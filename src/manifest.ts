import type { ExpoManifest } from "./types";

const BOUNDARY = "airlock-boundary";

/** Build multipart/mixed response wrapping an Expo manifest */
export function buildMultipartResponse(
  manifest: ExpoManifest,
  options?: { signature?: string; certificateChain?: string }
): Response {
  const manifestJson = JSON.stringify(manifest);

  const parts: string[] = [];

  // Manifest part — signature is a per-part header
  parts.push(`--${BOUNDARY}`);
  parts.push('Content-Disposition: inline; name="manifest"');
  parts.push("Content-Type: application/json");
  if (options?.signature) {
    parts.push(`expo-signature: ${options.signature}`);
  }
  parts.push("");
  parts.push(manifestJson);

  // Extensions part
  parts.push(`--${BOUNDARY}`);
  parts.push('Content-Disposition: inline; name="extensions"');
  parts.push("Content-Type: application/json");
  parts.push("");
  parts.push(JSON.stringify({}));

  // Optional certificate chain part
  if (options?.certificateChain) {
    parts.push(`--${BOUNDARY}`);
    parts.push('Content-Disposition: inline; name="certificate_chain"');
    parts.push("Content-Type: application/x-pem-file");
    parts.push("");
    parts.push(options.certificateChain);
  }

  parts.push(`--${BOUNDARY}--`);
  // Trailing empty string ensures the body ends with \r\n after the close
  // delimiter — required by the expo-updates iOS multipart stream reader.
  parts.push("");

  const body = parts.join("\r\n");

  return new Response(body, {
    status: 200,
    headers: {
      ...buildProtocolHeaders(),
      "Content-Type": `multipart/mixed; boundary=${BOUNDARY}`,
    },
  });
}

/** Build a directive response (noUpdateAvailable or rollBackToEmbedded) */
export function buildDirectiveResponse(
  directive: { type: "noUpdateAvailable" } | { type: "rollBackToEmbedded"; parameters: { commitTime: string } },
  options?: { signature?: string }
): Response {
  const directiveJson = JSON.stringify(directive);
  const parts: string[] = [];

  parts.push(`--${BOUNDARY}`);
  parts.push('Content-Disposition: inline; name="directive"');
  parts.push("Content-Type: application/json");
  if (options?.signature) {
    parts.push(`expo-signature: ${options.signature}`);
  }
  parts.push("");
  parts.push(directiveJson);
  parts.push(`--${BOUNDARY}--`);
  // Trailing empty string ensures the body ends with \r\n after the close
  // delimiter — required by the expo-updates iOS multipart stream reader.
  parts.push("");

  const body = parts.join("\r\n");

  return new Response(body, {
    status: 200,
    headers: {
      ...buildProtocolHeaders(),
      "Content-Type": `multipart/mixed; boundary=${BOUNDARY}`,
    },
  });
}

/** Standard response headers required by the Expo Updates protocol */
export function buildProtocolHeaders(): Record<string, string> {
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
    headers: buildProtocolHeaders(),
  });
}
