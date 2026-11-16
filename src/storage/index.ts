import type { PolyCloudConfig } from "../config.js";
import { LocalDiskStorage } from "./local.js";
import { MemoryStorage } from "./memory.js";
import { S3Storage } from "./s3.js";
import type { StorageBackend } from "./types.js";

export * from "./types.js";
export * from "./local.js";
export * from "./memory.js";
export * from "./s3.js";

export function createStorageBackend(config: PolyCloudConfig): StorageBackend {
  switch (config.storageBackend) {
    case "memory":
      return new MemoryStorage();
    case "s3":
      return new S3Storage({
        bucket: config.s3.bucket,
        region: config.s3.region,
        endpoint: config.s3.endpoint,
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey,
        forcePathStyle: config.s3.forcePathStyle,
      });
    default:
      return new LocalDiskStorage(config.storageLocalDir);
  }
}
