# airlock

Self-hosted Expo OTA update server. Ships as a Hono library you mount on your existing API.

## Install

```bash
bun add @dawsson/airlock
```

## Usage

```ts
import { Hono } from "hono"
import { createAirlock } from "@dawsson/airlock"
import { CloudflareAdapter } from "@dawsson/airlock/adapters/cloudflare"

const app = new Hono()

const airlock = createAirlock({
  adapter: new CloudflareAdapter({
    kv: env.OTA_KV,
    r2: env.OTA_R2,
    r2PublicUrl: "https://cdn.example.com",
  }),
})

app.route("/ota", airlock.routes)
```

Point your Expo app at `https://your-api.com/ota/manifest` and updates just work.

## Adapters

- **`@dawsson/airlock/adapters/cloudflare`** — KV for metadata, R2 for assets
- **`@dawsson/airlock/adapters/memory`** — In-memory, for tests

Implement `StorageAdapter` for anything else.

## Features

- Expo Updates protocol v1 compliant (multipart/mixed manifests)
- Deterministic hash-based rollout (percentage-based, same device always gets same result)
- Channel support (default, staging, production, etc.)
- `resolveUpdate` hook for custom logic (A/B testing, feature flags)
- Optional Ed25519 code signing
- Asset proxy endpoint

## License

MIT
