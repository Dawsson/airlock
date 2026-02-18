import { describe, test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { createAirlock } from "./server";
import { MemoryAdapter } from "./adapters/memory";
import type { StoredUpdate, AirlockEvent } from "./types";

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
    expect(res.status).toBe(302);
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
