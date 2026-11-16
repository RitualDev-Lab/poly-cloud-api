import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { MemoryMetadataStore } from "../src/metadata/store.js";
import { createPolyCloudServer } from "../src/server.js";
import { MemoryStorage } from "../src/storage/memory.js";

test("Turborepo & Poly Artifacts Protocol API", async (t) => {
  const config = loadConfig({
    storageBackend: "memory",
    authEnabled: true,
    defaultAdminToken: "test-admin-secret",
    defaultWorkspace: "default",
  });

  const storage = new MemoryStorage();
  const store = new MemoryMetadataStore();

  const server = await createPolyCloudServer(config, { storage, store });
  const app = server.app;

  // Setup test tokens
  const ws = await store.ensureWorkspace("mobile-app");
  const { rawToken: writeToken } = await store.createToken({
    workspaceId: ws.id,
    name: "write-tok",
    role: "write",
  });
  const { rawToken: readToken } = await store.createToken({
    workspaceId: ws.id,
    name: "read-tok",
    role: "read",
  });

  await t.test("rejects unauthorized requests", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v8/artifacts/some-hash-1",
    });
    assert.equal(res.statusCode, 401);
  });

  await t.test("returns 404 on cache miss", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v8/artifacts/missing-hash?team=mobile-app",
      headers: {
        authorization: `Bearer ${readToken}`,
      },
    });
    assert.equal(res.statusCode, 404);
  });

  await t.test("uploads artifact via PUT with write role", async () => {
    const payload = Buffer.from("prebuilt binary artifact tarball contents");

    const res = await app.inject({
      method: "PUT",
      url: "/v8/artifacts/artifact-12345?team=mobile-app",
      headers: {
        authorization: `Bearer ${writeToken}`,
        "content-type": "application/octet-stream",
        "content-length": payload.length.toString(),
        "x-artifact-tag": "ios-arm64",
        "x-artifact-duration": "3200",
      },
      payload,
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.status, "stored");
    assert.equal(body.hash, "artifact-12345");
    assert.equal(body.sizeBytes, payload.length);
    assert.ok(body.sha256);
  });

  await t.test("prevents read-only token from uploading via PUT", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/v8/artifacts/artifact-forbidden?team=mobile-app",
      headers: {
        authorization: `Bearer ${readToken}`,
        "content-type": "application/octet-stream",
      },
      payload: Buffer.from("bad"),
    });
    assert.equal(res.statusCode, 403);
  });

  await t.test("probes existence via HEAD", async () => {
    const resHit = await app.inject({
      method: "HEAD",
      url: "/v8/artifacts/artifact-12345?team=mobile-app",
      headers: {
        authorization: `Bearer ${readToken}`,
      },
    });
    assert.equal(resHit.statusCode, 200);

    const resMiss = await app.inject({
      method: "HEAD",
      url: "/v8/artifacts/not-there?team=mobile-app",
      headers: {
        authorization: `Bearer ${readToken}`,
      },
    });
    assert.equal(resMiss.statusCode, 404);
  });

  await t.test("downloads artifact via GET and verifies byte-for-byte stream", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v8/artifacts/artifact-12345?team=mobile-app",
      headers: {
        authorization: `Bearer ${readToken}`,
      },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "application/octet-stream");
    assert.equal(res.headers["x-artifact-tag"], "ios-arm64");
    assert.equal(res.headers["x-artifact-duration"], "3200");
    assert.equal(res.rawPayload.toString(), "prebuilt binary artifact tarball contents");
  });

  await t.test("records telemetry events via POST /v8/artifacts/events", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v8/artifacts/events?team=mobile-app",
      headers: {
        authorization: `Bearer ${writeToken}`,
        "content-type": "application/json",
      },
      payload: [
        {
          sessionId: "sess-1",
          event: "HIT",
          hash: "artifact-12345",
          duration: 3200,
        },
      ],
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.status, "ok");
    assert.equal(body.recorded, 1);
  });

  await t.test("deletes artifact via DELETE", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/v8/artifacts/artifact-12345?team=mobile-app",
      headers: {
        authorization: `Bearer ${writeToken}`,
      },
    });

    assert.equal(res.statusCode, 200);

    // Verify deleted
    const headRes = await app.inject({
      method: "HEAD",
      url: "/v8/artifacts/artifact-12345?team=mobile-app",
      headers: {
        authorization: `Bearer ${readToken}`,
      },
    });
    assert.equal(headRes.statusCode, 404);
  });

  await server.stop();
});
