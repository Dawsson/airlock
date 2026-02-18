import type { StorageAdapter, StoredUpdate, Platform } from "../types";

function key(channel: string, runtimeVersion: string, platform: Platform) {
  return `${channel}/${runtimeVersion}/${platform}`;
}

/** In-memory storage adapter — useful for tests and development */
export class MemoryAdapter implements StorageAdapter {
  private updates = new Map<string, StoredUpdate[]>();
  private assets = new Map<string, { data: Uint8Array; contentType: string }>();

  async getLatestUpdate(
    channel: string,
    runtimeVersion: string,
    platform: Platform
  ): Promise<StoredUpdate | null> {
    const list = this.updates.get(key(channel, runtimeVersion, platform));
    return list?.[0] ?? null;
  }

  async publishUpdate(
    channel: string,
    runtimeVersion: string,
    platform: Platform,
    update: StoredUpdate
  ): Promise<void> {
    const k = key(channel, runtimeVersion, platform);
    const list = this.updates.get(k) ?? [];
    list.unshift(update);
    this.updates.set(k, list);
  }

  async setRollout(
    channel: string,
    runtimeVersion: string,
    platform: Platform,
    updateId: string,
    percentage: number
  ): Promise<void> {
    const list = this.updates.get(key(channel, runtimeVersion, platform));
    const update = list?.find((u) => u.manifest.id === updateId);
    if (update) {
      update.rolloutPercentage = percentage;
      update.updatedAt = new Date().toISOString();
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
    const list = this.updates.get(key(channel, runtimeVersion, platform)) ?? [];
    return list.slice(0, limit);
  }

  async getAssetUrl(hash: string): Promise<string | null> {
    return this.assets.has(hash) ? `/assets/${hash}` : null;
  }

  /** Test helper: store an asset directly */
  storeAsset(hash: string, data: Uint8Array, contentType: string) {
    this.assets.set(hash, { data, contentType });
  }

  /** Test helper: get raw asset data */
  getAsset(hash: string) {
    return this.assets.get(hash) ?? null;
  }
}
