import assert from "node:assert/strict";
import test from "node:test";
import { RemoteCacheClient } from "../src/client/remote-cache.js";
import { loadConfig } from "../src/config.js";
import { MemoryMetadataStore } from "../src/metadata/store.js";
import { GitHubOidcVerifier } from "../src/oidc/verifier.js";
import { createPolyCloudServer } from "../src/server.js";
import { MemoryStorage } from "../src/storage/memory.js";

test("GitHub Actions OIDC Verifier Unit Tests", async (t) => {
  const verifier = new GitHubOidcVerifier();
  const kid = "github-actions-rsa-key-1";
  const { privateKeyPem, publicKeyPem, jwk } = verifier.generateTestKeypair(kid);

  const customKeys = { [kid]: publicKeyPem };

  await t.test("verifies valid GitHub Actions OIDC token and claims", async () => {
    const jwt = verifier.createTestJwt(
      {
        repository: "RitualDev-Lab/poly",
        repository_owner: "RitualDev-Lab",
        actor: "divyanshujethi",
        ref: "refs/heads/main",
        event_name: "push",
        aud: "poly-cloud-api",
      },
      privateKeyPem,
      kid,
    );

    const result = await verifier.verifyToken(jwt, {
      customPublicKeys: customKeys,
      expectedAudience: "poly-cloud-api",
    });

    assert.equal(result.valid, true);
    assert.equal(result.workspaceSlug, "ritualdev-lab-poly");
    assert.equal(result.role, "write");
    assert.equal(result.claims?.repository, "RitualDev-Lab/poly");
    assert.equal(result.claims?.actor, "divyanshujethi");
  });

  await t.test("rejects token with invalid issuer", async () => {
    const jwt = verifier.createTestJwt(
      {
        iss: "https://evil.issuer.com",
        repository: "RitualDev-Lab/poly",
      },
      privateKeyPem,
      kid,
    );

    const result = await verifier.verifyToken(jwt, {
      customPublicKeys: customKeys,
    });

    assert.equal(result.valid, false);
    assert.ok(result.error?.includes("Invalid OIDC issuer"));
  });

  await t.test("rejects expired token", async () => {
    const jwt = verifier.createTestJwt(
      {
        repository: "RitualDev-Lab/poly",
        exp: Math.floor(Date.now() / 1000) - 600, // Expired 10 min ago
      },
      privateKeyPem,
      kid,
    );

    const result = await verifier.verifyToken(jwt, {
      customPublicKeys: customKeys,
    });

    assert.equal(result.valid, false);
    assert.ok(result.error?.includes("expired"));
  });

  await t.test("rejects audience mismatch", async () => {
    const jwt = verifier.createTestJwt(
      {
        repository: "RitualDev-Lab/poly",
        aud: "other-service",
      },
      privateKeyPem,
      kid,
    );

    const result = await verifier.verifyToken(jwt, {
      customPublicKeys: customKeys,
      expectedAudience: "poly-cloud-api",
    });

    assert.equal(result.valid, false);
    assert.ok(result.error?.includes("Audience mismatch"));
  });

  await t.test("enforces allowedOwners corporate policy", async () => {
    const jwt = verifier.createTestJwt(
      {
        repository: "untrusted-org/malicious-repo",
        repository_owner: "untrusted-org",
      },
      privateKeyPem,
      kid,
    );

    const result = await verifier.verifyToken(jwt, {
      customPublicKeys: customKeys,
      allowedOwners: ["RitualDev-Lab"],
    });

    assert.equal(result.valid, false);
    assert.ok(result.error?.includes("owner 'untrusted-org' is not authorized"));
  });

  await t.test("enforces allowedRepositories pattern matching", async () => {
    const allowedJwt = verifier.createTestJwt(
      {
        repository: "RitualDev-Lab/poly-web",
        repository_owner: "RitualDev-Lab",
      },
      privateKeyPem,
      kid,
    );

    const deniedJwt = verifier.createTestJwt(
      {
        repository: "RitualDev-Lab/internal-secret-service",
        repository_owner: "RitualDev-Lab",
      },
      privateKeyPem,
      kid,
    );

    const policy = {
      customPublicKeys: customKeys,
      allowedRepositories: ["RitualDev-Lab/poly", "RitualDev-Lab/poly-*"],
    };

    assert.equal((await verifier.verifyToken(allowedJwt, policy)).valid, true);
    assert.equal((await verifier.verifyToken(deniedJwt, policy)).valid, false);
  });

  await t.test("resolves role based on PR and branch policy", async () => {
    // 1. Pull Request with allowPrWrite: false -> read role
    const prJwt = verifier.createTestJwt(
      {
        repository: "RitualDev-Lab/poly",
        event_name: "pull_request",
        ref: "refs/pull/123/merge",
      },
      privateKeyPem,
      kid,
    );

    const prResult = await verifier.verifyToken(prJwt, {
      customPublicKeys: customKeys,
      allowPrWrite: false,
    });
    assert.equal(prResult.valid, true);
    assert.equal(prResult.role, "read");

    // 2. Protected branch policy: only 'main' gets write
    const featureJwt = verifier.createTestJwt(
      {
        repository: "RitualDev-Lab/poly",
        event_name: "push",
        ref: "refs/heads/feature/dark-mode",
      },
      privateKeyPem,
      kid,
    );

    const featureResult = await verifier.verifyToken(featureJwt, {
      customPublicKeys: customKeys,
      requireWriteBranch: ["main"],
    });
    assert.equal(featureResult.valid, true);
    assert.equal(featureResult.role, "read");

    // 3. Push to main -> write
    const mainJwt = verifier.createTestJwt(
      {
        repository: "RitualDev-Lab/poly",
        event_name: "push",
        ref: "refs/heads/main",
      },
      privateKeyPem,
      kid,
    );

    const mainResult = await verifier.verifyToken(mainJwt, {
      customPublicKeys: customKeys,
      requireWriteBranch: ["main"],
    });
    assert.equal(mainResult.valid, true);
    assert.equal(mainResult.role, "write");
  });
});

