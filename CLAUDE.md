# Airlock

Self-hosted Expo OTA update server. Ships as a Hono library you mount on your existing API.

## Development

- **Run `bun test` often** — Type-check and run tests after any code change. Don't skip this.
- **`bunx tsc --noEmit`** — Run after edits to catch type errors early
- **Don't start dev servers** — API (3001) and Web (3000) are already running

## Architecture

- `src/types.ts` — Protocol types (manifest, assets, adapter interface, config)
- `src/server.ts` — Hono route handlers (`GET /manifest`, `GET /assets/:hash`)
- `src/manifest.ts` — Multipart/mixed response builder for Expo Updates protocol
- `src/rollout.ts` — Deterministic hash-based rollout (SHA-256)
- `src/crypto.ts` — Ed25519 code signing utilities
- `src/adapters/memory.ts` — In-memory adapter (tests)
- `src/adapters/cloudflare.ts` — KV + R2 adapter (production)
- `src/index.ts` — Public exports

## Key Concepts

### Storage Adapters
Implement `StorageAdapter` for your infra. Two built-in:
- `MemoryAdapter` — Map-based, for tests
- `CloudflareAdapter` — KV for metadata, R2 for assets

### Rollout
Deterministic: SHA-256 of `deviceId + updateId`, mod 100. Same device always gets same result.

### Channels
Updates are scoped to `{channel}/{runtimeVersion}/{platform}`. Default channel is `"default"`.

## Publishing

1. Bump version in `package.json`
2. `bun publish --access public`
