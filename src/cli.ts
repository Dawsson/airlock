#!/usr/bin/env bun

import { publish } from "./cli/publish";
import { promote } from "./cli/promote";
import { rollback } from "./cli/rollback";
import { rollout } from "./cli/rollout";
import { list } from "./cli/list";
import { status } from "./cli/status";
import { keygen } from "./cli/keygen";
import { init } from "./cli/init";

const USAGE = `airlock — self-hosted Expo OTA update server

Usage: airlock <command> [options]

Commands:
  status      Show all deployed updates (human-friendly overview)
  publish     Publish an update from expo export output
  promote     Promote an update from one channel to another
  rollback    Roll back to the previous update
  rollout     Set rollout percentage for an update
  list        List update history for a specific channel/platform/runtime
  keygen      Generate RSA-2048 signing key pair
  init        Initialize airlock config in your project

Options:
  --help, -h     Show help
  --version, -v  Show version`;

const command = process.argv[2];

if (!command || command === "--help" || command === "-h") {
  console.log(USAGE);
  process.exit(0);
}

if (command === "--version" || command === "-v") {
  const pkg = await import("../package.json");
  console.log(pkg.version);
  process.exit(0);
}

const commands: Record<string, (args: string[]) => Promise<void>> = {
  status,
  publish,
  promote,
  rollback,
  rollout,
  list,
  keygen,
  init,
};

const handler = commands[command];
if (!handler) {
  console.error(`Unknown command: ${command}\n`);
  console.log(USAGE);
  process.exit(1);
}

await handler(process.argv.slice(3));
