import { describe, test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { createAirlock } from "./server";
import { MemoryAdapter } from "./adapters/memory";
import type { StoredUpdate, AirlockEvent, StorageAdapter, Platform, ClientEvent } from "./types";

function makeUpdate(overrides?: Partial<StoredUpdate>): StoredUpdate {
  return {
    manifest: {
      id: "update-1",
      createdAt: "2025-01-01T00:00:00Z",
      runtimeVersion: "1.0.0",
      launchAsset: {
        hash: "abc123",
        key: "bundle",
        contentType: "application/javascript",
        fileExtension: ".js",
        url: "https://cdn.example.com/bundle.js",
      },
      assets: [],
      metadata: {},
      extra: {},
    },
    rolloutPercentage: 100,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function manifestRequest(
  app: Hono,
  headers?: Record<string, string>
) {
  return app.request("/manifest", {
    headers: {
      "expo-platform": "ios",
      "expo-runtime-version": "1.0.0",
      ...headers,
    },
  });
}

function adminRequest(
  app: Hono,
  path: string,
  body: unknown,
  token = "test-token"
) {
  return app.request(`/admin${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

function extractManifestPart(body: string): {
  id: string;
  launchAsset: { url: string };
  assets: Array<{ url: string }>;
  extra: Record<string, unknown>;
} {
  const marker = 'Content-Disposition: inline; name="manifest"';
  const markerIndex = body.indexOf(marker);
  if (markerIndex === -1) throw new Error("manifest part not found");
  const jsonStart = body.indexOf("{", markerIndex);
  const endBoundary = body.indexOf("\r\n--airlock-boundary", jsonStart);
  if (jsonStart === -1 || endBoundary === -1) throw new Error("manifest JSON body not found");
  return JSON.parse(body.slice(jsonStart, endBoundary)) as {
    id: string;
    launchAsset: { url: string };
    assets: Array<{ url: string }>;
    extra: Record<string, unknown>;
  };
}

describe("airlock", () => {
  let adapter: MemoryAdapter;
  let app: Hono;
  let events: AirlockEvent[];

  beforeEach(() => {
    adapter = new MemoryAdapter();
    events = [];
    const airlock = createAirlock({
      adapter,
      adminToken: "test-token",
      onEvent: (e) => { events.push(e); },
    });
    app = new Hono();
    app.route("/", airlock.routes);
  });

  // ─── Manifest endpoint ───────────────────────────────────────────

  test("returns 204 when no update available", async () => {
    const res = await manifestRequest(app);
    expect(res.status).toBe(204);
  });

  test("returns 400 when missing required headers", async () => {
    const res = await app.request("/manifest");
    expect(res.status).toBe(400);
  });

  test("returns multipart manifest when update exists", async () => {
    await adapter.publishUpdate("default", "1.0.0", "ios", makeUpdate());
    const res = await manifestRequest(app);

    expect(res.status).toBe(200);
    const contentType = res.headers.get("content-type");
    expect(contentType).toContain("multipart/mixed");
    expect(contentType).toContain("boundary=");

    const body = await res.text();
    expect(body).toContain('"id":"update-1"');
    expect(body).toContain('Content-Disposition: inline; name="manifest"');
  });

  test("returns required protocol headers", async () => {
    await adapter.publishUpdate("default", "1.0.0", "ios", makeUpdate());
    const res = await manifestRequest(app);

    expect(res.headers.get("expo-protocol-version")).toBe("1");
    expect(res.headers.get("expo-sfv-version")).toBe("0");
    expect(res.headers.get("cache-control")).toBe("private, max-age=0");
  });

  test("returns 204 when client already has latest update", async () => {
    await adapter.publishUpdate("default", "1.0.0", "ios", makeUpdate());
    const res = await manifestRequest(app, {
      "expo-current-update-id": "update-1",
    });
    expect(res.status).toBe(204);
  });

  test("does not serve older update when client already runs latest", async () => {
    const older = makeUpdate({
      manifest: {
        ...makeUpdate().manifest,
        id: "update-older",
        createdAt: "2025-01-01T00:00:00Z",
      },
      createdAt: "2025-01-01T00:00:00Z",
      updatedAt: "2025-01-01T00:00:00Z",
    });
    const latest = makeUpdate({
      manifest: {
        ...makeUpdate().manifest,
        id: "update-latest",
        createdAt: "2025-01-02T00:00:00Z",
      },
      createdAt: "2025-01-02T00:00:00Z",
      updatedAt: "2025-01-02T00:00:00Z",
    });

    await adapter.publishUpdate("default", "1.0.0", "ios", older);
    await adapter.publishUpdate("default", "1.0.0", "ios", latest);

    const res = await manifestRequest(app, {
      "expo-current-update-id": "update-latest",
    });
    expect(res.status).toBe(204);
  });

  test("channel defaults to 'default'", async () => {
    await adapter.publishUpdate("default", "1.0.0", "ios", makeUpdate());
    const res = await manifestRequest(app);
    expect(res.status).toBe(200);
  });

  test("channel can be set via header", async () => {
    await adapter.publishUpdate("staging", "1.0.0", "ios", makeUpdate());
    const res = await manifestRequest(app, {
      "expo-channel-name": "staging",
    });
    expect(res.status).toBe(200);
  });

  test("platform filtering works", async () => {
    await adapter.publishUpdate("default", "1.0.0", "android", makeUpdate());
    // Request ios — should be 204
    const res = await manifestRequest(app);
    expect(res.status).toBe(204);
  });

  test("runtime version filtering works", async () => {
    await adapter.publishUpdate("default", "2.0.0", "ios", makeUpdate());
    // Request rv 1.0.0 — should be 204
    const res = await manifestRequest(app);
    expect(res.status).toBe(204);
  });

  // ─── Critical flag ───────────────────────────────────────────────

  test("critical flag is injected into manifest extra", async () => {
    await adapter.publishUpdate(
      "default", "1.0.0", "ios",
      makeUpdate({ critical: true })
    );
    const res = await manifestRequest(app);
    const body = await res.text();
    expect(body).toContain('"critical":true');
  });

  test("non-critical update does not have critical in extra", async () => {
    await adapter.publishUpdate("default", "1.0.0", "ios", makeUpdate());
    const res = await manifestRequest(app);
    const body = await res.text();
    // The manifest extra should be empty {}
    expect(body).not.toContain('"critical":true');
  });

  test("update kind/stage/immediateApply are injected into manifest extra", async () => {
    await adapter.publishUpdate(
      "default",
      "1.0.0",
      "ios",
      makeUpdate({
        kind: "emergency",
        stage: "production",
        targeting: { immediateApply: "always" },
      })
    );
    const res = await manifestRequest(app);
    const manifest = extractManifestPart(await res.text());
    expect(manifest.extra.updateKind).toBe("emergency");
    expect(manifest.extra.updateStage).toBe("production");
    expect(manifest.extra.immediateApply).toBe("always");
  });

  // ─── Rollout ─────────────────────────────────────────────────────

  test("rollout: 0% excludes all devices", async () => {
    await adapter.publishUpdate(
      "default", "1.0.0", "ios",
      makeUpdate({ rolloutPercentage: 0 })
    );
    const res = await manifestRequest(app, {
      "expo-eas-client-id": "device-abc",
    });
    expect(res.status).toBe(204);
  });

  test("rollout: 100% includes all devices", async () => {
    await adapter.publishUpdate(
      "default", "1.0.0", "ios",
      makeUpdate({ rolloutPercentage: 100 })
    );
    const res = await manifestRequest(app, {
      "expo-eas-client-id": "device-abc",
    });
    expect(res.status).toBe(200);
  });

  test("rollout: deterministic for same device", async () => {
    await adapter.publishUpdate(
      "default", "1.0.0", "ios",
      makeUpdate({ rolloutPercentage: 50 })
    );

    const results: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await manifestRequest(app, {
        "expo-eas-client-id": "stable-device-id",
      });
      results.push(res.status);
    }
    expect(new Set(results).size).toBe(1);
  });

  test("cohort targeting serves matching cohort update", async () => {
    await adapter.publishUpdate(
      "default",
      "1.0.0",
      "ios",
      makeUpdate({
        manifest: { ...makeUpdate().manifest, id: "update-a" },
        targeting: { cohort: "A" },
      })
    );
    await adapter.publishUpdate(
      "default",
      "1.0.0",
      "ios",
      makeUpdate({
        manifest: { ...makeUpdate().manifest, id: "update-b" },
        targeting: { cohort: "B" },
      })
    );

    const res = await manifestRequest(app, { "x-airlock-cohort": "A" });
    expect(res.status).toBe(200);
    const manifest = extractManifestPart(await res.text());
    expect(manifest.id).toBe("update-a");
  });

  test("minimum bandwidth targeting filters updates", async () => {
    await adapter.publishUpdate(
      "default",
      "1.0.0",
      "ios",
      makeUpdate({
        manifest: { ...makeUpdate().manifest, id: "update-fallback" },
      })
    );
    await adapter.publishUpdate(
      "default",
      "1.0.0",
      "ios",
      makeUpdate({
        manifest: { ...makeUpdate().manifest, id: "update-high-bandwidth" },
        targeting: { minBandwidthKbps: 5_000 },
      })
    );

    const res = await manifestRequest(app, { "x-airlock-bandwidth-kbps": "500" });
    expect(res.status).toBe(200);
    const manifest = extractManifestPart(await res.text());
    expect(manifest.id).toBe("update-fallback");
  });

  test("auto-blocks unhealthy update using crash rate telemetry", async () => {
    await adapter.publishUpdate(
      "default",
      "1.0.0",
      "ios",
      makeUpdate({
        manifest: { ...makeUpdate().manifest, id: "stable-update" },
      })
    );
    await adapter.publishUpdate(
      "default",
      "1.0.0",
      "ios",
      makeUpdate({
        manifest: { ...makeUpdate().manifest, id: "bad-update" },
      })
    );
    await adapter.recordClientEvents?.(
      Array.from({ length: 25 }).map((_, index) => ({
        type: index < 10 ? "launch" : "launch_failed",
        channel: "default",
        runtimeVersion: "1.0.0",
        platform: "ios",
        updateId: "bad-update",
      }))
    );

    const res = await manifestRequest(app);
    expect(res.status).toBe(200);
    const manifest = extractManifestPart(await res.text());
    expect(manifest.id).toBe("stable-update");
    expect(events.some((e) => e.type === "update_auto_blocked")).toBe(true);
  });

  test("does not auto-block from untrusted public telemetry by default", async () => {
    await adapter.publishUpdate(
      "default",
      "1.0.0",
      "ios",
      makeUpdate({
        manifest: { ...makeUpdate().manifest, id: "fallback-update" },
      })
    );
    await adapter.publishUpdate(
      "default",
      "1.0.0",
      "ios",
      makeUpdate({
        manifest: { ...makeUpdate().manifest, id: "latest-update" },
      })
    );
    const res = await app.request("/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        events: Array.from({ length: 25 }).map((_, index) => ({
          type: index < 10 ? "launch" : "launch_failed",
          channel: "default",
          runtimeVersion: "1.0.0",
          platform: "ios",
          updateId: "latest-update",
        })),
      }),
    });
    expect(res.status).toBe(400);
    // send in valid-sized chunks
    for (let i = 0; i < 25; i += 20) {
      const chunk = Array.from({ length: Math.min(20, 25 - i) }).map((_, index) => ({
        type: i + index < 10 ? "launch" : "launch_failed",
        channel: "default",
        runtimeVersion: "1.0.0",
        platform: "ios",
        updateId: "latest-update",
      }));
      const chunkRes = await app.request("/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ events: chunk }),
      });
      expect(chunkRes.status).toBe(200);
    }

    const manifestRes = await manifestRequest(app);
    expect(manifestRes.status).toBe(200);
    const manifest = extractManifestPart(await manifestRes.text());
    expect(manifest.id).toBe("latest-update");
  });

  test("can auto-block from untrusted telemetry when explicitly enabled", async () => {
    const adapter2 = new MemoryAdapter();
    const airlock2 = createAirlock({
      adapter: adapter2,
      stability: {
        useUntrustedTelemetry: true,
        minLaunchesForBlocking: 20,
        crashRateThreshold: 0.5,
      },
      telemetry: {
        maxUntrustedWeight: 1,
      },
    });
    const app2 = new Hono();
    app2.route("/", airlock2.routes);

    await adapter2.publishUpdate(
      "default",
      "1.0.0",
      "ios",
      makeUpdate({
        manifest: { ...makeUpdate().manifest, id: "fallback-update" },
      })
    );
    await adapter2.publishUpdate(
      "default",
      "1.0.0",
      "ios",
      makeUpdate({
        manifest: { ...makeUpdate().manifest, id: "latest-update" },
      })
    );
    for (let i = 0; i < 25; i += 20) {
      const chunk = Array.from({ length: Math.min(20, 25 - i) }).map((_, index) => ({
        type: i + index < 10 ? "launch" : "launch_failed",
        channel: "default",
        runtimeVersion: "1.0.0",
        platform: "ios",
        updateId: "latest-update",
        trustScore: 1,
      }));
      const chunkRes = await app2.request("/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ events: chunk }),
      });
      expect(chunkRes.status).toBe(200);
    }

    const manifestRes = await manifestRequest(app2);
    expect(manifestRes.status).toBe(200);
    const manifest = extractManifestPart(await manifestRes.text());
    expect(manifest.id).toBe("fallback-update");
  });

  // ─── resolveUpdate hook ──────────────────────────────────────────

  test("resolveUpdate hook is called", async () => {
    const adapter2 = new MemoryAdapter();
    let hookCalled = false;

    const airlock = createAirlock({
      adapter: adapter2,
      resolveUpdate: (update, ctx) => {
        hookCalled = true;
        expect(ctx.platform).toBe("ios");
        expect(ctx.runtimeVersion).toBe("1.0.0");
        return update;
      },
    });
    const app2 = new Hono();
    app2.route("/", airlock.routes);

    await adapter2.publishUpdate("default", "1.0.0", "ios", makeUpdate());
    await manifestRequest(app2);
    expect(hookCalled).toBe(true);
  });

  test("resolveUpdate hook can block update", async () => {
    const adapter2 = new MemoryAdapter();
    const airlock = createAirlock({
      adapter: adapter2,
      resolveUpdate: () => null,
    });
    const app2 = new Hono();
    app2.route("/", airlock.routes);

    await adapter2.publishUpdate("default", "1.0.0", "ios", makeUpdate());
    const res = await manifestRequest(app2);
    expect(res.status).toBe(204);
  });

  // ─── Asset proxy ─────────────────────────────────────────────────

  test("asset proxy redirects when asset exists", async () => {
    await adapter.storeAsset("abc123", new Uint8Array([1, 2, 3]), "application/js");
    const res = await app.request("/assets/abc123");
    expect(res.status).toBe(200);
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([1, 2, 3]);
  });

  test("asset proxy returns 404 for missing asset", async () => {
    const res = await app.request("/assets/nonexistent");
    expect(res.status).toBe(404);
  });

  // ─── onEvent ─────────────────────────────────────────────────────

  test("manifest_request event fires on 200", async () => {
    await adapter.publishUpdate("default", "1.0.0", "ios", makeUpdate());
    await manifestRequest(app);
    const evt = events.find((e) => e.type === "manifest_request");
    expect(evt).toBeDefined();
    expect(evt!.type === "manifest_request" && evt!.served).toBe(true);
    expect(evt!.type === "manifest_request" && evt!.updateId).toBe("update-1");
  });

  test("manifest_request event fires on 204", async () => {
    await manifestRequest(app);
    const evt = events.find((e) => e.type === "manifest_request");
    expect(evt).toBeDefined();
    expect(evt!.type === "manifest_request" && evt!.served).toBe(false);
  });

  test("asset_request event fires", async () => {
    await app.request("/assets/missing");
    const evt = events.find((e) => e.type === "asset_request");
    expect(evt).toBeDefined();
    expect(evt!.type === "asset_request" && evt!.found).toBe(false);
  });

  // ─── Admin: auth ─────────────────────────────────────────────────

  test("admin requires auth token", async () => {
    const res = await app.request("/admin/updates?runtimeVersion=1.0.0&platform=ios");
    expect(res.status).toBe(401);
  });

  test("admin rejects wrong token", async () => {
    const res = await app.request("/admin/updates?runtimeVersion=1.0.0&platform=ios", {
      headers: { Authorization: "Bearer wrong" },
    });
    expect(res.status).toBe(401);
  });

  test("admin allows correct token", async () => {
    const res = await app.request("/admin/updates?runtimeVersion=1.0.0&platform=ios", {
      headers: { Authorization: "Bearer test-token" },
    });
    expect(res.status).toBe(200);
  });

  test("admin works without token when none configured", async () => {
    const airlock = createAirlock({ adapter: new MemoryAdapter() });
    const noAuthApp = new Hono();
    noAuthApp.route("/", airlock.routes);
    const res = await noAuthApp.request("/admin/updates?runtimeVersion=1.0.0&platform=ios");
    expect(res.status).toBe(200);
  });

  test("client events are accepted and persisted", async () => {
    const res = await adminRequest(app, "/client-events", {
      events: [
        {
          type: "launch",
          channel: "default",
          runtimeVersion: "1.0.0",
          platform: "ios",
          updateId: "update-1",
        },
        {
          type: "update_applied",
          channel: "default",
          runtimeVersion: "1.0.0",
          platform: "ios",
          updateId: "update-1",
          durationMs: 650,
        },
      ],
    });
    expect(res.status).toBe(200);

    const healthRes = await app.request(
      "/admin/health?runtimeVersion=1.0.0&platform=ios",
      { headers: { Authorization: "Bearer test-token" } }
    );
    expect(healthRes.status).toBe(200);
    const healthBody = await healthRes.json() as {
      supported: boolean;
      health: Array<{
        updateId: string;
        totalLaunches: number;
        trustedLaunches: number;
        avgApplyMs: number | null;
      }>;
    };
    expect(healthBody.supported).toBe(true);
    expect(healthBody.health.find((h) => h.updateId === "update-1")?.totalLaunches).toBe(1);
    expect(healthBody.health.find((h) => h.updateId === "update-1")?.trustedLaunches).toBe(1);
    expect(healthBody.health.find((h) => h.updateId === "update-1")?.avgApplyMs).toBe(650);
  });

  test("public events endpoint accepts unauthenticated telemetry as untrusted", async () => {
    const res = await app.request("/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: {
          type: "launch",
          channel: "default",
          runtimeVersion: "1.0.0",
          platform: "ios",
          updateId: "update-1",
        },
      }),
    });
    expect(res.status).toBe(200);

    const healthRes = await app.request(
      "/admin/health?runtimeVersion=1.0.0&platform=ios",
      { headers: { Authorization: "Bearer test-token" } }
    );
    const healthBody = await healthRes.json() as {
      health: Array<{
        updateId: string;
        totalLaunches: number;
        trustedLaunches: number;
        weightedLaunches: number;
      }>;
    };
    expect(healthBody.health.find((h) => h.updateId === "update-1")?.totalLaunches).toBe(1);
    expect(healthBody.health.find((h) => h.updateId === "update-1")?.trustedLaunches).toBe(0);
    expect(healthBody.health.find((h) => h.updateId === "update-1")?.weightedLaunches).toBe(0.25);
  });

  test("public events trust score is normalized and capped", async () => {
    const res = await app.request("/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        event: {
          type: "launch_failed",
          channel: "default",
          runtimeVersion: "1.0.0",
          platform: "ios",
          updateId: "update-1",
          trustScore: 95,
        },
      }),
    });
    expect(res.status).toBe(200);

    const healthRes = await app.request(
      "/admin/health?runtimeVersion=1.0.0&platform=ios",
      { headers: { Authorization: "Bearer test-token" } }
    );
    const healthBody = await healthRes.json() as {
      health: Array<{
        updateId: string;
        weightedLaunches: number;
        weightedFailedLaunches: number;
      }>;
    };
    // default public cap is 0.25 regardless of higher provided score.
    expect(healthBody.health.find((h) => h.updateId === "update-1")?.weightedLaunches).toBe(0.25);
    expect(healthBody.health.find((h) => h.updateId === "update-1")?.weightedFailedLaunches).toBe(0.25);
  });

  test("public events endpoint enforces rate and batch limits", async () => {
    const strictAirlock = createAirlock({
      adapter: new MemoryAdapter(),
      adminToken: "test-token",
      telemetry: {
        maxEventsPerRequest: 1,
        rateLimitWindowMs: 60_000,
        rateLimitMaxRequests: 1,
      },
    });
    const strictApp = new Hono();
    strictApp.route("/", strictAirlock.routes);

    const tooManyEvents = await strictApp.request("/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        events: [
          {
            type: "launch",
            channel: "default",
            runtimeVersion: "1.0.0",
            platform: "ios",
            updateId: "u1",
          },
          {
            type: "launch",
            channel: "default",
            runtimeVersion: "1.0.0",
            platform: "ios",
            updateId: "u1",
          },
        ],
      }),
    });
    expect(tooManyEvents.status).toBe(400);

    const first = await strictApp.request("/events", {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": "1.1.1.1" },
      body: JSON.stringify({
        event: {
          type: "launch",
          channel: "default",
          runtimeVersion: "1.0.0",
          platform: "ios",
          updateId: "u1",
        },
      }),
    });
    expect(first.status).toBe(200);

    const second = await strictApp.request("/events", {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": "1.1.1.1" },
      body: JSON.stringify({
        event: {
          type: "launch",
          channel: "default",
          runtimeVersion: "1.0.0",
          platform: "ios",
          updateId: "u1",
        },
      }),
    });
    expect(second.status).toBe(429);
  });

  test("metrics endpoint returns aggregates from ingested telemetry", async () => {
    const eventsPayload = {
      events: [
        {
          type: "launch",
          channel: "default",
          runtimeVersion: "1.0.0",
          platform: "ios",
          updateId: "u1",
          networkType: "wifi",
          bandwidthKbps: 15000,
          cohort: "A",
          stage: "production",
          appliedFromEmbedded: false,
        },
        {
          type: "launch_failed",
          channel: "default",
          runtimeVersion: "1.0.0",
          platform: "ios",
          updateId: "u1",
          networkType: "cellular",
          bandwidthKbps: 300,
          error: "boom",
          cohort: "A",
          stage: "production",
        },
        {
          type: "update_downloaded",
          channel: "default",
          runtimeVersion: "1.0.0",
          platform: "ios",
          updateId: "u1",
          durationMs: 1200,
        },
        {
          type: "update_applied",
          channel: "default",
          runtimeVersion: "1.0.0",
          platform: "ios",
          updateId: "u1",
          durationMs: 400,
        },
      ],
    };
    const ingest = await adminRequest(app, "/client-events", eventsPayload);
    expect(ingest.status).toBe(200);

    const overviewRes = await app.request(
      "/admin/metrics/overview?runtimeVersion=1.0.0&platform=ios",
      { headers: { Authorization: "Bearer test-token" } }
    );
    expect(overviewRes.status).toBe(200);
    const overviewBody = await overviewRes.json() as {
      supported: boolean;
      overview: { totalEvents: number; byType: Record<string, number> };
    };
    expect(overviewBody.supported).toBe(true);
    expect(overviewBody.overview.totalEvents).toBe(4);
    expect(overviewBody.overview.byType.launch).toBe(1);
    expect(overviewBody.overview.byType.launch_failed).toBe(1);

    const timingsRes = await app.request(
      "/admin/metrics/timings?runtimeVersion=1.0.0&platform=ios",
      { headers: { Authorization: "Bearer test-token" } }
    );
    expect(timingsRes.status).toBe(200);
    const timingsBody = await timingsRes.json() as {
      supported: boolean;
      timings: { update_downloaded: { avgMs: number | null } };
    };
    expect(timingsBody.supported).toBe(true);
    expect(timingsBody.timings.update_downloaded.avgMs).toBe(1200);

    const segmentsRes = await app.request(
      "/admin/metrics/segments?runtimeVersion=1.0.0&platform=ios",
      { headers: { Authorization: "Bearer test-token" } }
    );
    expect(segmentsRes.status).toBe(200);
    const segmentsBody = await segmentsRes.json() as {
      supported: boolean;
      segments: {
        bandwidthBuckets: Array<{ key: string; launches: number }>;
      };
    };
    expect(segmentsBody.supported).toBe(true);
    expect(
      segmentsBody.segments.bandwidthBuckets.some((entry) => entry.key === "very_high")
    ).toBe(true);
    expect(
      segmentsBody.segments.bandwidthBuckets.some((entry) => entry.key === "low")
    ).toBe(true);
  });

  test("metrics query validation enforces required params and window bounds", async () => {
    const missing = await app.request("/admin/metrics/overview?platform=ios", {
      headers: { Authorization: "Bearer test-token" },
    });
    expect(missing.status).toBe(400);

    const largeRange = await app.request(
      "/admin/metrics/overview?runtimeVersion=1.0.0&platform=ios&from=2020-01-01T00:00:00.000Z&to=2026-01-01T00:00:00.000Z",
      { headers: { Authorization: "Bearer test-token" } }
    );
    expect(largeRange.status).toBe(400);
  });

  test("metricsAuth can override admin bearer for /admin/metrics routes", async () => {
    const adapter2 = new MemoryAdapter();
    await adapter2.recordClientEvents?.([
      {
        type: "launch",
        channel: "default",
        runtimeVersion: "1.0.0",
        platform: "ios",
        updateId: "u1",
      },
    ]);
    const airlock2 = createAirlock({
      adapter: adapter2,
      adminToken: "test-token",
      metricsAuth: (req) => req.headers.get("x-metrics-key") === "allow",
    });
    const app2 = new Hono();
    app2.route("/", airlock2.routes);

    const denied = await app2.request(
      "/admin/metrics/overview?runtimeVersion=1.0.0&platform=ios"
    );
    expect(denied.status).toBe(401);

    const allowed = await app2.request(
      "/admin/metrics/overview?runtimeVersion=1.0.0&platform=ios",
      { headers: { "x-metrics-key": "allow" } }
    );
    expect(allowed.status).toBe(200);

    const nonMetricsDenied = await app2.request(
      "/admin/updates?runtimeVersion=1.0.0&platform=ios",
      { headers: { "x-metrics-key": "allow" } }
    );
    expect(nonMetricsDenied.status).toBe(401);
  });

  test("metrics endpoints return supported=false when adapter has no metrics methods", async () => {
    class NoMetricsAdapter implements StorageAdapter {
      private base = new MemoryAdapter();
      getLatestUpdate(channel: string, runtimeVersion: string, platform: Platform) {
        return this.base.getLatestUpdate(channel, runtimeVersion, platform);
      }
      publishUpdate(channel: string, runtimeVersion: string, platform: Platform, update: StoredUpdate) {
        return this.base.publishUpdate(channel, runtimeVersion, platform, update);
      }
      setRollout(channel: string, runtimeVersion: string, platform: Platform, updateId: string, percentage: number) {
        return this.base.setRollout(channel, runtimeVersion, platform, updateId, percentage);
      }
      promoteUpdate(fromChannel: string, toChannel: string, runtimeVersion: string, platform: Platform) {
        return this.base.promoteUpdate(fromChannel, toChannel, runtimeVersion, platform);
      }
      rollbackUpdate(channel: string, runtimeVersion: string, platform: Platform) {
        return this.base.rollbackUpdate(channel, runtimeVersion, platform);
      }
      getUpdateHistory(channel: string, runtimeVersion: string, platform: Platform, limit?: number) {
        return this.base.getUpdateHistory(channel, runtimeVersion, platform, limit);
      }
      listUpdates() {
        return this.base.listUpdates();
      }
      getAssetUrl(hash: string) {
        return this.base.getAssetUrl(hash);
      }
      storeAsset(hash: string, data: Uint8Array | ReadableStream | ArrayBuffer, contentType: string) {
        return this.base.storeAsset(hash, data, contentType);
      }
      recordClientEvents(events: ClientEvent[]) {
        return this.base.recordClientEvents(events);
      }
      getUpdateHealth(channel: string, runtimeVersion: string, platform: Platform, limit?: number) {
        return this.base.getUpdateHealth(channel, runtimeVersion, platform, limit);
      }
    }

    const airlock2 = createAirlock({
      adapter: new NoMetricsAdapter(),
      adminToken: "test-token",
    });
    const app2 = new Hono();
    app2.route("/", airlock2.routes);

    const res = await app2.request(
      "/admin/metrics/overview?runtimeVersion=1.0.0&platform=ios",
      { headers: { Authorization: "Bearer test-token" } }
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { supported: boolean; overview: unknown };
    expect(body.supported).toBe(false);
    expect(body.overview).toBeNull();
  });

  // ─── Admin: publish ──────────────────────────────────────────────

  test("publish then fetch roundtrip", async () => {
    const manifest = makeUpdate().manifest;

    const pubRes = await adminRequest(app, "/publish", {
      manifest,
      runtimeVersion: "1.0.0",
      platform: "ios",
      message: "fix login crash",
    });
    expect(pubRes.status).toBe(200);
    const pubJson = await pubRes.json() as { ok: boolean; updateId: string };
    expect(pubJson.ok).toBe(true);

    // Now fetch it
    const res = await manifestRequest(app);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain(manifest.id);

    // Check event
    const evt = events.find((e) => e.type === "update_published");
    expect(evt).toBeDefined();
  });

  test("publish stores assets", async () => {
    const manifest = makeUpdate().manifest;
    const assetData = btoa("hello world");

    await adminRequest(app, "/publish", {
      manifest,
      runtimeVersion: "1.0.0",
      platform: "ios",
      assets: [{ hash: "test-hash", base64: assetData, contentType: "text/plain" }],
    });

    const stored = adapter.getAsset("test-hash");
    expect(stored).not.toBeNull();
    expect(new TextDecoder().decode(stored!.data)).toBe("hello world");
  });

  test("publish with custom channel", async () => {
    await adminRequest(app, "/publish", {
      manifest: makeUpdate().manifest,
      runtimeVersion: "1.0.0",
      platform: "ios",
      channel: "staging",
    });

    // default channel — no update
    const res1 = await manifestRequest(app);
    expect(res1.status).toBe(204);

    // staging channel — has update
    const res2 = await manifestRequest(app, { "expo-channel-name": "staging" });
    expect(res2.status).toBe(200);
  });

  test("publish with rollout percentage", async () => {
    await adminRequest(app, "/publish", {
      manifest: makeUpdate({ rolloutPercentage: 0 }).manifest,
      runtimeVersion: "1.0.0",
      platform: "ios",
      rolloutPercentage: 0,
    });

    const res = await manifestRequest(app, {
      "expo-eas-client-id": "any-device",
    });
    expect(res.status).toBe(204);
  });

  test("manifest normalizes legacy _assets URLs to assets/*", async () => {
    await adminRequest(app, "/publish", {
      manifest: {
        ...makeUpdate().manifest,
        launchAsset: { ...makeUpdate().manifest.launchAsset, url: "_assets/legacy-bundle" },
        assets: [
          {
            ...makeUpdate().manifest.launchAsset,
            hash: "legacy-asset",
            url: "_assets/legacy-asset",
          },
        ],
      },
      runtimeVersion: "1.0.0",
      platform: "ios",
    });

    const res = await manifestRequest(app);
    expect(res.status).toBe(200);
    const body = await res.text();
    const manifest = extractManifestPart(body);

    expect(manifest.launchAsset.url).toBe("http://localhost/assets/abc123");
    expect(manifest.assets[0].url).toBe("http://localhost/assets/legacy-asset");
  });

  test("manifest keeps valid asset URLs unchanged", async () => {
    await adminRequest(app, "/publish", {
      manifest: {
        ...makeUpdate().manifest,
        launchAsset: { ...makeUpdate().manifest.launchAsset, url: "assets/abc123" },
      },
      runtimeVersion: "1.0.0",
      platform: "ios",
    });

    const res = await manifestRequest(app);
    expect(res.status).toBe(200);
    const body = await res.text();
    const manifest = extractManifestPart(body);

    expect(manifest.launchAsset.url).toBe("http://localhost/assets/abc123");
  });

  // ─── Admin: promote ──────────────────────────────────────────────

  test("promote copies update between channels", async () => {
    await adminRequest(app, "/publish", {
      manifest: makeUpdate().manifest,
      runtimeVersion: "1.0.0",
      platform: "ios",
      channel: "staging",
    });

    const promRes = await adminRequest(app, "/promote", {
      fromChannel: "staging",
      toChannel: "production",
      runtimeVersion: "1.0.0",
      platform: "ios",
    });
    expect(promRes.status).toBe(200);

    const res = await manifestRequest(app, { "expo-channel-name": "production" });
    expect(res.status).toBe(200);

    const evt = events.find((e) => e.type === "update_promoted");
    expect(evt).toBeDefined();
  });

  test("promote returns 404 when source channel empty", async () => {
    const res = await adminRequest(app, "/promote", {
      fromChannel: "staging",
      toChannel: "production",
      runtimeVersion: "1.0.0",
      platform: "ios",
    });
    expect(res.status).toBe(404);
  });

  // ─── Admin: rollout ──────────────────────────────────────────────

  test("rollout changes percentage", async () => {
    await adminRequest(app, "/publish", {
      manifest: makeUpdate().manifest,
      runtimeVersion: "1.0.0",
      platform: "ios",
    });

    await adminRequest(app, "/rollout", {
      runtimeVersion: "1.0.0",
      platform: "ios",
      updateId: "update-1",
      percentage: 0,
    });

    const res = await manifestRequest(app, {
      "expo-eas-client-id": "any-device",
    });
    expect(res.status).toBe(204);

    const evt = events.find((e) => e.type === "rollout_changed");
    expect(evt).toBeDefined();
  });

  // ─── Admin: rollback ─────────────────────────────────────────────

  test("rollback reverts to previous update", async () => {
    // Publish two updates
    const manifest1 = makeUpdate().manifest;
    const manifest2 = {
      ...makeUpdate().manifest,
      id: "update-2",
    };

    await adminRequest(app, "/publish", {
      manifest: manifest1,
      runtimeVersion: "1.0.0",
      platform: "ios",
    });
    await adminRequest(app, "/publish", {
      manifest: manifest2,
      runtimeVersion: "1.0.0",
      platform: "ios",
    });

    // Verify update-2 is current
    let res = await manifestRequest(app);
    let body = await res.text();
    expect(body).toContain("update-2");

    // Rollback
    const rbRes = await adminRequest(app, "/rollback", {
      runtimeVersion: "1.0.0",
      platform: "ios",
    });
    expect(rbRes.status).toBe(200);
    const rbJson = await rbRes.json() as { activeUpdateId: string };
    expect(rbJson.activeUpdateId).toBe("update-1");

    // Verify update-1 is now current
    res = await manifestRequest(app);
    body = await res.text();
    expect(body).toContain("update-1");

    const evt = events.find((e) => e.type === "update_rolled_back");
    expect(evt).toBeDefined();
  });

  test("rollback returns 404 when no previous update", async () => {
    await adminRequest(app, "/publish", {
      manifest: makeUpdate().manifest,
      runtimeVersion: "1.0.0",
      platform: "ios",
    });

    const res = await adminRequest(app, "/rollback", {
      runtimeVersion: "1.0.0",
      platform: "ios",
    });
    expect(res.status).toBe(404);
  });

  // ─── Admin: list updates ─────────────────────────────────────────

  test("list returns update history", async () => {
    await adminRequest(app, "/publish", {
      manifest: makeUpdate().manifest,
      runtimeVersion: "1.0.0",
      platform: "ios",
      message: "first",
    });
    await adminRequest(app, "/publish", {
      manifest: { ...makeUpdate().manifest, id: "update-2" },
      runtimeVersion: "1.0.0",
      platform: "ios",
      message: "second",
    });

    const res = await app.request(
      "/admin/updates?runtimeVersion=1.0.0&platform=ios",
      { headers: { Authorization: "Bearer test-token" } }
    );
    expect(res.status).toBe(200);
    const json = await res.json() as { updates: StoredUpdate[] };
    expect(json.updates.length).toBe(2);
    expect(json.updates[0].message).toBe("second");
    expect(json.updates[1].message).toBe("first");
  });

  test("list returns 400 without required params", async () => {
    const res = await app.request("/admin/updates", {
      headers: { Authorization: "Bearer test-token" },
    });
    expect(res.status).toBe(400);
  });

  // ─── Admin: input validation ──────────────────────────────────────

  test("publish rejects missing manifest", async () => {
    const res = await adminRequest(app, "/publish", {
      runtimeVersion: "1.0.0",
      platform: "ios",
    });
    expect(res.status).toBe(400);
  });

  test("publish rejects invalid platform", async () => {
    const res = await adminRequest(app, "/publish", {
      manifest: makeUpdate().manifest,
      runtimeVersion: "1.0.0",
      platform: "windows",
    });
    expect(res.status).toBe(400);
  });

  test("publish rejects rollout > 100", async () => {
    const res = await adminRequest(app, "/publish", {
      manifest: makeUpdate().manifest,
      runtimeVersion: "1.0.0",
      platform: "ios",
      rolloutPercentage: 150,
    });
    expect(res.status).toBe(400);
  });

  test("rollout rejects percentage > 100", async () => {
    const res = await adminRequest(app, "/rollout", {
      runtimeVersion: "1.0.0",
      platform: "ios",
      updateId: "update-1",
      percentage: 200,
    });
    expect(res.status).toBe(400);
  });
});

// ─── Adapter factory ─────────────────────────────────────────────────

describe("adapter factory", () => {
  test("factory is called per-request", async () => {
    const adapter = new MemoryAdapter();
    let callCount = 0;

    const airlock = createAirlock({
      adapter: (_env: unknown) => {
        callCount++;
        return adapter;
      },
    });

    const factoryApp = new Hono();
    factoryApp.route("/", airlock.routes);

    await factoryApp.request("/manifest", {
      headers: { "expo-platform": "ios", "expo-runtime-version": "1.0.0" },
    });
    expect(callCount).toBe(1);

    // Second request — factory called again
    await factoryApp.request("/assets/missing");
    expect(callCount).toBe(2);
  });

  test("factory adminToken is resolved per-request", async () => {
    const airlock = createAirlock({
      adapter: new MemoryAdapter(),
      adminToken: (env: unknown) => (env as { ADMIN: string })?.ADMIN ?? "dynamic-token",
    });

    const factoryApp = new Hono();
    factoryApp.route("/", airlock.routes);

    // Wrong token — should 401
    const res401 = await factoryApp.request("/admin/updates?runtimeVersion=1.0.0&platform=ios", {
      headers: { Authorization: "Bearer wrong" },
    });
    expect(res401.status).toBe(401);

    // Correct resolved token — should 200
    const res200 = await factoryApp.request("/admin/updates?runtimeVersion=1.0.0&platform=ios", {
      headers: { Authorization: "Bearer dynamic-token" },
    });
    expect(res200.status).toBe(200);
  });
});

// ─── mount() ─────────────────────────────────────────────────────────

describe("mount()", () => {
  test("strips basePath prefix from request URL", async () => {
    const adapter = new MemoryAdapter();
    await adapter.publishUpdate("default", "1.0.0", "ios", makeUpdate({
      manifest: {
        ...makeUpdate().manifest,
        launchAsset: { ...makeUpdate().manifest.launchAsset, url: "_assets/abc123" },
      },
    }));

    const airlock = createAirlock({ adapter });
    const handler = airlock.mount("/ota");

    const res = await handler(
      new Request("https://api.example.com/ota/manifest", {
        headers: {
          "expo-platform": "ios",
          "expo-runtime-version": "1.0.0",
        },
      })
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    const manifest = extractManifestPart(body);
    expect(manifest.launchAsset.url).toBe("https://api.example.com/ota/assets/abc123");
  });

  test("strips basePath with trailing slash", async () => {
    const adapter = new MemoryAdapter();
    const airlock = createAirlock({ adapter });
    const handler = airlock.mount("/ota/");

    const res = await handler(
      new Request("https://api.example.com/ota/manifest", {
        headers: {
          "expo-platform": "ios",
          "expo-runtime-version": "1.0.0",
        },
      })
    );
    expect(res.status).toBe(204); // no updates, but routing worked (not 404)
  });

  test("preserves request method and headers for admin routes", async () => {
    const adapter = new MemoryAdapter();
    const airlock = createAirlock({ adapter, adminToken: "tok" });
    const handler = airlock.mount("/ota");

    const res = await handler(
      new Request("https://api.example.com/ota/admin/updates?runtimeVersion=1.0.0&platform=ios", {
        method: "GET",
        headers: { Authorization: "Bearer tok" },
      })
    );
    expect(res.status).toBe(200);
  });

  test("passes env to adapter factory when called from mount()", async () => {
    const adapter = new MemoryAdapter();
    let envReceived: unknown;

    const airlock = createAirlock({
      adapter: (env: unknown) => {
        envReceived = env;
        return adapter;
      },
    });
    const handler = airlock.mount("/ota");

    const fakeEnv = { MY_BINDING: "hello" };
    await handler(
      new Request("https://api.example.com/ota/manifest", {
        headers: {
          "expo-platform": "ios",
          "expo-runtime-version": "1.0.0",
        },
      }),
      fakeEnv
    );
    expect(envReceived).toBe(fakeEnv);
  });

  test("asset redirects preserve mount base path for local adapter URLs", async () => {
    const adapter = new MemoryAdapter();
    await adapter.storeAsset("abc123", new Uint8Array([1, 2, 3]), "application/octet-stream");
    const airlock = createAirlock({ adapter });
    const handler = airlock.mount("/ota");

    const res = await handler(
      new Request("https://api.example.com/ota/assets/abc123")
    );
    expect(res.status).toBe(200);
    expect(Array.from(new Uint8Array(await res.arrayBuffer()))).toEqual([1, 2, 3]);
  });
});

// ─── Code signing tests ────────────────────────────────────────────

import { generateKeyPair } from "./crypto";

describe("code signing", () => {
  test("signature is included as per-part header in multipart body", async () => {
    const keyPair = await generateKeyPair();
    const adapter2 = new MemoryAdapter();
    const airlock = createAirlock({
      adapter: adapter2,
      signingKey: keyPair.privateKey,
    });
    const signedApp = new Hono();
    signedApp.route("/", airlock.routes);

    await adapter2.publishUpdate("default", "1.0.0", "ios", makeUpdate());
    const res = await manifestRequest(signedApp);
    expect(res.status).toBe(200);

    const body = await res.text();
    // expo-signature should be inside the multipart body, not as a response header
    expect(body).toContain("expo-signature:");
    expect(body).toContain('alg="rsa-v1_5-sha256"');
    expect(body).toContain('keyid="main"');
    expect(body).toContain('sig="');

    // Should NOT be a response-level header
    expect(res.headers.get("expo-signature")).toBeNull();
  });

  test("signature uses custom keyId when configured", async () => {
    const keyPair = await generateKeyPair();
    const adapter2 = new MemoryAdapter();
    const airlock = createAirlock({
      adapter: adapter2,
      signingKey: keyPair.privateKey,
      signingKeyId: "custom-key",
    });
    const signedApp = new Hono();
    signedApp.route("/", airlock.routes);

    await adapter2.publishUpdate("default", "1.0.0", "ios", makeUpdate());
    const res = await manifestRequest(signedApp);
    const body = await res.text();
    expect(body).toContain('keyid="custom-key"');
  });

  test("certificate chain is included as multipart part", async () => {
    const keyPair = await generateKeyPair();
    const adapter2 = new MemoryAdapter();
    const fakeCert = "-----BEGIN CERTIFICATE-----\nMIIBfake...\n-----END CERTIFICATE-----";
    const airlock = createAirlock({
      adapter: adapter2,
      signingKey: keyPair.privateKey,
      certificateChain: fakeCert,
    });
    const signedApp = new Hono();
    signedApp.route("/", airlock.routes);

    await adapter2.publishUpdate("default", "1.0.0", "ios", makeUpdate());
    const res = await manifestRequest(signedApp);
    const body = await res.text();
    expect(body).toContain('name="certificate_chain"');
    expect(body).toContain("application/x-pem-file");
    expect(body).toContain("MIIBfake");
  });

  test("unsigned response has no expo-signature in body", async () => {
    const adapter2 = new MemoryAdapter();
    const airlock = createAirlock({ adapter: adapter2 });
    const unsignedApp = new Hono();
    unsignedApp.route("/", airlock.routes);

    await adapter2.publishUpdate("default", "1.0.0", "ios", makeUpdate());
    const res = await manifestRequest(unsignedApp);
    const body = await res.text();
    expect(body).not.toContain("expo-signature:");
  });
});

// ─── Multipart format tests ──────────────────────────────────────────

describe("multipart format", () => {
  test("response contains manifest and extensions parts", async () => {
    const adapter2 = new MemoryAdapter();
    const airlock2 = createAirlock({ adapter: adapter2 });
    const testApp = new Hono();
    testApp.route("/", airlock2.routes);

    await adapter2.publishUpdate("default", "1.0.0", "ios", makeUpdate());
    const res = await manifestRequest(testApp);
    const body = await res.text();

    expect(body).toContain('name="manifest"');
    expect(body).toContain('name="extensions"');
    expect(body).toContain("\r\n");
  });

  test("204 response includes protocol headers", async () => {
    const adapter2 = new MemoryAdapter();
    const airlock2 = createAirlock({ adapter: adapter2 });
    const testApp = new Hono();
    testApp.route("/", airlock2.routes);

    const res = await manifestRequest(testApp);
    expect(res.status).toBe(204);
    expect(res.headers.get("expo-protocol-version")).toBe("1");
    expect(res.headers.get("expo-sfv-version")).toBe("0");
    expect(res.headers.get("cache-control")).toBe("private, max-age=0");
  });
});

// ─── Rollout unit tests ──────────────────────────────────────────────

import { isInRollout } from "./rollout";

describe("rollout", () => {
  test("0% always returns false", async () => {
    expect(await isInRollout("device", "update", 0)).toBe(false);
  });

  test("100% always returns true", async () => {
    expect(await isInRollout("device", "update", 100)).toBe(true);
  });

  test("deterministic — same inputs always produce same result", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => isInRollout("device-x", "update-y", 50))
    );
    expect(new Set(results).size).toBe(1);
  });

  test("distribution is roughly even at 50%", async () => {
    let included = 0;
    const total = 200;

    for (let i = 0; i < total; i++) {
      if (await isInRollout(`device-${i}`, "update-z", 50)) included++;
    }

    // Should be roughly 50% — allow ±20% tolerance
    expect(included).toBeGreaterThan(total * 0.3);
    expect(included).toBeLessThan(total * 0.7);
  });

  test("different update IDs can give different results for same device", async () => {
    const results = new Set<boolean>();
    for (let i = 0; i < 50; i++) {
      results.add(await isInRollout("stable-device", `update-${i}`, 50));
    }
    // With 50 different update IDs at 50%, we should see both true and false
    expect(results.size).toBe(2);
  });
});
