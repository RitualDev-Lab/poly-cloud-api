import path from "node:path";

export interface PolyCloudConfig {
  port: number;
  host: string;
  storageBackend: "local" | "s3" | "memory";
  storageLocalDir: string;
  s3: {
    endpoint?: string;
    region: string;
    bucket: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    forcePathStyle: boolean;
  };
  metadataDbPath: string;
  authEnabled: boolean;
  defaultAdminToken: string;
  defaultWorkspace: string;
  defaultTtlSeconds: number;
  maxArtifactSizeBytes: number;
  computeCostPerHourUsd: number;
  signatureVerification: boolean;
  signatureSecret?: string;
  presignedUrlsEnabled: boolean;
  presignedExpirySeconds: number;
  presignedRedirectOnGet: boolean;
  attestationRequired: boolean;
  attestationTrustedKeys: Record<string, string>;
  attestationAllowedRunners: string[];
  attestationAllowedArchitectures: string[];
  attestationAllowedPlatforms: string[];
  attestationAllowedBuilders: string[];
  checksumVerificationEnabled: boolean;
  githubOidcEnabled: boolean;
  githubOidcAudience?: string;
  githubOidcAllowedOwners: string[];
  githubOidcAllowedRepositories: string[];
  githubOidcRequireWriteBranch: string[];
  githubOidcAllowPrWrite: boolean;
  githubOidcTokenTtlSeconds: number;
  githubOidcJwksUrl?: string;
  autoEvictionEnabled: boolean;
  autoEvictIntervalSeconds: number;
  autoEvictOnWrite: boolean;
  quotaHighWatermarkRatio: number;
  quotaLowWatermarkRatio: number;
  deduplicationEnabled: boolean;
}

function parseList(val?: string): string[] {
  if (!val) return [];
  const trimmed = val.trim();
  if (trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed) as string[];
    } catch {
      // Fallback to comma split
    }
  }
  return trimmed
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseKeys(val?: string): Record<string, string> {
  if (!val) return {};
  const trimmed = val.trim();
  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed) as Record<string, string>;
    } catch {
      // Fallback
    }
  }
  return { default: trimmed };
}

