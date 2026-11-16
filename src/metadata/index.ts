import type { PolyCloudConfig } from "../config.js";
import { MemoryMetadataStore, SqliteMetadataStore } from "./store.js";
import type { MetadataStore } from "./types.js";

export * from "./types.js";
export * from "./store.js";

export function createMetadataStore(config: PolyCloudConfig): MetadataStore {
  if (config.storageBackend === "memory" || config.metadataDbPath === ":memory:") {
    return new MemoryMetadataStore();
  }
  return new SqliteMetadataStore(config.metadataDbPath);
}
