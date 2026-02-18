import { Hono } from "hono";
import type {
  AirlockConfig,
  AirlockEvent,
  Platform,
  StoredUpdate,
  UpdateContext,
} from "./types";
import {
  buildMultipartResponse,
  buildNoUpdateResponse,
} from "./manifest";
import { isInRollout } from "./rollout";
import { signManifest } from "./crypto";

function emit(config: AirlockConfig, event: AirlockEvent) {
  if (config.onEvent) {
    // Fire and forget — don't block the response
    Promise.resolve(config.onEvent(event)).catch(() => {});
  }
}

function requireAuth(config: AirlockConfig, header: string | undefined) {
  if (!config.adminToken) return true;
  return header === `Bearer ${config.adminToken}`;
}

export function createAirlock(config: AirlockConfig) {
  const app = new Hono();

  // ─── Public: manifest ──────────────────────────────────────────────

  app.get("/manifest", async (c) => {
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

    const update = await config.adapter.getLatestUpdate(
      channel,
      runtimeVersion,
      platform
    );

    const ctx: UpdateContext = {
      channel,
      runtimeVersion,
      platform,
      headers: Object.fromEntries([...c.req.raw.headers.entries()]),
      currentUpdateId,
    };

    if (!update) {
      emit(config, { type: "manifest_request", context: ctx, served: false });
      return buildNoUpdateResponse();
    }

    // Already on this update
    if (currentUpdateId && update.manifest.id === currentUpdateId) {
      emit(config, { type: "manifest_request", context: ctx, served: false });
      return buildNoUpdateResponse();
    }

    // Rollout check
    const deviceId =
      c.req.header("expo-eas-client-id") ??
      c.req.header("eas-client-id") ??
      "anonymous";

    if (update.rolloutPercentage < 100) {
      const inRollout = await isInRollout(
        deviceId,
        update.manifest.id,
        update.rolloutPercentage
      );
      if (!inRollout) {
        emit(config, { type: "manifest_request", context: ctx, served: false });
        return buildNoUpdateResponse();
      }
    }

    // resolveUpdate hook
    let resolved = config.resolveUpdate
      ? await config.resolveUpdate(update, ctx)
      : update;

    if (!resolved) {
      emit(config, { type: "manifest_request", context: ctx, served: false });
      return buildNoUpdateResponse();
    }

    // Inject critical flag into manifest extra
    if (resolved.critical) {
      resolved = {
        ...resolved,
        manifest: {
          ...resolved.manifest,
          extra: { ...resolved.manifest.extra, critical: true },
        },
      };
    }

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
    const hash = c.req.param("hash");
    const url = await config.adapter.getAssetUrl(hash);
    emit(config, { type: "asset_request", hash, found: !!url });
    if (!url) return c.notFound();
    return c.redirect(url);
  });

  // ─── Admin: middleware ─────────────────────────────────────────────

  const admin = new Hono();

  admin.use("*", async (c, next) => {
    if (!requireAuth(config, c.req.header("authorization"))) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    await next();
  });

  // ─── Admin: publish ────────────────────────────────────────────────

  admin.post("/publish", async (c) => {
    const body = await c.req.json<{
      manifest: StoredUpdate["manifest"];
      channel?: string;
      runtimeVersion: string;
      platform: Platform;
      rolloutPercentage?: number;
      message?: string;
      critical?: boolean;
      assets?: Array<{ hash: string; base64: string; contentType: string }>;
    }>();

    const channel = body.channel ?? "default";
    const now = new Date().toISOString();

    // Store assets first
    if (body.assets?.length) {
      await Promise.all(
        body.assets.map((a) => {
          const data = Uint8Array.from(atob(a.base64), (ch) =>
            ch.charCodeAt(0)
          );
          return config.adapter.storeAsset(a.hash, data, a.contentType);
        })
      );
    }

    const update: StoredUpdate = {
      manifest: body.manifest,
      rolloutPercentage: body.rolloutPercentage ?? 100,
      message: body.message,
      critical: body.critical,
      createdAt: now,
      updatedAt: now,
    };

    await config.adapter.publishUpdate(
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
    const body = await c.req.json<{
      fromChannel: string;
      toChannel: string;
      runtimeVersion: string;
      platform: Platform;
    }>();

    const source = await config.adapter.getLatestUpdate(
      body.fromChannel,
      body.runtimeVersion,
      body.platform
    );
    if (!source) {
      return c.json({ error: "No update found in source channel" }, 404);
    }

    await config.adapter.promoteUpdate(
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
    const body = await c.req.json<{
      channel?: string;
      runtimeVersion: string;
      platform: Platform;
      updateId: string;
      percentage: number;
    }>();

    const channel = body.channel ?? "default";
    await config.adapter.setRollout(
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
    const body = await c.req.json<{
      channel?: string;
      runtimeVersion: string;
      platform: Platform;
    }>();

    const channel = body.channel ?? "default";
    const current = await config.adapter.getLatestUpdate(
      channel,
      body.runtimeVersion,
      body.platform
    );

    const previous = await config.adapter.rollbackUpdate(
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

  // ─── Admin: list updates ──────────────────────────────────────────

  admin.get("/updates", async (c) => {
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

    const updates = await config.adapter.getUpdateHistory(
      channel,
      runtimeVersion,
      platform,
      limit
    );

    return c.json({ updates });
  });

  app.route("/admin", admin);

  return { routes: app };
}
