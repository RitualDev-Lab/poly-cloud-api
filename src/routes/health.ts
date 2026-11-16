import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PolyCloudConfig } from "../config.js";
import type { StorageBackend } from "../storage/types.js";

export interface HealthRouteOptions {
  storage: StorageBackend;
  config: PolyCloudConfig;
  startTime: number;
}

export async function registerHealthRoutes(
  app: FastifyInstance,
  options: HealthRouteOptions,
): Promise<void> {
  const { storage, config, startTime } = options;

  app.get("/api/v1/health", async (_request: FastifyRequest, reply: FastifyReply) => {
    const pingStart = performance.now();
    let storageHealthy = true;
    let storageError: string | undefined;

    try {
      await storage.has("__health_probe__");
    } catch (err: unknown) {
      storageHealthy = false;
      storageError = (err as Error).message;
    }
    const storageLatencyMs = Math.round(performance.now() - pingStart);

    const uptimeSeconds = Math.round((Date.now() - startTime) / 1000);
    const mem = process.memoryUsage();

    return reply.code(storageHealthy ? 200 : 503).send({
      status: storageHealthy ? "ok" : "degraded",
      version: "0.1.0",
      uptimeSeconds,
      storage: {
        backend: storage.name,
        healthy: storageHealthy,
        latencyMs: storageLatencyMs,
        error: storageError,
      },
      authEnabled: config.authEnabled,
      memory: {
        rssMb: Math.round(mem.rss / 1024 / 1024),
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      },
    });
  });
}