test("GitHub Actions OIDC Token Exchange & API Integration", async (t) => {
  const verifier = new GitHubOidcVerifier();
  const kid = "github-actions-rsa-key-2";
  const { privateKeyPem, publicKeyPem } = verifier.generateTestKeypair(kid);

  const config = loadConfig({
    storageBackend: "memory",
    authEnabled: true,
    githubOidcEnabled: true,
    githubOidcAllowedOwners: ["RitualDev-Lab"],
    githubOidcAudience: "poly-cloud-api",
  });

  const storage = new MemoryStorage();
  const store = new MemoryMetadataStore();

  // Inject custom keys into verifier for testing
  const originalVerify = verifier.verifyToken.bind(verifier);
  verifier.verifyToken = (jwt, policy) => {
    return originalVerify(jwt, {
      ...policy,
      customPublicKeys: { [kid]: publicKeyPem },
    });
  };

  const server = await createPolyCloudServer(config, {
    storage,
    store,
    oidcVerifier: verifier,
  });
  const app = server.app;

  await t.test(
    "POST /api/v1/auth/github-oidc exchanges token for ephemeral Poly token",
    async () => {
      const oidcJwt = verifier.createTestJwt(
        {
          repository: "RitualDev-Lab/poly-cloud-api",
          repository_owner: "RitualDev-Lab",
          actor: "github-actions[bot]",
          ref: "refs/heads/main",
          event_name: "push",
          aud: "poly-cloud-api",
        },
        privateKeyPem,
        kid,
      );

      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/github-oidc",
        payload: { token: oidcJwt },
      });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.ok(body.token.startsWith("poly_tok_"));
      assert.equal(body.workspaceSlug, "ritualdev-lab-poly-cloud-api");
      assert.equal(body.role, "write");
      assert.equal(body.claims.actor, "github-actions[bot]");

      // Use exchanged token to upload an artifact to the scoped workspace
      const artifactRes = await app.inject({
        method: "PUT",
        url: `/v8/artifacts/art-oidc-101?team=${body.workspaceSlug}`,
        headers: {
          authorization: `Bearer ${body.token}`,
          "content-type": "application/octet-stream",
        },
        payload: Buffer.from("oidc-authenticated-build-output"),
      });

      assert.equal(artifactRes.statusCode, 200);

      // Verify artifact can be downloaded using exchanged token
      const getRes = await app.inject({
        method: "GET",
        url: `/v8/artifacts/art-oidc-101?team=${body.workspaceSlug}`,
        headers: {
          authorization: `Bearer ${body.token}`,
        },
      });
      assert.equal(getRes.statusCode, 200);
      assert.equal(getRes.body, "oidc-authenticated-build-output");
    },
  );

  await t.test("POST /api/v1/auth/github-oidc rejects unauthorized repository owner", async () => {
    const oidcJwt = verifier.createTestJwt(
      {
        repository: "external-hacker/rogue-repo",
        repository_owner: "external-hacker",
        actor: "attacker",
        aud: "poly-cloud-api",
      },
      privateKeyPem,
      kid,
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/github-oidc",
      payload: { token: oidcJwt },
    });

    assert.equal(res.statusCode, 401);
    const body = JSON.parse(res.body);
    assert.ok(body.message.includes("is not authorized by corporate OIDC policy"));
  });

  await t.test(
    "Transparent Zero-Config: Direct GitHub Actions OIDC Bearer Token on /v8/artifacts",
    async () => {
      // Runner passes GitHub OIDC JWT directly as Bearer token without prior exchange
      const directOidcJwt = verifier.createTestJwt(
        {
          repository: "RitualDev-Lab/poly-direct-auth",
          repository_owner: "RitualDev-Lab",
          actor: "runner-node-12",
          ref: "refs/heads/main",
          event_name: "push",
          aud: "poly-cloud-api",
        },
        privateKeyPem,
        kid,
      );

      const uploadRes = await app.inject({
        method: "PUT",
        url: "/v8/artifacts/direct-token-artifact?team=ritualdev-lab-poly-direct-auth",
        headers: {
          authorization: `Bearer ${directOidcJwt}`,
          "content-type": "application/octet-stream",
        },
        payload: Buffer.from("zero-secret-ci-content"),
      });

      assert.equal(uploadRes.statusCode, 200);

      const downloadRes = await app.inject({
        method: "GET",
        url: "/v8/artifacts/direct-token-artifact?team=ritualdev-lab-poly-direct-auth",
        headers: {
          authorization: `Bearer ${directOidcJwt}`,
        },
      });

      assert.equal(downloadRes.statusCode, 200);
      assert.equal(downloadRes.body, "zero-secret-ci-content");
    },
  );

  await server.stop();
});

