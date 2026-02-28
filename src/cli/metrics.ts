import { api, die, loadConfig, requireArgs } from "./shared";

const USAGE = `airlock metrics — query Airlock metrics endpoints

Usage: airlock metrics [view] [options]

Views:
  overview   Aggregate event/crash summary (default)
  timings    Check/download/apply timing stats
  adoption   Per-update launch/adoption counters
  failures   Per-update failure/error breakdown
  segments   Cohort/stage/network/bandwidth/trust slices

Options:
  --platform, -p   Platform: ios or android (required)
  --runtime, -r    Runtime version (required)
  --channel, -c    Channel name (default: default)
  --from           ISO start timestamp (default: now-24h)
  --to             ISO end timestamp (default: now)
  --limit, -l      Result limit (default: 50)
  --json           Print raw JSON response
  --help, -h       Show help`;

type View = "overview" | "timings" | "adoption" | "failures" | "segments";

const VIEW_PATH: Record<View, string> = {
  overview: "/admin/metrics/overview",
  timings: "/admin/metrics/timings",
  adoption: "/admin/metrics/adoption",
  failures: "/admin/metrics/failures",
  segments: "/admin/metrics/segments",
};

function isView(value: string): value is View {
  return value in VIEW_PATH;
}

export async function metrics(args: string[]) {
  const { values, positionals } = requireArgs(args, {
    flags: {
      platform: { type: "string", short: "p" },
      runtime: { type: "string", short: "r" },
      channel: { type: "string", short: "c" },
      from: { type: "string" },
      to: { type: "string" },
      limit: { type: "string", short: "l" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(USAGE);
    return;
  }

  const viewRaw = (positionals[0] as string | undefined) ?? "overview";
  if (!isView(viewRaw)) {
    die(`Unknown metrics view: ${viewRaw}`);
  }
  const view = viewRaw;

  if (!values.platform || !values.runtime) {
    die("--platform and --runtime are required");
  }

  const config = await loadConfig();
  if (!config.server) die("AIRLOCK_SERVER not set. Run `airlock init` first.");

  const query: Record<string, string> = {
    platform: values.platform as string,
    runtimeVersion: values.runtime as string,
    channel: (values.channel as string) ?? "default",
    limit: (values.limit as string) ?? "50",
  };
  if (values.from) query.from = values.from as string;
  if (values.to) query.to = values.to as string;

  const result = await api(config, VIEW_PATH[view], { query });

  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const supported = (result as { supported?: boolean }).supported;
  if (supported === false) {
    console.log(`Metrics view '${view}' is not supported by the current adapter.`);
    return;
  }

  render(view, result as Record<string, unknown>);
}

function render(view: View, result: Record<string, unknown>) {
  console.log(`Metrics: ${view}\n`);
  switch (view) {
    case "overview": {
      const overview = result.overview as Record<string, unknown>;
      printRecord(overview);
      return;
    }
    case "timings": {
      const timings = result.timings as Record<string, Record<string, unknown>>;
      for (const key of ["update_check", "update_downloaded", "update_applied"]) {
        const row = timings[key];
        if (!row) continue;
        console.log(`${key}`);
        printRecord(row, "  ");
      }
      return;
    }
    case "adoption": {
      const entries = (result.adoption as { entries?: Array<Record<string, unknown>> })?.entries ?? [];
      if (!entries.length) {
        console.log("No adoption entries.");
        return;
      }
      for (const entry of entries) {
        const id = String(entry.updateId ?? "unknown").slice(0, 12);
        const launches = entry.launches ?? 0;
        const failed = entry.failedLaunches ?? 0;
        const ota = entry.otaLaunches ?? 0;
        const embedded = entry.embeddedLaunches ?? 0;
        console.log(`${id}  launches=${launches}  failed=${failed}  ota=${ota}  embedded=${embedded}`);
      }
      return;
    }
    case "failures": {
      const entries = (result.failures as { entries?: Array<Record<string, unknown>> })?.entries ?? [];
      if (!entries.length) {
        console.log("No failure entries.");
        return;
      }
      for (const entry of entries) {
        const id = String(entry.updateId ?? "unknown").slice(0, 12);
        const failures = entry.failures ?? 0;
        const launches = entry.launches ?? 0;
        const crashRate = entry.crashRate ?? 0;
        console.log(
          `${id}  failures=${failures}  launches=${launches}  crashRate=${formatPct(Number(crashRate))}`
        );
      }
      return;
    }
    case "segments": {
      const segments = result.segments as Record<string, Array<Record<string, unknown>>>;
      for (const key of ["cohorts", "stages", "networkTypes", "bandwidthBuckets", "trustLevels"]) {
        const rows = segments[key] ?? [];
        console.log(`${key}`);
        if (!rows.length) {
          console.log("  (none)");
          continue;
        }
        for (const row of rows) {
          console.log(
            `  ${row.key ?? "unknown"}  launches=${row.launches ?? 0}  failed=${row.failedLaunches ?? 0}  crashRate=${formatPct(Number(row.crashRate ?? 0))}`
          );
        }
      }
      return;
    }
  }
}

function printRecord(value: Record<string, unknown>, prefix = "") {
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "number" && k.toLowerCase().includes("rate")) {
      console.log(`${prefix}${k}: ${formatPct(v)}`);
      continue;
    }
    if (typeof v === "object" && v && !Array.isArray(v)) {
      console.log(`${prefix}${k}:`);
      printRecord(v as Record<string, unknown>, `${prefix}  `);
      continue;
    }
    console.log(`${prefix}${k}: ${String(v)}`);
  }
}

function formatPct(value: number): string {
  if (!Number.isFinite(value)) return "0.00%";
  return `${(value * 100).toFixed(2)}%`;
}
