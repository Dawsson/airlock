import { loadConfig, api, die, requireArgs } from "./shared";
import type { StoredUpdate } from "../types";

const USAGE = `airlock list — list update history

Usage: airlock list [options]

Options:
  --platform, -p   Platform: ios or android (required)
  --runtime, -r    Runtime version (required)
  --channel, -c    Channel name (default: default)
  --limit, -l      Max updates to show (default: 20)`;

export async function list(args: string[]) {
  const { values } = requireArgs(args, {
    flags: {
      platform: { type: "string", short: "p" },
      runtime: { type: "string", short: "r" },
      channel: { type: "string", short: "c" },
      limit: { type: "string", short: "l" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(USAGE);
    return;
  }

  if (!values.platform || !values.runtime) {
    die("--platform and --runtime are required");
  }

  const config = await loadConfig();
  if (!config.server) die("AIRLOCK_SERVER not set");

  const result = (await api(config, "/admin/updates", {
    query: {
      runtimeVersion: values.runtime as string,
      platform: values.platform as string,
      channel: (values.channel as string) ?? "default",
      limit: (values.limit as string) ?? "20",
    },
  })) as { updates: StoredUpdate[] };

  if (!result.updates.length) {
    console.log("No updates found.");
    return;
  }

  console.log(`Updates for ${values.platform} rv ${values.runtime}:\n`);
  for (const u of result.updates) {
    const critical = u.critical ? " [CRITICAL]" : "";
    const msg = u.message ? ` — ${u.message}` : "";
    const rolloutStr = u.rolloutPercentage < 100 ? ` (${u.rolloutPercentage}%)` : "";
    console.log(`  ${u.manifest.id}${rolloutStr}${critical}${msg}`);
    console.log(`    ${u.createdAt}`);
  }
}
