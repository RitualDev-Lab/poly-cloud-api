import crypto from "node:crypto";
import { Readable } from "node:stream";
import type {
  ArtifactStat,
  StorageBackend,
  StoragePruneResult,
  StoragePutResult,
} from "./types.js";

interface MemoryEntry {
  buffer: Buffer;
  createdAt: Date;
  lastModified: Date;
}

export class MemoryStorage implements StorageBackend {
  readonly name = "memory" as const;
  private items = new Map<string, MemoryEntry>();

  async has(key: string): Promise<boolean> {
    return this.items.has(key);
  }

  async get(key: string): Promise<Readable | null> {
    const entry = this.items.get(key);
    if (!entry) return null;
    return Readable.from(entry.buffer);
  }

  async getBuffer(key: string): Promise<Buffer | null> {
    const entry = this.items.get(key);
    return entry ? entry.buffer : null;
  }

  async put(key: string, data: Readable | Buffer): Promise<StoragePutResult> {
    let buf: Buffer;
    if (Buffer.isBuffer(data)) {
      buf = data;
    } else {
      const chunks: Buffer[] = [];
      for await (const chunk of data) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      buf = Buffer.concat(chunks);
    }

    const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
    const now = new Date();

    this.items.set(key, {
      buffer: buf,
      createdAt: now,
      lastModified: now,
    });

    return {
      sizeBytes: buf.length,
      sha256,
    };
  }

  async delete(key: string): Promise<boolean> {
    return this.items.delete(key);
  }

  async stat(key: string): Promise<ArtifactStat> {
    const entry = this.items.get(key);
    if (!entry) return { exists: false };
    return {
      exists: true,
      sizeBytes: entry.buffer.length,
      lastModified: entry.lastModified,
    };
  }

  async listKeys(prefix = ""): Promise<string[]> {
    return Array.from(this.items.keys()).filter((k) => k.startsWith(prefix));
  }

  async prune(beforeDate: Date): Promise<StoragePruneResult> {
    let deletedCount = 0;
    let freedBytes = 0;

    for (const [key, entry] of this.items.entries()) {
      if (entry.lastModified < beforeDate) {
        freedBytes += entry.buffer.length;
        this.items.delete(key);
        deletedCount++;
      }
    }

    return { deletedCount, freedBytes };
  }

  clear(): void {
    this.items.clear();
  }
}
