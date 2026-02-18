# Changelog

## [0.2.1] - 2026-02-18

### Fixed

- `airlock status` command was not registered in the CLI — now works correctly

## [0.2.0] - 2026-02-18

### Added

- `airlock status` command — human-friendly overview of all deployed updates across every channel, platform, and runtime version; no required flags, defaults to 25 entries (`--limit` to adjust)
- `listUpdates()` method on `StorageAdapter` interface — **required for custom adapter implementations**

### Changed

- README: clarified that the package serves dual purpose — import `createAirlock` on the server, run `airlock` CLI (via `bunx` or global install) to publish updates

## [0.1.0] - 2026-02-18

### Added

- Expo Updates protocol v1 manifest endpoint (multipart/mixed)
- Admin API: publish, promote, rollback, rollout, list updates
- Bearer token authentication for admin endpoints
- CLI: `publish`, `promote`, `rollback`, `rollout`, `list`, `keygen`, `init`
- Deterministic hash-based rollout (SHA-256, percentage-based)
- Channel support (default, staging, production, etc.)
- `resolveUpdate` hook for custom update logic (A/B testing, feature flags)
- `onEvent` hook for analytics and logging
- Critical update flag (`critical: true` in manifest extra)
- Update messages for human-readable history
- RSA-SHA256 code signing (rsa-v1_5-sha256, Expo-compatible)
- Asset proxy endpoint with redirect
- In-memory adapter for tests
- Cloudflare KV + R2 adapter for production
- `StorageAdapter` interface for custom backends
