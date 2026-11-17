import type { Readable } from "node:stream";

export interface ArtifactStat {
  exists: boolean;
  sizeBytes?: number;
  lastModified?: Date;
  etag?: string;
}

export interface StoragePutResult {
  sizeBytes: number;
  sha256?: string;
}

export interface StoragePruneResult {
  deletedCount: number;
  freedBytes: number;
}

export interface PresignedUrlOptions {
  expiresInSeconds?: number;
  contentType?: string;
  sizeBytes?: number;
}

export interface StorageBackend {
  readonly name: "local" | "s3" | "memory";
  readonly supportsPresignedUrls?: boolean;
  init?(): Promise<void>;
  has(key: string): Promise<boolean>;
  get(key: string): Promise<Readable | null>;
  getBuffer(key: string): Promise<Buffer | null>;
  put(key: string, data: Readable | Buffer, sizeBytes?: number): Promise<StoragePutResult>;
  delete(key: string): Promise<boolean>;
  stat(key: string): Promise<ArtifactStat>;
  listKeys(prefix?: string): Promise<string[]>;
  prune(beforeDate: Date): Promise<StoragePruneResult>;
  getPresignedGetUrl?(key: string, options?: PresignedUrlOptions): Promise<string | null>;
  getPresignedPutUrl?(key: string, options?: PresignedUrlOptions): Promise<string | null>;
}
