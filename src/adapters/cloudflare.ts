/// <reference types="@cloudflare/workers-types" />
import type { StorageAdapter, StoredUpdate, Platform } from "../types";

type CloudflareAdapterConfig = {
  kv: KVNamespace;
  r2: R2Bucket;
  r2PublicUrl: string;
};

const PREFIX = "airlock/v1";

function kvKey(
  channel: string,
  runtimeVersion: string,
  platform: Platform,
  suffix: "current" | "history"
) {
  return `${PREFIX}/${channel}/${runtimeVersion}/${platform}/${suffix}`;
}

function assetKey(hash: string) {
  return `airlock/assets/${hash}`;
}

/** Cloudflare Workers KV + R2 storage adapter */
export class CloudflareAdapter implements StorageAdapter {
  private kv: KVNamespace;
  private r2: R2Bucket;
  private r2PublicUrl: string;

  constructor(config: CloudflareAdapterConfig) {
    this.kv = config.kv;
    this.r2 = config.r2;
    this.r2PublicUrl = config.r2PublicUrl.replace(/\/$/, "");
  }

  async getLatestUpdate(
    channel: string,
    runtimeVersion: string,
    platform: Platform
  ): Promise<StoredUpdate | null> {
    const key = kvKey(channel, runtimeVersion, platform, "current");
    return this.kv.get<StoredUpdate>(key, "json");
  }

  async publishUpdate(
    channel: string,
    runtimeVersion: string,
    platform: Platform,
    update: StoredUpdate
  ): Promise<void> {
    const currentKey = kvKey(channel, runtimeVersion, platform, "current");
    const historyKey = kvKey(channel, runtimeVersion, platform, "history");

    // Push current to history
    const history =
      (await this.kv.get<StoredUpdate[]>(historyKey, "json")) ?? [];
    history.unshift(update);
    const trimmed = history.slice(0, 50);

    await Promise.all([
      this.kv.put(currentKey, JSON.stringify(update)),
      this.kv.put(historyKey, JSON.stringify(trimmed)),
    ]);
  }

  async setRollout(
    channel: string,
    runtimeVersion: string,
    platform: Platform,
    updateId: string,
    percentage: number
  ): Promise<void> {
    const currentKey = kvKey(channel, runtimeVersion, platform, "current");
    const current = await this.kv.get<StoredUpdate>(currentKey, "json");

    if (current && current.manifest.id === updateId) {
      current.rolloutPercentage = percentage;
      current.updatedAt = new Date().toISOString();
      await this.kv.put(currentKey, JSON.stringify(current));
    }
  }

  async promoteUpdate(
    fromChannel: string,
    toChannel: string,
    runtimeVersion: string,
    platform: Platform
  ): Promise<void> {
    const source = await this.getLatestUpdate(
      fromChannel,
      runtimeVersion,
      platform
    );
    if (source) {
      await this.publishUpdate(toChannel, runtimeVersion, platform, {
        ...source,
        rolloutPercentage: 100,
        updatedAt: new Date().toISOString(),
      });
    }
  }

  async getUpdateHistory(
    channel: string,
    runtimeVersion: string,
    platform: Platform,
    limit = 20
  ): Promise<StoredUpdate[]> {
    const historyKey = kvKey(channel, runtimeVersion, platform, "history");
    const history =
      (await this.kv.get<StoredUpdate[]>(historyKey, "json")) ?? [];
    return history.slice(0, limit);
  }

  async getAssetUrl(hash: string): Promise<string | null> {
    const obj = await this.r2.head(assetKey(hash));
    if (!obj) return null;
    return `${this.r2PublicUrl}/${assetKey(hash)}`;
  }

  /** Upload an asset to R2 */
  async uploadAsset(
    hash: string,
    data: ReadableStream | ArrayBuffer | Uint8Array,
    contentType: string
  ): Promise<string> {
    await this.r2.put(assetKey(hash), data, {
      httpMetadata: { contentType },
    });
    return `${this.r2PublicUrl}/${assetKey(hash)}`;
  }
}
