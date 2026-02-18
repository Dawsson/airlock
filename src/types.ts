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
  createdAt: string;
  updatedAt: string;
};

export type Platform = "ios" | "android";

/** Context passed to resolveUpdate hook and used internally */
export type UpdateContext = {
  channel: string;
  runtimeVersion: string;
  platform: Platform;
  headers: Record<string, string>;
  currentUpdateId: string | null;
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

  getUpdateHistory(
    channel: string,
    runtimeVersion: string,
    platform: Platform,
    limit?: number
  ): Promise<StoredUpdate[]>;

  getAssetUrl(hash: string): Promise<string | null>;
}

/** Configuration for createAirlock() */
export type AirlockConfig = {
  adapter: StorageAdapter;
  resolveUpdate?: (
    update: StoredUpdate,
    context: UpdateContext
  ) => StoredUpdate | null | Promise<StoredUpdate | null>;
  signingKey?: CryptoKey;
};
