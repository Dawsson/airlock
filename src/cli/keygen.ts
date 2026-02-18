import { writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { requireArgs, die } from "./shared";
import { generateKeyPair, exportKeyToPem } from "../crypto";

const USAGE = `airlock keygen — generate RSA-2048 signing key pair

Usage: airlock keygen [options]

Options:
  --out, -o    Output directory (default: .)

Generates:
  airlock-private.pem  — Private key (keep secret, use in AIRLOCK_SIGNING_KEY)
  airlock-public.pem   — Public key (bundle with your app)`;

export async function keygen(args: string[]) {
  const { values } = requireArgs(args, {
    flags: {
      out: { type: "string", short: "o" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(USAGE);
    return;
  }

  const outDir = resolve((values.out as string) ?? ".");

  const privatePath = resolve(outDir, "airlock-private.pem");
  const publicPath = resolve(outDir, "airlock-public.pem");

  if (existsSync(privatePath) || existsSync(publicPath)) {
    die("Key files already exist. Remove them first to regenerate.");
  }

  console.log("Generating RSA-2048 key pair...");

  const keyPair = await generateKeyPair();
  const privatePem = await exportKeyToPem(keyPair.privateKey, "private");
  const publicPem = await exportKeyToPem(keyPair.publicKey, "public");

  writeFileSync(privatePath, privatePem);
  writeFileSync(publicPath, publicPem);

  console.log(`  ${privatePath}`);
  console.log(`  ${publicPath}`);
  console.log(`\nAdd airlock-private.pem to .gitignore!`);
}
