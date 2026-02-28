import type {
  ClientEventType,
  MetricsAdoption,
  MetricsFailures,
  MetricsOverview,
  MetricsQuery,
  MetricsSegments,
  MetricsTimings,
  ClientEvent,
  Platform,
  StorageAdapter,
  StoredUpdate,
  UpdateEntry,
  UpdateHealth,
} from "../types";

function key(channel: string, runtimeVersion: string, platform: Platform) {
  return `${channel}/${runtimeVersion}/${platform}`;
}

/** In-memory storage adapter — useful for tests and development */
export class MemoryAdapter implements StorageAdapter {
  private updates = new Map<string, StoredUpdate[]>();
  private assets = new Map<string, { data: Uint8Array; contentType: string }>();
  private health = new Map<
    string,
    Map<
      string,
      {
        totalLaunches: number;
        failedLaunches: number;
        trustedLaunches: number;
        trustedFailedLaunches: number;
        weightedLaunches: number;
        weightedFailedLaunches: number;
        downloadSamples: number;
        applySamples: number;
        downloadTotalMs: number;
        applyTotalMs: number;
        lastSeenAt: string;
      }
    >
  >();
  private metricsEvents: ClientEvent[] = [];

  private filterEvents(query: MetricsQuery): ClientEvent[] {
    const fromMs = Date.parse(query.from);
    const toMs = Date.parse(query.to);
    return this.metricsEvents.filter((event) => {
      if (event.channel !== query.channel) return false;
      if (event.runtimeVersion !== query.runtimeVersion) return false;
      if (event.platform !== query.platform) return false;
      const ts = Date.parse(event.timestamp ?? "");
      return Number.isFinite(ts) && ts >= fromMs && ts <= toMs;
    });
  }

  private static summarizeDurations(events: ClientEvent[]) {
    const values = events
      .map((event) => event.durationMs)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
      .sort((a, b) => a - b);
    if (!values.length) {
      return {
        count: 0,
        avgMs: null,
        minMs: null,
        maxMs: null,
        p50Ms: null,
        p95Ms: null,
      };
    }
    const at = (ratio: number) => values[Math.min(values.length - 1, Math.floor(values.length * ratio))];
    const total = values.reduce((sum, value) => sum + value, 0);
    return {
      count: values.length,
      avgMs: Math.round(total / values.length),
      minMs: values[0],
      maxMs: values[values.length - 1],
      p50Ms: at(0.5),
      p95Ms: at(0.95),
    };
  }

  private static countByType(events: ClientEvent[]): Record<ClientEventType, number> {
    const out: Record<ClientEventType, number> = {
      launch: 0,
      launch_failed: 0,
      update_check: 0,
      update_downloaded: 0,
      update_applied: 0,
    };
    for (const event of events) out[event.type] += 1;
    return out;
  }

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

  async recordClientEvents(events: ClientEvent[]): Promise<void> {
    this.metricsEvents.push(...events);
    for (const event of events) {
      if (!event.updateId) continue;
      const k = key(event.channel, event.runtimeVersion, event.platform);
      const byUpdate = this.health.get(k) ?? new Map();
      const existing = byUpdate.get(event.updateId) ?? {
        totalLaunches: 0,
        failedLaunches: 0,
        trustedLaunches: 0,
        trustedFailedLaunches: 0,
        weightedLaunches: 0,
        weightedFailedLaunches: 0,
        downloadSamples: 0,
        applySamples: 0,
        downloadTotalMs: 0,
        applyTotalMs: 0,
        lastSeenAt: new Date().toISOString(),
      };

      const trusted = event.trusted ?? true;
      const weight = Math.max(0, Math.min(1, event.trustWeight ?? (trusted ? 1 : 0.25)));
      if (event.type === "launch") {
        existing.totalLaunches += 1;
        if (trusted) existing.trustedLaunches += 1;
        existing.weightedLaunches += weight;
      }
      if (event.type === "launch_failed") {
        existing.totalLaunches += 1;
        existing.failedLaunches += 1;
        if (trusted) {
          existing.trustedLaunches += 1;
          existing.trustedFailedLaunches += 1;
        }
        existing.weightedLaunches += weight;
        existing.weightedFailedLaunches += weight;
      }
      if (event.type === "update_downloaded" && typeof event.durationMs === "number") {
        existing.downloadSamples += 1;
        existing.downloadTotalMs += event.durationMs;
      }
      if (event.type === "update_applied" && typeof event.durationMs === "number") {
        existing.applySamples += 1;
        existing.applyTotalMs += event.durationMs;
      }

      existing.lastSeenAt = event.timestamp ?? new Date().toISOString();
      byUpdate.set(event.updateId, existing);
      this.health.set(k, byUpdate);
    }
  }

