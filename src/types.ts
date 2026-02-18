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

/** A stored update with rollout metadata */
export type StoredUpdate = {
  manifest: ExpoManifest;
  rolloutPercentage: number;
  message?: string;
  critical?: boolean;
  createdAt: string;
  updatedAt: string;
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
  resolveUpdate?: (
    update: StoredUpdate,
    context: UpdateContext
  ) => StoredUpdate | null | Promise<StoredUpdate | null>;
  onEvent?: (event: AirlockEvent) => void | Promise<void>;
  signingKey?: CryptoKey;
  signingKeyId?: string;
  certificateChain?: string;
};
