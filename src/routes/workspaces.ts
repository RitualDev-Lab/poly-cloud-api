import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PolyCloudConfig } from "../config.js";
import type { MetadataStore } from "../metadata/types.js";
import { createAuthHook } from "../middleware/auth.js";
import { StorageOptimizerDaemon } from "../optimizer/daemon.js";
import type { StorageBackend } from "../storage/types.js";

export interface WorkspacesRouteOptions {
  storage: StorageBackend;
  store: MetadataStore;
  config: PolyCloudConfig;
  optimizer?: StorageOptimizerDaemon;
}

export async function registerWorkspaceRoutes(
  app: FastifyInstance,
  options: WorkspacesRouteOptions,
): Promise<void> {
  const { storage, store, config } = options;

  const adminAuth = createAuthHook({ store, config }, "admin");
  const writeAuth = createAuthHook({ store, config }, "write");
  const readAuth = createAuthHook({ store, config }, "read");

  // GET /api/v1/workspaces - List workspaces
  app.get(
    "/api/v1/workspaces",
    { preHandler: adminAuth },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      const list = await store.listWorkspaces();
      return reply.code(200).send({ workspaces: list });
    },
  );

  // POST /api/v1/workspaces - Create or configure workspace
  app.post<{
    Body: { slug: string; name?: string; quotaBytes?: number };
  }>("/api/v1/workspaces", { preHandler: adminAuth }, async (request, reply) => {
    const { slug, name, quotaBytes } = request.body || {};
    if (!slug || typeof slug !== "string") {
      return reply.code(400).send({
        error: "Bad Request",
        message: "Field 'slug' is required",
      });
    }

    const ws = await store.ensureWorkspace(slug, name, quotaBytes);
    return reply.code(201).send({ workspace: ws });
  });

  // GET /api/v1/workspaces/:slug/stats - Get ROI stats & hit rates
  app.get<{ Params: { slug: string } }>(
    "/api/v1/workspaces/:slug/stats",
    { preHandler: readAuth },
    async (request, reply) => {
      const slug = request.params.slug;
      try {
        const stats = await store.getWorkspaceStats(slug, config.computeCostPerHourUsd);
        return reply.code(200).send({ stats });
      } catch (err: unknown) {
        return reply.code(404).send({
          error: "Not Found",
          message: (err as Error).message,
        });
      }
    },
  );

  // GET /api/v1/workspaces/:slug/artifacts - List artifacts with pagination
  app.get<{
    Params: { slug: string };
    Querystring: { limit?: string; offset?: string };
  }>("/api/v1/workspaces/:slug/artifacts", { preHandler: readAuth }, async (request, reply) => {
    const slug = request.params.slug;
    const ws = await store.getWorkspaceBySlug(slug);
    if (!ws) {
      return reply.code(404).send({
        error: "Not Found",
        message: `Workspace '${slug}' not found`,
      });
    }

    const limit = Number.parseInt(request.query.limit || "50", 10);
    const offset = Number.parseInt(request.query.offset || "0", 10);

    const result = await store.listArtifacts(ws.id, limit, offset);
    return reply.code(200).send(result);
  });

  // POST /api/v1/workspaces/:slug/prune - Prune expired artifacts
  app.post<{ Params: { slug: string } }>(
    "/api/v1/workspaces/:slug/prune",
    { preHandler: adminAuth },
    async (request, reply) => {
      const slug = request.params.slug;
      const ws = await store.getWorkspaceBySlug(slug);
      if (!ws) {
        return reply.code(404).send({
          error: "Not Found",
          message: `Workspace '${slug}' not found`,
        });
      }

      const expired = await store.getExpiredArtifacts(ws.id);
      let freedBytes = 0;
      let deletedCount = 0;

      for (const item of expired) {
        const storageKey = `${ws.id}/${item.hash}`;
        await storage.delete(storageKey);
        await store.deleteArtifact(ws.id, item.hash);
        freedBytes += item.sizeBytes;
        deletedCount++;
      }

      return reply.code(200).send({
        status: "pruned",
        workspace: slug,
        deletedCount,
        freedBytes,
      });
    },
  );

  // POST /api/v1/workspaces/:slug/purge - Invalidate remote cache for branch or workspace
  app.post<{
    Params: { slug: string };
    Body: { branch?: string; tag?: string };
  }>("/api/v1/workspaces/:slug/purge", { preHandler: writeAuth }, async (request, reply) => {
    const slug = request.params.slug;
    const ws = await store.getWorkspaceBySlug(slug);
    if (!ws) {
      return reply.code(404).send({
        error: "Not Found",
        message: `Workspace '${slug}' not found`,
      });
    }

    const branchOrTag = request.body?.branch || request.body?.tag;
    const all = await store.listArtifacts(ws.id, 10000, 0);
    const toDelete = branchOrTag
      ? all.artifacts.filter(
          (a) =>
            a.tag === branchOrTag ||
            a.tag?.toLowerCase() === branchOrTag.toLowerCase() ||
            Boolean(a.tag?.includes(branchOrTag)),
        )
      : all.artifacts;

    let freedBytes = 0;
    let deletedCount = 0;
    const deletedHashes: string[] = [];

    for (const item of toDelete) {
      const storageKey = `${ws.id}/${item.hash}`;
      await storage.delete(storageKey);
      await store.deleteArtifact(ws.id, item.hash);
      freedBytes += item.sizeBytes;
      deletedCount++;
      deletedHashes.push(item.hash);

      await store.recordEvent({
        workspaceId: ws.id,
        hash: item.hash,
        eventType: "delete",
        durationSavedMs: 0,
      });
    }

    return reply.code(200).send({
      status: "purged",
      workspace: slug,
      branch: branchOrTag || "all",
      deletedCount,
      freedBytes,
      deletedHashes,
    });
  });

  // POST /api/v1/workspaces/:slug/optimize - Run storage optimizer (TTL cleanup + LRU eviction + deduplication)
  app.post<{ Params: { slug: string } }>(
    "/api/v1/workspaces/:slug/optimize",
    { preHandler: adminAuth },
    async (request, reply) => {
      const slug = request.params.slug;
      const ws = await store.getWorkspaceBySlug(slug);
      if (!ws) {
        return reply.code(404).send({
          error: "Not Found",
          message: `Workspace '${slug}' not found`,
        });
      }

      const activeOptimizer =
        options.optimizer ?? new StorageOptimizerDaemon({ store, storage, config });
      const report = await activeOptimizer.optimizeWorkspace(slug);

      return reply.code(200).send({
        status: "optimized",
        report,
      });
    },
  );
}
