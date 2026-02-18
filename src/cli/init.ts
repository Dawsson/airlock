import { writeFileSync, existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { requireArgs, die } from "./shared";

const USAGE = `airlock init — initialize airlock config in your project

Usage: airlock init [options]

Options:
  --server, -s   Server URL (e.g. https://api.example.com/ota)
  --token, -t    Admin token

Creates .airlockrc.json with your server config.`;

export async function init(args: string[]) {
  const { values } = requireArgs(args, {
    flags: {
      server: { type: "string", short: "s" },
      token: { type: "string", short: "t" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(USAGE);
    return;
  }

  const rcPath = resolve(process.cwd(), ".airlockrc.json");

  let existing: Record<string, string> = {};
  if (existsSync(rcPath)) {
    existing = JSON.parse(readFileSync(rcPath, "utf-8"));
  }

  const rc = {
    ...existing,
    ...(values.server ? { server: values.server } : {}),
    ...(values.token ? { token: values.token } : {}),
  };

  if (!rc.server) die("--server is required (e.g. https://api.example.com/ota)");

  writeFileSync(rcPath, JSON.stringify(rc, null, 2) + "\n");
  console.log(`Config written to ${rcPath}`);

  // Remind about .gitignore
  const gitignorePath = resolve(process.cwd(), ".gitignore");
  if (existsSync(gitignorePath)) {
    const content = readFileSync(gitignorePath, "utf-8");
    if (!content.includes(".airlockrc.json")) {
      console.log("\nRemember to add .airlockrc.json to .gitignore (it may contain your token).");
    }
  }
}
