import { describe, test, expect, beforeEach } from "bun:test";
import { Hono } from "hono";
import { createAirlock } from "./server";
import { MemoryAdapter } from "./adapters/memory";
import type { StoredUpdate } from "./types";

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

describe("airlock", () => {
  let adapter: MemoryAdapter;
  let app: Hono;

  beforeEach(() => {
    adapter = new MemoryAdapter();
    const airlock = createAirlock({ adapter });
    app = new Hono();
    app.route("/", airlock.routes);
  });

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
    expect(body).toContain("Content-Disposition: inline; name=\"manifest\"");
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

  test("rollout: 0% excludes all devices", async () => {
    await adapter.publishUpdate(
      "default",
      "1.0.0",
      "ios",
      makeUpdate({ rolloutPercentage: 0 })
    );
    const res = await manifestRequest(app, {
      "expo-eas-client-id": "device-abc",
    });
    expect(res.status).toBe(204);
  });

  test("rollout: 100% includes all devices", async () => {
    await adapter.publishUpdate(
      "default",
      "1.0.0",
      "ios",
      makeUpdate({ rolloutPercentage: 100 })
    );
    const res = await manifestRequest(app, {
      "expo-eas-client-id": "device-abc",
    });
    expect(res.status).toBe(200);
  });

  test("rollout: deterministic for same device", async () => {
    await adapter.publishUpdate(
      "default",
      "1.0.0",
      "ios",
      makeUpdate({ rolloutPercentage: 50 })
    );

    const results: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await manifestRequest(app, {
        "expo-eas-client-id": "stable-device-id",
      });
      results.push(res.status);
    }
    // All results should be the same (deterministic)
    expect(new Set(results).size).toBe(1);
  });

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

  test("asset proxy redirects when asset exists", async () => {
    adapter.storeAsset("abc123", new Uint8Array([1, 2, 3]), "application/js");
    const res = await app.request("/assets/abc123");
    expect(res.status).toBe(302);
  });

  test("asset proxy returns 404 for missing asset", async () => {
    const res = await app.request("/assets/nonexistent");
    expect(res.status).toBe(404);
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
});
