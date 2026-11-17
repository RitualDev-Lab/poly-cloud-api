import type { PolyCloudConfig } from "../config.js";
import type { MetadataStore } from "../metadata/types.js";
import type { StorageBackend } from "../storage/types.js";
import type { EvictionResult, OptimizationReport, StorageOptimizerConfig } from "./types.js";

export class StorageOptimizerDaemon {
  private store: MetadataStore;
  private storage: StorageBackend;
  private config: PolyCloudConfig;
  private optimizerConfig: StorageOptimizerConfig;
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;

  constructor(options: {
    store: MetadataStore;
    storage: StorageBackend;
    config: PolyCloudConfig;
    optimizerConfig?: Partial<StorageOptimizerConfig>;
  }) {
    this.store = options.store;
    this.storage = options.storage;
    this.config = options.config;
    this.optimizerConfig = {
      enabled: options.optimizerConfig?.enabled ?? options.config.autoEvictionEnabled,
      intervalSeconds:
        options.optimizerConfig?.intervalSeconds ?? options.config.autoEvictIntervalSeconds,
      autoEvictOnWrite:
        options.optimizerConfig?.autoEvictOnWrite ?? options.config.autoEvictOnWrite,
      highWatermarkRatio:
        options.optimizerConfig?.highWatermarkRatio ?? options.config.quotaHighWatermarkRatio,
      lowWatermarkRatio:
        options.optimizerConfig?.lowWatermarkRatio ?? options.config.quotaLowWatermarkRatio,
    };
  }

  /**
   * Starts the background quota monitoring and eviction timer.
   */
  start(): void {
    if (!this.optimizerConfig.enabled || this.timer) return;

    const intervalMs = Math.max(1000, this.optimizerConfig.intervalSeconds * 1000);
    this.timer = setInterval(() => {
      this.runOptimizationPass().catch(() => {
        // Suppress background errors to keep daemon resilient
      });
    }, intervalMs);

    // Prevent background timer from blocking process exit
    if (this.timer.unref) {
      this.timer.unref();
    }
  }

  /**
   * Stops the background optimizer timer.
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Evaluates workspace quota and executes Least-Recently-Used (LRU) eviction
   * if current usage exceeds the high watermark.
   */
  async evictWorkspaceLru(
    workspaceId: string,
    options?: { highWatermarkRatio?: number; lowWatermarkRatio?: number },
  ): Promise<EvictionResult> {
    const ws = await this.store.getWorkspaceById(workspaceId);
    if (!ws) {
      throw new Error(`Workspace with id '${workspaceId}' not found`);
    }

    const highRatio = options?.highWatermarkRatio ?? this.optimizerConfig.highWatermarkRatio;
    const lowRatio = options?.lowWatermarkRatio ?? this.optimizerConfig.lowWatermarkRatio;

    const highWatermarkBytes = Math.floor(ws.quotaBytes * highRatio);
    const lowWatermarkBytes = Math.floor(ws.quotaBytes * lowRatio);

    const stats = await this.store.getWorkspaceStats(ws.slug);
    let currentSizeBytes = stats.totalSizeBytes;

    const result: EvictionResult = {
      workspaceId: ws.id,
      workspaceSlug: ws.slug,
      evictedCount: 0,
      freedBytes: 0,
      evictedHashes: [],
      remainingSizeBytes: currentSizeBytes,
      quotaBytes: ws.quotaBytes,
      quotaUsedPercent: stats.quotaUsedPercent,
    };

    // If usage is below high watermark, no eviction needed
    if (currentSizeBytes <= highWatermarkBytes) {
      return result;
    }

    // Step 1: Prune any expired artifacts first (zero impact on active builds)
    const expired = await this.store.getExpiredArtifacts(ws.id);
    for (const exp of expired) {
      const storageKey = `${ws.id}/${exp.hash}`;
      await this.storage.delete(storageKey);
      await this.store.deleteArtifact(ws.id, exp.hash);
      currentSizeBytes -= exp.sizeBytes;
      result.freedBytes += exp.sizeBytes;
      result.evictedCount++;
      result.evictedHashes.push(exp.hash);
      await this.store.recordEvent({
        workspaceId: ws.id,
        hash: exp.hash,
        eventType: "delete",
        durationSavedMs: 0,
      });
    }

    // If still over low watermark, perform Least-Recently-Used (LRU) eviction
    if (currentSizeBytes > lowWatermarkBytes) {
      const candidates = await this.store.getArtifactsForEviction(ws.id);

      for (const item of candidates) {
        if (currentSizeBytes <= lowWatermarkBytes) {
          break; // Brought down to target low watermark
        }

        const storageKey = `${ws.id}/${item.hash}`;
        await this.storage.delete(storageKey);
        await this.store.deleteArtifact(ws.id, item.hash);

        currentSizeBytes -= item.sizeBytes;
        result.freedBytes += item.sizeBytes;
        result.evictedCount++;
        result.evictedHashes.push(item.hash);

        await this.store.recordEvent({
          workspaceId: ws.id,
          hash: item.hash,
          eventType: "delete",
          durationSavedMs: 0,
        });
      }
    }

    result.remainingSizeBytes = Math.max(0, currentSizeBytes);
    result.quotaUsedPercent =
      ws.quotaBytes > 0
        ? Number(((result.remainingSizeBytes / ws.quotaBytes) * 100).toFixed(1))
        : 0;

    return result;
  }