export function loadConfig(overrides?: Partial<PolyCloudConfig>): PolyCloudConfig {
  const env = process.env;

  const defaultLocalDir = path.resolve(process.cwd(), "data", "artifacts");
  const defaultDbPath = path.resolve(process.cwd(), "data", "metadata.sqlite");

  return {
    port: overrides?.port ?? Number.parseInt(env.PORT || env.POLY_PORT || "8080", 10),
    host: overrides?.host ?? env.HOST ?? env.POLY_HOST ?? "0.0.0.0",
    storageBackend:
      overrides?.storageBackend ??
      ((env.STORAGE_BACKEND || env.POLY_STORAGE_BACKEND || "local").toLowerCase() as
        | "local"
        | "s3"
        | "memory"),
    storageLocalDir:
      overrides?.storageLocalDir ??
      env.STORAGE_LOCAL_DIR ??
      env.POLY_STORAGE_LOCAL_DIR ??
      defaultLocalDir,
    s3: {
      endpoint: overrides?.s3?.endpoint ?? env.S3_ENDPOINT ?? env.AWS_ENDPOINT_URL,
      region: overrides?.s3?.region ?? env.S3_REGION ?? env.AWS_REGION ?? "us-east-1",
      bucket: overrides?.s3?.bucket ?? env.S3_BUCKET ?? "poly-remote-cache",
      accessKeyId: overrides?.s3?.accessKeyId ?? env.S3_ACCESS_KEY_ID ?? env.AWS_ACCESS_KEY_ID,
      secretAccessKey:
        overrides?.s3?.secretAccessKey ?? env.S3_SECRET_ACCESS_KEY ?? env.AWS_SECRET_ACCESS_KEY,
      forcePathStyle:
        overrides?.s3?.forcePathStyle ?? (env.S3_FORCE_PATH_STYLE === "true" || !!env.S3_ENDPOINT),
    },
    metadataDbPath:
      overrides?.metadataDbPath ??
      env.METADATA_DB_PATH ??
      env.POLY_METADATA_DB_PATH ??
      defaultDbPath,
    authEnabled:
      overrides?.authEnabled ?? (env.AUTH_ENABLED !== "false" && env.POLY_AUTH_ENABLED !== "false"),
    defaultAdminToken:
      overrides?.defaultAdminToken ??
      env.DEFAULT_ADMIN_TOKEN ??
      env.POLY_ADMIN_TOKEN ??
      "poly_admin_default_token",
    defaultWorkspace:
      overrides?.defaultWorkspace ??
      env.DEFAULT_WORKSPACE ??
      env.POLY_DEFAULT_WORKSPACE ??
      "default",
    defaultTtlSeconds:
      overrides?.defaultTtlSeconds ??
      Number.parseInt(env.DEFAULT_TTL_SECONDS || env.POLY_DEFAULT_TTL || "604800", 10), // 7 days
    maxArtifactSizeBytes:
      overrides?.maxArtifactSizeBytes ??
      Number.parseInt(
        env.MAX_ARTIFACT_SIZE_BYTES || "2147483648", // 2GB
        10,
      ),
    computeCostPerHourUsd:
      overrides?.computeCostPerHourUsd ??
      Number.parseFloat(env.COMPUTE_COST_PER_HOUR_USD || "0.08"), // Standard GitHub Actions / Cloud runner rate
    signatureVerification:
      overrides?.signatureVerification ??
      (env.SIGNATURE_VERIFICATION === "true" || env.POLY_SIGNATURE_VERIFICATION === "true"),
    signatureSecret:
      overrides?.signatureSecret ?? env.SIGNATURE_SECRET ?? env.POLY_SIGNATURE_SECRET,
    presignedUrlsEnabled:
      overrides?.presignedUrlsEnabled ??
      (env.PRESIGNED_URLS_ENABLED === "true" ||
        (env.PRESIGNED_URLS_ENABLED !== "false" &&
          (overrides?.storageBackend === "s3" || env.STORAGE_BACKEND === "s3"))),
    presignedExpirySeconds:
      overrides?.presignedExpirySeconds ??
      Number.parseInt(env.PRESIGNED_EXPIRY_SECONDS || "900", 10), // 15 mins
    presignedRedirectOnGet:
      overrides?.presignedRedirectOnGet ?? env.PRESIGNED_REDIRECT_ON_GET !== "false",
    attestationRequired:
      overrides?.attestationRequired ??
      (env.ATTESTATION_REQUIRED === "true" || env.POLY_ATTESTATION_REQUIRED === "true"),
    attestationTrustedKeys:
      overrides?.attestationTrustedKeys ??
      parseKeys(env.ATTESTATION_TRUSTED_KEYS || env.POLY_TRUSTED_KEYS),
    attestationAllowedRunners:
      overrides?.attestationAllowedRunners ??
      parseList(env.ATTESTATION_ALLOWED_RUNNERS || env.POLY_ALLOWED_RUNNERS),
    attestationAllowedArchitectures:
      overrides?.attestationAllowedArchitectures ??
      parseList(env.ATTESTATION_ALLOWED_ARCHS || env.POLY_ALLOWED_ARCHS),
    attestationAllowedPlatforms:
      overrides?.attestationAllowedPlatforms ??
      parseList(env.ATTESTATION_ALLOWED_PLATFORMS || env.POLY_ALLOWED_PLATFORMS),
    attestationAllowedBuilders:
      overrides?.attestationAllowedBuilders ??
      parseList(env.ATTESTATION_ALLOWED_BUILDERS || env.POLY_ALLOWED_BUILDERS),
    checksumVerificationEnabled:
      overrides?.checksumVerificationEnabled ??
      (env.CHECKSUM_VERIFICATION_ENABLED !== "false" && env.POLY_CHECKSUM_VERIFICATION !== "false"),
    githubOidcEnabled:
      overrides?.githubOidcEnabled ??
      (env.GITHUB_OIDC_ENABLED !== "false" && env.POLY_OIDC_ENABLED !== "false"),
    githubOidcAudience:
      overrides?.githubOidcAudience ?? env.GITHUB_OIDC_AUDIENCE ?? env.POLY_OIDC_AUDIENCE,
    githubOidcAllowedOwners:
      overrides?.githubOidcAllowedOwners ??
      parseList(env.GITHUB_OIDC_ALLOWED_OWNERS || env.POLY_OIDC_ALLOWED_OWNERS),
    githubOidcAllowedRepositories:
      overrides?.githubOidcAllowedRepositories ??
      parseList(env.GITHUB_OIDC_ALLOWED_REPOS || env.POLY_OIDC_ALLOWED_REPOS),
    githubOidcRequireWriteBranch:
      overrides?.githubOidcRequireWriteBranch ??
      parseList(env.GITHUB_OIDC_WRITE_BRANCHES || env.POLY_OIDC_WRITE_BRANCHES),
    githubOidcAllowPrWrite:
      overrides?.githubOidcAllowPrWrite ?? env.GITHUB_OIDC_ALLOW_PR_WRITE !== "false",
    githubOidcTokenTtlSeconds:
      overrides?.githubOidcTokenTtlSeconds ??
      Number.parseInt(env.GITHUB_OIDC_TOKEN_TTL || "3600", 10),
    githubOidcJwksUrl: overrides?.githubOidcJwksUrl ?? env.GITHUB_OIDC_JWKS_URL,
    autoEvictionEnabled:
      overrides?.autoEvictionEnabled ??
      (env.AUTO_EVICTION_ENABLED !== "false" && env.POLY_AUTO_EVICTION !== "false"),
    autoEvictIntervalSeconds:
      overrides?.autoEvictIntervalSeconds ??
      Number.parseInt(
        env.AUTO_EVICTION_INTERVAL_SECONDS || env.AUTO_EVICT_INTERVAL_SECONDS || "300",
        10,
      ),
    autoEvictOnWrite:
      overrides?.autoEvictOnWrite ??
      (env.AUTO_EVICT_ON_WRITE !== "false" && env.POLY_AUTO_EVICT_ON_WRITE !== "false"),
    quotaHighWatermarkRatio:
      overrides?.quotaHighWatermarkRatio ??
      Number.parseFloat(env.QUOTA_HIGH_WATERMARK_RATIO || "0.95"),
    quotaLowWatermarkRatio:
      overrides?.quotaLowWatermarkRatio ??
      Number.parseFloat(env.QUOTA_LOW_WATERMARK_RATIO || "0.80"),
    deduplicationEnabled:
      overrides?.deduplicationEnabled ??
      (env.DEDUPLICATION_ENABLED !== "false" && env.POLY_DEDUPLICATION !== "false"),
  };
}
