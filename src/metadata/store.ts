import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DsseEnvelope, InTotoStatement } from "../attestation/types.js";
import type {
  ApiToken,
  ArtifactRecord,
  MetadataStore,
  TelemetryEvent,
  TokenRole,
  Workspace,
  WorkspaceStats,
} from "./types.js";

function hashToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

export class MemoryMetadataStore implements MetadataStore {
  protected workspaces = new Map<string, Workspace>(); // id -> Workspace
  protected workspacesBySlug = new Map<string, string>(); // slug -> id
  protected tokens = new Map<string, ApiToken>(); // id -> ApiToken
  protected tokensByHash = new Map<string, string>(); // hash -> id
  protected artifacts = new Map<string, ArtifactRecord>(); // "workspaceId:hash" -> ArtifactRecord
  protected events: TelemetryEvent[] = [];

  async init(): Promise<void> {
    // Initialized
  }

  async close(): Promise<void> {
    // Closed
  }

  async getWorkspaceBySlug(slug: string): Promise<Workspace | null> {
    const id = this.workspacesBySlug.get(slug);
    return id ? (this.workspaces.get(id) ?? null) : null;
  }

  async getWorkspaceById(id: string): Promise<Workspace | null> {
    return this.workspaces.get(id) ?? null;
  }

  async ensureWorkspace(
    slug: string,
    name?: string,
    quotaBytes = 107374182400,
  ): Promise<Workspace> {
    const existing = await this.getWorkspaceBySlug(slug);
    if (existing) return existing;

    const id = crypto.randomUUID();
    const ws: Workspace = {
      id,
      slug,
      name: name || slug,
      quotaBytes, // Default 100GB
      defaultTtlSeconds: 604800, // 7 days
      createdAt: new Date().toISOString(),
    };
    this.workspaces.set(id, ws);
    this.workspacesBySlug.set(slug, id);
    return ws;
  }

  async listWorkspaces(): Promise<Workspace[]> {
    return Array.from(this.workspaces.values());
  }

  async createToken(params: {
    workspaceId: string;
    name: string;
    role: TokenRole;
    expiresInDays?: number;
  }): Promise<{ token: ApiToken; rawToken: string }> {
    const rawSecret = crypto.randomBytes(24).toString("hex");
    const rawToken = `poly_tok_${rawSecret}`;
    const tokenHash = hashToken(rawToken);
    const id = crypto.randomUUID();

    const expiresAt = params.expiresInDays
      ? new Date(Date.now() + params.expiresInDays * 86400000).toISOString()
      : undefined;

    const token: ApiToken = {
      id,
      tokenHash,
      tokenPrefix: `poly_tok_${rawSecret.slice(0, 6)}...`,
      workspaceId: params.workspaceId,
      name: params.name,
      role: params.role,
      createdAt: new Date().toISOString(),
      expiresAt,
    };

    this.tokens.set(id, token);
    this.tokensByHash.set(tokenHash, id);

    return { token, rawToken };
  }

  async verifyToken(rawToken: string): Promise<{ token: ApiToken; workspace: Workspace } | null> {
    const tokenHash = hashToken(rawToken);
    const id = this.tokensByHash.get(tokenHash);
    if (!id) return null;

    const token = this.tokens.get(id);
    if (!token) return null;

    if (token.expiresAt && new Date(token.expiresAt) < new Date()) {
      return null;
    }

    const workspace = this.workspaces.get(token.workspaceId);
    if (!workspace) return null;

    token.lastUsedAt = new Date().toISOString();
    return { token, workspace };
  }

  async listTokens(workspaceId: string): Promise<ApiToken[]> {
    return Array.from(this.tokens.values()).filter((t) => t.workspaceId === workspaceId);
  }

  async revokeToken(id: string): Promise<boolean> {
    const token = this.tokens.get(id);
    if (!token) return false;
    this.tokensByHash.delete(token.tokenHash);
    this.tokens.delete(id);
    return true;
  }

  private artifactKey(workspaceId: string, hash: string): string {
    return `${workspaceId}:${hash}`;
  }

  async recordArtifact(params: {
    hash: string;
    workspaceId: string;
    sizeBytes: number;
    sha256?: string;
    tag?: string;
    durationMs?: number;
    ttlSeconds?: number;
    isAttested?: boolean;
    attestationVerified?: boolean;
    attestationSignerKeyId?: string;
    builderId?: string;
    ciRunner?: string;
    attestationEnvelope?: DsseEnvelope;
    attestationStatement?: InTotoStatement;
  }): Promise<ArtifactRecord> {
    const key = this.artifactKey(params.workspaceId, params.hash);
    const now = new Date();
    const ws = this.workspaces.get(params.workspaceId);
    const ttl = params.ttlSeconds ?? ws?.defaultTtlSeconds ?? 604800;
    const expiresAt = new Date(now.getTime() + ttl * 1000).toISOString();

    const record: ArtifactRecord = {
      hash: params.hash,
      workspaceId: params.workspaceId,
      sizeBytes: params.sizeBytes,
      sha256: params.sha256,
      tag: params.tag,
      durationMs: params.durationMs,
      hitCount: 0,
      isAttested: params.isAttested,
      attestationVerified: params.attestationVerified,
      attestationSignerKeyId: params.attestationSignerKeyId,
      builderId: params.builderId,
      ciRunner: params.ciRunner,
      attestationEnvelope: params.attestationEnvelope,
      attestationStatement: params.attestationStatement,
      createdAt: now.toISOString(),
      lastAccessedAt: now.toISOString(),
      expiresAt,
    };

    this.artifacts.set(key, record);
    return record;
  }

