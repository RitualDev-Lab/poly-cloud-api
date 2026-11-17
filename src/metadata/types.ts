import type { DsseEnvelope, InTotoStatement } from "../attestation/types.js";

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
  sha256?: string;
  tag?: string;
  durationMs?: number;
  hitCount: number;
  isAttested?: boolean;
  attestationVerified?: boolean;
  attestationSignerKeyId?: string;
  builderId?: string;
  ciRunner?: string;
  attestationEnvelope?: DsseEnvelope;
  attestationStatement?: InTotoStatement;
  isDeduplicated?: boolean;
  originalHash?: string;
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
  deduplicationSavingsBytes: number;
  deduplicationRatio: number;
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
    sha256?: string;
    tag?: string;
    durationMs?: number;
    ttlSeconds?: number;
    expiresAt?: string;
    createdAt?: string;
    lastAccessedAt?: string;
    isAttested?: boolean;
    attestationVerified?: boolean;
    attestationSignerKeyId?: string;
    builderId?: string;
    ciRunner?: string;
    attestationEnvelope?: DsseEnvelope;
    attestationStatement?: InTotoStatement;
    isDeduplicated?: boolean;
    originalHash?: string;
  }): Promise<ArtifactRecord>;
  attachAttestation(params: {
    workspaceId: string;
    hash: string;
    isAttested: boolean;
    attestationVerified: boolean;
    attestationSignerKeyId?: string;
    builderId?: string;
    ciRunner?: string;
    attestationEnvelope?: DsseEnvelope;
    attestationStatement?: InTotoStatement;
  }): Promise<ArtifactRecord | null>;
  getArtifact(workspaceId: string, hash: string): Promise<ArtifactRecord | null>;
  recordHit(workspaceId: string, hash: string): Promise<void>;
  deleteArtifact(workspaceId: string, hash: string): Promise<boolean>;
  listArtifacts(
    workspaceId: string,
    limit?: number,
    offset?: number,
  ): Promise<{ artifacts: ArtifactRecord[]; total: number }>;
  getExpiredArtifacts(workspaceId?: string): Promise<ArtifactRecord[]>;
  getArtifactsForEviction(workspaceId: string): Promise<ArtifactRecord[]>;
  findArtifactBySha256(workspaceId: string, sha256: string): Promise<ArtifactRecord | null>;
  getDeduplicationStats(workspaceId?: string): Promise<{
    rawBytes: number;
    storedBytes: number;
    savedBytes: number;
    ratio: number;
  }>;

  // Events & Analytics
  recordEvent(event: Omit<TelemetryEvent, "id" | "timestamp">): Promise<void>;
  getWorkspaceStats(slug: string, costPerHourUsd?: number): Promise<WorkspaceStats>;
}
