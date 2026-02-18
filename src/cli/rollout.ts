import { loadConfig, api, die, requireArgs } from "./shared";

const USAGE = `airlock rollout — set rollout percentage for an update

Usage: airlock rollout [options]

Options:
  --platform, -p     Platform: ios or android (required)
  --runtime, -r      Runtime version (required)
  --update-id, -u    Update ID (required)
  --percentage       Rollout percentage 0-100 (required)
  --channel, -c      Channel name (default: default)`;

export async function rollout(args: string[]) {
  const { values } = requireArgs(args, {
    flags: {
      platform: { type: "string", short: "p" },
      runtime: { type: "string", short: "r" },
      "update-id": { type: "string", short: "u" },
      percentage: { type: "string" },
      channel: { type: "string", short: "c" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(USAGE);
    return;
  }

  if (!values.platform || !values.runtime || !values["update-id"] || !values.percentage) {
    die("--platform, --runtime, --update-id, and --percentage are required");
  }

  const pct = parseInt(values.percentage as string);
  if (isNaN(pct) || pct < 0 || pct > 100) die("--percentage must be 0-100");

  const config = loadConfig();
  if (!config.server) die("AIRLOCK_SERVER not set");

  await api(config, "/admin/rollout", {
    method: "POST",
    body: {
      runtimeVersion: values.runtime,
      platform: values.platform,
      updateId: values["update-id"],
      percentage: pct,
      channel: values.channel ?? "default",
    },
  });

  console.log(`Rollout set to ${pct}% for update ${values["update-id"]}`);
}
