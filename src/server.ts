import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import type { PolyCloudConfig } from "./config.js";
import { createMetadataStore } from "./metadata/index.js";
import type { MetadataStore } from "./metadata/types.js";
import type { GitHubOidcVerifier } from "./oidc/verifier.js";
import { StorageOptimizerDaemon } from "./optimizer/daemon.js";
import { registerArtifactRoutes } from "./routes/artifacts.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";
import { registerEventsRoutes } from "./routes/events.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerMetricsRoutes } from "./routes/metrics.js";
import { registerOidcRoutes } from "./routes/oidc.js";
import { registerTokenRoutes } from "./routes/tokens.js";
import { registerWorkspaceRoutes } from "./routes/workspaces.js";
import { createStorageBackend } from "./storage/index.js";
import type { StorageBackend } from "./storage/types.js";

export interface PolyCloudServer {
  app: FastifyInstance;
  config: PolyCloudConfig;
  storage: StorageBackend;
  store: MetadataStore;
  optimizer: StorageOptimizerDaemon;
  start: () => Promise<string>;
  stop: () => Promise<void>;
}

export async function createPolyCloudServer(
  config: PolyCloudConfig,
  overrides?: {
    storage?: StorageBackend;
    store?: MetadataStore;
    oidcVerifier?: GitHubOidcVerifier;
    optimizer?: StorageOptimizerDaemon;
  },
): Promise<PolyCloudServer> {
  const startTime = Date.now();

  const app = Fastify({
    logger: false,
    exposeHeadRoutes: false,
    bodyLimit: config.maxArtifactSizeBytes,
  });

  await app.register(cors, {
    origin: "*",
    methods: ["GET", "PUT", "POST", "DELETE", "HEAD", "OPTIONS"],
    allowedHeaders: [
      "Authorization",
      "Content-Type",
      "Content-Length",
      "x-artifact-tag",
      "x-artifact-duration",
      "x-artifact-signature",
      "x-poly-team",
    ],
  });

  // Custom parser to accept raw binary artifact payloads
  app.addContentTypeParser(
    [
      "application/octet-stream",
      "application/x-tar",
      "application/gzip",
      "application/zstd",
      "application/x-gzip",
      "binary/octet-stream",
    ],
    { parseAs: "buffer", bodyLimit: config.maxArtifactSizeBytes },
    (_req, body, done) => {
      done(null, body);
    },
  );

  const storage = overrides?.storage ?? createStorageBackend(config);
  const store = overrides?.store ?? createMetadataStore(config);

  await store.init();
  if (storage.init) {
    await storage.init();
  }

  // Ensure default workspace exists
  await store.ensureWorkspace(config.defaultWorkspace);

  // Initialize background Storage Optimizer Daemon
  const optimizer = overrides?.optimizer ?? new StorageOptimizerDaemon({ store, storage, config });

  // Register all routes
  await registerDashboardRoutes(app);
  await registerArtifactRoutes(app, {
    storage,
    store,
    config,
    oidcVerifier: overrides?.oidcVerifier,
    optimizer,
  });
  await registerEventsRoutes(app, { store, config });
  await registerWorkspaceRoutes(app, { storage, store, config, optimizer });
  await registerTokenRoutes(app, { store, config });
  await registerOidcRoutes(app, { store, config, verifier: overrides?.oidcVerifier });
  await registerHealthRoutes(app, { storage, config, startTime });
  await registerMetricsRoutes(app, { store });

  const start = async (): Promise<string> => {
    optimizer.start();
    return await app.listen({
      port: config.port,
      host: config.host,
    });
  };

  const stop = async (): Promise<void> => {
    optimizer.stop();
    await app.close();
    await store.close();
  };

  return {
    app,
    config,
    storage,
    store,
    optimizer,
    start,
    stop,
  };
}
