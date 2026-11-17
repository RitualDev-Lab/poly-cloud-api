import type { FastifyReply, FastifyRequest } from "fastify";
import type { PolyCloudConfig } from "../config.js";
import type { MetadataStore, TokenRole, Workspace } from "../metadata/types.js";
import type { GitHubOidcPolicy } from "../oidc/types.js";
import { GitHubOidcVerifier } from "../oidc/verifier.js";

declare module "fastify" {
  interface FastifyRequest {
    workspace?: Workspace;
    tokenRole?: TokenRole;
    isAdmin?: boolean;
  }
}

export interface AuthContext {
  store: MetadataStore;
  config: PolyCloudConfig;
  oidcVerifier?: GitHubOidcVerifier;
}

export function createAuthHook(context: AuthContext, requiredRole: TokenRole = "read") {
  const roleWeights: Record<TokenRole, number> = {
    read: 1,
    write: 2,
    admin: 3,
  };

  return async (request: FastifyRequest, reply: FastifyReply) => {
    // If auth is completely disabled (e.g. air-gapped dev cluster)
    if (!context.config.authEnabled) {
      const defaultWs = await context.store.ensureWorkspace(context.config.defaultWorkspace);
      request.workspace = defaultWs;
      request.tokenRole = "admin";
      request.isAdmin = true;
      return;
    }

    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return reply.code(401).send({
        error: "Unauthorized",
        message: "Missing or invalid Authorization bearer token header",
      });
    }

    const rawToken = authHeader.slice(7).trim();

    // Check if master admin token
    if (rawToken === context.config.defaultAdminToken) {
      const queryTeam =
        (request.query as { team?: string; slug?: string })?.team ||
        (request.query as { team?: string; slug?: string })?.slug ||
        (request.headers["x-poly-team"] as string) ||
        context.config.defaultWorkspace;

      const ws = await context.store.ensureWorkspace(queryTeam);
      request.workspace = ws;
      request.tokenRole = "admin";
      request.isAdmin = true;
      return;
    }

    // Direct GitHub Actions OIDC Bearer Token verification
    if (rawToken.startsWith("eyJ") && context.config.githubOidcEnabled) {
      const oidcVerifier = context.oidcVerifier ?? new GitHubOidcVerifier();
      const oidcPolicy: GitHubOidcPolicy = {
        enabled: context.config.githubOidcEnabled,
        jwksUrl: context.config.githubOidcJwksUrl,
        expectedAudience: context.config.githubOidcAudience,
        allowedOwners: context.config.githubOidcAllowedOwners,
        allowedRepositories: context.config.githubOidcAllowedRepositories,
        requireWriteBranch: context.config.githubOidcRequireWriteBranch,
        allowPrWrite: context.config.githubOidcAllowPrWrite,
      };

      const verification = await oidcVerifier.verifyToken(rawToken, oidcPolicy);
      if (verification.valid && verification.claims) {
        if (roleWeights[verification.role] < roleWeights[requiredRole]) {
          return reply.code(403).send({
            error: "Forbidden",
            message: `GitHub OIDC role '${verification.role}' insufficient. Required role: '${requiredRole}'`,
          });
        }

        const ws = await context.store.ensureWorkspace(
          verification.workspaceSlug,
          verification.claims.repository,
        );
        request.workspace = ws;
        request.tokenRole = verification.role;
        request.isAdmin = verification.role === "admin";
        return;
      }
    }

    // Verify token from database
    const authResult = await context.store.verifyToken(rawToken);
    if (!authResult) {
      return reply.code(401).send({
        error: "Unauthorized",
        message: "Invalid, expired, or revoked API token",
      });
    }

    const { token, workspace } = authResult;

    // Check role permission level
    if (roleWeights[token.role] < roleWeights[requiredRole]) {
      return reply.code(403).send({
        error: "Forbidden",
        message: `Token role '${token.role}' insufficient. Required role: '${requiredRole}'`,
      });
    }

    request.workspace = workspace;
    request.tokenRole = token.role;
    request.isAdmin = token.role === "admin";
  };
}