  /**
   * Inline on-write quota monitor: Called after an upload to trigger immediate LRU eviction
   * if workspace exceeds quota.
   */
  async checkOnWrite(workspaceId: string): Promise<EvictionResult | null> {
    if (!this.optimizerConfig.autoEvictOnWrite) return null;
    return this.evictWorkspaceLru(workspaceId);
  }

  /**
   * Runs a complete optimization pass across all workspaces.
   */
  async runOptimizationPass(): Promise<Record<string, EvictionResult>> {
    if (this.isRunning) return {};
    this.isRunning = true;

    const results: Record<string, EvictionResult> = {};
    try {
      const workspaces = await this.store.listWorkspaces();
      for (const ws of workspaces) {
        results[ws.slug] = await this.evictWorkspaceLru(ws.id);
      }
    } finally {
      this.isRunning = false;
    }

    return results;
  }

  /**
   * Generates a comprehensive optimization and deduplication report for a workspace.
   */
  async optimizeWorkspace(slug: string): Promise<OptimizationReport> {
    const ws = await this.store.getWorkspaceBySlug(slug);
    if (!ws) {
      throw new Error(`Workspace '${slug}' not found`);
    }

    // 1. Prune expired
    const expired = await this.store.getExpiredArtifacts(ws.id);
    let expiredFreedBytes = 0;
    for (const item of expired) {
      await this.storage.delete(`${ws.id}/${item.hash}`);
      await this.store.deleteArtifact(ws.id, item.hash);
      expiredFreedBytes += item.sizeBytes;
    }

    // 2. Perform LRU eviction if needed
    const lruResult = await this.evictWorkspaceLru(ws.id);

    // 3. Compute deduplication and current stats
    const stats = await this.store.getWorkspaceStats(slug);

    return {
      workspaceSlug: slug,
      expiredPrunedCount: expired.length,
      expiredFreedBytes,
      lruEvictedCount: lruResult.evictedCount,
      lruFreedBytes: lruResult.freedBytes,
      totalFreedBytes: expiredFreedBytes + lruResult.freedBytes,
      deduplicationSavingsBytes: stats.deduplicationSavingsBytes,
      deduplicationRatio: stats.deduplicationRatio,
      currentSizeBytes: stats.totalSizeBytes,
      quotaBytes: stats.quotaBytes,
      quotaUsedPercent: stats.quotaUsedPercent,
      timestamp: new Date().toISOString(),
    };
  }
}
