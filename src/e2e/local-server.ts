import { Hono } from "hono";
import { createAirlock } from "../server";
import { MemoryAdapter } from "../adapters/memory";
import { FileAdapter } from "../adapters/file";

const port = Number(process.env.AIRLOCK_E2E_PORT ?? "8788");
const adminToken = process.env.AIRLOCK_E2E_TOKEN ?? "local-dev-token";
const stateFile = process.env.AIRLOCK_E2E_STATE_FILE;

const adapter = stateFile ? new FileAdapter({ filePath: stateFile }) : new MemoryAdapter();
const airlock = createAirlock({
  adapter,
  adminToken,
  onEvent(event) {
    if (event.type === "asset_request" && !event.found) {
      console.error(`[airlock-e2e] missing asset hash=${event.hash}`);
    }
  },
});

const app = new Hono();
app.get("/health", (c) => c.json({ ok: true }));
app.route("/ota", airlock.routes);

const server = Bun.serve({
  port,
  fetch: app.fetch,
});

console.log(`[airlock-e2e] running on http://127.0.0.1:${port} (admin token: ${adminToken})`);
if (stateFile) {
  console.log(`[airlock-e2e] persistence enabled at ${stateFile}`);
}

process.on("SIGINT", () => {
  server.stop(true);
  process.exit(0);
});
