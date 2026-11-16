import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PolyCloudConfig } from "../config.js";
import type { MetadataStore } from "../metadata/types.js";
import { createAuthHook } from "../middleware/auth.js";

export interface EventsRouteOptions {
  store: MetadataStore;
  config: PolyCloudConfig;
}

interface TelemetryEventPayload {
  sessionId?: string;
  source?: string;
  event?: "HIT" | "MISS" | "UPLOAD" | "DELETE" | string;
  hash?: string;
  duration?: number;
}

export async function registerEventsRoutes(
  app: FastifyInstance,
  options: EventsRouteOptions,
): Promise<void> {
  const { store, config } = options;
  const writeAuth = createAuthHook({ store, config }, "write");

  // POST /v8/artifacts/events - Record build task events
  app.post(
    "/v8/artifacts/events",
    { preHandler: writeAuth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const workspace = request.workspace!;
      const body = request.body;

      const events: TelemetryEventPayload[] = Array.isArray(body)
        ? body
        : body && typeof body === "object"
          ? [body as TelemetryEventPayload]
          : [];

      for (const item of events) {
        const rawEvent = (item.event || "HIT").toUpperCase();
        const eventType =
          rawEvent === "HIT"
            ? "hit"
            : rawEvent === "MISS"
              ? "miss"
              : rawEvent === "UPLOAD"
                ? "upload"
                : "hit";

        await store.recordEvent({
          workspaceId: workspace.id,
          hash: item.hash,
          eventType,
          durationSavedMs: item.duration || 0,
        });
      }

      return reply.code(200).send({ status: "ok", recorded: events.length });
    },
  );
}
