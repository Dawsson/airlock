import { parseArgs } from "util";
import { existsSync } from "fs";
import { resolve } from "path";

export type CliConfig = {
  server: string;
  token: string;
};

export async function loadConfig(): Promise<CliConfig> {
  // Check env vars first, then .airlockrc.json
  let server = process.env.AIRLOCK_SERVER ?? "";
  let token = process.env.AIRLOCK_TOKEN ?? "";

  const rcPath = resolve(process.cwd(), ".airlockrc.json");
  if (existsSync(rcPath)) {
    const text = await Bun.file(rcPath).text();
    const rc = JSON.parse(text);
    server = server || rc.server || "";
    token = token || rc.token || "";
  }

  return { server, token };
}

export async function api(
  config: CliConfig,
  path: string,
  options?: { method?: string; body?: unknown; query?: Record<string, string> }
) {
  let url = `${config.server.replace(/\/$/, "")}${path}`;
  if (options?.query) {
    const params = new URLSearchParams(options.query);
    url += `?${params}`;
  }

  const res = await fetch(url, {
    method: options?.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(config.token ? { Authorization: `Bearer ${config.token}` } : {}),
    },
    ...(options?.body ? { body: JSON.stringify(options.body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  return res.json();
}

export function die(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

export function requireArgs(
  args: string[],
  spec: { flags: Record<string, { type: "string" | "boolean"; short?: string }> }
) {
  return parseArgs({ args, options: spec.flags, allowPositionals: true });
}
