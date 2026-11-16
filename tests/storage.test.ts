import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { LocalDiskStorage } from "../src/storage/local.js";
import { MemoryStorage } from "../src/storage/memory.js";

test("MemoryStorage Backend", async (t) => {
  const storage = new MemoryStorage();

  await t.test("puts and gets buffer", async () => {
    const testData = Buffer.from("hello remote cache memory");
    const putRes = await storage.put("test-key-1", testData);

    assert.equal(putRes.sizeBytes, testData.length);
    assert.ok(putRes.sha256);

    const has = await storage.has("test-key-1");
    assert.equal(has, true);

    const fetched = await storage.getBuffer("test-key-1");
    assert.deepEqual(fetched, testData);
  });

  await t.test("streams readable input", async () => {
    const stream = Readable.from(["stream-chunk-1-", "stream-chunk-2"]);
    const putRes = await storage.put("test-stream-1", stream);

    assert.equal(putRes.sizeBytes, 29);
    const fetched = await storage.getBuffer("test-stream-1");
    assert.equal(fetched?.toString(), "stream-chunk-1-stream-chunk-2");
  });

  await t.test("deletes and stats keys", async () => {
    const stat1 = await storage.stat("test-key-1");
    assert.equal(stat1.exists, true);

    const deleted = await storage.delete("test-key-1");
    assert.equal(deleted, true);

    const stat2 = await storage.stat("test-key-1");
    assert.equal(stat2.exists, false);
    assert.equal(await storage.has("test-key-1"), false);
  });

  await t.test("lists keys and prunes old keys", async () => {
    await storage.put("k-1", Buffer.from("data-1"));
    await storage.put("k-2", Buffer.from("data-2"));

    const keys = await storage.listKeys("k-");
    assert.ok(keys.includes("k-1"));
    assert.ok(keys.includes("k-2"));

    // Prune with future date
    const pruneRes = await storage.prune(new Date(Date.now() + 10000));
    assert.ok(pruneRes.deletedCount >= 2);
    assert.ok(pruneRes.freedBytes > 0);
  });
});

test("LocalDiskStorage Backend", async (t) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "poly-local-storage-"));
  const storage = new LocalDiskStorage(tmpDir);

  await t.test("writes and reads files atomically", async () => {
    const testData = Buffer.from("local disk cache content");
    const putRes = await storage.put("artifact-hash-abc", testData);

    assert.equal(putRes.sizeBytes, testData.length);
    assert.ok(putRes.sha256);

    const has = await storage.has("artifact-hash-abc");
    assert.equal(has, true);

    const fetched = await storage.getBuffer("artifact-hash-abc");
    assert.deepEqual(fetched, testData);

    const stat = await storage.stat("artifact-hash-abc");
    assert.equal(stat.exists, true);
    assert.equal(stat.sizeBytes, testData.length);
  });

  await t.test("streams from readable to local file", async () => {
    const stream = Readable.from(["streamed-part-1-", "streamed-part-2"]);
    const putRes = await storage.put("artifact-stream-abc", stream);

    assert.equal(putRes.sizeBytes, 31);

    const readStream = await storage.get("artifact-stream-abc");
    assert.ok(readStream);

    const chunks: Buffer[] = [];
    for await (const chunk of readStream) {
      chunks.push(chunk);
    }
    assert.equal(Buffer.concat(chunks).toString(), "streamed-part-1-streamed-part-2");
  });

  await t.test("deletes file", async () => {
    const deleted = await storage.delete("artifact-hash-abc");
    assert.equal(deleted, true);
    assert.equal(await storage.has("artifact-hash-abc"), false);
  });

  await t.test("cleans up", () => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
