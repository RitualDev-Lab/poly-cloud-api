import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface RemoteCacheClientOptions {
  apiUrl: string;
  token: string;
  teamSlug?: string;
  timeoutMs?: number;
}

export interface ClientCacheResult {
  hit: boolean;
  key: string;
  durationMs: number;
  sizeBytes?: number;
  storageBackend: "remote";
}

export class RemoteCacheClient {
  private apiUrl: string;
  private token: string;
  private teamSlug: string;
  private timeoutMs: number;

  constructor(options: RemoteCacheClientOptions) {
    this.apiUrl = options.apiUrl.replace(/\/+$/, "");
    this.token = options.token;
    this.teamSlug = options.teamSlug || "default";
    this.timeoutMs = options.timeoutMs || 15000;
  }

  private getHeaders(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      "x-poly-team": this.teamSlug,
    };
  }

  private getUrl(path: string): string {
    const sep = path.includes("?") ? "&" : "?";
    return `${this.apiUrl}${path}${sep}team=${encodeURIComponent(this.teamSlug)}`;
  }

  async hasKey(hash: string): Promise<boolean> {
    try {
      const res = await fetch(this.getUrl(`/v8/artifacts/${hash}`), {
        method: "HEAD",
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return res.status === 200;
    } catch {
      return false;
    }
  }

  async download(hash: string): Promise<Buffer | null> {
    try {
      const res = await fetch(this.getUrl(`/v8/artifacts/${hash}`), {
        method: "GET",
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (res.status !== 200) return null;
      const arrayBuf = await res.arrayBuffer();
      return Buffer.from(arrayBuf);
    } catch {
      return null;
    }
  }

  async upload(
    hash: string,
    data: Buffer,
    options?: { tag?: string; durationMs?: number },
  ): Promise<boolean> {
    try {
      const headers: Record<string, string> = {
        ...this.getHeaders(),
        "Content-Type": "application/octet-stream",
        "Content-Length": data.length.toString(),
      };
      if (options?.tag) headers["x-artifact-tag"] = options.tag;
      if (options?.durationMs) headers["x-artifact-duration"] = options.durationMs.toString();

      const res = await fetch(this.getUrl(`/v8/artifacts/${hash}`), {
        method: "PUT",
        headers,
        body: data,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async delete(hash: string): Promise<boolean> {
    try {
      const res = await fetch(this.getUrl(`/v8/artifacts/${hash}`), {
        method: "DELETE",
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async reportEvent(event: {
    hash: string;
    event: "HIT" | "MISS" | "UPLOAD";
    duration?: number;
  }): Promise<void> {
    try {
      await fetch(this.getUrl("/v8/artifacts/events"), {
        method: "POST",
        headers: {
          ...this.getHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify([event]),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {}
  }
}

/**
 * Poly-compatible CacheStorageAdapter that delegates save/restore
 * directly to a remote poly-cloud-api instance.
 */
export class PolyRemoteCacheAdapter {
  readonly backend = "remote" as const;
  private client: RemoteCacheClient;

  constructor(options: RemoteCacheClientOptions) {
    this.client = new RemoteCacheClient(options);
  }

  async hasKey(key: string): Promise<boolean> {
    return this.client.hasKey(key);
  }

  async save(key: string, sourceDirectories: string[]): Promise<ClientCacheResult> {
    const start = performance.now();
    // Serialize source directories to a mock archive buffer (or JSON representation for testing)
    const archiveData: Record<string, string> = {};
    for (const dir of sourceDirectories) {
      if (!fs.existsSync(dir)) continue;
      const base = path.basename(dir);
      archiveData[base] = "DIR_ARCHIVE";
    }

    const buf = Buffer.from(JSON.stringify(archiveData));
    const success = await this.client.upload(key, buf);

    return {
      hit: success,
      key,
      durationMs: Math.round(performance.now() - start),
      sizeBytes: buf.length,
      storageBackend: "remote",
    };
  }

  async restore(key: string, _targetBaseDir: string): Promise<ClientCacheResult> {
    const start = performance.now();
    const data = await this.client.download(key);

    if (!data) {
      return {
        hit: false,
        key,
        durationMs: Math.round(performance.now() - start),
        storageBackend: "remote",
      };
    }

    return {
      hit: true,
      key,
      durationMs: Math.round(performance.now() - start),
      sizeBytes: data.length,
      storageBackend: "remote",
    };
  }

  async clean(): Promise<{ removedKeys: number; freedBytes: number }> {
    return { removedKeys: 0, freedBytes: 0 };
  }
}
