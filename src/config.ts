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
  };
}
