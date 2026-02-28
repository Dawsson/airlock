/** Individual asset in an Expo manifest */
export type ManifestAsset = {
  hash: string;
  key: string;
  contentType: string;
  fileExtension: string;
  url: string;
};

/** Full Expo manifest returned to the client */
export type ExpoManifest = {
  id: string;
  createdAt: string;
  runtimeVersion: string;
  launchAsset: ManifestAsset;
  assets: ManifestAsset[];
  metadata: Record<string, unknown>;
  extra: Record<string, unknown>;
};

export type UpdateKind = "feature" | "optional" | "hotfix" | "emergency";
export type UpdateStage = "development" | "preview" | "staging" | "production";

export type UpdateTargeting = {
  /** Optional experiment cohort (e.g. "A", "B", "control") */
  cohort?: string;
  /** Minimum estimated bandwidth needed to serve this update */
  minBandwidthKbps?: number;
  /** Allowed app stages for this update */
  allowedStages?: UpdateStage[];
  /** Hint to client for when to apply fetched update */
  immediateApply?: "never" | "fast_connection" | "always";
};

/** A stored update with rollout metadata */
export type StoredUpdate = {
  manifest: ExpoManifest;
  rolloutPercentage: number;
  message?: string;
  critical?: boolean;
  kind?: UpdateKind;
  stage?: UpdateStage;
  tags?: string[];
  targeting?: UpdateTargeting;
  createdAt: string;
  updatedAt: string;
};

export type ClientEventType =
  | "launch"
  | "launch_failed"
  | "update_check"
  | "update_downloaded"
  | "update_applied";

export type ClientEvent = {
  type: ClientEventType;
  channel: string;
  runtimeVersion: string;
  platform: Platform;
  updateId?: string;
  deviceId?: string;
  stage?: UpdateStage;
  networkType?: "wifi" | "cellular" | "unknown";
  bandwidthKbps?: number;
  durationMs?: number;
  appliedFromEmbedded?: boolean;
  error?: string;
  timestamp?: string;
  /** Whether this event is trusted for stability decisions. */
  trusted?: boolean;
  /**
   * Optional raw trust score supplied by caller.
   * Can be 0..1, 0..100, or 0..1000 depending on deployment.
   */
  trustScore?: number;
  /** Normalized trust weight (0..1) computed by the server. */
  trustWeight?: number;
};

export type UpdateHealth = {
  updateId: string;
  totalLaunches: number;
  failedLaunches: number;
  crashRate: number;
  trustedLaunches: number;
  trustedFailedLaunches: number;
  trustedCrashRate: number;
  weightedLaunches: number;
  weightedFailedLaunches: number;
  weightedCrashRate: number;
  avgDownloadMs: number | null;
  avgApplyMs: number | null;
  lastSeenAt: string;
};

/** Events emitted by the server for analytics/logging */
export type AirlockEvent =
  | {
      type: "manifest_request";
      context: UpdateContext;
      served: boolean;
      updateId?: string;
    }
  | { type: "asset_request"; hash: string; found: boolean }
  | {
      type: "update_published";
      updateId: string;
      channel: string;
      runtimeVersion: string;
      platform: Platform;
    }
  | {
      type: "update_auto_blocked";
      updateId: string;
      channel: string;
      runtimeVersion: string;
      platform: Platform;
      crashRate: number;
      launches: number;
    }
  | {
      type: "client_events_recorded";
      count: number;
      channel: string;
      runtimeVersion: string;
      platform: Platform;
    }
  | { type: "rollout_changed"; updateId: string; percentage: number }
  | {
      type: "update_promoted";
      updateId: string;
      fromChannel: string;
      toChannel: string;
    }
  | { type: "update_rolled_back"; channel: string; rolledBackId: string };

export type Platform = "ios" | "android";

/** Context passed to resolveUpdate hook and used internally */
export type UpdateContext = {
  channel: string;
  runtimeVersion: string;
  platform: Platform;
  headers: Record<string, string>;
  currentUpdateId: string | null;
  deviceId: string;
  cohort: string | null;
  stage: UpdateStage | null;
  bandwidthKbps: number | null;
};

/** A single update entry returned by listUpdates() */
export type UpdateEntry = {
  channel: string;
  runtimeVersion: string;
  platform: Platform;
  update: StoredUpdate;
};

