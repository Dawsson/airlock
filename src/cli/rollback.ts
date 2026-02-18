import { loadConfig, api, die, requireArgs } from "./shared";

const USAGE = `airlock rollback — roll back to the previous update

Usage: airlock rollback [options]

Options:
  --platform, -p   Platform: ios or android (required)
  --runtime, -r    Runtime version (required)
  --channel, -c    Channel name (default: default)`;

export async function rollback(args: string[]) {
  const { values } = requireArgs(args, {
    flags: {
      platform: { type: "string", short: "p" },
      runtime: { type: "string", short: "r" },
      channel: { type: "string", short: "c" },
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

  const result = await api(config, "/admin/rollback", {
    method: "POST",
    body: {
      runtimeVersion: values.runtime,
      platform: values.platform,
      channel: values.channel ?? "default",
    },
  });

  console.log(`Rolled back. Active update: ${(result as { activeUpdateId: string }).activeUpdateId}`);
}
