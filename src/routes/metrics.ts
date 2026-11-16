import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { MetadataStore } from "../metadata/types.js";

export interface MetricsRouteOptions {
  store: MetadataStore;
}

export async function registerMetricsRoutes(
  app: FastifyInstance,
  options: MetricsRouteOptions,
): Promise<void> {
  const { store } = options;

  app.get("/api/v1/metrics", async (_request: FastifyRequest, reply: FastifyReply) => {
    const workspaces = await store.listWorkspaces();
    let totalHits = 0;
    let totalMisses = 0;
    let totalSizeBytes = 0;
    let totalArtifacts = 0;
    let totalDurationSaved = 0;

    for (const ws of workspaces) {
      try {
        const stats = await store.getWorkspaceStats(ws.slug);
        totalHits += stats.totalHits;
        totalMisses += stats.totalMisses;
        totalSizeBytes += stats.totalSizeBytes;
        totalArtifacts += stats.totalArtifacts;
        totalDurationSaved += stats.totalDurationSavedSeconds;
      } catch {}
    }

    const output = [
      "# HELP poly_cache_hits_total Total number of remote cache hits",
      "# TYPE poly_cache_hits_total counter",
      `poly_cache_hits_total ${totalHits}`,
      "",
      "# HELP poly_cache_misses_total Total number of remote cache misses",
      "# TYPE poly_cache_misses_total counter",
      `poly_cache_misses_total ${totalMisses}`,
      "",
      "# HELP poly_cache_artifacts_count Current number of stored artifacts",
      "# TYPE poly_cache_artifacts_count gauge",
      `poly_cache_artifacts_count ${totalArtifacts}`,
      "",
      "# HELP poly_cache_bytes_total Total size in bytes stored in remote cache",
      "# TYPE poly_cache_bytes_total gauge",
      `poly_cache_bytes_total ${totalSizeBytes}`,
      "",
      "# HELP poly_cache_duration_saved_seconds Total compute time saved in seconds",
      "# TYPE poly_cache_duration_saved_seconds counter",
      `poly_cache_duration_saved_seconds ${totalDurationSaved}`,
      "",
    ].join("\n");

    reply.header("Content-Type", "text/plain; version=0.0.4");
    return reply.send(output);
  });
}
