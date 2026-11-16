import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { MemoryMetadataStore } from "../src/metadata/store.js";
import { createPolyCloudServer } from "../src/server.js";
import { MemoryStorage } from "../src/storage/memory.js";

test("Enterprise API Suite", async (t) => {
  const config = loadConfig({
    storageBackend: "memory",
    authEnabled: true,
    defaultAdminToken: "poly-enterprise-master-token",
    defaultWorkspace: "enterprise-core",
  });

  const storage = new MemoryStorage();
  const store = new MemoryMetadataStore();

  const server = await createPolyCloudServer(config, { storage, store });
  const app = server.app;
  const adminAuth = { authorization: "Bearer poly-enterprise-master-token" };

  await t.test("GET /api/v1/health returns healthy status and latency", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/health",
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.status, "ok");
    assert.equal(body.version, "0.1.0");
    assert.equal(body.storage.backend, "memory");
    assert.equal(body.storage.healthy, true);
    assert.ok(typeof body.storage.latencyMs === "number");
  });

  await t.test("POST & GET /api/v1/tokens manages team tokens", async () => {
    // Create read-write token
    const createRes = await app.inject({
      method: "POST",
      url: "/api/v1/tokens",
      headers: adminAuth,
      payload: {
        workspaceSlug: "enterprise-core",
        name: "github-actions-ci",
        role: "write",
        expiresInDays: 30,
      },
    });

    assert.equal(createRes.statusCode, 201);
    const created = JSON.parse(createRes.body);
    assert.ok(created.rawToken.startsWith("poly_tok_"));
    assert.equal(created.token.name, "github-actions-ci");
    assert.equal(created.token.role, "write");
    assert.ok(created.token.expiresAt);

    const tokenId = created.token.id;

    // List tokens
    const listRes = await app.inject({
      method: "GET",
      url: "/api/v1/tokens?workspaceSlug=enterprise-core",
      headers: adminAuth,
    });
    assert.equal(listRes.statusCode, 200);
    const listBody = JSON.parse(listRes.body);
    assert.ok(listBody.tokens.some((t: { id: string }) => t.id === tokenId));

    // Delete token
    const deleteRes = await app.inject({
      method: "DELETE",
      url: `/api/v1/tokens/${tokenId}`,
      headers: adminAuth,
    });
    assert.equal(deleteRes.statusCode, 200);
  });

  await t.test("GET /api/v1/workspaces/:slug/stats returns ROI & savings", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/workspaces/enterprise-core/stats",
      headers: adminAuth,
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.stats);
    assert.equal(body.stats.workspaceSlug, "enterprise-core");
    assert.ok(typeof body.stats.hitRatePercent === "number");
    assert.ok(typeof body.stats.estimatedSavingsUsd === "number");
  });

  await t.test("GET /api/v1/metrics returns Prometheus exposition data", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/metrics",
    });

    assert.equal(res.statusCode, 200);
    assert.ok(res.body.includes("poly_cache_hits_total"));
    assert.ok(res.body.includes("poly_cache_bytes_total"));
    assert.ok(res.body.includes("poly_cache_duration_saved_seconds"));
  });

  await t.test("POST /api/v1/workspaces/:slug/prune prunes expired artifacts", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/workspaces/enterprise-core/prune",
      headers: adminAuth,
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.status, "pruned");
    assert.equal(body.workspace, "enterprise-core");
  });

  await server.stop();
});
