import { Hono } from "hono";
import type {
  AirlockConfig,
  AirlockEvent,
  ClientEvent,
  Platform,
  StorageAdapter,
  StoredUpdate,
  UpdateHealth,
  UpdateStage,
  UpdateContext,
} from "./types";
import {
  buildMultipartResponse,
  buildNoUpdateResponse,
} from "./manifest";
import { isInRollout } from "./rollout";
import { signManifest } from "./crypto";
import type { ExpoManifest, ManifestAsset } from "./types";

function emit(config: AirlockConfig, event: AirlockEvent) {
  if (config.onEvent) {
    // Fire and forget — don't block the response
    Promise.resolve(config.onEvent(event)).catch(() => {});
  }
}

function resolveAdapter(config: AirlockConfig, env: unknown): StorageAdapter {
  return typeof config.adapter === "function" ? config.adapter(env) : config.adapter;
}

function resolveAdminToken(config: AirlockConfig, env: unknown): string | undefined {
  return typeof config.adminToken === "function" ? config.adminToken(env) : config.adminToken;
}

function resolveClientEventToken(config: AirlockConfig, env: unknown): string | undefined {
  return typeof config.clientEventToken === "function"
    ? config.clientEventToken(env)
    : config.clientEventToken;
}

function requireAuth(adminToken: string | undefined, header: string | undefined) {
  if (!adminToken) return true;
  const expected = `Bearer ${adminToken}`;
  if (!header || header.length !== expected.length) return false;
  // Constant-time comparison to prevent timing attacks
  const a = new TextEncoder().encode(header);
  const b = new TextEncoder().encode(expected);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function normalizeAssetUrl(
  asset: ManifestAsset,
  origin: string,
  basePath: string
): ManifestAsset {
  let url = asset.url;
  if (!url || url.startsWith("_assets/") || url.startsWith("/_assets/")) {
    url = `assets/${asset.hash}`;
  }
  if (/^https?:\/\//i.test(url)) return { ...asset, url };

  // Expo iOS client expects absolute URLs for launch and static assets.
  const normalizedBase = basePath && basePath !== "/" ? `/${basePath.replace(/^\/+|\/+$/g, "")}` : "";
  return { ...asset, url: `${origin}${normalizedBase}/assets/${asset.hash}` };
}

function normalizeManifest(
  manifest: ExpoManifest,
  requestUrl: string,
  basePath: string
): ExpoManifest {
  const url = new URL(requestUrl);
  const origin = url.origin;
  const inferredBase = url.pathname.endsWith("/manifest")
    ? url.pathname.slice(0, -"/manifest".length)
    : "";
  const effectiveBasePath = basePath || inferredBase;
  return {
    ...manifest,
    launchAsset: normalizeAssetUrl(manifest.launchAsset, origin, effectiveBasePath),
    assets: manifest.assets.map((asset) =>
      normalizeAssetUrl(asset, origin, effectiveBasePath)
    ),
  };
}

function inferBaseFromPath(pathname: string, suffix: string): string {
  return pathname.endsWith(suffix) ? pathname.slice(0, -suffix.length) : "";
}

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseExpoExtraParams(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  // Structured-field dictionary form: key="value", key2="value2"
  const regex = /([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(header)) !== null) {
    out[match[1]] = match[2];
  }
  return out;
}

function getClientIp(headers: Headers): string {
  const cf = headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const real = headers.get("x-real-ip");
  if (real) return real.trim();
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return "unknown";
}

function validateClientEvents(events: ClientEvent[], now = Date.now(), maxTimestampSkewMs = 86_400_000): string | null {
  for (const event of events) {
    if (!event.channel || event.channel.length > 100) return "Invalid channel";
    if (!event.runtimeVersion || event.runtimeVersion.length > 100) return "Invalid runtimeVersion";
    if (event.updateId && event.updateId.length > 128) return "Invalid updateId";
    if (event.deviceId && event.deviceId.length > 256) return "Invalid deviceId";
    if (event.error && event.error.length > 1024) return "Invalid error";
    if (typeof event.trustScore === "number" && !Number.isFinite(event.trustScore)) {
      return "Invalid trustScore";
    }
    if (typeof event.durationMs === "number" && (event.durationMs < 0 || event.durationMs > 600_000)) {
      return "Invalid durationMs";
    }
    if (typeof event.bandwidthKbps === "number" && (event.bandwidthKbps < 0 || event.bandwidthKbps > 10_000_000)) {
      return "Invalid bandwidthKbps";
    }
    if (event.timestamp) {
      const ts = Date.parse(event.timestamp);
      if (!Number.isFinite(ts)) return "Invalid timestamp";
      if (Math.abs(now - ts) > maxTimestampSkewMs) return "Timestamp outside allowed skew window";
    }
  }
  return null;
}

function defaultNormalizeTrustScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  if (score <= 1 && score >= 0) return score;
  if (score <= 100 && score >= 0) return score / 100;
  if (score <= 1000 && score >= 0) return score / 1000;
  return Math.max(0, Math.min(1, score));
}

function getTrustWeight(
  event: ClientEvent,
  trustedRequest: boolean,
  config: AirlockConfig
): number {
  if (trustedRequest) return 1;
  const maxUntrustedWeight = config.telemetry?.maxUntrustedWeight ?? 0.25;
  const raw = event.trustScore;
  if (typeof raw !== "number") {
    return maxUntrustedWeight;
  }
  const normalized = config.telemetry?.normalizeTrustScore
    ? config.telemetry.normalizeTrustScore(raw, event)
    : defaultNormalizeTrustScore(raw);
  const safe = Math.max(0, Math.min(1, normalized));
  return Math.min(maxUntrustedWeight, safe);
}

function matchesTargeting(update: StoredUpdate, ctx: UpdateContext): boolean {
  const targeting = update.targeting;
  if (!targeting) return true;
  if (targeting.cohort && targeting.cohort !== ctx.cohort) return false;
  if (
    typeof targeting.minBandwidthKbps === "number" &&
    (ctx.bandwidthKbps == null || ctx.bandwidthKbps < targeting.minBandwidthKbps)
  ) {
    return false;
  }
  if (
    Array.isArray(targeting.allowedStages) &&
    targeting.allowedStages.length > 0 &&
    (!ctx.stage || !targeting.allowedStages.includes(ctx.stage))
  ) {
    return false;
  }
  return true;
}

function isHealthBlocked(
  updateId: string,
  health: Map<string, UpdateHealth>,
  config: AirlockConfig
): UpdateHealth | null {
  const autoBlock = config.stability?.autoBlockUnhealthy ?? true;
  if (!autoBlock) return null;
  const minLaunches = config.stability?.minLaunchesForBlocking ?? 20;
  const crashRateThreshold = config.stability?.crashRateThreshold ?? 0.2;
  const useUntrusted = config.stability?.useUntrustedTelemetry ?? false;
  const entry = health.get(updateId);
  if (!entry) return null;
  const launches = useUntrusted ? entry.weightedLaunches : entry.trustedLaunches;
  const crashRate = useUntrusted ? entry.weightedCrashRate : entry.trustedCrashRate;
  if (launches < minLaunches) return null;
  if (crashRate < crashRateThreshold) return null;
  return entry;
}

export function createAirlock(config: AirlockConfig) {
  const app = new Hono();
  const telemetryRate = new Map<string, { windowStart: number; count: number }>();

  // ─── Public: manifest ──────────────────────────────────────────────

  app.get("/manifest", async (c) => {
    const adapter = resolveAdapter(config, c.env);
    const platform = (c.req.header("expo-platform") ??
      c.req.query("platform")) as Platform | undefined;
    const runtimeVersion =
      c.req.header("expo-runtime-version") ?? c.req.query("runtimeVersion");
    const channel =
      c.req.header("expo-channel-name") ??
      c.req.query("channel") ??
      "default";
    const currentUpdateId =
      c.req.header("expo-current-update-id") ?? null;

    if (!platform || !runtimeVersion) {
      return c.json(
        { error: "Missing expo-platform or expo-runtime-version" },
        400
      );
    }

    const deviceId =
      c.req.header("expo-eas-client-id") ??
      c.req.header("eas-client-id") ??
      "anonymous";

    const extraParams = parseExpoExtraParams(c.req.header("expo-extra-params"));
    const stage = (
      c.req.header("x-airlock-stage") ??
      extraParams["airlock-stage"] ??
      extraParams.stage ??
      null
    ) as UpdateStage | null;
    const cohort =
      c.req.header("x-airlock-cohort") ??
      extraParams["airlock-cohort"] ??
      extraParams.cohort ??
      null;
    const bandwidthKbps = parseNumber(
      c.req.header("x-airlock-bandwidth-kbps") ??
        extraParams["airlock-bandwidth-kbps"] ??
        extraParams.bandwidthKbps
    );

    const ctx: UpdateContext = {
      channel,
      runtimeVersion,
      platform,
      headers: Object.fromEntries([...c.req.raw.headers.entries()]),
      currentUpdateId,
      deviceId,
      stage,
      cohort,
      bandwidthKbps,
    };

    const history = await adapter.getUpdateHistory(
      channel,
      runtimeVersion,
      platform,
      50
    );
    if (!history.length) {
      emit(config, { type: "manifest_request", context: ctx, served: false });
      return buildNoUpdateResponse();
    }

    const healthRows = adapter.getUpdateHealth
      ? await adapter.getUpdateHealth(channel, runtimeVersion, platform, 100)
      : [];
    const healthByUpdate = new Map(healthRows.map((row) => [row.updateId, row]));
    let update: StoredUpdate | null = null;
    const currentIndex = currentUpdateId
      ? history.findIndex((entry) => entry.manifest.id === currentUpdateId)
      : -1;
    // Never "downgrade" by serving updates older than the currently running one.
    // History is expected newest-first, so only candidates before currentIndex are newer.
    const candidates =
      currentIndex >= 0 ? history.slice(0, currentIndex) : history;

    for (const candidate of candidates) {
      if (!matchesTargeting(candidate, ctx)) continue;
      if (candidate.rolloutPercentage < 100) {
        const inRollout = await isInRollout(
          deviceId,
          candidate.manifest.id,
          candidate.rolloutPercentage
        );
        if (!inRollout) continue;
      }
      const blockedHealth = isHealthBlocked(candidate.manifest.id, healthByUpdate, config);
      if (blockedHealth) {
        const useUntrusted = config.stability?.useUntrustedTelemetry ?? false;
        emit(config, {
          type: "update_auto_blocked",
          updateId: candidate.manifest.id,
          channel,
          runtimeVersion,
          platform,
          crashRate: useUntrusted ? blockedHealth.weightedCrashRate : blockedHealth.trustedCrashRate,
          launches: useUntrusted
            ? Math.round(blockedHealth.weightedLaunches)
            : blockedHealth.trustedLaunches,
        });
        continue;
      }
      update = candidate;
      break;
    }

    if (!update) {
      emit(config, { type: "manifest_request", context: ctx, served: false });
      return buildNoUpdateResponse();
    }

    // resolveUpdate hook
    let resolved = config.resolveUpdate
      ? await config.resolveUpdate(update, ctx)
      : update;

    if (!resolved) {
      emit(config, { type: "manifest_request", context: ctx, served: false });
      return buildNoUpdateResponse();
    }

    const extra = {
      ...resolved.manifest.extra,
      ...(resolved.critical ? { critical: true } : {}),
      ...(resolved.kind ? { updateKind: resolved.kind } : {}),
      ...(resolved.stage ? { updateStage: resolved.stage } : {}),
      ...(resolved.targeting?.immediateApply
        ? { immediateApply: resolved.targeting.immediateApply }
        : {}),
    };
    resolved = {
      ...resolved,
      manifest: {
        ...resolved.manifest,
        extra,
      },
    };

    const basePath = c.req.header("x-airlock-base-path") ?? "";
    resolved = {
      ...resolved,
      manifest: normalizeManifest(resolved.manifest, c.req.url, basePath),
    };

    // Code signing
    let signature: string | undefined;
    if (config.signingKey) {
      signature = await signManifest(
        JSON.stringify(resolved.manifest),
        config.signingKey,
        config.signingKeyId ?? "main"
      );
    }

    emit(config, {
      type: "manifest_request",
      context: ctx,
      served: true,
      updateId: resolved.manifest.id,
    });

    return buildMultipartResponse(resolved.manifest, {
      signature,
      certificateChain: config.certificateChain,
    });
  });

  // ─── Public: asset proxy ───────────────────────────────────────────

  app.get("/assets/:hash", async (c) => {
    const adapter = resolveAdapter(config, c.env);
    const hash = c.req.param("hash");
    const rawUrl = await adapter.getAssetUrl(hash);
    emit(config, { type: "asset_request", hash, found: !!rawUrl });
    if (!rawUrl) return c.notFound();

    const requestUrl = new URL(c.req.url);
    const headerBase = c.req.header("x-airlock-base-path") ?? "";
    const inferredBase = inferBaseFromPath(requestUrl.pathname, `/assets/${hash}`);
    const basePath = headerBase || inferredBase;
    const assetRecord = (
      adapter as {
        getAsset?: (assetHash: string) =>
          | { data: Uint8Array; contentType: string }
          | null;
      }
    ).getAsset?.(hash) ?? null;

    const serveAssetRecord = () =>
      new Response(assetRecord!.data as unknown as BodyInit, {
        status: 200,
        headers: {
          "content-type": assetRecord!.contentType,
          "cache-control": "public, max-age=31536000, immutable",
        },
      });

    // mount("/ota") + MemoryAdapter returns "/assets/:hash"; redirecting would loop.
    if (headerBase && rawUrl.startsWith("/assets/") && assetRecord) {
      return serveAssetRecord();
    }

    let redirectUrl = rawUrl;
    if (!/^https?:\/\//i.test(redirectUrl)) {
      if (redirectUrl.startsWith("/assets/") && basePath) {
        const normalizedBase = `/${basePath.replace(/^\/+|\/+$/g, "")}`;
        redirectUrl = `${requestUrl.origin}${normalizedBase}${redirectUrl}`;
      } else if (redirectUrl.startsWith("/")) {
        redirectUrl = `${requestUrl.origin}${redirectUrl}`;
      } else {
        const normalizedBase = basePath
          ? `/${basePath.replace(/^\/+|\/+$/g, "")}`
          : "";
        redirectUrl = `${requestUrl.origin}${normalizedBase}/${redirectUrl.replace(/^\/+/, "")}`;
      }
    }

    if (redirectUrl === requestUrl.toString()) {
      if (assetRecord) {
        return serveAssetRecord();
      }
      return c.notFound();
    }

    return c.redirect(redirectUrl);
  });

  // ─── Public: client telemetry ────────────────────────────────────

  app.post("/events", async (c) => {
    const adapter = resolveAdapter(config, c.env);
    if (!adapter.recordClientEvents) {
      return c.json({ error: "Adapter does not support telemetry storage" }, 501);
    }
    if (config.telemetry?.enablePublicEndpoint === false) {
      return c.notFound();
    }

    const maxBodyBytes = config.telemetry?.maxBodyBytes ?? 32_768;
    const lengthHeader = c.req.header("content-length");
    if (lengthHeader) {
      const length = Number(lengthHeader);
      if (Number.isFinite(length) && length > maxBodyBytes) {
        return c.json({ error: "Payload too large" }, 413);
      }
    }

    const token = resolveClientEventToken(config, c.env);
    if (!requireAuth(token, c.req.header("authorization"))) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const rateLimitWindowMs = config.telemetry?.rateLimitWindowMs ?? 60_000;
    const rateLimitMaxRequests = config.telemetry?.rateLimitMaxRequests ?? 120;
    const ip = getClientIp(c.req.raw.headers);
    const nowMs = Date.now();
    const bucket = telemetryRate.get(ip) ?? { windowStart: nowMs, count: 0 };
    if (nowMs - bucket.windowStart > rateLimitWindowMs) {
      bucket.windowStart = nowMs;
      bucket.count = 0;
    }
    bucket.count += 1;
    telemetryRate.set(ip, bucket);
    if (bucket.count > rateLimitMaxRequests) {
      return c.json({ error: "Rate limit exceeded" }, 429);
    }

    const body = await c.req.json<{
      events?: ClientEvent[];
      event?: ClientEvent;
      defaultTrustScore?: number;
    }>();
    const events = body.events ?? (body.event ? [body.event] : []);
    if (!events.length) {
      return c.json({ error: "Missing events payload" }, 400);
    }
    const maxEventsPerRequest = config.telemetry?.maxEventsPerRequest ?? 20;
    if (events.length > maxEventsPerRequest) {
      return c.json({ error: `Too many events; max is ${maxEventsPerRequest}` }, 400);
    }

    for (const event of events) {
      if (!event.channel || !event.runtimeVersion || !event.platform || !event.type) {
        return c.json({ error: "Each event requires channel, runtimeVersion, platform, and type" }, 400);
      }
    }
    const validationError = validateClientEvents(
      events,
      nowMs,
      config.telemetry?.maxTimestampSkewMs ?? 86_400_000
    );
    if (validationError) {
      return c.json({ error: validationError }, 400);
    }

    const trusted = !!token;

    await adapter.recordClientEvents(
      events.map((event) => {
        const withScore = {
          ...event,
          trustScore:
            typeof event.trustScore === "number"
              ? event.trustScore
              : body.defaultTrustScore,
        };
        return {
          ...withScore,
          trusted,
          trustWeight: getTrustWeight(withScore, trusted, config),
          timestamp: event.timestamp ?? new Date().toISOString(),
        };
      })
    );

    const first = events[0];
    emit(config, {
      type: "client_events_recorded",
      count: events.length,
      channel: first.channel,
      runtimeVersion: first.runtimeVersion,
      platform: first.platform,
    });

    return c.json({ ok: true, count: events.length });
  });

  // ─── Admin: middleware ─────────────────────────────────────────────

  const admin = new Hono();

  admin.use("*", async (c, next) => {
    const token = resolveAdminToken(config, c.env);
    if (!requireAuth(token, c.req.header("authorization"))) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  });

  // ─── Admin: publish ────────────────────────────────────────────────

  admin.post("/publish", async (c) => {
    const adapter = resolveAdapter(config, c.env);
    const body = await c.req.json<{
      manifest: StoredUpdate["manifest"];
      channel?: string;
      runtimeVersion: string;
      platform: Platform;
      rolloutPercentage?: number;
      message?: string;
      critical?: boolean;
      kind?: StoredUpdate["kind"];
      stage?: StoredUpdate["stage"];
      tags?: string[];
      targeting?: StoredUpdate["targeting"];
      assets?: Array<{ hash: string; base64: string; contentType: string }>;
    }>();

    if (!body.manifest?.id || !body.runtimeVersion || !body.platform) {
      return c.json({ error: "Missing manifest, runtimeVersion, or platform" }, 400);
    }
    if (body.platform !== "ios" && body.platform !== "android") {
      return c.json({ error: "platform must be ios or android" }, 400);
    }
    const pct = body.rolloutPercentage ?? 100;
    if (pct < 0 || pct > 100) {
      return c.json({ error: "rolloutPercentage must be 0-100" }, 400);
    }

    const channel = body.channel ?? "default";
    const now = new Date().toISOString();

    // Store assets first
    if (body.assets?.length) {
      await Promise.all(
        body.assets.map((a) => {
          const data = Uint8Array.from(atob(a.base64), (ch) =>
            ch.charCodeAt(0)
          );
          return adapter.storeAsset(a.hash, data, a.contentType);
        })
      );
    }

    const update: StoredUpdate = {
      manifest: body.manifest,
      rolloutPercentage: pct,
      message: body.message,
      critical: body.critical,
      kind: body.kind,
      stage: body.stage,
      tags: body.tags,
      targeting: body.targeting,
      createdAt: now,
      updatedAt: now,
    };

    await adapter.publishUpdate(
      channel,
      body.runtimeVersion,
      body.platform,
      update
    );

    emit(config, {
      type: "update_published",
      updateId: body.manifest.id,
      channel,
      runtimeVersion: body.runtimeVersion,
      platform: body.platform,
    });

    return c.json({ ok: true, updateId: body.manifest.id });
  });

  // ─── Admin: promote ────────────────────────────────────────────────

  admin.post("/promote", async (c) => {
    const adapter = resolveAdapter(config, c.env);
    const body = await c.req.json<{
      fromChannel: string;
      toChannel: string;
      runtimeVersion: string;
      platform: Platform;
    }>();

    const source = await adapter.getLatestUpdate(
      body.fromChannel,
      body.runtimeVersion,
      body.platform
    );
    if (!source) {
      return c.json({ error: "No update found in source channel" }, 404);
    }

    await adapter.promoteUpdate(
      body.fromChannel,
      body.toChannel,
      body.runtimeVersion,
      body.platform
    );

    emit(config, {
      type: "update_promoted",
      updateId: source.manifest.id,
      fromChannel: body.fromChannel,
      toChannel: body.toChannel,
    });

    return c.json({ ok: true, updateId: source.manifest.id });
  });

  // ─── Admin: rollout ────────────────────────────────────────────────

  admin.post("/rollout", async (c) => {
    const adapter = resolveAdapter(config, c.env);
    const body = await c.req.json<{
      channel?: string;
      runtimeVersion: string;
      platform: Platform;
      updateId: string;
      percentage: number;
    }>();

    if (!body.runtimeVersion || !body.platform || !body.updateId || body.percentage == null) {
      return c.json({ error: "Missing runtimeVersion, platform, updateId, or percentage" }, 400);
    }
    if (body.percentage < 0 || body.percentage > 100) {
      return c.json({ error: "percentage must be 0-100" }, 400);
    }

    const channel = body.channel ?? "default";
    await adapter.setRollout(
      channel,
      body.runtimeVersion,
      body.platform,
      body.updateId,
      body.percentage
    );

    emit(config, {
      type: "rollout_changed",
      updateId: body.updateId,
      percentage: body.percentage,
    });

    return c.json({ ok: true });
  });

  // ─── Admin: rollback ───────────────────────────────────────────────

  admin.post("/rollback", async (c) => {
    const adapter = resolveAdapter(config, c.env);
    const body = await c.req.json<{
      channel?: string;
      runtimeVersion: string;
      platform: Platform;
    }>();

    const channel = body.channel ?? "default";
    const current = await adapter.getLatestUpdate(
      channel,
      body.runtimeVersion,
      body.platform
    );

    const previous = await adapter.rollbackUpdate(
      channel,
      body.runtimeVersion,
      body.platform
    );

    if (!previous) {
      return c.json({ error: "No previous update to roll back to" }, 404);
    }

    emit(config, {
      type: "update_rolled_back",
      channel,
      rolledBackId: current?.manifest.id ?? "unknown",
    });

    return c.json({ ok: true, activeUpdateId: previous.manifest.id });
  });

  // ─── Admin: status (all updates across all channels/platforms/runtimes) ──

  admin.get("/status", async (c) => {
    const adapter = resolveAdapter(config, c.env);
    const updates = await adapter.listUpdates();
    return c.json({ updates });
  });

  // ─── Admin: list updates ──────────────────────────────────────────

  admin.get("/updates", async (c) => {
    const adapter = resolveAdapter(config, c.env);
    const channel = c.req.query("channel") ?? "default";
    const runtimeVersion = c.req.query("runtimeVersion");
    const platform = c.req.query("platform") as Platform | undefined;
    const limit = parseInt(c.req.query("limit") ?? "20");

    if (!runtimeVersion || !platform) {
      return c.json(
        { error: "Missing runtimeVersion or platform query param" },
        400
      );
    }

    const updates = await adapter.getUpdateHistory(
      channel,
      runtimeVersion,
      platform,
      limit
    );

    return c.json({ updates });
  });

  // ─── Admin: client telemetry ─────────────────────────────────────

  admin.post("/client-events", async (c) => {
    const adapter = resolveAdapter(config, c.env);
    if (!adapter.recordClientEvents) {
      return c.json({ error: "Adapter does not support telemetry storage" }, 501);
    }

    const body = await c.req.json<{
      events?: ClientEvent[];
      event?: ClientEvent;
      defaultTrustScore?: number;
    }>();
    const events = body.events ?? (body.event ? [body.event] : []);
    if (!events.length) {
      return c.json({ error: "Missing events payload" }, 400);
    }
    const maxEventsPerRequest = config.telemetry?.maxEventsPerRequest ?? 20;
    if (events.length > maxEventsPerRequest) {
      return c.json({ error: `Too many events; max is ${maxEventsPerRequest}` }, 400);
    }

    for (const event of events) {
      if (!event.channel || !event.runtimeVersion || !event.platform || !event.type) {
        return c.json({ error: "Each event requires channel, runtimeVersion, platform, and type" }, 400);
      }
    }
    const validationError = validateClientEvents(
      events,
      Date.now(),
      config.telemetry?.maxTimestampSkewMs ?? 86_400_000
    );
    if (validationError) {
      return c.json({ error: validationError }, 400);
    }

    await adapter.recordClientEvents(
      events.map((event) => {
        const withScore = {
          ...event,
          trustScore:
            typeof event.trustScore === "number"
              ? event.trustScore
              : body.defaultTrustScore,
        };
        return {
          ...withScore,
          trusted: true,
          trustWeight: 1,
          timestamp: event.timestamp ?? new Date().toISOString(),
        };
      })
    );

    const first = events[0];
    emit(config, {
      type: "client_events_recorded",
      count: events.length,
      channel: first.channel,
      runtimeVersion: first.runtimeVersion,
      platform: first.platform,
    });

    return c.json({ ok: true, count: events.length });
  });

  admin.get("/health", async (c) => {
    const adapter = resolveAdapter(config, c.env);
    const channel = c.req.query("channel") ?? "default";
    const runtimeVersion = c.req.query("runtimeVersion");
    const platform = c.req.query("platform") as Platform | undefined;
    const limit = parseInt(c.req.query("limit") ?? "20");

    if (!runtimeVersion || !platform) {
      return c.json(
        { error: "Missing runtimeVersion or platform query param" },
        400
      );
    }

    if (!adapter.getUpdateHealth) {
      return c.json({ supported: false, health: [] });
    }

    const health = await adapter.getUpdateHealth(
      channel,
      runtimeVersion,
      platform,
      limit
    );
    return c.json({ supported: true, health });
  });

  app.route("/admin", admin);

  return {
    routes: app,

    /**
     * Returns a WinterCG-compatible fetch handler with the basePath prefix
     * stripped from incoming requests. Works with any framework or runtime.
     *
     * ```ts
     * const handler = airlock.mount("/ota")
     *
     * // Cloudflare Worker:
     * export default { fetch: handler }
     *
     * // Hono:
     * app.all("/ota/*", (c) => handler(c.req.raw, c.env))
     *
     * // Elysia / Bun.serve:
     * Bun.serve({ fetch: handler })
     * ```
     */
    mount(basePath: string): (request: Request, env?: unknown) => Promise<Response> {
      const base = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
      return (request: Request, env?: unknown): Promise<Response> => {
        const url = new URL(request.url);
        if (url.pathname.startsWith(base)) {
          url.pathname = url.pathname.slice(base.length) || "/";
        }
        const headers = new Headers(request.headers);
        headers.set("x-airlock-base-path", base);
        return Promise.resolve(app.fetch(new Request(url.toString(), {
          method: request.method,
          headers,
          body: request.body,
          redirect: request.redirect,
        }), env));
      };
    },
  };
}
