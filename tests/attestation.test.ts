import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { AttestationVerifier } from "../src/attestation/verifier.js";
import { RemoteCacheClient } from "../src/client/remote-cache.js";
import { loadConfig } from "../src/config.js";
import { MemoryMetadataStore } from "../src/metadata/store.js";
import { createPolyCloudServer } from "../src/server.js";
import { MemoryStorage } from "../src/storage/memory.js";

test("Cryptographic Attestation & SLSA Verification Suite", async (t) => {
  const verifier = new AttestationVerifier();
  const { privateKey, publicKey } = verifier.generateKeyPair("ed25519");
  const keyId = "corp-ed25519-key-1";

  await t.test("AttestationVerifier: Signs and verifies SLSA v1.0 in-toto statement", () => {
    const artifactBytes = Buffer.from("production-compiler-binary-data");
    const sha256 = crypto.createHash("sha256").update(artifactBytes).digest("hex");

    const statement = verifier.createAttestationStatement({
      subjects: [{ name: "dist/compiler.bin", sha256 }],
      ciRunner: "GitHub Actions",
      platform: "linux",
      arch: "x64",
      builderId: "https://github.com/RitualDev-Lab/poly",
    });

    const envelope = verifier.signStatement(statement, privateKey, keyId);
    assert.equal(envelope.payloadType, "application/vnd.in-toto+json");
    assert.equal(envelope.signatures.length, 1);
    assert.equal(envelope.signatures[0].keyid, keyId);

    // Verify signature
    const sigCheck = verifier.verifySignature(envelope, { [keyId]: publicKey });
    assert.equal(sigCheck.verified, true);
    assert.equal(sigCheck.keyId, keyId);

    // Verify subject
    const subCheck = verifier.verifySubject(statement, "compiler.bin", sha256);
    assert.equal(subCheck.matched, true);
  });

  await t.test("AttestationVerifier: Rejects tampered signature or untrusted key", () => {
    const statement = verifier.createAttestationStatement({
      subjects: [{ name: "artifact.tar.gz", sha256: "aabbcc" }],
    });
    const envelope = verifier.signStatement(statement, privateKey, keyId);

    // Tampered payload
    const tamperedPayload = Buffer.from(JSON.stringify({ ...statement, subject: [] })).toString(
      "base64",
    );
    const tamperedEnvelope = { ...envelope, payload: tamperedPayload };

    const sigCheckTampered = verifier.verifySignature(tamperedEnvelope, {
      [keyId]: publicKey,
    });
    assert.equal(sigCheckTampered.verified, false);

    // Untrusted key
    const untrustedKey = verifier.generateKeyPair("ed25519").publicKey;
    const sigCheckUntrusted = verifier.verifySignature(envelope, {
      "other-key": untrustedKey,
    });
    assert.equal(sigCheckUntrusted.verified, false);
  });

  await t.test(
    "Corporate Policy Gate: Enforces approved runners, platforms, and architectures",
    () => {
      const artifactBytes = Buffer.from("ci-artifact");
      const sha256 = crypto.createHash("sha256").update(artifactBytes).digest("hex");

      const statement = verifier.createAttestationStatement({
        subjects: [{ name: "pkg", sha256 }],
        ciRunner: "Unauthorized-Local-Machine",
        arch: "riscv64",
        platform: "freebsd",
      });
      const envelope = verifier.signStatement(statement, privateKey, keyId);

      const result = verifier.evaluatePolicy({
        envelope,
        artifactHash: sha256,
        payloadSha256: sha256,
        policy: {
          requireAttestation: true,
          trustedPublicKeys: { [keyId]: publicKey },
          allowedRunners: ["GitHub Actions"],
          allowedArchitectures: ["x64", "arm64"],
          allowedPlatforms: ["linux", "darwin"],
        },
      });

      assert.equal(result.valid, false);
      assert.equal(result.signatureVerified, true);
      assert.ok(result.violations.some((v) => v.includes("UNAPPROVED_RUNNER")));
      assert.ok(result.violations.some((v) => v.includes("UNAPPROVED_ARCH")));
      assert.ok(result.violations.some((v) => v.includes("UNAPPROVED_PLATFORM")));
    },
  );

  await t.test("Checksum Integrity: Rejects corrupt or tampered binary payloads", () => {
    const result = verifier.evaluatePolicy({
      artifactHash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      payloadSha256: "11223344556677889900aabbccddeeff11223344556677889900aabbccddeeff",
      policy: {
        requireAttestation: false,
        trustedPublicKeys: {},
        enforceChecksumMatch: true,
      },
    });

    assert.equal(result.valid, false);
    assert.ok(result.violations.some((v) => v.includes("CHECKSUM_MISMATCH")));
  });
});

