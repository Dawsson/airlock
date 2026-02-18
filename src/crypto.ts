/** Sign a manifest JSON string with RSA-SHA256 (rsa-v1_5-sha256) */
export async function signManifest(
  manifest: string,
  privateKey: CryptoKey,
  keyId = "main"
): Promise<string> {
  const data = new TextEncoder().encode(manifest);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    data
  );
  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)));
  return `sig="${sig}", keyid="${keyId}", alg="rsa-v1_5-sha256"`;
}

/** Import a PEM-encoded PKCS#8 private key for RSA-SHA256 signing */
export async function importSigningKey(pem: string): Promise<CryptoKey> {
  const b64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s/g, "");
  const der = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

/** Generate an RSA-2048 key pair for code signing */
export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"]
  ) as Promise<CryptoKeyPair>;
}

/** Export a CryptoKey to PEM format */
export async function exportKeyToPem(
  key: CryptoKey,
  type: "private" | "public"
): Promise<string> {
  const format = type === "private" ? "pkcs8" : "spki";
  const label = type === "private" ? "PRIVATE KEY" : "PUBLIC KEY";
  const der = await crypto.subtle.exportKey(format, key);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----\n`;
}

/** Compute Base64URL-encoded SHA-256 hash of data */
export async function hashAsset(data: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data);
  const b64 = btoa(String.fromCharCode(...new Uint8Array(hash)));
  // Base64URL: replace +/ with -_, strip padding
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
