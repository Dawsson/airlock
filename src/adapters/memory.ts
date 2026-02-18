import type { StorageAdapter, StoredUpdate, UpdateEntry, Platform } from "../types";

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

  async rollbackUpdate(
    channel: string,
    runtimeVersion: string,
    platform: Platform
  ): Promise<StoredUpdate | null> {
    const k = key(channel, runtimeVersion, platform);
    const list = this.updates.get(k) ?? [];
    if (list.length < 2) return null;
    list.shift(); // remove current
    return list[0] ?? null;
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

  async listUpdates(): Promise<UpdateEntry[]> {
    const results: UpdateEntry[] = [];
    for (const [k, list] of this.updates) {
      if (!list.length) continue;
      const [channel, runtimeVersion, platform] = k.split("/");
      results.push({ channel, runtimeVersion, platform: platform as Platform, update: list[0] });
    }
    return results;
  }

  async getAssetUrl(hash: string): Promise<string | null> {
    return this.assets.has(hash) ? `/assets/${hash}` : null;
  }

  async storeAsset(
    hash: string,
    data: Uint8Array | ReadableStream | ArrayBuffer,
    contentType: string
  ): Promise<string> {
    const bytes =
      data instanceof Uint8Array
        ? data
        : new Uint8Array(data instanceof ArrayBuffer ? data : await new Response(data).arrayBuffer());
    this.assets.set(hash, { data: bytes, contentType });
    return `/assets/${hash}`;
  }

  /** Test helper: get raw asset data */
  getAsset(hash: string) {
    return this.assets.get(hash) ?? null;
  }
}
