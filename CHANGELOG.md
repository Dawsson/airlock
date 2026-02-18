# Changelog

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
- Code signing support
- Asset proxy endpoint with redirect
- In-memory adapter for tests
- Cloudflare KV + R2 adapter for production
- `StorageAdapter` interface for custom backends
