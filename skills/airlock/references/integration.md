# Integrating Airlock

## Server Integration (Hono)

### 1. Install

```bash
bun add @dawsson/airlock
```

### 2. Mount on your Hono app

```ts
import { Hono } from "hono"
import { createAirlock } from "@dawsson/airlock"
import { CloudflareAdapter } from "@dawsson/airlock/adapters/cloudflare"

const app = new Hono<{ Bindings: Env }>()

const airlock = createAirlock({
  adapter: new CloudflareAdapter({
    kv: env.OTA_KV,           // KVNamespace — stores update metadata
    r2: env.OTA_R2,           // R2Bucket — stores asset binaries
    r2PublicUrl: "https://cdn.example.com",
  }),
  adminToken: env.AIRLOCK_ADMIN_TOKEN,  // omit to allow unauthenticated admin access
})

app.route("/ota", airlock.routes)
```

The Hono app then exposes:
- `GET /ota/manifest` — Expo Updates manifest endpoint (public)
- `GET /ota/assets/:hash` — Asset proxy (public, redirects to R2)
- `POST /ota/admin/publish` — Publish an update
- `POST /ota/admin/promote` — Promote between channels
- `POST /ota/admin/rollout` — Set rollout percentage
- `POST /ota/admin/rollback` — Revert to previous update
- `GET /ota/admin/updates` — List update history

### 3. Cloudflare Workers config (`wrangler.toml`)

```toml
[[kv_namespaces]]
binding = "OTA_KV"
id = "your-kv-namespace-id"

[[r2_buckets]]
binding = "OTA_R2"
bucket_name = "your-r2-bucket"
```

---

## Adapters

### CloudflareAdapter

Production-ready. KV for metadata, R2 for asset binaries.

```ts
import { CloudflareAdapter } from "@dawsson/airlock/adapters/cloudflare"

new CloudflareAdapter({
  kv: env.OTA_KV,
  r2: env.OTA_R2,
  r2PublicUrl: "https://cdn.example.com",  // public URL prefix for R2 assets
})
```

- KV key format: `airlock/v1/{channel}/{runtimeVersion}/{platform}/current`
- R2 key format: `airlock/assets/{hash}`
- Keeps up to 50 historical updates per channel/rv/platform
- `promoteUpdate` resets rolloutPercentage to 100

### MemoryAdapter

For tests and local development. Map-backed, no external dependencies.

```ts
import { MemoryAdapter } from "@dawsson/airlock/adapters/memory"

const adapter = new MemoryAdapter()
// adapter.getAsset(hash) — test helper to read raw stored bytes
```

### Custom Adapter

Implement `StorageAdapter` from `@dawsson/airlock` for any backend (Postgres, S3, Upstash, etc.):

```ts
import type { StorageAdapter, StoredUpdate, Platform } from "@dawsson/airlock"

class MyAdapter implements StorageAdapter {
  getLatestUpdate(channel, runtimeVersion, platform): Promise<StoredUpdate | null>
  publishUpdate(channel, runtimeVersion, platform, update): Promise<void>
  setRollout(channel, runtimeVersion, platform, updateId, percentage): Promise<void>
  promoteUpdate(fromChannel, toChannel, runtimeVersion, platform): Promise<void>
  rollbackUpdate(channel, runtimeVersion, platform): Promise<StoredUpdate | null>
  getUpdateHistory(channel, runtimeVersion, platform, limit?): Promise<StoredUpdate[]>
  getAssetUrl(hash): Promise<string | null>
  storeAsset(hash, data, contentType): Promise<string>
}
```

---

## Hooks

### `resolveUpdate`

Runs after the adapter returns an update. Inspect context and return the update, a different one, or `null` to skip.

```ts
createAirlock({
  adapter,
  resolveUpdate(update, context) {
    // context: { channel, runtimeVersion, platform, headers, currentUpdateId }
    const userId = context.headers["x-user-id"]
    if (!isBetaUser(userId)) return null
    return update
  },
})
```

Use for: A/B testing, user targeting, feature flags, custom rollout logic.

### `onEvent`

Fire-and-forget analytics hook. Never blocks the response.

```ts
createAirlock({
  adapter,
  onEvent(event) {
    // event.type values:
    //   "manifest_request"   — { context, served, updateId? }
    //   "asset_request"      — { hash, found }
    //   "update_published"   — { updateId, channel, runtimeVersion, platform }
    //   "rollout_changed"    — { updateId, percentage }
    //   "update_promoted"    — { updateId, fromChannel, toChannel }
    //   "update_rolled_back" — { channel, rolledBackId }
    analytics.track(event.type, event)
  },
})
```

---

## Code Signing

Generate a key pair:

```bash
airlock keygen
# Outputs: airlock-private.pem, airlock-public.pem
```

Configure the server with the private key:

```ts
import { importSigningKey } from "@dawsson/airlock"

createAirlock({
  adapter,
  signingKey: await importSigningKey(env.AIRLOCK_SIGNING_KEY), // PEM string
  signingKeyId: "main",           // optional, defaults to "main"
  certificateChain: env.CERT_PEM, // optional, PEM cert chain for client validation
})
```

The public key goes in your Expo app's `app.json`:

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

---

## Expo App Configuration

Point your Expo app at the airlock server in `app.json` / `app.config.ts`:

```json
{
  "expo": {
    "updates": {
      "url": "https://api.example.com/ota/manifest",
      "enabled": true,
      "checkAutomatically": "ON_LOAD"
    },
    "runtimeVersion": {
      "policy": "appVersion"
    }
  }
}
```

The Expo Updates client sends these headers on each manifest request:
- `expo-platform` — `ios` or `android`
- `expo-runtime-version` — matches your `runtimeVersion`
- `expo-channel-name` — channel to check (default: `"default"`)
- `expo-current-update-id` — UUID of the currently running update
- `expo-eas-client-id` — device ID used for deterministic rollout

---

## Types Reference

```ts
type AirlockConfig = {
  adapter: StorageAdapter
  adminToken?: string         // Required for admin endpoint auth
  resolveUpdate?: (update: StoredUpdate, context: UpdateContext) => StoredUpdate | null | Promise<StoredUpdate | null>
  onEvent?: (event: AirlockEvent) => void | Promise<void>
  signingKey?: CryptoKey      // From importSigningKey()
  signingKeyId?: string       // Defaults to "main"
  certificateChain?: string   // Optional PEM cert chain
}

type StoredUpdate = {
  manifest: ExpoManifest
  rolloutPercentage: number   // 0–100
  message?: string
  critical?: boolean          // Passed to client as manifest.extra.critical
  createdAt: string
  updatedAt: string
}

type UpdateContext = {
  channel: string
  runtimeVersion: string
  platform: Platform          // "ios" | "android"
  headers: Record<string, string>
  currentUpdateId: string | null
}
```
