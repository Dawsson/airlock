import type { ExpoManifest } from "./types";

const BOUNDARY = "airlock-boundary";

/** Build multipart/mixed response wrapping an Expo manifest */
export function buildMultipartResponse(
  manifest: ExpoManifest,
  options?: { signature?: string }
): Response {
  const manifestJson = JSON.stringify(manifest);
  const directive = JSON.stringify({ sig: options?.signature ?? null });

  const parts = [
    `--${BOUNDARY}`,
    "Content-Disposition: inline; name=\"manifest\"",
    "Content-Type: application/json",
    "",
    manifestJson,
    `--${BOUNDARY}`,
    "Content-Disposition: inline; name=\"extensions\"",
    "Content-Type: application/json",
    "",
    JSON.stringify({}),
    `--${BOUNDARY}--`,
  ];

  const body = parts.join("\r\n");

  return new Response(body, {
    status: 200,
    headers: {
      ...buildManifestHeaders(),
      "Content-Type": `multipart/mixed; boundary=${BOUNDARY}`,
      ...(options?.signature
        ? { "expo-signature": directive }
        : {}),
    },
  });
}

/** Standard response headers required by the Expo Updates protocol */
export function buildManifestHeaders(): Record<string, string> {
  return {
    "expo-protocol-version": "1",
    "expo-sfv-version": "0",
    "cache-control": "private, max-age=0",
  };
}

/** 204 No Content — client already has the latest update */
export function buildNoUpdateResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: buildManifestHeaders(),
  });
}