  async attachAttestation(params: {
    workspaceId: string;
    hash: string;
    isAttested: boolean;
    attestationVerified: boolean;
    attestationSignerKeyId?: string;
    builderId?: string;
    ciRunner?: string;
    attestationEnvelope?: DsseEnvelope;
    attestationStatement?: InTotoStatement;
  }): Promise<ArtifactRecord | null> {
    const key = this.artifactKey(params.workspaceId, params.hash);
    const record = this.artifacts.get(key);
    if (!record) return null;

    record.isAttested = params.isAttested;
    record.attestationVerified = params.attestationVerified;
    if (params.attestationSignerKeyId)
      record.attestationSignerKeyId = params.attestationSignerKeyId;
    if (params.builderId) record.builderId = params.builderId;
    if (params.ciRunner) record.ciRunner = params.ciRunner;
    if (params.attestationEnvelope) record.attestationEnvelope = params.attestationEnvelope;
    if (params.attestationStatement) record.attestationStatement = params.attestationStatement;

    return record;
  }

  async getArtifact(workspaceId: string, hash: string): Promise<ArtifactRecord | null> {
    const key = this.artifactKey(workspaceId, hash);
    const record = this.artifacts.get(key);
    if (!record) return null;

    if (new Date(record.expiresAt) < new Date()) {
      this.artifacts.delete(key);
      return null;
    }

    return record;
  }

  async recordHit(workspaceId: string, hash: string): Promise<void> {
    const key = this.artifactKey(workspaceId, hash);
    const record = this.artifacts.get(key);
    if (record) {
      record.hitCount++;
      record.lastAccessedAt = new Date().toISOString();
    }
  }

  async deleteArtifact(workspaceId: string, hash: string): Promise<boolean> {
    const key = this.artifactKey(workspaceId, hash);
    return this.artifacts.delete(key);
  }

  async listArtifacts(
    workspaceId: string,
    limit = 50,
    offset = 0,
  ): Promise<{ artifacts: ArtifactRecord[]; total: number }> {
    const all = Array.from(this.artifacts.values()).filter((a) => a.workspaceId === workspaceId);
    const total = all.length;
    const sorted = all.sort(
      (a, b) => new Date(b.lastAccessedAt).getTime() - new Date(a.lastAccessedAt).getTime(),
    );
    return {
      artifacts: sorted.slice(offset, offset + limit),
      total,
    };
  }

  async getExpiredArtifacts(workspaceId?: string): Promise<ArtifactRecord[]> {
    const now = new Date();
    return Array.from(this.artifacts.values()).filter((a) => {
      if (workspaceId && a.workspaceId !== workspaceId) return false;
      return new Date(a.expiresAt) < now;
    });
  }

  async recordEvent(event: Omit<TelemetryEvent, "id" | "timestamp">): Promise<void> {
    this.events.push({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      ...event,
    });
    // Keep max 10,000 events in memory
    if (this.events.length > 10000) {
      this.events.splice(0, 1000);
    }
  }

  async getWorkspaceStats(slug: string, costPerHourUsd = 0.08): Promise<WorkspaceStats> {
    const ws = await this.getWorkspaceBySlug(slug);
    if (!ws) {
      throw new Error(`Workspace '${slug}' not found`);
    }

    const wsArtifacts = Array.from(this.artifacts.values()).filter((a) => a.workspaceId === ws.id);
    let totalSizeBytes = 0;
    let totalHits = 0;
    let totalDurationSavedMs = 0;

    for (const art of wsArtifacts) {
      totalSizeBytes += art.sizeBytes;
      totalHits += art.hitCount;
      if (art.durationMs && art.hitCount > 0) {
        totalDurationSavedMs += art.durationMs * art.hitCount;
      }
    }

    const wsEvents = this.events.filter((e) => e.workspaceId === ws.id);
    let misses = 0;
    for (const e of wsEvents) {
      if (e.eventType === "miss") misses++;
      if (e.durationSavedMs > 0) {
        totalDurationSavedMs += e.durationSavedMs;
      }
    }

    const totalRequests = totalHits + misses;
    const hitRatePercent =
      totalRequests > 0 ? Number(((totalHits / totalRequests) * 100).toFixed(1)) : 0;
    const quotaUsedPercent =
      ws.quotaBytes > 0 ? Number(((totalSizeBytes / ws.quotaBytes) * 100).toFixed(1)) : 0;

    const totalDurationSavedSeconds = Math.round(totalDurationSavedMs / 1000);
    const hoursSaved = totalDurationSavedMs / 3600000;
    const estimatedSavingsUsd = Number((hoursSaved * costPerHourUsd).toFixed(2));

    return {
      workspaceSlug: ws.slug,
      totalArtifacts: wsArtifacts.length,
      totalSizeBytes,
      quotaBytes: ws.quotaBytes,
      quotaUsedPercent,
      totalHits,
      totalMisses: misses,
      hitRatePercent,
      totalDurationSavedSeconds,
      estimatedSavingsUsd,
    };
  }
}

