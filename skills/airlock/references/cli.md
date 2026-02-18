# Airlock CLI Reference

The `airlock` CLI manages updates on a running airlock server.

## Configuration

Config is loaded from env vars first, then `.airlockrc.json` in the current directory.

| Source | Key | Description |
|--------|-----|-------------|
| Env | `AIRLOCK_SERVER` | Server base URL (e.g. `https://api.example.com/ota`) |
| Env | `AIRLOCK_TOKEN` | Admin bearer token |
| File | `.airlockrc.json` `server` | Server base URL |
| File | `.airlockrc.json` `token` | Admin bearer token |

`.airlockrc.json` example:
```json
{
  "server": "https://api.example.com/ota",
  "token": "your-admin-token"
}
```

**Always add `.airlockrc.json` to `.gitignore`** — it may contain your token.

---

## Commands

### `airlock init`

Initialize `.airlockrc.json` in the current project directory.

```bash
airlock init --server https://api.example.com/ota --token your-admin-token
```

| Flag | Short | Description |
|------|-------|-------------|
| `--server` | `-s` | Server URL |
| `--token` | `-t` | Admin token |

---

### `airlock publish`

Publish an update from `expo export` output. Reads `metadata.json` from the dist directory, hashes assets, and uploads to the server.

```bash
npx expo export --platform ios
airlock publish --platform ios --runtime 1.0.0 --message "fix login crash"
```

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--dist` | `-d` | `dist` | Path to expo export output directory |
| `--platform` | `-p` | — | **Required.** `ios` or `android` |
| `--runtime` | `-r` | — | **Required.** Runtime version string |
| `--channel` | `-c` | `default` | Channel name |
| `--message` | `-m` | — | Human-readable update message |
| `--critical` | — | `false` | Mark as critical update |
| `--rollout` | — | `100` | Initial rollout percentage (0–100) |

---

### `airlock promote`

Copy the latest update from one channel to another. Promotes at 100% rollout.

```bash
airlock promote --from staging --to production --platform ios --runtime 1.0.0
```

| Flag | Short | Description |
|------|-------|-------------|
| `--from` | `-f` | **Required.** Source channel |
| `--to` | `-t` | **Required.** Target channel |
| `--platform` | `-p` | **Required.** `ios` or `android` |
| `--runtime` | `-r` | **Required.** Runtime version |

---

### `airlock rollback`

Revert to the previous update in a channel.

```bash
airlock rollback --platform ios --runtime 1.0.0
airlock rollback --platform ios --runtime 1.0.0 --channel staging
```

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--platform` | `-p` | — | **Required.** `ios` or `android` |
| `--runtime` | `-r` | — | **Required.** Runtime version |
| `--channel` | `-c` | `default` | Channel name |

---

### `airlock rollout`

Set the rollout percentage for a specific update. Rollout is deterministic: same device always gets same result.

```bash
airlock rollout --platform ios --runtime 1.0.0 --update-id <id> --percentage 10
airlock rollout --platform ios --runtime 1.0.0 --update-id <id> --percentage 100
```

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--platform` | `-p` | — | **Required.** `ios` or `android` |
| `--runtime` | `-r` | — | **Required.** Runtime version |
| `--update-id` | `-u` | — | **Required.** Update ID (UUID from publish output) |
| `--percentage` | — | — | **Required.** 0–100 |
| `--channel` | `-c` | `default` | Channel name |

---

### `airlock list`

List update history for a channel.

```bash
airlock list --platform ios --runtime 1.0.0
airlock list --platform ios --runtime 1.0.0 --channel staging --limit 5
```

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--platform` | `-p` | — | **Required.** `ios` or `android` |
| `--runtime` | `-r` | — | **Required.** Runtime version |
| `--channel` | `-c` | `default` | Channel name |
| `--limit` | `-l` | `20` | Max updates to show |

Output format per update:
```
  <updateId> (<rollout>%) [CRITICAL] — <message>
    <createdAt>
```

---

### `airlock keygen`

Generate an RSA-2048 signing key pair for code signing.

```bash
airlock keygen
airlock keygen --out ./keys
```

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--out` | `-o` | `.` | Output directory |

Outputs:
- `airlock-private.pem` — Private key; set as `AIRLOCK_SIGNING_KEY` on the server. **Add to `.gitignore`.**
- `airlock-public.pem` — Public key; bundle with your Expo app.

Fails if either file already exists.

---

## Typical Workflow

```bash
# 1. One-time setup
airlock init --server https://api.example.com/ota --token $ADMIN_TOKEN

# 2. Export and publish
npx expo export --platform ios
airlock publish --platform ios --runtime 1.0.0 --message "fix crash" --rollout 10

# 3. Watch and ramp
airlock list --platform ios --runtime 1.0.0
airlock rollout --platform ios --runtime 1.0.0 --update-id <id> --percentage 50
airlock rollout --platform ios --runtime 1.0.0 --update-id <id> --percentage 100

# 4. Promote to production
airlock promote --from staging --to production --platform ios --runtime 1.0.0

# 5. Emergency rollback
airlock rollback --platform ios --runtime 1.0.0
```
