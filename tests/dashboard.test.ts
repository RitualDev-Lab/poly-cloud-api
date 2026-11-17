import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { MemoryMetadataStore } from "../src/metadata/store.js";
import { createPolyCloudServer } from "../src/server.js";
import { MemoryStorage } from "../src/storage/memory.js";

test("Embedded Web Dashboard (/dashboard)", async (t) => {
  const config = loadConfig({
    storageBackend: "memory",
    authEnabled: true,
    defaultAdminToken: "dashboard-test-token",
    defaultWorkspace: "default",
  });

  const storage = new MemoryStorage();
  const store = new MemoryMetadataStore();

  const server = await createPolyCloudServer(config, { storage, store });
  const app = server.app;

  await t.test("GET /dashboard serves self-contained HTML page", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/dashboard",
    });

    assert.equal(res.statusCode, 200);
    assert.match(res.headers["content-type"] || "", /text\/html/);

    const html = res.body;
    assert.ok(html.includes("<!DOCTYPE html>"));
    assert.ok(html.includes("Poly Cloud API"));
    assert.ok(html.includes("Overview & ROI"));
    assert.ok(html.includes("Artifact Explorer"));
    assert.ok(html.includes("Token Governance"));
    assert.ok(html.includes("Cluster & Storage Health Probe"));
  });

  await t.test("Dashboard is air-gapped with zero external remote scripts", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/dashboard",
    });

    const html = res.body;
    // Ensure no CDN or external script/link tags
    assert.equal(html.includes("<script src="), false);
    assert.equal(html.includes('<link rel="stylesheet" href="http'), false);
    assert.equal(html.includes("https://cdn"), false);
    assert.equal(html.includes("https://unpkg"), false);
    assert.equal(html.includes("https://cdnjs"), false);
  });

  await t.test("GET / redirects to /dashboard", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/",
    });

    assert.equal(res.statusCode, 302);
    assert.equal(res.headers.location, "/dashboard");
  });

  await server.stop();
});
