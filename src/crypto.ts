/** Sign a manifest JSON string with Ed25519 (Web Crypto API) */
export async function signManifest(
  manifest: string,
  privateKey: CryptoKey
): Promise<string> {
  const data = new TextEncoder().encode(manifest);
  const signature = await crypto.subtle.sign("Ed25519", privateKey, data);
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

/** Generate an Ed25519 key pair for code signing */
export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ]) as Promise<CryptoKeyPair>;
}