/** Storage backend interface — implement for your infra */
export interface StorageAdapter {
  getLatestUpdate(
    channel: string,
    runtimeVersion: string,
    platform: Platform
  ): Promise<StoredUpdate | null>;

  publishUpdate(
    channel: string,
    runtimeVersion: string,
    platform: Platform,
    update: StoredUpdate
  ): Promise<void>;

  setRollout(
    channel: string,
    runtimeVersion: string,
    platform: Platform,
    updateId: string,
    percentage: number
  ): Promise<void>;

  promoteUpdate(
    fromChannel: string,
    toChannel: string,
    runtimeVersion: string,
    platform: Platform
  ): Promise<void>;

  rollbackUpdate(
    channel: string,
    runtimeVersion: string,
    platform: Platform
  ): Promise<StoredUpdate | null>;

  getUpdateHistory(
    channel: string,
    runtimeVersion: string,
    platform: Platform,
    limit?: number
  ): Promise<StoredUpdate[]>;

  listUpdates(): Promise<UpdateEntry[]>;

  getAssetUrl(hash: string): Promise<string | null>;

  storeAsset(
    hash: string,
    data: Uint8Array | ReadableStream | ArrayBuffer,
    contentType: string
  ): Promise<string>;

  recordClientEvents?(events: ClientEvent[]): Promise<void>;

  getUpdateHealth?(
    channel: string,
    runtimeVersion: string,
    platform: Platform,
    limit?: number
  ): Promise<UpdateHealth[]>;
}

/** Configuration for createAirlock() */
export type AirlockConfig = {
  /**
   * Storage adapter instance, or a factory called per-request with the runtime env.
   * Use a factory for Cloudflare Workers where bindings are only available per-request:
   *
   * ```ts
   * adapter: (env: Env) => new CloudflareAdapter({ kv: env.OTA_KV, r2: env.OTA_R2, r2PublicUrl: env.R2_URL })
   * ```
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: StorageAdapter | ((env: any) => StorageAdapter);
  /**
   * Admin bearer token, or a factory called per-request with the runtime env.
   * Omit to allow unauthenticated admin access (not recommended for production).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adminToken?: string | ((env: any) => string | undefined);
  /**
   * Optional lightweight token for public client telemetry endpoint (`POST /events`).
   * Keep unset to allow unauthenticated telemetry ingestion.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clientEventToken?: string | ((env: any) => string | undefined);
  resolveUpdate?: (
    update: StoredUpdate,
    context: UpdateContext
  ) => StoredUpdate | null | Promise<StoredUpdate | null>;
  onEvent?: (event: AirlockEvent) => void | Promise<void>;
  stability?: {
    /** Auto-block unhealthy updates from being served (default: true). */
    autoBlockUnhealthy?: boolean;
    /** Minimum launches before health gating applies (default: 20). */
    minLaunchesForBlocking?: number;
    /** Crash-rate threshold (failed / total) to block (default: 0.2). */
    crashRateThreshold?: number;
    /** Allow auto-blocking from unauthenticated telemetry (default: false). */
    useUntrustedTelemetry?: boolean;
  };
  telemetry?: {
    /**
     * Enable public telemetry ingestion endpoint (`POST /events`).
     * Default: true when adapter supports telemetry.
     */
    enablePublicEndpoint?: boolean;
    /** Max accepted events per request (default: 20). */
    maxEventsPerRequest?: number;
    /** Max accepted request body size in bytes (default: 32768). */
    maxBodyBytes?: number;
    /** Allowed timestamp skew in milliseconds (default: 86400000 / 24h). */
    maxTimestampSkewMs?: number;
    /** Basic per-IP request throttle window (default: 60000 / 1m). */
    rateLimitWindowMs?: number;
    /** Basic per-IP request throttle cap per window (default: 120). */
    rateLimitMaxRequests?: number;
    /**
     * Maximum trust influence for unauthenticated requests (default: 0.25).
     * Prevents public actors from dominating auto-block decisions.
     */
    maxUntrustedWeight?: number;
    /**
     * Optional custom trust-score normalizer.
     * Should return a value between 0 and 1.
     */
    normalizeTrustScore?: (score: number, event: ClientEvent) => number;
  };
  signingKey?: CryptoKey;
  signingKeyId?: string;
  certificateChain?: string;
};
