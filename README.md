# airlock

Self-hosted Expo OTA update server. Ships as a Hono library you mount on your existing API.

## Install

There are two ways to use airlock — as a **server library** and as a **CLI tool**. They're the same package.

### Server (Cloudflare Worker / Hono app)

Add it as a dependency in your API project:

```bash
bun add @dawsson/airlock
```

Then import and mount it (see Quick Start below).

### CLI (publish updates from your machine or CI)

Run without installing:

```bash
bunx @dawsson/airlock publish --platform ios --runtime 1.0.0
```

Or install globally so `airlock` is always available:

```bash
bun add -g @dawsson/airlock
airlock publish --platform ios --runtime 1.0.0
```

Or add as a dev dependency in your Expo project:

```bash
bun add -D @dawsson/airlock
bunx airlock publish --platform ios --runtime 1.0.0
```

You can also install the Airlock skill into your coding agent with:

```bash
npx skills add dawsson/airlock
```

## Quick Start

```ts
import { createAirlock } from "@dawsson/airlock";
import { CloudflareAdapter } from "@dawsson/airlock/adapters/cloudflare";

// Adapter and token factories are called per-request with the runtime env —
// the correct pattern for Cloudflare Workers where bindings aren't available at module init.
// CloudflareAdapter.forEnv() falls back to MemoryAdapter in local dev (no crash, just a log).
const airlock = createAirlock({
  adapter: (env: Env) =>
    CloudflareAdapter.forEnv({
      kv: env.OTA_KV,
      r2: env.OTA_R2,
      r2PublicUrl: env.R2_PUBLIC_URL,
    }),
  adminToken: (env: Env) => env.AIRLOCK_ADMIN_TOKEN,
  // Optional: only set if you want to require a bearer token on POST /events.
  // clientEventToken: (env: Env) => env.AIRLOCK_CLIENT_EVENT_TOKEN,
  metricsAuth: (req) => req.headers.get("x-internal-dashboard-key") === "allow",
});

// Returns a standard WinterCG fetch handler with basePath prefix stripping built in.
const handler = airlock.mount("/ota");

export default { fetch: handler };
```

Or mount on an existing Hono app:

```ts
import { Hono } from "hono";
const app = new Hono<{ Bindings: Env }>();
app.all("/ota/*", (c) => handler(c.req.raw, c.env));
```

Point your Expo app at `https://your-api.com/ota/manifest` and updates just work.

## Local Persistent Adapter

For local/dev workflows where state should survive restarts, use the file-backed adapter:

```ts
import { createAirlock } from "@dawsson/airlock";
import { FileAdapter } from "@dawsson/airlock/adapters/file";

const airlock = createAirlock({
  adapter: new FileAdapter({ filePath: ".airlock/state.json" }),
  adminToken: process.env.AIRLOCK_ADMIN_TOKEN,
});
```

This persists updates, assets, health, and metrics snapshots to JSON on disk.

## Expo App Configuration

Add this to your `app.json` or `app.config.ts`:

```json
{
  "expo": {
    "updates": {
      "url": "https://your-api.com/ota/manifest",
      "enabled": true,
      "checkAutomatically": "ON_LOAD"
    },
    "runtimeVersion": {
      "policy": "appVersion"
    }
  }
}
```

## CLI

```bash
# Initialize config
airlock init --server https://api.example.com/ota --token your-admin-token

# Publish from expo export output
npx expo export --platform ios
airlock publish --platform ios --runtime 1.0.0 --message "fix login crash"
airlock publish --platform ios --runtime 1.0.0 --kind emergency --stage production --cohort A --min-bandwidth 1500 --immediate-apply always

# Manage updates
airlock list --platform ios --runtime 1.0.0
airlock metrics overview --platform ios --runtime 1.0.0
airlock metrics segments --platform ios --runtime 1.0.0 --from 2026-02-01T00:00:00.000Z --to 2026-02-28T23:59:59.000Z
airlock promote --from staging --to production --platform ios --runtime 1.0.0
airlock rollout --platform ios --runtime 1.0.0 --update-id <id> --percentage 50
airlock rollback --platform ios --runtime 1.0.0

# Generate signing keys
airlock keygen
```

## Local iOS OTA Validation

This repo includes a fixture Expo app at `e2e/expo-ota-fixture` and scripts to
run a full local Airlock OTA loop on iOS simulator.

### Prerequisites

- Xcode + iOS Simulator installed
- Bun installed

### One-command end-to-end loop

```bash
bun run e2e:ios-ota
```

What it does:

1. Starts a local Airlock server on `http://127.0.0.1:8788/ota`
2. Exports and publishes fixture update `v1`
3. Builds and installs the fixture app in **Release** on iOS simulator
4. Launches app and verifies marker `v1`
5. Exports and publishes fixture update `v2`
6. Relaunches app to fetch `v2`, then relaunches again to verify `v2` is active

The fixture app writes launch/update diagnostics to:

`<simulator app data>/Documents/ota-status.json`

The e2e script reads this file to assert OTA behavior.
It also writes a timing report to `e2e/ios-ota-report.json`.
Temporary Expo export artifacts are written to
`e2e/expo-ota-fixture/.airlock-builds/` (gitignored).