  async recordMetricsSnapshots(events: ClientEvent[]): Promise<void> {
    // Memory adapter already snapshots metrics in recordClientEvents.
    void events;
  }

  async getUpdateHealth(
    channel: string,
    runtimeVersion: string,
    platform: Platform,
    limit = 20
  ): Promise<UpdateHealth[]> {
    const byUpdate = this.health.get(key(channel, runtimeVersion, platform));
    if (!byUpdate) return [];
    const results: UpdateHealth[] = [];
    for (const [updateId, stats] of byUpdate) {
      results.push({
        updateId,
        totalLaunches: stats.totalLaunches,
        failedLaunches: stats.failedLaunches,
        crashRate: stats.totalLaunches > 0 ? stats.failedLaunches / stats.totalLaunches : 0,
        trustedLaunches: stats.trustedLaunches,
        trustedFailedLaunches: stats.trustedFailedLaunches,
        trustedCrashRate:
          stats.trustedLaunches > 0
            ? stats.trustedFailedLaunches / stats.trustedLaunches
            : 0,
        weightedLaunches: Number(stats.weightedLaunches.toFixed(3)),
        weightedFailedLaunches: Number(stats.weightedFailedLaunches.toFixed(3)),
        weightedCrashRate:
          stats.weightedLaunches > 0
            ? stats.weightedFailedLaunches / stats.weightedLaunches
            : 0,
        avgDownloadMs:
          stats.downloadSamples > 0
            ? Math.round(stats.downloadTotalMs / stats.downloadSamples)
            : null,
        avgApplyMs:
          stats.applySamples > 0
            ? Math.round(stats.applyTotalMs / stats.applySamples)
            : null,
        lastSeenAt: stats.lastSeenAt,
      });
    }
    return results
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
      .slice(0, limit);
  }

  async getMetricsOverview(query: MetricsQuery): Promise<MetricsOverview> {
    const events = this.filterEvents(query);
    const launches = events.filter((event) => event.type === "launch").length;
    const failedLaunches = events.filter((event) => event.type === "launch_failed").length;
    const trustedLaunches = events.filter(
      (event) => (event.type === "launch" || event.type === "launch_failed") && !!event.trusted
    ).length;
    const trustedFailedLaunches = events.filter(
      (event) => event.type === "launch_failed" && !!event.trusted
    ).length;
    const weightedLaunches = events
      .filter((event) => event.type === "launch" || event.type === "launch_failed")
      .reduce((sum, event) => sum + (event.trustWeight ?? (event.trusted ? 1 : 0.25)), 0);
    const weightedFailedLaunches = events
      .filter((event) => event.type === "launch_failed")
      .reduce((sum, event) => sum + (event.trustWeight ?? (event.trusted ? 1 : 0.25)), 0);
    return {
      totalEvents: events.length,
      uniqueUpdates: new Set(events.map((event) => event.updateId).filter(Boolean)).size,
      blockedUpdates: 0,
      launches,
      failedLaunches,
      trustedLaunches,
      trustedFailedLaunches,
      weightedLaunches: Number(weightedLaunches.toFixed(3)),
      weightedFailedLaunches: Number(weightedFailedLaunches.toFixed(3)),
      crashRate: launches + failedLaunches > 0 ? failedLaunches / (launches + failedLaunches) : 0,
      trustedCrashRate:
        trustedLaunches > 0 ? trustedFailedLaunches / trustedLaunches : 0,
      weightedCrashRate:
        weightedLaunches > 0 ? weightedFailedLaunches / weightedLaunches : 0,
      byType: MemoryAdapter.countByType(events),
    };
  }

