export interface EvictionResult {
  workspaceId: string;
  workspaceSlug: string;
  evictedCount: number;
  freedBytes: number;
  evictedHashes: string[];
  remainingSizeBytes: number;
  quotaBytes: number;
  quotaUsedPercent: number;
}

export interface OptimizationReport {
  workspaceSlug: string;
  expiredPrunedCount: number;
  expiredFreedBytes: number;
  lruEvictedCount: number;
  lruFreedBytes: number;
  totalFreedBytes: number;
  deduplicationSavingsBytes: number;
  deduplicationRatio: number;
  currentSizeBytes: number;
  quotaBytes: number;
  quotaUsedPercent: number;
  timestamp: string;
}

export interface StorageOptimizerConfig {
  enabled: boolean;
  intervalSeconds: number;
  autoEvictOnWrite: boolean;
  highWatermarkRatio: number; // default: 0.95 (95% of quota)
  lowWatermarkRatio: number; // default: 0.80 (80% of quota target)
}
