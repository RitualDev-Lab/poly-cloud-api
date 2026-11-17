import * as crypto from "node:crypto";
import type { TokenRole } from "../metadata/types.js";
import type { GitHubOidcClaims, GitHubOidcPolicy, OidcVerificationResult } from "./types.js";

interface JwkKey {
  kty: string;
  kid?: string;
  alg?: string;
  n?: string;
  e?: string;
  use?: string;
}

interface JwksResponse {
  keys: JwkKey[];
}

export class GitHubOidcVerifier {
  private jwksCache: { keys: JwkKey[]; fetchedAt: number } | null = null;
  private jwksTtlMs = 3600000; // 1 hour

  private base64UrlDecode(str: string): string {
    let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4 !== 0) {
      base64 += "=";
    }
    return Buffer.from(base64, "base64").toString("utf-8");
  }

  private base64UrlDecodeBuffer(str: string): Buffer {
    let base64 = str.replace(/-/g, "+").replace(/_/g, "/");
    while (base64.length % 4 !== 0) {
      base64 += "=";
    }
    return Buffer.from(base64, "base64");
  }

  private base64UrlEncode(buffer: Buffer): string {
    return buffer.toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  }

  /**
   * Fetches GitHub Actions OIDC JWKS keys with in-memory caching.
   */
  async getJwks(jwksUrl: string): Promise<JwkKey[]> {
    const now = Date.now();
    if (this.jwksCache && now - this.jwksCache.fetchedAt < this.jwksTtlMs) {
      return this.jwksCache.keys;
    }

    try {
      const res = await fetch(jwksUrl, {
        headers: { "User-Agent": "poly-cloud-api" },
        signal: AbortSignal.timeout(10000),
      });

      if (!res.ok) {
        throw new Error(`Failed to fetch JWKS from ${jwksUrl}: HTTP ${res.status}`);
      }

      const data = (await res.json()) as JwksResponse;
      if (Array.isArray(data.keys)) {
        this.jwksCache = { keys: data.keys, fetchedAt: now };
        return data.keys;
      }
      return [];
    } catch (e) {
      // If cached keys exist, return stale cache as fallback
      if (this.jwksCache) {
        return this.jwksCache.keys;
      }
      throw e;
    }
  }

  /**
   * Matches a repository string against an allowed pattern (e.g. "org/*" or "org/repo-*").
   */
  private matchesRepoPattern(repo: string, pattern: string): boolean {
    if (pattern === "*" || pattern.toLowerCase() === repo.toLowerCase()) return true;
    if (pattern.includes("*")) {
      const escaped = pattern
        .toLowerCase()
        .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*");
      const regex = new RegExp(`^${escaped}$`, "i");
      return regex.test(repo);
    }
    return repo.toLowerCase() === pattern.toLowerCase();
  }

  /**
   * Resolves the workspace slug from a repository identifier (e.g. "RitualDev-Lab/poly" -> "ritualdev-lab-poly").
   */
  resolveWorkspaceSlug(repository: string): string {
    return repository
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9_-]/g, "-");
  }

  /**
   * Resolves granted token role from GitHub Actions OIDC claims and policy rules.
   */
  resolveRole(claims: GitHubOidcClaims, policy?: Partial<GitHubOidcPolicy>): TokenRole {
    // Check Pull Request restrictions
    if (claims.event_name === "pull_request" && policy?.allowPrWrite === false) {
      return "read";
    }

    // Check branch protection rules
    if (policy?.requireWriteBranch && policy.requireWriteBranch.length > 0) {
      const branchName = claims.ref.replace("refs/heads/", "").replace("refs/tags/", "");
      const isAllowedBranch = policy.requireWriteBranch.some((b) => {
        if (b.endsWith("/*")) {
          const prefix = b.slice(0, -2);
          return branchName.startsWith(prefix);
        }
        return branchName === b;
      });

      if (!isAllowedBranch) {
        return "read";
      }
    }

    return "write";
  }

  /**
   * Cryptographically verifies an ephemeral GitHub Actions OIDC JWT and enforces repository scoping.
   */
  async verifyToken(
    jwt: string,
    policy?: Partial<GitHubOidcPolicy>,
  ): Promise<OidcVerificationResult> {
    if (!jwt || typeof jwt !== "string") {
      return {
        valid: false,
        role: "read",
        workspaceSlug: "",
        error: "Missing or invalid JWT token string",
      };
    }

    const parts = jwt.trim().split(".");
    if (parts.length !== 3) {
      return {
        valid: false,
        role: "read",
        workspaceSlug: "",
        error: "Malformed JWT: expected 3 dot-separated segments",
      };
    }

    const [headerB64, payloadB64, sigB64] = parts;

    let header: { alg?: string; kid?: string };
    let claims: GitHubOidcClaims;

    try {
      header = JSON.parse(this.base64UrlDecode(headerB64));
      claims = JSON.parse(this.base64UrlDecode(payloadB64));
    } catch (e) {
      return {
        valid: false,
        role: "read",
        workspaceSlug: "",
        error: `Failed to decode JWT header/claims: ${String(e)}`,
      };
    }

    // Algorithm check: GitHub Actions OIDC uses RS256
    if (header.alg !== "RS256") {
      return {
        valid: false,
        role: "read",
        workspaceSlug: "",
        error: `Unsupported JWT algorithm '${header.alg}'. Expected RS256.`,
      };
    }

    // Verify Issuer
    const expectedIssuer = "https://token.actions.githubusercontent.com";
    if (claims.iss !== expectedIssuer) {
      return {
        valid: false,
        role: "read",
        workspaceSlug: "",
        error: `Invalid OIDC issuer '${claims.iss}'. Expected '${expectedIssuer}'.`,
      };
    }

    // Verify Expiration
    const nowEpoch = Math.floor(Date.now() / 1000);
    if (claims.exp && claims.exp < nowEpoch) {
      return {
        valid: false,
        role: "read",
        workspaceSlug: "",
        error: `GitHub OIDC token expired at ${new Date(claims.exp * 1000).toISOString()}`,
      };
    }

    // Verify Not Before (nbf)
    if (claims.nbf && claims.nbf > nowEpoch + 60) {
      return {
        valid: false,
        role: "read",
        workspaceSlug: "",
        error: "Token not yet valid",
      };
    }

    // Verify Audience if configured
    if (policy?.expectedAudience) {
      const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
      if (!auds.includes(policy.expectedAudience)) {
        return {
          valid: false,
          role: "read",
          workspaceSlug: "",
          error: `Audience mismatch: expected '${policy.expectedAudience}', got '${JSON.stringify(claims.aud)}'`,
        };
      }
    }

    // Verify Repository Owner Policy
    if (policy?.allowedOwners && policy.allowedOwners.length > 0) {
      const owner = claims.repository_owner;
      const isOwnerAllowed = policy.allowedOwners.some(
        (o) => o.toLowerCase() === owner?.toLowerCase(),
      );
      if (!isOwnerAllowed) {
        return {
          valid: false,
          role: "read",
          workspaceSlug: "",
          error: `Repository owner '${owner}' is not authorized by corporate OIDC policy`,
        };
      }
    }

    // Verify Allowed Repositories Policy
    if (policy?.allowedRepositories && policy.allowedRepositories.length > 0) {
      const repo = claims.repository;
      const isRepoAllowed = policy.allowedRepositories.some((pattern) =>
        this.matchesRepoPattern(repo, pattern),
      );
      if (!isRepoAllowed) {
        return {
          valid: false,
          role: "read",
          workspaceSlug: "",
          error: `Repository '${repo}' is not authorized by corporate OIDC policy`,
        };
      }
    }

    // Cryptographic Signature Verification
    const signedData = Buffer.from(`${headerB64}.${payloadB64}`, "utf-8");
    const signature = this.base64UrlDecodeBuffer(sigB64);

    let signatureVerified = false;

    // Check custom public keys first (used for testing or air-gapped setups)
    if (policy?.customPublicKeys) {
      const customKey = header.kid ? policy.customPublicKeys[header.kid] : undefined;
      const candidateKeys = customKey ? [customKey] : Object.values(policy.customPublicKeys);

      for (const key of candidateKeys) {
        try {
          const keyObj =
            typeof key === "object"
              ? crypto.createPublicKey({ key: key as crypto.JsonWebKey, format: "jwk" })
              : crypto.createPublicKey(key);

          if (crypto.verify("sha256", signedData, keyObj, signature)) {
            signatureVerified = true;
            break;
          }
        } catch {
          // Continue trying next key
        }
      }
    }

    // Verify via Live GitHub JWKS endpoint if not already verified
    if (!signatureVerified) {
      const jwksUrl =
        policy?.jwksUrl || "https://token.actions.githubusercontent.com/.well-known/jwks";

      try {
        const keys = await this.getJwks(jwksUrl);
        const matchingKey = header.kid ? keys.find((k) => k.kid === header.kid) : keys[0];

        if (matchingKey) {
          const keyObj = crypto.createPublicKey({
            key: matchingKey as crypto.JsonWebKey,
            format: "jwk",
          });
          signatureVerified = crypto.verify("sha256", signedData, keyObj, signature);
        }
      } catch (e) {
        return {
          valid: false,
          role: "read",
          workspaceSlug: "",
          error: `Failed to verify token with GitHub JWKS: ${String(e)}`,
        };
      }
    }

    if (!signatureVerified) {
      return {
        valid: false,
        role: "read",
        workspaceSlug: "",
        error: "Cryptographic signature verification failed: token signature is invalid",
      };
    }

    const workspaceSlug = this.resolveWorkspaceSlug(claims.repository);
    const role = this.resolveRole(claims, policy);

    return {
      valid: true,
      claims,
      workspaceSlug,
      role,
    };
  }

  /**
   * Helper: Generate an RSA 2048 keypair in PEM & JWK format for testing.
   */
  generateTestKeypair(kid = "test-key-1"): {
    privateKeyPem: string;
    publicKeyPem: string;
    jwk: JwkKey;
  } {
    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });

    const keyObj = crypto.createPublicKey(publicKey);
    const rawJwk = keyObj.export({ format: "jwk" }) as JwkKey;
    rawJwk.kid = kid;
    rawJwk.alg = "RS256";
    rawJwk.use = "sig";

    return {
      privateKeyPem: privateKey,
      publicKeyPem: publicKey,
      jwk: rawJwk,
    };
  }

  /**
   * Helper: Create a cryptographically signed GitHub Actions OIDC JWT for testing.
   */
  createTestJwt(
    claims: Partial<GitHubOidcClaims>,
    privateKeyPem: string,
    kid = "test-key-1",
  ): string {
    const now = Math.floor(Date.now() / 1000);
    const fullClaims: GitHubOidcClaims = {
      iss: "https://token.actions.githubusercontent.com",
      sub: `repo:${claims.repository || "RitualDev-Lab/poly"}:ref:${claims.ref || "refs/heads/main"}`,
      aud: claims.aud || "poly-cloud-api",
      repository: claims.repository || "RitualDev-Lab/poly",
      repository_owner: claims.repository_owner || "RitualDev-Lab",
      actor: claims.actor || "ci-bot",
      ref: claims.ref || "refs/heads/main",
      ref_type: claims.ref_type || "branch",
      event_name: claims.event_name || "push",
      job_workflow_ref:
        claims.job_workflow_ref || "RitualDev-Lab/poly/.github/workflows/ci.yml@refs/heads/main",
      exp: claims.exp || now + 3600,
      iat: claims.iat || now,
      nbf: claims.nbf || now - 10,
      ...claims,
    };

    const header = { alg: "RS256", typ: "JWT", kid };
    const headerB64 = this.base64UrlEncode(Buffer.from(JSON.stringify(header)));
    const payloadB64 = this.base64UrlEncode(Buffer.from(JSON.stringify(fullClaims)));

    const signedData = Buffer.from(`${headerB64}.${payloadB64}`, "utf-8");
    const sig = crypto.sign("sha256", signedData, crypto.createPrivateKey(privateKeyPem));
    const sigB64 = this.base64UrlEncode(sig);

    return `${headerB64}.${payloadB64}.${sigB64}`;
  }
}
