import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { MemoryMetadataStore } from "../src/metadata/store.js";
import { StorageOptimizerDaemon } from "../src/optimizer/daemon.js";
import { createPolyCloudServer } from "../src/server.js";
import { MemoryStorage } from "../src/storage/memory.js";

test("Storage Optimizer & LRU Auto-Eviction Daemon", async (t) => {
  const config = loadConfig({
    storageBackend: "memory",
    authEnabled: true,
    defaultAdminToken: "test-admin-secret",
    defaultWorkspace: "default",
    autoEvictionEnabled: true,
    autoEvictIntervalSeconds: 300,
    autoEvictOnWrite: true,
    quotaHighWatermarkRatio: 0.8, // 80%
    quotaLowWatermarkRatio: 0.5, // 50%
    deduplicationEnabled: true,
  });

  await t.test("MetadataStore LRU ordering and deduplication stats", async () => {
    const store = new MemoryMetadataStore();
    await store.init();
    const ws = await store.ensureWorkspace("order-test", "Order Test", 10000);

    const now = Date.now();
    // Artifact 1: Oldest access
    await store.recordArtifact({
      hash: "art-1",
      workspaceId: ws.id,
      sizeBytes: 1000,
      sha256: "sha-aaa",
      lastAccessedAt: new Date(now - 100000).toISOString(),
      createdAt: new Date(now - 100000).toISOString(),
    });

    // Artifact 2: Middle access
    await store.recordArtifact({
      hash: "art-2",
      workspaceId: ws.id,
      sizeBytes: 1000,
      sha256: "sha-bbb",
      lastAccessedAt: new Date(now - 50000).toISOString(),
      createdAt: new Date(now - 50000).toISOString(),
    });

    // Artifact 3: Newest access (hot)
    await store.recordArtifact({
      hash: "art-3",
      workspaceId: ws.id,
      sizeBytes: 1000,
      sha256: "sha-aaa", // duplicate sha of art-1
      isDeduplicated: true,
      originalHash: "art-1",
      lastAccessedAt: new Date(now).toISOString(),
      createdAt: new Date(now).toISOString(),
    });

    // Verify LRU order
    const evictionCandidates = await store.getArtifactsForEviction(ws.id);
    assert.equal(evictionCandidates.length, 3);
    assert.equal(evictionCandidates[0].hash, "art-1");
    assert.equal(evictionCandidates[1].hash, "art-2");
    assert.equal(evictionCandidates[2].hash, "art-3");

    // Verify findArtifactBySha256
    const found = await store.findArtifactBySha256(ws.id, "sha-aaa");
    assert.ok(found);
    assert.equal(found?.hash, "art-1");

    const notFound = await store.findArtifactBySha256(ws.id, "sha-nonexistent");
    assert.equal(notFound, null);

    // Verify deduplication stats
    const dedupStats = await store.getDeduplicationStats(ws.id);
    assert.equal(dedupStats.rawBytes, 3000);
    assert.equal(dedupStats.storedBytes, 2000);
    assert.equal(dedupStats.savedBytes, 1000);
    assert.equal(dedupStats.ratio, 1.5);
  });

  await t.test("LRU eviction respects watermarks and preserves hot artifacts", async () => {
    const store = new MemoryMetadataStore();
    await store.init();
    const storage = new MemoryStorage();

    // 1000 byte quota; high watermark = 800 bytes (80%); low watermark = 500 bytes (50%)
    const ws = await store.ensureWorkspace("lru-test", "LRU Test", 1000);

    const daemon = new StorageOptimizerDaemon({
      store,
      storage,
      config,
      optimizerConfig: {
        enabled: true,
        highWatermarkRatio: 0.8,
        lowWatermarkRatio: 0.5,
      },
    });

    const now = Date.now();
    // Populate 4 artifacts, 250 bytes each = 1000 bytes total (100% of quota > 80% high watermark)
    for (let i = 1; i <= 4; i++) {
      const hash = `art-${i}`;
      const payload = Buffer.alloc(250, i);
      await storage.put(`${ws.id}/${hash}`, payload);
      await store.recordArtifact({
        hash,
        workspaceId: ws.id,
        sizeBytes: 250,
        // art-1 oldest, art-4 newest/hottest
        lastAccessedAt: new Date(now - (5 - i) * 10000).toISOString(),
        createdAt: new Date(now - (5 - i) * 10000).toISOString(),
      });
    }

    const preStats = await store.getWorkspaceStats("lru-test");
    assert.equal(preStats.totalSizeBytes, 1000);

    // Trigger LRU eviction
    const result = await daemon.evictWorkspaceLru(ws.id);

    // To bring 1000 down to <= 500 (low watermark), it needs to evict 2 artifacts (500 bytes)
    assert.equal(result.evictedCount, 2);
    assert.equal(result.freedBytes, 500);
    assert.deepEqual(result.evictedHashes, ["art-1", "art-2"]);
    assert.equal(result.remainingSizeBytes, 500);
    assert.equal(result.quotaUsedPercent, 50);

    // art-1 and art-2 should be removed from both storage and store
    assert.equal(await storage.has(`${ws.id}/art-1`), false);
    assert.equal(await storage.has(`${ws.id}/art-2`), false);
    assert.equal(await store.getArtifact(ws.id, "art-1"), null);
    assert.equal(await store.getArtifact(ws.id, "art-2"), null);

    // art-3 and art-4 (hotter) should remain intact
    assert.equal(await storage.has(`${ws.id}/art-3`), true);
    assert.equal(await storage.has(`${ws.id}/art-4`), true);
    assert.ok(await store.getArtifact(ws.id, "art-3"));
    assert.ok(await store.getArtifact(ws.id, "art-4"));

    // Running again when usage is at or below high watermark should be a no-op
    const noopResult = await daemon.evictWorkspaceLru(ws.id);
    assert.equal(noopResult.evictedCount, 0);
    assert.equal(noopResult.freedBytes, 0);
  });

  await t.test("Expired artifacts are pruned first before active LRU dependencies", async () => {
    const store = new MemoryMetadataStore();
    await store.init();
    const storage = new MemoryStorage();

    const ws = await store.ensureWorkspace("ttl-priority-test", "TTL Test", 1000);
    const daemon = new StorageOptimizerDaemon({
      store,
      storage,
      config,
      optimizerConfig: {
        highWatermarkRatio: 0.8,
        lowWatermarkRatio: 0.5,
      },
    });

    const now = Date.now();
    // 3 artifacts:
    // art-active-old: 300 bytes, unexpired, accessed long ago
    // art-expired: 400 bytes, EXPIRED
    // art-active-hot: 300 bytes, unexpired, recently accessed
    // Total = 1000 bytes (> 800 bytes high watermark)
    await storage.put(`${ws.id}/art-active-old`, Buffer.alloc(300));
    await store.recordArtifact({
      hash: "art-active-old",
      workspaceId: ws.id,
      sizeBytes: 300,
      lastAccessedAt: new Date(now - 80000).toISOString(),
    });

    await storage.put(`${ws.id}/art-expired`, Buffer.alloc(400));
    await store.recordArtifact({
      hash: "art-expired",
      workspaceId: ws.id,
      sizeBytes: 400,
      expiresAt: new Date(now - 10000).toISOString(), // expired in past
      lastAccessedAt: new Date(now - 10000).toISOString(),
    });

    await storage.put(`${ws.id}/art-active-hot`, Buffer.alloc(300));
    await store.recordArtifact({
      hash: "art-active-hot",
      workspaceId: ws.id,
      sizeBytes: 300,
      lastAccessedAt: new Date(now).toISOString(),
    });

    const result = await daemon.evictWorkspaceLru(ws.id);

    // Evicting art-expired frees 400 bytes, leaving 600 bytes.
    // 600 > 500 (low watermark), so art-active-old (300 bytes) is evicted next.
    // Remaining = 300 bytes <= 500 bytes.
    // art-active-hot (300 bytes) is preserved!
    assert.equal(result.evictedCount, 2);
    assert.equal(result.freedBytes, 700);
    assert.ok(result.evictedHashes.includes("art-expired"));
    assert.ok(result.evictedHashes.includes("art-active-old"));
    assert.equal(await storage.has(`${ws.id}/art-active-hot`), true);
  });

  await t.test("Daemon background lifecycle start() and stop()", async () => {
    const store = new MemoryMetadataStore();
    const storage = new MemoryStorage();
    const daemon = new StorageOptimizerDaemon({
      store,
      storage,
      config,
      optimizerConfig: { enabled: true, intervalSeconds: 1 },
    });

    daemon.start();
    // Starting second time is idempotent
    daemon.start();
    daemon.stop();
  });

  await t.test("POST /api/v1/workspaces/:slug/optimize endpoint", async () => {
    const storage = new MemoryStorage();
    const store = new MemoryMetadataStore();
    const server = await createPolyCloudServer(config, { storage, store });
    const app = server.app;

    const ws = await store.ensureWorkspace("optim-api-test", "Optimize API Test", 5000);
    const { rawToken: adminToken } = await store.createToken({
      workspaceId: ws.id,
      name: "admin",
      role: "admin",
    });
    const { rawToken: readToken } = await store.createToken({
      workspaceId: ws.id,
      name: "read",
      role: "read",
    });

    // Populate an expired artifact and an active artifact
    await storage.put(`${ws.id}/exp-art`, Buffer.alloc(200));
    await store.recordArtifact({
      hash: "exp-art",
      workspaceId: ws.id,
      sizeBytes: 200,
      expiresAt: new Date(Date.now() - 5000).toISOString(),
    });

    await storage.put(`${ws.id}/act-art`, Buffer.alloc(300));
    await store.recordArtifact({
      hash: "act-art",
      workspaceId: ws.id,
      sizeBytes: 300,
    });

    // Unauthorized without token
    const resUnauth = await app.inject({
      method: "POST",
      url: "/api/v1/workspaces/optim-api-test/optimize",
    });
    assert.equal(resUnauth.statusCode, 401);

    // Forbidden with read-only token
    const resForbidden = await app.inject({
      method: "POST",
      url: "/api/v1/workspaces/optim-api-test/optimize",
      headers: { authorization: `Bearer ${readToken}` },
    });
    assert.equal(resForbidden.statusCode, 403);

    // 404 for unknown workspace
    const resNotFound = await app.inject({
      method: "POST",
      url: "/api/v1/workspaces/unknown-ws/optimize",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(resNotFound.statusCode, 404);

    // 200 Success with admin token
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/workspaces/optim-api-test/optimize",
      headers: { authorization: `Bearer ${adminToken}` },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.payload);
    assert.equal(body.status, "optimized");
    assert.ok(body.report);
    assert.equal(body.report.workspaceSlug, "optim-api-test");
    assert.equal(body.report.expiredPrunedCount, 1);
    assert.equal(body.report.expiredFreedBytes, 200);
    assert.equal(body.report.currentSizeBytes, 300);
    assert.ok(body.report.timestamp);
  });

  await t.test(
    "Deduplication and inline on-write eviction via PUT /v8/artifacts/:hash",
    async () => {
      const storage = new MemoryStorage();
      const store = new MemoryMetadataStore();
      const server = await createPolyCloudServer(
        loadConfig({
          storageBackend: "memory",
          authEnabled: true,
          defaultAdminToken: "test-admin-secret",
          defaultWorkspace: "default",
          autoEvictionEnabled: true,
          autoEvictOnWrite: true,
          quotaHighWatermarkRatio: 0.7, // 700 bytes on 1000 byte quota
          quotaLowWatermarkRatio: 0.4, // 400 bytes target
          deduplicationEnabled: true,
        }),
        { storage, store },
      );
      const app = server.app;

      const ws = await store.ensureWorkspace("dedup-ws", "Dedup WS", 1000);
      const { rawToken: writeToken } = await store.createToken({
        workspaceId: ws.id,
        name: "writer",
        role: "write",
      });

      const identicalPayload = Buffer.from("reusable shared dependency layer binary output");

      // Upload first artifact
      const res1 = await app.inject({
        method: "PUT",
        url: "/v8/artifacts/branch-main-dep?team=dedup-ws",
        headers: {
          authorization: `Bearer ${writeToken}`,
          "content-type": "application/octet-stream",
          "content-length": identicalPayload.length.toString(),
        },
        payload: identicalPayload,
      });
      assert.equal(res1.statusCode, 200);
      const art1 = await store.getArtifact(ws.id, "branch-main-dep");
      assert.equal(art1?.isDeduplicated, false);

      // Upload second artifact with identical payload on different hash (e.g. branch-feat)
      const res2 = await app.inject({
        method: "PUT",
        url: "/v8/artifacts/branch-feat-dep?team=dedup-ws",
        headers: {
          authorization: `Bearer ${writeToken}`,
          "content-type": "application/octet-stream",
          "content-length": identicalPayload.length.toString(),
        },
        payload: identicalPayload,
      });
      assert.equal(res2.statusCode, 200);

      const art2 = await store.getArtifact(ws.id, "branch-feat-dep");
      assert.equal(art2?.isDeduplicated, true);
      assert.equal(art2?.originalHash, "branch-main-dep");

      // Check stats for deduplication savings
      const stats = await store.getWorkspaceStats("dedup-ws");
      assert.equal(stats.totalArtifacts, 2);
      assert.equal(stats.deduplicationSavingsBytes, identicalPayload.length);
      assert.equal(stats.deduplicationRatio, 2.0);
    },
  );
});
