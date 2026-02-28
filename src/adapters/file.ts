import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";
import type {
  ClientEvent,
  MetricsAdoption,
  MetricsFailures,
  MetricsOverview,
  MetricsQuery,
  MetricsSegments,
  MetricsTimings,
  Platform,
  StorageAdapter,
  StoredUpdate,
  UpdateEntry,
  UpdateHealth,
} from "../types";
import { MemoryAdapter, type MemoryAdapterSnapshot } from "./memory";

type FileAdapterOptions = {
  filePath: string;
};

/**
 * Persistent local adapter backed by a JSON snapshot on disk.
 * Useful for local/dev where in-memory state should survive restarts.
 */
export class FileAdapter implements StorageAdapter {
  private memory = new MemoryAdapter();
  private filePath: string;

  constructor(options: FileAdapterOptions) {
    this.filePath = options.filePath;
    this.loadFromDisk();
  }

  private loadFromDisk() {
    try {
      const raw = readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as MemoryAdapterSnapshot;
      this.memory.restore(parsed);
    } catch {
      // First boot or invalid snapshot; start clean.
    }
  }

  private saveToDisk() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const snapshot = this.memory.snapshot();
    writeFileSync(this.filePath, `${JSON.stringify(snapshot, null, 2)}\n`);
  }

  async getLatestUpdate(
    channel: string,
    runtimeVersion: string,
    platform: Platform,
  ): Promise<StoredUpdate | null> {
    return this.memory.getLatestUpdate(channel, runtimeVersion, platform);
  }

  async publishUpdate(
    channel: string,
    runtimeVersion: string,
    platform: Platform,
    update: StoredUpdate,
  ): Promise<void> {
    await this.memory.publishUpdate(channel, runtimeVersion, platform, update);
    this.saveToDisk();
  }

  async setRollout(
    channel: string,
    runtimeVersion: string,
    platform: Platform,
    updateId: string,
    percentage: number,
  ): Promise<void> {
    await this.memory.setRollout(channel, runtimeVersion, platform, updateId, percentage);
    this.saveToDisk();
  }

  async promoteUpdate(
    fromChannel: string,
    toChannel: string,
    runtimeVersion: string,
    platform: Platform,
  ): Promise<void> {
    await this.memory.promoteUpdate(fromChannel, toChannel, runtimeVersion, platform);
    this.saveToDisk();
  }

  async rollbackUpdate(
    channel: string,
    runtimeVersion: string,
    platform: Platform,
  ): Promise<StoredUpdate | null> {
    const update = await this.memory.rollbackUpdate(channel, runtimeVersion, platform);
    this.saveToDisk();
    return update;
  }

  async getUpdateHistory(
    channel: string,
    runtimeVersion: string,
    platform: Platform,
    limit?: number,
  ): Promise<StoredUpdate[]> {
    return this.memory.getUpdateHistory(channel, runtimeVersion, platform, limit);
  }

  async listUpdates(): Promise<UpdateEntry[]> {
    return this.memory.listUpdates();
  }

  async getAssetUrl(hash: string): Promise<string | null> {
    return this.memory.getAssetUrl(hash);
  }

  async storeAsset(
    hash: string,
    data: Uint8Array | ReadableStream | ArrayBuffer,
    contentType: string,
  ): Promise<string> {
    const url = await this.memory.storeAsset(hash, data, contentType);
    this.saveToDisk();
    return url;
  }

  async recordClientEvents(events: ClientEvent[]): Promise<void> {
    await this.memory.recordClientEvents?.(events);
    this.saveToDisk();
  }

  async recordMetricsSnapshots(events: ClientEvent[]): Promise<void> {
    await this.memory.recordMetricsSnapshots?.(events);
    this.saveToDisk();
  }

  async getUpdateHealth(
    channel: string,
    runtimeVersion: string,
    platform: Platform,
    limit?: number,
  ): Promise<UpdateHealth[]> {
    return this.memory.getUpdateHealth?.(channel, runtimeVersion, platform, limit) ?? [];
  }

  async getMetricsOverview(query: MetricsQuery): Promise<MetricsOverview> {
    return (
      this.memory.getMetricsOverview?.(query) ?? {
        totalEvents: 0,
        uniqueUpdates: 0,
        blockedUpdates: 0,
        launches: 0,
        failedLaunches: 0,
        trustedLaunches: 0,
        trustedFailedLaunches: 0,
        weightedLaunches: 0,
        weightedFailedLaunches: 0,
        crashRate: 0,
        trustedCrashRate: 0,
        weightedCrashRate: 0,
        byType: {
          launch: 0,
          launch_failed: 0,
          update_check: 0,
          update_downloaded: 0,
          update_applied: 0,
        },
      }
    );
  }

  async getMetricsTimings(query: MetricsQuery): Promise<MetricsTimings> {
    return (
      this.memory.getMetricsTimings?.(query) ?? {
        update_check: { count: 0, avgMs: null, minMs: null, maxMs: null, p50Ms: null, p95Ms: null },
        update_downloaded: {
          count: 0,
          avgMs: null,
          minMs: null,
          maxMs: null,
          p50Ms: null,
          p95Ms: null,
        },
        update_applied: {
          count: 0,
          avgMs: null,
          minMs: null,
          maxMs: null,
          p50Ms: null,
          p95Ms: null,
        },
      }
    );
  }

  async getMetricsAdoption(query: MetricsQuery): Promise<MetricsAdoption> {
    return this.memory.getMetricsAdoption?.(query) ?? { entries: [] };
  }

  async getMetricsFailures(query: MetricsQuery): Promise<MetricsFailures> {
    return this.memory.getMetricsFailures?.(query) ?? { entries: [] };
  }

  async getMetricsSegments(query: MetricsQuery): Promise<MetricsSegments> {
    return (
      this.memory.getMetricsSegments?.(query) ?? {
        cohorts: [],
        stages: [],
        networkTypes: [],
        bandwidthBuckets: [],
        trustLevels: [],
      }
    );
  }
}
