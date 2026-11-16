import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { type Readable, Stream } from "node:stream";
import { pipeline } from "node:stream/promises";
import type {
  ArtifactStat,
  StorageBackend,
  StoragePruneResult,
  StoragePutResult,
} from "./types.js";

export class LocalDiskStorage implements StorageBackend {
  readonly name = "local" as const;
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = path.resolve(baseDir);
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private getFilePath(key: string): string {
    // Sanitize key to prevent path traversal
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.baseDir, safeKey);
  }

  async has(key: string): Promise<boolean> {
    const file = this.getFilePath(key);
    return fs.existsSync(file);
  }

  async get(key: string): Promise<Readable | null> {
    const file = this.getFilePath(key);
    if (!fs.existsSync(file)) return null;
    return fs.createReadStream(file);
  }

  async getBuffer(key: string): Promise<Buffer | null> {
    const file = this.getFilePath(key);
    if (!fs.existsSync(file)) return null;
    return fs.promises.readFile(file);
  }

  async put(key: string, data: Readable | Buffer): Promise<StoragePutResult> {
    const file = this.getFilePath(key);
    const tmpFile = `${file}.tmp.${Date.now()}.${crypto.randomBytes(4).toString("hex")}`;

    let totalBytes = 0;
    const hash = crypto.createHash("sha256");

    if (Buffer.isBuffer(data)) {
      totalBytes = data.length;
      hash.update(data);
      await fs.promises.writeFile(tmpFile, data);
    } else {
      const writeStream = fs.createWriteStream(tmpFile);

      // Tap stream to calculate hash and count bytes
      data.on("data", (chunk: Buffer) => {
        totalBytes += chunk.length;
        hash.update(chunk);
      });

      await pipeline(data, writeStream);
    }

    // Atomic rename
    await fs.promises.rename(tmpFile, file);

    return {
      sizeBytes: totalBytes,
      sha256: hash.digest("hex"),
    };
  }

  async delete(key: string): Promise<boolean> {
    const file = this.getFilePath(key);
    if (!fs.existsSync(file)) return false;
    await fs.promises.unlink(file);
    return true;
  }

  async stat(key: string): Promise<ArtifactStat> {
    const file = this.getFilePath(key);
    try {
      const stats = await fs.promises.stat(file);
      return {
        exists: true,
        sizeBytes: stats.size,
        lastModified: stats.mtime,
      };
    } catch {
      return { exists: false };
    }
  }

  async listKeys(prefix = ""): Promise<string[]> {
    if (!fs.existsSync(this.baseDir)) return [];
    const files = await fs.promises.readdir(this.baseDir);
    return files.filter((f) => !f.endsWith(".tmp") && f.startsWith(prefix)).map((f) => f);
  }

  async prune(beforeDate: Date): Promise<StoragePruneResult> {
    if (!fs.existsSync(this.baseDir)) return { deletedCount: 0, freedBytes: 0 };
    const files = await fs.promises.readdir(this.baseDir);
    let deletedCount = 0;
    let freedBytes = 0;

    for (const file of files) {
      if (file.includes(".tmp")) {
        // Always clean up orphaned temporary upload files older than 1 hour
        const fullPath = path.join(this.baseDir, file);
        try {
          const stats = await fs.promises.stat(fullPath);
          if (Date.now() - stats.mtimeMs > 3600000) {
            await fs.promises.unlink(fullPath);
          }
        } catch {}
        continue;
      }

      const fullPath = path.join(this.baseDir, file);
      try {
        const stats = await fs.promises.stat(fullPath);
        if (stats.mtime < beforeDate) {
          freedBytes += stats.size;
          await fs.promises.unlink(fullPath);
          deletedCount++;
        }
      } catch {}
    }

    return { deletedCount, freedBytes };
  }
}
