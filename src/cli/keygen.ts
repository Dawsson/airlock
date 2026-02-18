import { writeFileSync, existsSync } from "fs";
import { resolve } from "path";
import { requireArgs, die } from "./shared";

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

  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"]
  );

  const privateKeyDer = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const publicKeyDer = await crypto.subtle.exportKey("spki", keyPair.publicKey);

  writeFileSync(privatePath, formatPem(privateKeyDer, "PRIVATE KEY"));
  writeFileSync(publicPath, formatPem(publicKeyDer, "PUBLIC KEY"));

  console.log(`  ${privatePath}`);
  console.log(`  ${publicPath}`);
  console.log(`\nAdd airlock-private.pem to .gitignore!`);
}

function formatPem(der: ArrayBuffer, label: string): string {
  const b64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}
