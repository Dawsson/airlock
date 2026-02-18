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
import { createAirlock } from "@dawsson/airlock"
import { CloudflareAdapter } from "@dawsson/airlock/adapters/cloudflare"

// Adapter and token factories are called per-request with the runtime env —
// the correct pattern for Cloudflare Workers where bindings aren't available at module init.
const airlock = createAirlock({
  adapter: (env: Env) => new CloudflareAdapter({
    kv: env.OTA_KV,
    r2: env.OTA_R2,
    r2PublicUrl: env.R2_PUBLIC_URL,
  }),
  adminToken: (env: Env) => env.AIRLOCK_ADMIN_TOKEN,
})

// Returns a standard WinterCG fetch handler with basePath prefix stripping built in.
const handler = airlock.mount("/ota")

export default { fetch: handler }
```

Or mount on an existing Hono app:

```ts
import { Hono } from "hono"
const app = new Hono<{ Bindings: Env }>()
app.all("/ota/*", (c) => handler(c.req.raw, c.env))
```

Point your Expo app at `https://your-api.com/ota/manifest` and updates just work.

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

# Manage updates
airlock list --platform ios --runtime 1.0.0
airlock promote --from staging --to production --platform ios --runtime 1.0.0
airlock rollout --platform ios --runtime 1.0.0 --update-id <id> --percentage 50
airlock rollback --platform ios --runtime 1.0.0

# Generate signing keys
airlock keygen
```

## Features

- Expo Updates protocol v1 compliant (multipart/mixed manifests)
- RSA-SHA256 code signing (`rsa-v1_5-sha256`, Expo-compatible)
- Deterministic hash-based rollout (same device always gets same result)
- Channel support (default, staging, production, etc.)
- Admin API with bearer token auth (publish, promote, rollback, rollout)
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
    const userId = context.headers["x-user-id"]
    if (!isBetaUser(userId)) return null
    return update
  },
})
```

### onEvent

Fire-and-forget analytics. Never blocks the response.

```ts
createAirlock({
  adapter,
  onEvent(event) {
    // event.type: manifest_request | asset_request | update_published
    //             | rollout_changed | update_promoted | update_rolled_back
    console.log(event)
  },
})
```

## Code Signing

Generate a key pair:

```bash
airlock keygen
# Creates: airlock-private.pem, airlock-public.pem
```

Configure the server:

```ts
import { createAirlock, importSigningKey } from "@dawsson/airlock"

createAirlock({
  adapter,
  signingKey: await importSigningKey(env.AIRLOCK_SIGNING_KEY),
  signingKeyId: "main",
})
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

## Adapters

### Built-in

- **`@dawsson/airlock/adapters/cloudflare`** — KV for metadata, R2 for assets
- **`@dawsson/airlock/adapters/memory`** — In-memory, for tests

### Custom

Implement `StorageAdapter` for any backend (Postgres, S3, Upstash, etc.):

```ts
import type { StorageAdapter, StoredUpdate, Platform } from "@dawsson/airlock"

class PostgresAdapter implements StorageAdapter {
  async getLatestUpdate(channel, runtimeVersion, platform) { /* ... */ }
  async publishUpdate(channel, runtimeVersion, platform, update) { /* ... */ }
  async setRollout(channel, runtimeVersion, platform, updateId, percentage) { /* ... */ }
  async promoteUpdate(fromChannel, toChannel, runtimeVersion, platform) { /* ... */ }
  async rollbackUpdate(channel, runtimeVersion, platform) { /* ... */ }
  async getUpdateHistory(channel, runtimeVersion, platform, limit?) { /* ... */ }
  async listUpdates() { /* ... */ }
  async getAssetUrl(hash) { /* ... */ }
  async storeAsset(hash, data, contentType) { /* ... */ }
}
```

## Admin API

All admin endpoints require `Authorization: Bearer <token>` when `adminToken` is set.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/admin/publish` | Publish an update with manifest + assets |
| `POST` | `/admin/promote` | Copy update from one channel to another |
| `POST` | `/admin/rollout` | Set rollout percentage for an update |
| `POST` | `/admin/rollback` | Revert to previous update |
| `GET` | `/admin/updates` | List update history for a channel/rv/platform |
| `GET` | `/admin/status` | Overview of all deployed updates across all channels |

## License

MIT
