export interface Workspace {
  id: string;
  slug: string;
  name: string;
  quotaBytes: number;
  defaultTtlSeconds: number;
  createdAt: string;
}

export type TokenRole = "read" | "write" | "admin";

export interface ApiToken {
  id: string;
  tokenHash: string;
  tokenPrefix: string;
  workspaceId: string;
  name: string;
  role: TokenRole;
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
}

export interface ArtifactRecord {
  hash: string;
  workspaceId: string;
  sizeBytes: number;
  tag?: string;
  durationMs?: number;
  hitCount: number;
  createdAt: string;
  lastAccessedAt: string;
  expiresAt: string;
}

export interface TelemetryEvent {
  id: string;
  workspaceId: string;
  hash?: string;
  eventType: "hit" | "miss" | "upload" | "delete";
  durationSavedMs: number;
  timestamp: string;
}

export interface WorkspaceStats {
  workspaceSlug: string;
  totalArtifacts: number;
  totalSizeBytes: number;
  quotaBytes: number;
  quotaUsedPercent: number;
  totalHits: number;
  totalMisses: number;
  hitRatePercent: number;
  totalDurationSavedSeconds: number;
  estimatedSavingsUsd: number;
}

export interface MetadataStore {
  init(): Promise<void>;
  close(): Promise<void>;

  // Workspaces
  getWorkspaceBySlug(slug: string): Promise<Workspace | null>;
  getWorkspaceById(id: string): Promise<Workspace | null>;
  ensureWorkspace(slug: string, name?: string, quotaBytes?: number): Promise<Workspace>;
  listWorkspaces(): Promise<Workspace[]>;

  // Tokens
  createToken(params: {
    workspaceId: string;
    name: string;
    role: TokenRole;
    expiresInDays?: number;
  }): Promise<{ token: ApiToken; rawToken: string }>;
  verifyToken(rawToken: string): Promise<{ token: ApiToken; workspace: Workspace } | null>;
  listTokens(workspaceId: string): Promise<ApiToken[]>;
  revokeToken(id: string): Promise<boolean>;

  // Artifacts
  recordArtifact(params: {
    hash: string;
    workspaceId: string;
    sizeBytes: number;
    tag?: string;
    durationMs?: number;
    ttlSeconds?: number;
  }): Promise<ArtifactRecord>;
  getArtifact(workspaceId: string, hash: string): Promise<ArtifactRecord | null>;
  recordHit(workspaceId: string, hash: string): Promise<void>;
  deleteArtifact(workspaceId: string, hash: string): Promise<boolean>;
  listArtifacts(
    workspaceId: string,
    limit?: number,
    offset?: number,
  ): Promise<{ artifacts: ArtifactRecord[]; total: number }>;
  getExpiredArtifacts(workspaceId?: string): Promise<ArtifactRecord[]>;

  // Events & Analytics
  recordEvent(event: Omit<TelemetryEvent, "id" | "timestamp">): Promise<void>;
  getWorkspaceStats(slug: string, costPerHourUsd?: number): Promise<WorkspaceStats>;
}
