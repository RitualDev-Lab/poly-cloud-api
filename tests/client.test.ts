import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { PolyRemoteCacheAdapter, RemoteCacheClient } from "../src/client/remote-cache.js";
import { loadConfig } from "../src/config.js";
import { MemoryMetadataStore } from "../src/metadata/store.js";
import { createPolyCloudServer } from "../src/server.js";
import { MemoryStorage } from "../src/storage/memory.js";

test("RemoteCacheClient & PolyRemoteCacheAdapter Integration", async (t) => {
  const config = loadConfig({
    port: 0, // Random available port
    storageBackend: "memory",
    authEnabled: true,
    defaultAdminToken: "client-test-admin-secret",
    defaultWorkspace: "web-team",
  });

  const storage = new MemoryStorage();
  const store = new MemoryMetadataStore();

  const server = await createPolyCloudServer(config, { storage, store });
  const serverAddress = await server.start();

  const client = new RemoteCacheClient({
    apiUrl: serverAddress,
    token: "client-test-admin-secret",
    teamSlug: "web-team",
  });

  const adapter = new PolyRemoteCacheAdapter({
    apiUrl: serverAddress,
    token: "client-test-admin-secret",
    teamSlug: "web-team",
  });

  await t.test("client uploads, probes and downloads artifact", async () => {
    const rawData = Buffer.from("test raw artifact data for client");

    assert.equal(await client.hasKey("key-101"), false);

    const uploaded = await client.upload("key-101", rawData, {
      tag: "test-tag",
      durationMs: 2000,
    });
    assert.equal(uploaded, true);

    const exists = await client.hasKey("key-101");
    assert.equal(exists, true);

    const downloaded = await client.download("key-101");
    assert.deepEqual(downloaded, rawData);
  });

  await t.test("adapter saves and restores simulated build outputs", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-client-adapter-"));
    const distDir = path.join(tmpDir, "dist");
    fs.mkdirSync(distDir, { recursive: true });
    fs.writeFileSync(path.join(distDir, "index.js"), "console.log('remote build');");

    const saveResult = await adapter.save("poly-cache-key-999", [distDir]);
    assert.equal(saveResult.hit, true);
    assert.equal(saveResult.storageBackend, "remote");

    const exists = await adapter.hasKey("poly-cache-key-999");
    assert.equal(exists, true);

    const restoreResult = await adapter.restore("poly-cache-key-999", tmpDir);
    assert.equal(restoreResult.hit, true);
    assert.equal(restoreResult.storageBackend, "remote");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  await t.test("adapter returns miss for non-existent key", async () => {
    const result = await adapter.restore("non-existent-key", os.tmpdir());
    assert.equal(result.hit, false);
  });

  await server.stop();
});
