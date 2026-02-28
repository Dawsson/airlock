import { resolve, basename, extname } from "path";
import { existsSync, readFileSync } from "fs";
import { loadConfig, api, die, requireArgs } from "./shared";
import { createHash } from "crypto";

const USAGE = `airlock publish — publish an update from expo export output

Usage: airlock publish [options]

Options:
  --dist, -d       Path to expo export output (default: dist)
  --platform, -p   Platform: ios or android (required)
  --runtime, -r    Runtime version (required)
  --channel, -c    Channel name (default: default)
  --message, -m    Human-readable update message
  --kind           Update kind: feature|optional|hotfix|emergency
  --stage          Stage: development|preview|staging|production
  --tags           Comma-separated tags
  --cohort         Optional cohort identifier for A/B targeting
  --min-bandwidth  Minimum required bandwidth in kbps
  --immediate-apply Apply hint: never|fast_connection|always
  --critical        Mark as critical update
  --rollout         Rollout percentage (default: 100)`;

export async function publish(args: string[]) {
  const { values } = requireArgs(args, {
    flags: {
      dist: { type: "string", short: "d" },
      platform: { type: "string", short: "p" },
      runtime: { type: "string", short: "r" },
      channel: { type: "string", short: "c" },
      message: { type: "string", short: "m" },
      kind: { type: "string" },
      stage: { type: "string" },
      tags: { type: "string" },
      cohort: { type: "string" },
      "min-bandwidth": { type: "string" },
      "immediate-apply": { type: "string" },
      critical: { type: "boolean" },
      rollout: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(USAGE);
    return;
  }

  const platform = values.platform as string | undefined;
  const runtimeVersion = values.runtime as string | undefined;
  if (!platform || !runtimeVersion) die("--platform and --runtime are required");
  if (platform !== "ios" && platform !== "android") die("--platform must be ios or android");
  if (
    values.kind &&
    !["feature", "optional", "hotfix", "emergency"].includes(values.kind as string)
  ) {
    die("--kind must be one of: feature, optional, hotfix, emergency");
  }
  if (
    values.stage &&
    !["development", "preview", "staging", "production"].includes(values.stage as string)
  ) {
    die("--stage must be one of: development, preview, staging, production");
  }
  if (
    values["immediate-apply"] &&
    !["never", "fast_connection", "always"].includes(values["immediate-apply"] as string)
  ) {
    die("--immediate-apply must be one of: never, fast_connection, always");
  }

  const config = await loadConfig();
  if (!config.server) die("AIRLOCK_SERVER not set. Run `airlock init` or set the env var.");

  const distDir = resolve((values.dist as string) ?? "dist");
  if (!existsSync(distDir)) die(`dist directory not found: ${distDir}`);

  // Read the expo export metadata
  const metadataPath = resolve(distDir, "metadata.json");
  if (!existsSync(metadataPath)) die("metadata.json not found in dist directory");
  const metadata = JSON.parse(readFileSync(metadataPath, "utf-8"));
  const expoConfigPath = resolve(distDir, "expoConfig.json");
  const expoConfig = existsSync(expoConfigPath)
    ? JSON.parse(readFileSync(expoConfigPath, "utf-8"))
    : null;

  const platformMetadata = metadata.fileMetadata?.[platform === "ios" ? "ios" : "android"];
  if (!platformMetadata) die(`No ${platform} metadata found in metadata.json`);

  // Read bundle
  const bundlePath = resolve(distDir, platformMetadata.bundle);
  if (!existsSync(bundlePath)) die(`Bundle not found: ${bundlePath}`);
  const bundleData = readFileSync(bundlePath);
  const bundleHash = hashAsset(bundleData);
  const bundleExt = extname(bundlePath) || ".js";

  // Read assets
  const assets: Array<{ hash: string; base64: string; contentType: string }> = [];
  const manifestAssets: Array<{
    hash: string;
    key: string;
    contentType: string;
    fileExtension: string;
    url: string;
  }> = [];

  // Bundle as launch asset
  assets.push({
    hash: bundleHash,
    base64: bundleData.toString("base64"),
    contentType: "application/javascript",
  });

  // Process other assets
  for (const asset of platformMetadata.assets ?? []) {
    const assetPath = resolve(distDir, asset.path);
    if (!existsSync(assetPath)) {
      console.warn(`Warning: asset not found: ${assetPath}`);
      continue;
    }
    const data = readFileSync(assetPath);
    const hash = hashAsset(data);
    const key = basename(asset.path);
    const ext = asset.ext ? `.${asset.ext}` : extname(asset.path);
    assets.push({
      hash,
      base64: data.toString("base64"),
      contentType: guessContentType(ext),
    });
    manifestAssets.push({
      hash,
      key,
      contentType: guessContentType(ext),
      fileExtension: ext,
      url: `assets/${hash}`,
    });
  }

  const updateId = crypto.randomUUID();
  const now = new Date().toISOString();
  const tags =
    typeof values.tags === "string"
      ? values.tags
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
      : undefined;
  const minBandwidthKbps =
    typeof values["min-bandwidth"] === "string"
      ? Number(values["min-bandwidth"])
      : undefined;
  if (
    values["min-bandwidth"] &&
    (typeof minBandwidthKbps !== "number" ||
      !Number.isFinite(minBandwidthKbps) ||
      minBandwidthKbps < 0)
  ) {
    die("--min-bandwidth must be a non-negative number");
  }
  const targeting =
    values.cohort || values["immediate-apply"] || Number.isFinite(minBandwidthKbps)
      ? {
          cohort: values.cohort as string | undefined,
          immediateApply: values["immediate-apply"] as "never" | "fast_connection" | "always" | undefined,
          minBandwidthKbps:
            typeof minBandwidthKbps === "number" && Number.isFinite(minBandwidthKbps)
              ? minBandwidthKbps
              : undefined,
        }
      : undefined;

  const manifest = {
    id: updateId,
    createdAt: now,
    runtimeVersion,
    launchAsset: {
      hash: bundleHash,
      key: "bundle",
      contentType: "application/javascript",
      fileExtension: bundleExt,
      url: `assets/${bundleHash}`,
    },
    assets: manifestAssets,
    metadata: {},
    extra: expoConfig ? { expoClient: expoConfig } : {},
  };

  console.log(`Publishing ${platform} update for rv ${runtimeVersion}...`);
  console.log(`  Bundle: ${bundleHash.slice(0, 12)}...`);
  console.log(`  Assets: ${assets.length} total`);

  const result = await api(config, "/admin/publish", {
    method: "POST",
    body: {
      manifest,
      runtimeVersion,
      platform,
      channel: values.channel ?? "default",
      message: values.message,
      critical: values.critical ?? false,
      kind: values.kind,
      stage: values.stage,
      tags,
      targeting,
      rolloutPercentage: values.rollout ? parseInt(values.rollout as string) : 100,
      assets,
    },
  });

  console.log(`Published! Update ID: ${(result as { updateId: string }).updateId}`);
}

function hashAsset(data: Buffer | Uint8Array): string {
  return createHash("sha256").update(data).digest("base64url");
}

function guessContentType(ext: string): string {
  const map: Record<string, string> = {
    ".js": "application/javascript",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".ttf": "font/ttf",
    ".otf": "font/otf",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".json": "application/json",
  };
  return map[ext.toLowerCase()] ?? "application/octet-stream";
}
