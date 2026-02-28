import { Hono } from "hono";
import { createAirlock } from "../server";
import { MemoryAdapter } from "../adapters/memory";
import type { StoredUpdate } from "../types";

function makeUpdate(id: string, extras?: Partial<StoredUpdate>): StoredUpdate {
  return {
    manifest: {
      id,
      createdAt: new Date().toISOString(),
      runtimeVersion: "1.0.0",
      launchAsset: {
        hash: `${id}-bundle`,
        key: "bundle",
        contentType: "application/javascript",
        fileExtension: ".js",
        url: `assets/${id}-bundle`,
      },
      assets: [],
      metadata: {},
      extra: {},
    },
    rolloutPercentage: 100,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...extras,
  };
}

function extractManifestId(body: string): string {
  const marker = 'Content-Disposition: inline; name="manifest"';
  const markerIndex = body.indexOf(marker);
  if (markerIndex === -1) throw new Error("manifest part not found");
  const jsonStart = body.indexOf("{", markerIndex);
  const endBoundary = body.indexOf("\r\n--airlock-boundary", jsonStart);
  if (jsonStart === -1 || endBoundary === -1) throw new Error("manifest JSON body not found");
  const parsed = JSON.parse(body.slice(jsonStart, endBoundary)) as { id: string };
  return parsed.id;
}

async function requestManifest(
  app: Hono,
  headers: Record<string, string> = {}
): Promise<Response> {
  return app.request("/manifest", {
    headers: {
      "expo-platform": "ios",
      "expo-runtime-version": "1.0.0",
      "expo-channel-name": "production",
      "expo-eas-client-id": "device-1",
      ...headers,
    },
  });
}

async function main() {
  const adapter = new MemoryAdapter();
  const airlock = createAirlock({
    adapter,
    adminToken: "test-token",
    stability: {
      minLaunchesForBlocking: 10,
      crashRateThreshold: 0.5,
    },
  });
  const app = new Hono();
  app.route("/", airlock.routes);

  // A/B cohorts in same channel/runtime/platform.
  await adapter.publishUpdate("production", "1.0.0", "ios", makeUpdate("control", {
    targeting: { cohort: "control" },
  }));
  await adapter.publishUpdate("production", "1.0.0", "ios", makeUpdate("variant-a", {
    targeting: { cohort: "A" },
  }));

  const cohortRes = await requestManifest(app, { "x-airlock-cohort": "A" });
  if (cohortRes.status !== 200) throw new Error(`expected cohort manifest status 200, got ${cohortRes.status}`);
  const cohortId = extractManifestId(await cohortRes.text());
  if (cohortId !== "variant-a") {
    throw new Error(`expected A cohort to receive variant-a, got ${cohortId}`);
  }

  await adapter.publishUpdate("production", "1.0.0", "ios", makeUpdate("general"));

  // Connection-speed gating: high-bandwidth update should be skipped on slower network.
  await adapter.publishUpdate("production", "1.0.0", "ios", makeUpdate("high-bandwidth", {
    targeting: { minBandwidthKbps: 10_000 },
  }));
  const slowRes = await requestManifest(app, { "x-airlock-bandwidth-kbps": "1000" });
  if (slowRes.status !== 200) throw new Error(`expected slow network manifest status 200, got ${slowRes.status}`);
  const slowId = extractManifestId(await slowRes.text());
  if (slowId === "high-bandwidth") {
    throw new Error("expected high-bandwidth update to be filtered out on slow network");
  }

  // Crash telemetry auto-block: unhealthy latest should be bypassed.
  await adapter.publishUpdate("production", "1.0.0", "ios", makeUpdate("bad-latest"));
  await adapter.recordClientEvents?.(
    Array.from({ length: 12 }).map((_, index) => ({
      type: index < 4 ? "launch" : "launch_failed",
      channel: "production",
      runtimeVersion: "1.0.0",
      platform: "ios",
      updateId: "bad-latest",
    }))
  );

  const blockedRes = await requestManifest(app);
  if (blockedRes.status !== 200) throw new Error(`expected blocked fallback manifest status 200, got ${blockedRes.status}`);
  const blockedId = extractManifestId(await blockedRes.text());
  if (blockedId === "bad-latest") {
    throw new Error("expected unhealthy latest update to be auto-blocked");
  }

  // Manual rollback still works and should activate previous update.
  const rollbackRes = await app.request("/admin/rollback", {
    method: "POST",
    headers: {
      Authorization: "Bearer test-token",
      "content-type": "application/json",
    },
    body: JSON.stringify({ channel: "production", runtimeVersion: "1.0.0", platform: "ios" }),
  });
  if (rollbackRes.status !== 200) {
    throw new Error(`expected rollback 200, got ${rollbackRes.status}`);
  }

  const healthRes = await app.request("/admin/health?channel=production&runtimeVersion=1.0.0&platform=ios", {
    headers: { Authorization: "Bearer test-token" },
  });
  if (healthRes.status !== 200) throw new Error(`expected health 200, got ${healthRes.status}`);
  const healthJson = await healthRes.json() as { supported: boolean; health: Array<{ updateId: string; crashRate: number }> };
  if (!healthJson.supported) throw new Error("expected health endpoint to be supported");
  if (!healthJson.health.find((entry) => entry.updateId === "bad-latest")) {
    throw new Error("expected health stats for bad-latest");
  }

  console.log("PASS: advanced feature checks complete (A/B, bandwidth gating, crash auto-block, rollback, health).");
}

await main();
