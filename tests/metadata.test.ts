import assert from "node:assert/strict";
import test from "node:test";
import { MemoryMetadataStore } from "../src/metadata/store.js";

test("MemoryMetadataStore", async (t) => {
  const store = new MemoryMetadataStore();
  await store.init();

  let workspaceId = "";

  await t.test("ensures workspace", async () => {
    const ws = await store.ensureWorkspace("team-backend", "Team Backend");
    assert.equal(ws.slug, "team-backend");
    assert.equal(ws.name, "Team Backend");
    assert.ok(ws.id);
    workspaceId = ws.id;

    // Idempotent
    const ws2 = await store.ensureWorkspace("team-backend");
    assert.equal(ws2.id, ws.id);
  });

  let rawSecretToken = "";
  let tokenId = "";

  await t.test("creates and verifies token", async () => {
    const { token, rawToken } = await store.createToken({
      workspaceId,
      name: "ci-runner-token",
      role: "write",
    });

    assert.ok(rawToken.startsWith("poly_tok_"));
    assert.equal(token.role, "write");
    assert.equal(token.workspaceId, workspaceId);
    rawSecretToken = rawToken;
    tokenId = token.id;

    const verified = await store.verifyToken(rawSecretToken);
    assert.ok(verified);
    assert.equal(verified?.workspace.slug, "team-backend");
    assert.equal(verified?.token.role, "write");
  });

  await t.test("fails on invalid token", async () => {
    const bad = await store.verifyToken("invalid_tok_123");
    assert.equal(bad, null);
  });

  await t.test("records artifact and hits", async () => {
    const art = await store.recordArtifact({
      hash: "hash-build-1",
      workspaceId,
      sizeBytes: 1048576, // 1MB
      tag: "linux-x64",
      durationMs: 4500, // 4.5s
    });

    assert.equal(art.hash, "hash-build-1");
    assert.equal(art.hitCount, 0);

    await store.recordHit(workspaceId, "hash-build-1");
    await store.recordHit(workspaceId, "hash-build-1");

    const fetched = await store.getArtifact(workspaceId, "hash-build-1");
    assert.equal(fetched?.hitCount, 2);
  });

  await t.test("calculates ROI stats", async () => {
    // 2 hits * 4500ms = 9000ms saved = 9s
    const stats = await store.getWorkspaceStats("team-backend", 0.08);

    assert.equal(stats.totalArtifacts, 1);
    assert.equal(stats.totalSizeBytes, 1048576);
    assert.equal(stats.totalHits, 2);
    assert.equal(stats.totalDurationSavedSeconds, 9);
    assert.ok(stats.estimatedSavingsUsd >= 0);
  });

  await t.test("revokes token", async () => {
    const revoked = await store.revokeToken(tokenId);
    assert.equal(revoked, true);

    const check = await store.verifyToken(rawSecretToken);
    assert.equal(check, null);
  });
});