test("API Endpoints & Policy Enforcement Integration", async (t) => {
  const verifier = new AttestationVerifier();
  const { privateKey, publicKey } = verifier.generateKeyPair("ed25519");
  const keyId = "corp-prod-signer";

  const config = loadConfig({
    storageBackend: "memory",
    authEnabled: true,
    attestationRequired: false,
    attestationTrustedKeys: { [keyId]: publicKey },
    attestationAllowedRunners: ["GitHub Actions"],
  });

  const storage = new MemoryStorage();
  const store = new MemoryMetadataStore();
  const server = await createPolyCloudServer(config, { storage, store });
  const app = server.app;

  const ws = await store.ensureWorkspace("security-team");
  const { rawToken: writeToken } = await store.createToken({
    workspaceId: ws.id,
    name: "ci-token",
    role: "write",
  });
  const { rawToken: readToken } = await store.createToken({
    workspaceId: ws.id,
    name: "read-token",
    role: "read",
  });

  await t.test(
    "PUT /v8/artifacts/:hash accepts valid Ed25519 SLSA attestation header",
    async () => {
      const payload = Buffer.from("verified-secure-build-artifact");
      const sha256 = crypto.createHash("sha256").update(payload).digest("hex");
      const hash = sha256;

      const statement = verifier.createAttestationStatement({
        subjects: [{ name: hash, sha256 }],
        ciRunner: "GitHub Actions",
        builderId: "https://github.com/RitualDev-Lab/poly",
      });
      const envelope = verifier.signStatement(statement, privateKey, keyId);

      const res = await app.inject({
        method: "PUT",
        url: `/v8/artifacts/${hash}?team=security-team`,
        headers: {
          authorization: `Bearer ${writeToken}`,
          "content-type": "application/octet-stream",
          "content-length": payload.length.toString(),
          "x-poly-attestation": JSON.stringify(envelope),
        },
        payload,
      });

      assert.equal(res.statusCode, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.status, "stored");
      assert.equal(body.attested, true);
      assert.equal(body.verified, true);
      assert.equal(body.signerKeyId, keyId);

      // Verify GET /v8/artifacts/:hash/attestation
      const attestRes = await app.inject({
        method: "GET",
        url: `/v8/artifacts/${hash}/attestation?team=security-team`,
        headers: { authorization: `Bearer ${readToken}` },
      });
      assert.equal(attestRes.statusCode, 200);
      const attestBody = JSON.parse(attestRes.body);
      assert.equal(attestBody.hash, hash);
      assert.equal(attestBody.isAttested, true);
      assert.equal(attestBody.attestationVerified, true);
      assert.equal(attestBody.signerKeyId, keyId);
      assert.equal(
        attestBody.statement.predicate.buildDefinition.systemParameters.ciRunner,
        "GitHub Actions",
      );
    },
  );

  await t.test(
    "PUT /v8/artifacts/:hash rejects tampered signature with 403 Forbidden",
    async () => {
      const payload = Buffer.from("tampered-signature-data");
      const sha256 = crypto.createHash("sha256").update(payload).digest("hex");
      const hash = sha256;

      const statement = verifier.createAttestationStatement({
        subjects: [{ name: hash, sha256 }],
        ciRunner: "GitHub Actions",
      });
      const envelope = verifier.signStatement(statement, privateKey, keyId);
      // Tamper the signature bytes
      envelope.signatures[0].sig = Buffer.from("invalid-signature-bytes").toString("base64");

      const res = await app.inject({
        method: "PUT",
        url: `/v8/artifacts/${hash}?team=security-team`,
        headers: {
          authorization: `Bearer ${writeToken}`,
          "content-type": "application/octet-stream",
          "x-poly-attestation": JSON.stringify(envelope),
        },
        payload,
      });

      assert.equal(res.statusCode, 403);
      const body = JSON.parse(res.body);
      assert.equal(body.error, "Corporate Policy Violation");
      assert.ok(body.violations.some((v: string) => v.includes("SIGNATURE_VERIFICATION_FAILED")));

      // Ensure artifact was not retained in storage
      const hasObj = await storage.has(`${ws.id}/${hash}`);
      assert.equal(hasObj, false);
    },
  );

  await t.test(
    "PUT /v8/artifacts/:hash rejects corrupt artifact checksum with 400 Bad Request",
    async () => {
      const payload = Buffer.from("corrupt-bytes");
      const expectedHash = "0000000000000000000000000000000000000000000000000000000000000000";

      const res = await app.inject({
        method: "PUT",
        url: `/v8/artifacts/${expectedHash}?team=security-team`,
        headers: {
          authorization: `Bearer ${writeToken}`,
          "content-type": "application/octet-stream",
        },
        payload,
      });

      assert.equal(res.statusCode, 400);
      const body = JSON.parse(res.body);
      assert.equal(body.error, "Checksum Mismatch");

      // Ensure purged from storage
      const hasObj = await storage.has(`${ws.id}/${expectedHash}`);
      assert.equal(hasObj, false);
    },
  );

  await t.test(
    "POST /v8/artifacts/:hash/attestation attaches attestation to existing artifact",
    async () => {
      const payload = Buffer.from("pre-existing-unattested-artifact");
      const sha256 = crypto.createHash("sha256").update(payload).digest("hex");
      const hash = sha256;

      // Upload initially without attestation
      const putRes = await app.inject({
        method: "PUT",
        url: `/v8/artifacts/${hash}?team=security-team`,
        headers: {
          authorization: `Bearer ${writeToken}`,
          "content-type": "application/octet-stream",
        },
        payload,
      });
      assert.equal(putRes.statusCode, 200);

      // Now sign and attach attestation separately
      const statement = verifier.createAttestationStatement({
        subjects: [{ name: hash, sha256 }],
        ciRunner: "GitHub Actions",
      });
      const envelope = verifier.signStatement(statement, privateKey, keyId);

      const postAttestRes = await app.inject({
        method: "POST",
        url: `/v8/artifacts/${hash}/attestation?team=security-team`,
        headers: {
          authorization: `Bearer ${writeToken}`,
          "content-type": "application/json",
        },
        payload: { envelope },
      });

      assert.equal(postAttestRes.statusCode, 200);
      const postBody = JSON.parse(postAttestRes.body);
      assert.equal(postBody.status, "attested");
      assert.equal(postBody.verified, true);
      assert.equal(postBody.signerKeyId, keyId);

      // Verify it is now marked attested
      const getRes = await app.inject({
        method: "GET",
        url: `/v8/artifacts/${hash}/attestation?team=security-team`,
        headers: { authorization: `Bearer ${readToken}` },
      });
      assert.equal(getRes.statusCode, 200);
    },
  );

  await server.stop();
});