/**
 * SQLite-backed MetadataStore with embedded node:sqlite engine
 * and automatic fallback to MemoryMetadataStore.
 */
export class SqliteMetadataStore extends MemoryMetadataStore {
  private dbPath: string;
  private db: unknown = null;

  constructor(dbPath: string) {
    super();
    this.dbPath = dbPath;
  }

  override async init(): Promise<void> {
    try {
      const dbDir = path.dirname(this.dbPath);
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
      }

      // Check if node:sqlite is present in current Node runtime
      const sqliteModule = "node:sqlite";
      const sqlite = await import(sqliteModule);
      if (sqlite?.DatabaseSync) {
        const db = new sqlite.DatabaseSync(this.dbPath);
        this.db = db;
        this.runMigrations(db);
        this.loadInitialData(db);
        return;
      }
    } catch {
      // Graceful fallback to MemoryMetadataStore if node:sqlite unavailable
    }
  }

  private runMigrations(db: { exec: (sql: string) => void }): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        quota_bytes INTEGER NOT NULL,
        default_ttl_seconds INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tokens (
        id TEXT PRIMARY KEY,
        token_hash TEXT UNIQUE NOT NULL,
        token_prefix TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT,
        last_used_at TEXT
      );

      CREATE TABLE IF NOT EXISTS artifacts (
        hash TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        sha256 TEXT,
        tag TEXT,
        duration_ms INTEGER,
        hit_count INTEGER NOT NULL DEFAULT 0,
        is_attested INTEGER,
        attestation_verified INTEGER,
        attestation_signer_key_id TEXT,
        builder_id TEXT,
        ci_runner TEXT,
        attestation_json TEXT,
        created_at TEXT NOT NULL,
        last_accessed_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, hash)
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        hash TEXT,
        event_type TEXT NOT NULL,
        duration_saved_ms INTEGER NOT NULL,
        timestamp TEXT NOT NULL
      );
    `);

    // Backwards-compatibility migrations for existing tables
    try {
      db.exec("ALTER TABLE artifacts ADD COLUMN sha256 TEXT;");
    } catch {}
    try {
      db.exec("ALTER TABLE artifacts ADD COLUMN is_attested INTEGER;");
    } catch {}
    try {
      db.exec("ALTER TABLE artifacts ADD COLUMN attestation_verified INTEGER;");
    } catch {}
    try {
      db.exec("ALTER TABLE artifacts ADD COLUMN attestation_signer_key_id TEXT;");
    } catch {}
    try {
      db.exec("ALTER TABLE artifacts ADD COLUMN builder_id TEXT;");
    } catch {}
    try {
      db.exec("ALTER TABLE artifacts ADD COLUMN ci_runner TEXT;");
    } catch {}
    try {
      db.exec("ALTER TABLE artifacts ADD COLUMN attestation_json TEXT;");
    } catch {}
  }

  private loadInitialData(db: {
    prepare: (sql: string) => { all: () => unknown[] };
  }): void {
    const wsRows = db.prepare("SELECT * FROM workspaces").all() as Array<{
      id: string;
      slug: string;
      name: string;
      quota_bytes: number;
      default_ttl_seconds: number;
      created_at: string;
    }>;
    for (const r of wsRows) {
      const ws: Workspace = {
        id: r.id,
        slug: r.slug,
        name: r.name,
        quotaBytes: r.quota_bytes,
        defaultTtlSeconds: r.default_ttl_seconds,
        createdAt: r.created_at,
      };
      this.workspaces.set(r.id, ws);
      this.workspacesBySlug.set(r.slug, r.id);
    }

    const tokenRows = db.prepare("SELECT * FROM tokens").all() as Array<{
      id: string;
      token_hash: string;
      token_prefix: string;
      workspace_id: string;
      name: string;
      role: TokenRole;
      created_at: string;
      expires_at?: string;
      last_used_at?: string;
    }>;
    for (const r of tokenRows) {
      const token: ApiToken = {
        id: r.id,
        tokenHash: r.token_hash,
        tokenPrefix: r.token_prefix,
        workspaceId: r.workspace_id,
        name: r.name,
        role: r.role,
        createdAt: r.created_at,
        expiresAt: r.expires_at,
        lastUsedAt: r.last_used_at,
      };
      this.tokens.set(r.id, token);
      this.tokensByHash.set(r.token_hash, r.id);
    }
  }

  override async close(): Promise<void> {
    if (this.db && typeof (this.db as { close?: () => void }).close === "function") {
      (this.db as { close: () => void }).close();
      this.db = null;
    }
  }
}
