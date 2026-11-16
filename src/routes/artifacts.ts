import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PolyCloudConfig } from "../config.js";
import type { MetadataStore } from "../metadata/types.js";
import { createAuthHook } from "../middleware/auth.js";
import type { StorageBackend } from "../storage/types.js";

export interface ArtifactsRouteOptions {
  storage: StorageBackend;
  store: MetadataStore;
  config: PolyCloudConfig;
}

export async function registerArtifactRoutes(
  app: FastifyInstance,
  options: ArtifactsRouteOptions,
): Promise<void> {
  const { storage, store, config } = options;

  const readAuth = createAuthHook({ store, config }, "read");
  const writeAuth = createAuthHook({ store, config }, "write");

  // GET /v8/artifacts/:hash - Fetch cached artifact
  app.get<{ Params: { hash: string } }>(
    "/v8/artifacts/:hash",
    { preHandler: readAuth },
    async (request, reply) => {
      const hash = request.params.hash;
      const workspace = request.workspace!;
      const storageKey = `${workspace.id}/${hash}`;

      const meta = await store.getArtifact(workspace.id, hash);
      const stream = await storage.get(storageKey);

      if (!stream) {
        // Record cache miss event
        await store.recordEvent({
          workspaceId: workspace.id,
          hash,
          eventType: "miss",
          durationSavedMs: 0,
        });

        return reply.code(404).send({
          error: "Not Found",
          message: `Artifact '${hash}' not found in workspace '${workspace.slug}'`,
        });
      }

      // Record cache hit
      await store.recordHit(workspace.id, hash);
      await store.recordEvent({
        workspaceId: workspace.id,
        hash,
        eventType: "hit",
        durationSavedMs: meta?.durationMs || 0,
      });

      const stat = await storage.stat(storageKey);

      reply.header("Content-Type", "application/octet-stream");
      if (stat.sizeBytes) {
        reply.header("Content-Length", stat.sizeBytes);
      }
      if (meta?.tag) {
        reply.header("x-artifact-tag", meta.tag);
      }
      if (meta?.durationMs) {
        reply.header("x-artifact-duration", meta.durationMs);
      }

      return reply.send(stream);
    },
  );

  // HEAD /v8/artifacts/:hash - Fast cache hit / existence probe
  app.head<{ Params: { hash: string } }>(
    "/v8/artifacts/:hash",
    { preHandler: readAuth },
    async (request, reply) => {
      const hash = request.params.hash;
      const workspace = request.workspace!;
      const storageKey = `${workspace.id}/${hash}`;

      const exists = await storage.has(storageKey);
      if (!exists) {
        return reply.code(404).send();
      }

      const stat = await storage.stat(storageKey);
      if (stat.sizeBytes) {
        reply.header("Content-Length", stat.sizeBytes);
      }
      return reply.code(200).send();
    },
  );

  // PUT /v8/artifacts/:hash - Upload and save cached artifact
  app.put<{ Params: { hash: string } }>(
    "/v8/artifacts/:hash",
    { preHandler: writeAuth },
    async (request, reply) => {
      const hash = request.params.hash;
      const workspace = request.workspace!;
      const storageKey = `${workspace.id}/${hash}`;

      const tag = request.headers["x-artifact-tag"] as string | undefined;
      const durationHeader = request.headers["x-artifact-duration"];
      const durationMs = durationHeader ? Number.parseInt(durationHeader as string, 10) : undefined;

      // Handle raw body stream or buffer
      let bodyData: Buffer | import("node:stream").Readable;
      if (Buffer.isBuffer(request.body)) {
        bodyData = request.body;
      } else if (typeof request.body === "string") {
        bodyData = Buffer.from(request.body);
      } else {
        // Fallback to underlying raw HTTP stream
        bodyData = request.raw;
      }

      // Check artifact size ceiling if Content-Length provided
      const contentLength = Number.parseInt(
        (request.headers["content-length"] as string) || "0",
        10,
      );
      if (contentLength > config.maxArtifactSizeBytes) {
        return reply.code(413).send({
          error: "Payload Too Large",
          message: `Artifact size ${contentLength} bytes exceeds cluster maximum of ${config.maxArtifactSizeBytes} bytes`,
        });
      }

      const putResult = await storage.put(storageKey, bodyData, contentLength);

      // Record metadata
      const record = await store.recordArtifact({
        hash,
        workspaceId: workspace.id,
        sizeBytes: putResult.sizeBytes,
        tag,
        durationMs,
      });

      // Record upload event
      await store.recordEvent({
        workspaceId: workspace.id,
        hash,
        eventType: "upload",
        durationSavedMs: 0,
      });

      return reply.code(200).send({
        status: "stored",
        hash: record.hash,
        sizeBytes: record.sizeBytes,
        sha256: putResult.sha256,
      });
    },
  );

  // DELETE /v8/artifacts/:hash - Invalidate artifact
  app.delete<{ Params: { hash: string } }>(
    "/v8/artifacts/:hash",
    { preHandler: writeAuth },
    async (request, reply) => {
      const hash = request.params.hash;
      const workspace = request.workspace!;
      const storageKey = `${workspace.id}/${hash}`;

      await storage.delete(storageKey);
      await store.deleteArtifact(workspace.id, hash);

      await store.recordEvent({
        workspaceId: workspace.id,
        hash,
        eventType: "delete",
        durationSavedMs: 0,
      });

      return reply.code(200).send({
        status: "deleted",
        hash,
      });
    },
  );
}