test("Strict Corporate Policy: ATTESTATION_REQUIRED enforcement", async (t) => {
  const verifier = new AttestationVerifier();
  const { privateKey, publicKey } = verifier.generateKeyPair("ed25519");
  const keyId = "corp-strict-key";

  // Strict enforcement mode: unsigned binaries strictly forbidden
  const config = loadConfig({
    storageBackend: "memory",
    authEnabled: true,
    attestationRequired: true,
    attestationTrustedKeys: { [keyId]: publicKey },
  });

  const storage = new MemoryStorage();
  const store = new MemoryMetadataStore();
  const server = await createPolyCloudServer(config, { storage, store });
  const app = server.app;

  const ws = await store.ensureWorkspace("regulated-bank");
  const { rawToken } = await store.createToken({
    workspaceId: ws.id,
    name: "builder-token",
    role: "write",
  });

  await t.test("Rejects unsigned artifact uploads with 403 Forbidden", async () => {
    const payload = Buffer.from("unsigned-developer-binary");
    const sha256 = crypto.createHash("sha256").update(payload).digest("hex");

    const res = await app.inject({
      method: "PUT",
      url: `/v8/artifacts/${sha256}?team=regulated-bank`,
      headers: {
        authorization: `Bearer ${rawToken}`,
        "content-type": "application/octet-stream",
      },
      payload,
    });

    assert.equal(res.statusCode, 403);
    const body = JSON.parse(res.body);
    assert.equal(body.error, "Corporate Policy Violation");
    assert.ok(body.violations.some((v: string) => v.includes("UNSIGNED_ARTIFACT")));
  });

  await t.test("Accepts signed and attested artifact in strict mode", async () => {
    const payload = Buffer.from("attested-bank-binary");
    const sha256 = crypto.createHash("sha256").update(payload).digest("hex");

    const statement = verifier.createAttestationStatement({
      subjects: [{ name: sha256, sha256 }],
    });
    const envelope = verifier.signStatement(statement, privateKey, keyId);

    const res = await app.inject({
      method: "PUT",
      url: `/v8/artifacts/${sha256}?team=regulated-bank`,
      headers: {
        authorization: `Bearer ${rawToken}`,
        "content-type": "application/octet-stream",
        "x-poly-attestation": JSON.stringify(envelope),
      },
      payload,
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.status, "stored");
    assert.equal(body.verified, true);
  });

  await server.stop();
});

test("RemoteCacheClient: Attestation integration methods", async (t) => {
  const verifier = new AttestationVerifier();
  const { privateKey, publicKey } = verifier.generateKeyPair("ed25519");
  const keyId = "client-signer";

  const config = loadConfig({
    port: 0,
    storageBackend: "memory",
    authEnabled: true,
    attestationTrustedKeys: { [keyId]: publicKey },
  });

  const storage = new MemoryStorage();
  const store = new MemoryMetadataStore();
  const server = await createPolyCloudServer(config, { storage, store });
  const serverAddress = await server.start();

  const ws = await store.ensureWorkspace("client-team");
  const { rawToken } = await store.createToken({
    workspaceId: ws.id,
    name: "client-tok",
    role: "write",
  });

  const client = new RemoteCacheClient({
    apiUrl: serverAddress,
    token: rawToken,
    teamSlug: "client-team",
  });

  await t.test("Client uploads artifact with attestation envelope and checksum", async () => {
    const payload = Buffer.from("client-attested-binary");
    const sha256 = crypto.createHash("sha256").update(payload).digest("hex");

    const statement = verifier.createAttestationStatement({
      subjects: [{ name: sha256, sha256 }],
      ciRunner: "GitHub Actions",
    });
    const envelope = verifier.signStatement(statement, privateKey, keyId);

    const uploaded = await client.upload(sha256, payload, {
      attestation: envelope,
      checksumSha256: sha256,
      tag: "linux-x64",
    });
    assert.equal(uploaded, true);

    // Verify attestation can be retrieved via client
    const attestationRec = await client.getAttestation(sha256);
    assert.ok(attestationRec);
    assert.equal(attestationRec.isAttested, true);
    assert.equal(attestationRec.attestationVerified, true);
    assert.equal(attestationRec.signerKeyId, keyId);
  });

  await server.stop();
});