  async getMetricsTimings(query: MetricsQuery): Promise<MetricsTimings> {
    const events = this.filterEvents(query);
    return {
      update_check: MemoryAdapter.summarizeDurations(events.filter((event) => event.type === "update_check")),
      update_downloaded: MemoryAdapter.summarizeDurations(events.filter((event) => event.type === "update_downloaded")),
      update_applied: MemoryAdapter.summarizeDurations(events.filter((event) => event.type === "update_applied")),
    };
  }

  async getMetricsAdoption(query: MetricsQuery): Promise<MetricsAdoption> {
    const events = this.filterEvents(query).filter((event) => !!event.updateId);
    const byUpdate = new Map<
      string,
      { launches: number; failedLaunches: number; embeddedLaunches: number; otaLaunches: number; lastSeenAt: string | null }
    >();
    for (const event of events) {
      const updateId = event.updateId!;
      const current = byUpdate.get(updateId) ?? {
        launches: 0,
        failedLaunches: 0,
        embeddedLaunches: 0,
        otaLaunches: 0,
        lastSeenAt: null,
      };
      if (event.type === "launch") {
        current.launches += 1;
        if (event.appliedFromEmbedded) current.embeddedLaunches += 1;
        else current.otaLaunches += 1;
      }
      if (event.type === "launch_failed") current.failedLaunches += 1;
      if (event.timestamp && (!current.lastSeenAt || event.timestamp > current.lastSeenAt)) {
        current.lastSeenAt = event.timestamp;
      }
      byUpdate.set(updateId, current);
    }
    return {
      entries: Array.from(byUpdate.entries())
        .map(([updateId, entry]) => ({ updateId, ...entry }))
        .sort((a, b) => (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? ""))
        .slice(0, query.limit),
    };
  }

  async getMetricsFailures(query: MetricsQuery): Promise<MetricsFailures> {
    const events = this.filterEvents(query).filter((event) => !!event.updateId);
    const launchesByUpdate = new Map<string, number>();
    const failuresByUpdate = new Map<string, { failures: number; byError: Record<string, number> }>();

    for (const event of events) {
      const updateId = event.updateId!;
      if (event.type === "launch" || event.type === "launch_failed") {
        launchesByUpdate.set(updateId, (launchesByUpdate.get(updateId) ?? 0) + 1);
      }
      if (event.type === "launch_failed") {
        const entry = failuresByUpdate.get(updateId) ?? { failures: 0, byError: {} };
        entry.failures += 1;
        const err = event.error ?? "unknown";
        entry.byError[err] = (entry.byError[err] ?? 0) + 1;
        failuresByUpdate.set(updateId, entry);
      }
    }

    return {
      entries: Array.from(failuresByUpdate.entries())
        .map(([updateId, failure]) => {
          const launches = launchesByUpdate.get(updateId) ?? 0;
          return {
            updateId,
            failures: failure.failures,
            launches,
            crashRate: launches > 0 ? failure.failures / launches : 0,
            byError: failure.byError,
          };
        })
        .sort((a, b) => b.failures - a.failures)
        .slice(0, query.limit),
    };
  }

  async getMetricsSegments(query: MetricsQuery): Promise<MetricsSegments> {
    const events = this.filterEvents(query).filter(
      (event) => event.type === "launch" || event.type === "launch_failed"
    );

    const build = (keyFor: (event: ClientEvent) => string) => {
      const map = new Map<string, { launches: number; failedLaunches: number }>();
      for (const event of events) {
        const key = keyFor(event);
        const entry = map.get(key) ?? { launches: 0, failedLaunches: 0 };
        entry.launches += 1;
        if (event.type === "launch_failed") entry.failedLaunches += 1;
        map.set(key, entry);
      }
      return Array.from(map.entries())
        .map(([key, value]) => ({
          key,
          launches: value.launches,
          failedLaunches: value.failedLaunches,
          crashRate: value.launches > 0 ? value.failedLaunches / value.launches : 0,
        }))
        .sort((a, b) => b.launches - a.launches)
        .slice(0, query.limit);
    };

    return {
      cohorts: build((event) => event.cohort ?? "unassigned"),
      stages: build((event) => event.stage ?? "unknown"),
      networkTypes: build((event) => event.networkType ?? "unknown"),
      bandwidthBuckets: build((event) => event.bandwidthBucket ?? "unknown"),
      trustLevels: build((event) => (event.trusted ? "trusted" : "untrusted")),
    };
  }
}