test("RemoteCacheClient: GitHub Actions OIDC Factory & Exchange", async (t) => {
  const verifier = new GitHubOidcVerifier();
  const kid = "github-actions-rsa-key-3";
  const { privateKeyPem, publicKeyPem } = verifier.generateTestKeypair(kid);

  const config = loadConfig({
    port: 0,
    storageBackend: "memory",
    authEnabled: true,
    githubOidcEnabled: true,
  });

  const storage = new MemoryStorage();
  const store = new MemoryMetadataStore();

  const originalVerify = verifier.verifyToken.bind(verifier);
  verifier.verifyToken = (jwt, policy) => {
    return originalVerify(jwt, {
      ...policy,
      customPublicKeys: { [kid]: publicKeyPem },
    });
  };

  const server = await createPolyCloudServer(config, {
    storage,
    store,
    oidcVerifier: verifier,
  });
  const serverAddress = await server.start();

  const oidcJwt = verifier.createTestJwt(
    {
      repository: "RitualDev-Lab/sdk-test-repo",
      repository_owner: "RitualDev-Lab",
      actor: "sdk-ci",
      ref: "refs/heads/main",
    },
    privateKeyPem,
    kid,
  );

  await t.test("RemoteCacheClient.fromGitHubOidc creates authenticated client", async () => {
    const client = await RemoteCacheClient.fromGitHubOidc({
      apiUrl: serverAddress,
      oidcToken: oidcJwt,
    });

    assert.ok(client);

    const testData = Buffer.from("artifact via oidc sdk client");
    const uploaded = await client.upload("sdk-art-1", testData);
    assert.equal(uploaded, true);

    const exists = await client.hasKey("sdk-art-1");
    assert.equal(exists, true);

    const downloaded = await client.download("sdk-art-1");
    assert.ok(downloaded);
    assert.equal(downloaded.toString(), "artifact via oidc sdk client");
  });

  await server.stop();
});
