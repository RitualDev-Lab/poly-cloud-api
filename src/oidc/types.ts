import type { TokenRole } from "../metadata/types.js";

export interface GitHubOidcClaims {
  iss: string;
  sub: string;
  aud: string | string[];
  repository: string;
  repository_owner: string;
  repository_owner_id?: string;
  repository_id?: string;
  actor: string;
  actor_id?: string;
  ref: string;
  ref_type?: "branch" | "tag" | string;
  head_ref?: string;
  base_ref?: string;
  event_name: string;
  job_workflow_ref?: string;
  workflow?: string;
  run_id?: string;
  run_number?: string;
  run_attempt?: string;
  runner_environment?: string;
  exp: number;
  iat: number;
  nbf?: number;
  jti?: string;
}

export interface GitHubOidcPolicy {
  enabled: boolean;
  jwksUrl?: string;
  expectedAudience?: string;
  allowedOwners?: string[];
  allowedRepositories?: string[];
  requireWriteBranch?: string[];
  allowPrWrite?: boolean;
  tokenTtlSeconds?: number;
  customPublicKeys?: Record<string, string | import("node:crypto").JsonWebKey>;
}

export interface OidcVerificationResult {
  valid: boolean;
  claims?: GitHubOidcClaims;
  role: TokenRole;
  workspaceSlug: string;
  error?: string;
}

export interface OidcExchangeResponse {
  token: string;
  workspaceSlug: string;
  workspaceId: string;
  role: TokenRole;
  expiresAt: string;
  claims: GitHubOidcClaims;
}
