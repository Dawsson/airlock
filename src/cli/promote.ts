import { loadConfig, api, die, requireArgs } from "./shared";

const USAGE = `airlock promote — promote an update from one channel to another

Usage: airlock promote [options]

Options:
  --from, -f       Source channel (required)
  --to, -t         Target channel (required)
  --platform, -p   Platform: ios or android (required)
  --runtime, -r    Runtime version (required)`;

export async function promote(args: string[]) {
  const { values } = requireArgs(args, {
    flags: {
      from: { type: "string", short: "f" },
      to: { type: "string", short: "t" },
      platform: { type: "string", short: "p" },
      runtime: { type: "string", short: "r" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(USAGE);
    return;
  }

  if (!values.from || !values.to || !values.platform || !values.runtime) {
    die("--from, --to, --platform, and --runtime are required");
  }

  const config = await loadConfig();
  if (!config.server) die("AIRLOCK_SERVER not set");

  const result = await api(config, "/admin/promote", {
    method: "POST",
    body: {
      fromChannel: values.from,
      toChannel: values.to,
      runtimeVersion: values.runtime,
      platform: values.platform,
    },
  });

  console.log(`Promoted update ${(result as { updateId: string }).updateId} from ${values.from} → ${values.to}`);
}
