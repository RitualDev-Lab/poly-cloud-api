import type { FastifyInstance } from "fastify";
import type { PolyCloudConfig } from "../config.js";
import type { MetadataStore } from "../metadata/types.js";
import type { GitHubOidcPolicy } from "../oidc/types.js";
import { GitHubOidcVerifier } from "../oidc/verifier.js";

export interface OidcRouteOptions {
  store: MetadataStore;
  config: PolyCloudConfig;
  verifier?: GitHubOidcVerifier;
}

export async function registerOidcRoutes(
  app: FastifyInstance,
  options: OidcRouteOptions,
): Promise<void> {
  const { store, config } = options;
  const verifier = options.verifier ?? new GitHubOidcVerifier();

  function getOidcPolicy(): GitHubOidcPolicy {
    return {
      enabled: config.githubOidcEnabled,
      jwksUrl: config.githubOidcJwksUrl,
      expectedAudience: config.githubOidcAudience,
      allowedOwners: config.githubOidcAllowedOwners,
      allowedRepositories: config.githubOidcAllowedRepositories,
      requireWriteBranch: config.githubOidcRequireWriteBranch,
      allowPrWrite: config.githubOidcAllowPrWrite,
      tokenTtlSeconds: config.githubOidcTokenTtlSeconds,
    };
  }

  // POST /api/v1/auth/github-oidc - Exchange GitHub Actions OIDC JWT for an ephemeral Poly cache token
  app.post<{
    Body: { token?: string };
  }>("/api/v1/auth/github-oidc", async (request, reply) => {
    const policy = getOidcPolicy();
    if (!policy.enabled) {
      return reply.code(403).send({
        error: "Forbidden",
        message: "GitHub Actions OIDC authentication is disabled on this cluster",
      });
    }

    // Extract token from body or Authorization header
    let rawJwt = request.body?.token;
    if (!rawJwt) {
      const authHeader = request.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        rawJwt = authHeader.slice(7).trim();
      }
    }

    if (!rawJwt) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "Missing GitHub Actions OIDC token in request body or Authorization header",
      });
    }

    const verification = await verifier.verifyToken(rawJwt, policy);
    if (!verification.valid || !verification.claims) {
      return reply.code(401).send({
        error: "Unauthorized",
        message: verification.error || "GitHub Actions OIDC token verification failed",
      });
    }

    const claims = verification.claims;
    const workspaceSlug = verification.workspaceSlug;

    // Ensure workspace automatically for the GitHub repository
    const workspace = await store.ensureWorkspace(workspaceSlug, claims.repository);

    // Create an ephemeral scoped API token matching the job duration
    const ttlDays = (policy.tokenTtlSeconds || 3600) / 86400;
    const branchName = claims.ref.replace("refs/heads/", "");
    const tokenName = `oidc:${claims.repository}@${branchName}:${claims.actor}`;

    const { token, rawToken } = await store.createToken({
      workspaceId: workspace.id,
      name: tokenName,
      role: verification.role,
      expiresInDays: ttlDays,
    });

    return reply.code(200).send({
      token: rawToken,
      workspaceSlug: workspace.slug,
      workspaceId: workspace.id,
      role: verification.role,
      expiresAt: token.expiresAt,
      claims,
    });
  });
}
