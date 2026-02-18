# Deploying Airlock with Alchemy

Alchemy is the recommended way to provision Cloudflare infrastructure for airlock (KV, R2, Worker). It's not required — `wrangler` works too — but Alchemy keeps everything in TypeScript alongside your code.

## Before You Start — Ask the User

Before writing any Alchemy config, ask:

1. **KV namespace** — Do you have an existing KV namespace for OTA metadata, or should I create a new one?
2. **R2 bucket** — Do you have an existing R2 bucket for OTA assets, or should I create a new one?
3. **CDN / public URL** — Do you have a custom domain or CDN URL in front of R2 (e.g. `https://cdn.example.com`)? Or should I use the default `r2.dev` public URL? (R2 public bucket URL looks like `https://pub-xxxx.r2.dev`)
4. **Admin token** — Do you have an existing `AIRLOCK_ADMIN_TOKEN`, or should I generate a new one?

Use existing resources when provided. Only create new ones when the user says to.

---

## Generating a Secure Admin Token

If the user doesn't have a token, generate one. 27 random bytes → 36 base64url characters (216 bits of entropy).

```bash
bun -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(27))).toString('base64url'))"
```

Store it in `.env` (bun loads this automatically):

```bash
# .env
AIRLOCK_ADMIN_TOKEN=Kx9mP2rQvL8nYwZ4bT6cD1eF3gH5jA7s
```

Add `.env` to `.gitignore` if it isn't already.

---

## Alchemy Run File

```ts
// alchemy.run.ts
import alchemy from "alchemy"
import { Worker, KVNamespace, R2Bucket } from "alchemy/cloudflare"

const app = await alchemy("my-app")

// — Use existing KV, or create new —
const otaKv = await KVNamespace("OTA_KV", {
  // If user has an existing namespace, pass its ID:
  // id: "abc123existingid",
  title: "my-app-ota-kv",
})

// — Use existing R2 bucket, or create new —
const otaR2 = await R2Bucket("OTA_R2", {
  // If user has an existing bucket, pass its name:
  // adopt: true,
  name: "my-app-ota-assets",
})

await Worker("my-app-worker", {
  name: "my-app-worker",
  entrypoint: "./src/worker.ts",
  bindings: {
    OTA_KV: otaKv,
    OTA_R2: otaR2,
    // Reads from process.env.AIRLOCK_ADMIN_TOKEN (set in .env or shell)
    AIRLOCK_ADMIN_TOKEN: alchemy.secret("AIRLOCK_ADMIN_TOKEN"),
  },
})

await app.finalize()
```

Run it:

```bash
bun run alchemy.run.ts
```

---

## Worker Entry Point

```ts
// src/worker.ts
import { Hono } from "hono"
import { createAirlock } from "@dawsson/airlock"
import { CloudflareAdapter } from "@dawsson/airlock/adapters/cloudflare"

type Env = {
  OTA_KV: KVNamespace
  OTA_R2: R2Bucket
  AIRLOCK_ADMIN_TOKEN: string
}

const app = new Hono<{ Bindings: Env }>()

// Mount airlock at /ota — adjust path to match your API layout
app.all("/ota/*", (c) => {
  const airlock = createAirlock({
    adapter: new CloudflareAdapter({
      kv: c.env.OTA_KV,
      r2: c.env.OTA_R2,
      // Use the user's CDN URL, or their R2 public bucket URL
      r2PublicUrl: "https://pub-xxxx.r2.dev",
    }),
    adminToken: c.env.AIRLOCK_ADMIN_TOKEN,
  })
  return airlock.routes.fetch(c.req.raw, c.env)
})

export default app
```

---

## Existing vs New Resources

### Using an existing KV namespace

```ts
const otaKv = await KVNamespace("OTA_KV", {
  id: "abc123...",  // from Cloudflare dashboard or wrangler kv namespace list
  title: "my-app-ota-kv",
})
```

### Using an existing R2 bucket

```ts
const otaR2 = await R2Bucket("OTA_R2", {
  adopt: true,      // don't error if bucket already exists
  name: "my-existing-bucket",
})
```

### Using a custom CDN domain

If the user has a custom domain or Cloudflare-proxied URL in front of R2 (e.g. via a Transform Rule or Worker), pass that as `r2PublicUrl`:

```ts
r2PublicUrl: "https://cdn.example.com"
// Assets will be served at: https://cdn.example.com/airlock/assets/<hash>
```

---

## After Deploying — Init the CLI

Once the Worker is deployed:

```bash
airlock init \
  --server https://my-app-worker.your-subdomain.workers.dev/ota \
  --token <the AIRLOCK_ADMIN_TOKEN value>
```

This writes `.airlockrc.json`. Add it to `.gitignore`.

Then publish your first update:

```bash
npx expo export --platform ios
airlock publish --platform ios --runtime 1.0.0 --message "initial release"
```
