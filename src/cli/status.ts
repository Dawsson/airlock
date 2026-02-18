import { loadConfig, api, die, requireArgs } from "./shared";
import type { UpdateEntry } from "../types";

const USAGE = `airlock status — show all deployed updates

Usage: airlock status [options]

Options:
  --limit, -l   Max entries to show (default: 25)`;

export async function status(args: string[]) {
  const { values } = requireArgs(args, {
    flags: {
      limit: { type: "string", short: "l" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(USAGE);
    return;
  }

  const limit = parseInt((values.limit as string) ?? "25");
  if (isNaN(limit) || limit < 1) die("--limit must be a positive number");

  const config = await loadConfig();
  if (!config.server) die("AIRLOCK_SERVER not set. Run `airlock init` first.");

  const result = (await api(config, "/admin/status")) as { updates: UpdateEntry[] };

  if (!result.updates.length) {
    console.log("No updates published yet.");
    return;
  }

  // Sort: platform → channel → runtimeVersion
  const sorted = result.updates
    .sort((a, b) =>
      a.platform.localeCompare(b.platform) ||
      a.channel.localeCompare(b.channel) ||
      a.runtimeVersion.localeCompare(b.runtimeVersion)
    )
    .slice(0, limit);

  const total = result.updates.length;

  // Group by platform for display
  const byPlatform = new Map<string, UpdateEntry[]>();
  for (const entry of sorted) {
    const list = byPlatform.get(entry.platform) ?? [];
    list.push(entry);
    byPlatform.set(entry.platform, list);
  }

  const maxChannel = Math.max(...sorted.map((e) => e.channel.length));
  const maxRuntime = Math.max(...sorted.map((e) => e.runtimeVersion.length));

  for (const [platform, entries] of byPlatform) {
    console.log(`\n${platform}`);
    for (const { channel, runtimeVersion, update } of entries) {
      const id = update.manifest.id.slice(0, 8);
      const pct = `${update.rolloutPercentage}%`.padStart(4);
      const critical = update.critical ? " [CRITICAL]" : "";
      const msg = update.message ? `  ${update.message}` : "";
      const age = timeAgo(update.createdAt);
      const ch = channel.padEnd(maxChannel);
      const rv = runtimeVersion.padEnd(maxRuntime);
      console.log(`  ${ch}  rv ${rv}  ${id}  ${pct}${critical}${msg}  (${age})`);
    }
  }

  console.log();
  if (total > limit) {
    console.log(`Showing ${limit} of ${total} entries. Use --limit to see more.`);
  }
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