### Advanced production feature checks

Run a fast smoke suite for production controls:

```bash
bun run e2e:advanced
```

This verifies:

1. A/B cohort targeting (`x-airlock-cohort`)
2. Bandwidth-aware update gating (`x-airlock-bandwidth-kbps`)
3. Crash-rate auto-blocking (bad latest update is skipped)
4. Manual rollback behavior
5. Health telemetry endpoint output

### Run server manually

```bash
bun run e2e:server
```

Default local credentials:

- Server: `http://127.0.0.1:8788/ota`
- Admin token: `local-dev-token`

Override with env vars:

- `AIRLOCK_E2E_PORT`
- `AIRLOCK_E2E_TOKEN`
- `AIRLOCK_E2E_SIMULATOR`
- `AIRLOCK_E2E_BUNDLE_ID`
- `AIRLOCK_E2E_RUNTIME`
- `AIRLOCK_E2E_STATE_FILE` (optional JSON persistence file path)

### Troubleshooting

- If updates never apply, verify fixture `runtimeVersion` matches publish `--runtime`.
- If app cannot fetch assets, ensure manifest asset URLs are `assets/<hash>` (or legacy `_assets/*` that Airlock normalizes).
- If simulator launch fails, open Xcode once to accept toolchain/license prompts and rerun.

## Features

- Expo Updates protocol v1 compliant (multipart/mixed manifests)
- RSA-SHA256 code signing (`rsa-v1_5-sha256`, Expo-compatible)
- Deterministic hash-based rollout (same device always gets same result)
- Channel support (default, staging, production, etc.)
- Admin API with bearer token auth (publish, promote, rollback, rollout)
- Targeting controls: cohort, minimum bandwidth, and stage gating
- Update metadata: kind (`feature|optional|hotfix|emergency`), stage, tags
- Immediate-apply hint in manifest `extra.immediateApply` (`never|fast_connection|always`)
- Telemetry ingestion endpoint for launch/apply/download events
- Health stats endpoint (crash rate + timing aggregates)
- Authenticated metrics endpoints for dashboard queries (`/admin/metrics/*`)
- Automatic unhealthy-update blocking based on crash-rate thresholds
- `resolveUpdate` hook for custom logic (A/B testing, feature flags, user targeting)
- `onEvent` hook for analytics and logging
- Critical update flag (passed to client via manifest `extra`)
- Update messages for human-readable history
- Asset proxy endpoint
- CLI for publishing and managing updates

## Hooks

### resolveUpdate

Runs after the adapter fetches the latest update. Inspect headers, swap the update, or return `null` to skip.

```ts
createAirlock({
  adapter,
  resolveUpdate(update, context) {
    // context has: channel, runtimeVersion, platform, headers, currentUpdateId
    const userId = context.headers["x-user-id"];
    if (!isBetaUser(userId)) return null;
    return update;
  },
});
```

### onEvent

Fire-and-forget analytics. Never blocks the response.

```ts
createAirlock({
  adapter,
  onEvent(event) {
    // event.type: manifest_request | asset_request | update_published
    //             | rollout_changed | update_promoted | update_rolled_back
    console.log(event);
  },
});
```

## Code Signing

Generate a key pair:

```bash
airlock keygen
# Creates: airlock-private.pem, airlock-public.pem
```

Configure the server:

```ts
import { createAirlock, importSigningKey } from "@dawsson/airlock";

createAirlock({
  adapter,
  signingKey: await importSigningKey(env.AIRLOCK_SIGNING_KEY),
  signingKeyId: "main",
});
```

Add the public key to your Expo app's `app.json`:

```json
{
  "expo": {
    "updates": {
      "codeSigningCertificate": "./airlock-public.pem",
      "codeSigningMetadata": { "keyid": "main", "alg": "rsa-v1_5-sha256" }
    }
  }
}
```

### onTelemetryBatch

Use this to forward ingested telemetry to external analytics sinks (Cloudflare
Analytics Engine, PostHog pipeline, etc.) without coupling Airlock core to any
specific vendor.

```ts
createAirlock({
  adapter,
  onTelemetryBatch(events, context) {
    // context.trusted -> true for /admin/client-events, false for public /events
    // context.ip -> client IP when available
    // Fire your own async write path here
    void events;
    void context;
  },
});
```

If this hook throws, Airlock swallows the error and emits
`telemetry_export_failed` via `onEvent`.

### Crash Gating Policy

Configure automatic unhealthy update blocking:

```ts
createAirlock({
  adapter,
  stability: {
    autoBlockUnhealthy: true,
    minLaunchesForBlocking: 20,
    crashRateThreshold: 0.2,
    useUntrustedTelemetry: false,
  },
});
```

If telemetry reports that an update exceeds the crash threshold after the minimum
sample size, Airlock skips that update and serves the next eligible one.
By default, only trusted telemetry is used for auto-block decisions.

## Adapters

### Built-in

