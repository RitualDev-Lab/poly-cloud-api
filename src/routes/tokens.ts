import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PolyCloudConfig } from "../config.js";
import type { MetadataStore, TokenRole } from "../metadata/types.js";
import { createAuthHook } from "../middleware/auth.js";

export interface TokensRouteOptions {
  store: MetadataStore;
  config: PolyCloudConfig;
}

export async function registerTokenRoutes(
  app: FastifyInstance,
  options: TokensRouteOptions,
): Promise<void> {
  const { store, config } = options;
  const adminAuth = createAuthHook({ store, config }, "admin");

  // POST /api/v1/tokens - Issue new API token
  app.post<{
    Body: {
      workspaceSlug?: string;
      name: string;
      role: TokenRole;
      expiresInDays?: number;
    };
  }>("/api/v1/tokens", { preHandler: adminAuth }, async (request, reply) => {
    const { workspaceSlug, name, role, expiresInDays } = request.body || {};

    if (!name || !role) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "Fields 'name' and 'role' are required",
      });
    }

    if (!["read", "write", "admin"].includes(role)) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "Field 'role' must be one of: 'read', 'write', 'admin'",
      });
    }

    const slug = workspaceSlug || request.workspace?.slug || config.defaultWorkspace;
    const ws = await store.ensureWorkspace(slug);

    const { token, rawToken } = await store.createToken({
      workspaceId: ws.id,
      name,
      role,
      expiresInDays,
    });

    return reply.code(201).send({
      token: {
        id: token.id,
        name: token.name,
        role: token.role,
        tokenPrefix: token.tokenPrefix,
        workspaceSlug: ws.slug,
        createdAt: token.createdAt,
        expiresAt: token.expiresAt,
      },
      rawToken, // Plaintext secret is returned only once
    });
  });

  // GET /api/v1/tokens - List tokens for a workspace
  app.get<{
    Querystring: { workspaceSlug?: string };
  }>("/api/v1/tokens", { preHandler: adminAuth }, async (request, reply) => {
    const slug = request.query.workspaceSlug || request.workspace?.slug || config.defaultWorkspace;
    const ws = await store.getWorkspaceBySlug(slug);
    if (!ws) {
      return reply.code(404).send({
        error: "Not Found",
        message: `Workspace '${slug}' not found`,
      });
    }

    const tokens = await store.listTokens(ws.id);
    return reply.code(200).send({
      tokens: tokens.map((t) => ({
        id: t.id,
        name: t.name,
        role: t.role,
        tokenPrefix: t.tokenPrefix,
        createdAt: t.createdAt,
        expiresAt: t.expiresAt,
        lastUsedAt: t.lastUsedAt,
      })),
    });
  });

  // DELETE /api/v1/tokens/:id - Revoke token
  app.delete<{ Params: { id: string } }>(
    "/api/v1/tokens/:id",
    { preHandler: adminAuth },
    async (request, reply) => {
      const id = request.params.id;
      const revoked = await store.revokeToken(id);

      if (!revoked) {
        return reply.code(404).send({
          error: "Not Found",
          message: `Token with id '${id}' not found`,
        });
      }

      return reply.code(200).send({ status: "revoked", id });
    },
  );
}
