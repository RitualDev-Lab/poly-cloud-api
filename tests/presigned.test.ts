import assert from "node:assert/strict";
import test from "node:test";
import { RemoteCacheClient } from "../src/client/remote-cache.js";
import { loadConfig } from "../src/config.js";
import { MemoryMetadataStore } from "../src/metadata/store.js";
import { createPolyCloudServer } from "../src/server.js";
import { MemoryStorage } from "../src/storage/memory.js";

test("Presigned S3/R2 Direct-to-Storage Engine", async (t) => {
  const config = loadConfig({
    storageBackend: "memory",
    authEnabled: true,
    defaultAdminToken: "presigned-test-token",
    defaultWorkspace: "team-cloud",
    presignedUrlsEnabled: true,
    presignedRedirectOnGet: true,
    presignedExpirySeconds: 600,
  });

  // Storage with presigned support enabled
  const storage = new MemoryStorage({ enablePresignedUrls: true });
  const store = new MemoryMetadataStore();

  const server = await createPolyCloudServer(config, { storage, store });
  const app = server.app;
  const authHeader = { authorization: "Bearer presigned-test-token" };

  await t.test("POST /v8/artifacts/:hash/upload-url generates presigned PUT URL", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/v8/artifacts/direct-upload-hash-1/upload-url?team=team-cloud",
      headers: {
        ...authHeader,
        "content-type": "application/json",
      },
      payload: {
        sizeBytes: 1024,
        tag: "linux-x64",
        durationMs: 1500,
      },
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.ok(body.uploadUrl);
    assert.match(body.uploadUrl, /signed=true/);
    assert.equal(body.method, "PUT");
    assert.equal(body.expiresInSeconds, 600);
    assert.ok(body.expiresAt);
  });

  await t.test(
    "POST /v8/artifacts/:hash/complete validates and records direct upload",
    async () => {
      const hash = "direct-upload-hash-1";
      const ws = await store.ensureWorkspace("team-cloud");
      const storageKey = `${ws.id}/${hash}`;

      // Simulate S3 object landing directly from runner
      await storage.put(storageKey, Buffer.from("direct uploaded artifact payload from CI runner"));

      // Call complete endpoint
      const res = await app.inject({
        method: "POST",
        url: `/v8/artifacts/${hash}/complete?team=team-cloud`,
        headers: {
          ...authHeader,
          "content-type": "application/json",
        },
        payload: {
          tag: "linux-x64",
          durationMs: 1500,
        },
      });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.status, "stored");
      assert.equal(body.hash, hash);
      assert.ok(body.sizeBytes > 0);

      // Verify metadata recorded
      const meta = await store.getArtifact(ws.id, hash);
      assert.ok(meta);
      assert.equal(meta?.tag, "linux-x64");
      assert.equal(meta?.durationMs, 1500);
    },
  );

  await t.test(
    "POST /v8/artifacts/:hash/complete rejects if object missing from storage",
    async () => {
      const res = await app.inject({
        method: "POST",
        url: "/v8/artifacts/non-existent-hash/complete?team=team-cloud",
        headers: {
          ...authHeader,
          "content-type": "application/json",
        },
        payload: {},
      });

      assert.equal(res.statusCode, 400);
    },
  );

  await t.test("GET /v8/artifacts/:hash issues 307 Redirect to S3 presigned URL", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/v8/artifacts/direct-upload-hash-1?team=team-cloud",
      headers: authHeader,
    });

    // HTTP 307 Temporary Redirect directly to S3
    assert.equal(res.statusCode, 307);
    assert.ok(res.headers.location);
    assert.match(res.headers.location, /https:\/\/s3\.storage\.example\.com/);
    assert.match(res.headers.location, /signed=true/);
    assert.equal(res.headers["x-artifact-tag"], "linux-x64");
  });

  await t.test(
    "GET /v8/artifacts/:hash?direct=true bypasses redirect and streams directly",
    async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v8/artifacts/direct-upload-hash-1?team=team-cloud&direct=true",
        headers: authHeader,
      });

      assert.equal(res.statusCode, 200);
      assert.equal(res.headers["content-type"], "application/octet-stream");
      assert.equal(res.body, "direct uploaded artifact payload from CI runner");
    },
  );

  await t.test(
    "GET /v8/artifacts/:hash/download-url returns direct presigned URL as JSON",
    async () => {
      const res = await app.inject({
        method: "GET",
        url: "/v8/artifacts/direct-upload-hash-1/download-url?team=team-cloud",
        headers: authHeader,
      });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.ok(body.downloadUrl);
      assert.match(body.downloadUrl, /signed=true/);
      assert.equal(body.expiresInSeconds, 600);
      assert.ok(body.expiresAt);
    },
  );

  await server.stop();
});

test("S3Storage Presigned URL Generation Unit Tests", async (t) => {
  const { S3Storage } = await import("../src/storage/s3.js");
  const s3 = new S3Storage({
    bucket: "test-poly-bucket",
    region: "eu-central-1",
    endpoint: "https://eu-central-1.r2.cloudflarestorage.com",
    accessKeyId: "mock-key",
    secretAccessKey: "mock-secret",
  });

  assert.equal(s3.supportsPresignedUrls, true);

  await t.test("generates presigned GET URL with custom expiration", async () => {
    const url = await s3.getPresignedGetUrl("artifacts/test-hash", {
      expiresInSeconds: 300,
    });

    assert.ok(url);
    assert.match(url, /X-Amz-Signature/);
    assert.match(url, /X-Amz-Expires=300/);
    assert.match(url, /test-poly-bucket/);
  });

  await t.test("generates presigned PUT URL with content type", async () => {
    const url = await s3.getPresignedPutUrl("artifacts/test-hash", {
      expiresInSeconds: 600,
      contentType: "application/x-tar",
    });

    assert.ok(url);
    assert.match(url, /X-Amz-Signature/);
    assert.match(url, /X-Amz-Expires=600/);
    assert.match(url, /test-poly-bucket/);
  });
});