- `**@dawsson/airlock/adapters/cloudflare**` — KV for metadata, R2 for assets
- `**@dawsson/airlock/adapters/memory**` — In-memory, for tests

### Custom

Implement `StorageAdapter` for any backend (Postgres, S3, Upstash, etc.):

```ts
import type { StorageAdapter, StoredUpdate, Platform } from "@dawsson/airlock";

class PostgresAdapter implements StorageAdapter {
  async getLatestUpdate(channel, runtimeVersion, platform) {
    /* ... */
  }
  async publishUpdate(channel, runtimeVersion, platform, update) {
    /* ... */
  }
  async setRollout(channel, runtimeVersion, platform, updateId, percentage) {
    /* ... */
  }
  async promoteUpdate(fromChannel, toChannel, runtimeVersion, platform) {
    /* ... */
  }
  async rollbackUpdate(channel, runtimeVersion, platform) {
    /* ... */
  }
  async getUpdateHistory(channel, runtimeVersion, platform, limit?) {
    /* ... */
  }
  async listUpdates() {
    /* ... */
  }
  async getAssetUrl(hash) {
    /* ... */
  }
  async storeAsset(hash, data, contentType) {
    /* ... */
  }
}
```

## Telemetry API

Public client telemetry endpoint:

- `POST /events` (no admin token required)
- guarded by request size, batch size, timestamp skew, and per-IP rate limits
- events received here are marked **untrusted** unless `clientEventToken` is configured

Trusted telemetry endpoint:

- `POST /admin/client-events` (admin token required)
- events are always marked trusted for stability decisions
- events derive `bandwidthBucket` (`unknown|low|medium|high|very_high`) server-side

## Metrics API

Dashboard-oriented, authenticated metrics endpoints:

- `GET /admin/metrics/overview`
- `GET /admin/metrics/timings`
- `GET /admin/metrics/adoption`
- `GET /admin/metrics/failures`
- `GET /admin/metrics/segments`

Shared query params:

- `runtimeVersion` (required)
- `platform` (required: `ios|android`)
- `channel` (optional, default `default`)
- `from` / `to` (optional ISO timestamps; default rolling 24h)
- `limit` (optional, default 50, max 500)

Query guardrails:

- max window: 30 days
- invalid ranges or missing required params return `400`

Auth behavior:

- if `metricsAuth` is configured, it is used for `/admin/metrics/*`
- otherwise metrics routes use normal admin bearer auth
- metrics routes are never public in this release

## Admin API

All admin endpoints require `Authorization: Bearer <token>` when `adminToken` is set.

| Method | Path                      | Description                                           |
| ------ | ------------------------- | ----------------------------------------------------- |
| `POST` | `/admin/publish`          | Publish an update with manifest + assets              |
| `POST` | `/admin/promote`          | Copy update from one channel to another               |
| `POST` | `/admin/rollout`          | Set rollout percentage for an update                  |
| `POST` | `/admin/rollback`         | Revert to previous update                             |
| `POST` | `/admin/client-events`    | Record trusted client launch/download/apply telemetry |
| `GET`  | `/admin/health`           | Read per-update crash-rate and timing aggregates      |
| `GET`  | `/admin/metrics/overview` | Read aggregate event/crash summary                    |
| `GET`  | `/admin/metrics/timings`  | Read check/download/apply timing distributions        |
| `GET`  | `/admin/metrics/adoption` | Read per-update launch/adoption counters              |
| `GET`  | `/admin/metrics/failures` | Read per-update failure/error breakdown               |
| `GET`  | `/admin/metrics/segments` | Read cohort/stage/network/bandwidth/trust slices      |
| `GET`  | `/admin/updates`          | List update history for a channel/rv/platform         |
| `GET`  | `/admin/status`           | Overview of all deployed updates across all channels  |

CLI equivalents:

- `airlock metrics overview --platform ios --runtime 1.0.0`
- `airlock metrics timings --platform ios --runtime 1.0.0`
- `airlock metrics adoption --platform ios --runtime 1.0.0`
- `airlock metrics failures --platform ios --runtime 1.0.0`
- `airlock metrics segments --platform ios --runtime 1.0.0`

## Metrics Storage Guidance

- Store OTA bundles/assets in R2/object storage only.
- Store queryable telemetry aggregates in adapter storage (DB/KV) for fast
  dashboard reads.
- Keep raw, high-volume analytics in your own external sink if needed via
  `onTelemetryBatch`.

## iOS Timing Baseline

From the latest local run (`e2e/ios-ota-report.json`, iPhone 17 Pro simulator):

| Step              | Duration   |
| ----------------- | ---------- |
| wait_for_server   | 270 ms     |
| export_publish_v1 | 7.0 s      |
| build_release_v1  | 25.8 s     |
| first_launch      | 8.4 s      |
| export_publish_v2 | 7.3 s      |
| second_launch     | 8.4 s      |
| third_launch      | 8.4 s      |
| **total**         | **65.6 s** |

Notes:

- Build dominates runtime; OTA publish/fetch/apply loop is significantly faster than full rebuild.
- Second launch was non-embedded (`isEmbeddedLaunch=false`), confirming OTA activation.

## License

MIT
