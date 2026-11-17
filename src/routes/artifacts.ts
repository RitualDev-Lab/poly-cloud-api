import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { CorporateAttestationPolicy, DsseEnvelope } from "../attestation/types.js";
import { AttestationVerifier } from "../attestation/verifier.js";
import type { PolyCloudConfig } from "../config.js";
import type { MetadataStore } from "../metadata/types.js";
import { createAuthHook } from "../middleware/auth.js";
import type { StorageBackend } from "../storage/types.js";

export interface ArtifactsRouteOptions {
  storage: StorageBackend;
  store: MetadataStore;
  config: PolyCloudConfig;
}

export async function registerArtifactRoutes(
  app: FastifyInstance,
  options: ArtifactsRouteOptions,
): Promise<void> {
  const { storage, store, config } = options;

  const readAuth = createAuthHook({ store, config }, "read");
  const writeAuth = createAuthHook({ store, config }, "write");

  const verifier = new AttestationVerifier();

  function getPolicy(): CorporateAttestationPolicy {
    return {
      requireAttestation: config.attestationRequired,
      trustedPublicKeys: config.attestationTrustedKeys,
      allowedRunners: config.attestationAllowedRunners,
      allowedArchitectures: config.attestationAllowedArchitectures,
      allowedPlatforms: config.attestationAllowedPlatforms,
      allowedBuilders: config.attestationAllowedBuilders,
      enforceChecksumMatch: config.checksumVerificationEnabled,
      enforceSubjectMatch: true,
    };
  }

  // GET /v8/artifacts/:hash - Fetch cached artifact (or 307 Redirect to S3/R2 presigned URL)
  app.get<{
    Params: { hash: string };
    Querystring: { redirect?: string; direct?: string; team?: string };
  }>("/v8/artifacts/:hash", { preHandler: readAuth }, async (request, reply) => {
    const hash = request.params.hash;
    const workspace = request.workspace!;
    const storageKey = `${workspace.id}/${hash}`;

    // Check if artifact exists
    const exists = await storage.has(storageKey);
    if (!exists) {
      // Record cache miss event
      await store.recordEvent({
        workspaceId: workspace.id,
        hash,
        eventType: "miss",
        durationSavedMs: 0,
      });

      return reply.code(404).send({
        error: "Not Found",
        message: `Artifact '${hash}' not found in workspace '${workspace.slug}'`,
      });
    }

    const meta = await store.getArtifact(workspace.id, hash);

    // Record cache hit
    await store.recordHit(workspace.id, hash);
    await store.recordEvent({
      workspaceId: workspace.id,
      hash,
      eventType: "hit",
      durationSavedMs: meta?.durationMs || 0,
    });

    const wantsDirectStream = request.query.redirect === "false" || request.query.direct === "true";

    // Direct S3 / Cloudflare R2 Presigned Redirect (307)
    if (
      !wantsDirectStream &&
      config.presignedUrlsEnabled &&
      config.presignedRedirectOnGet &&
      storage.supportsPresignedUrls &&
      storage.getPresignedGetUrl
    ) {
      const presignedUrl = await storage.getPresignedGetUrl(storageKey, {
        expiresInSeconds: config.presignedExpirySeconds,
      });

      if (presignedUrl) {
        if (meta?.tag) {
          reply.header("x-artifact-tag", meta.tag);
        }
        if (meta?.durationMs) {
          reply.header("x-artifact-duration", meta.durationMs);
        }
        return reply.redirect(presignedUrl, 307);
      }
    }

    // Fallback: Direct stream through API server
    const stream = await storage.get(storageKey);
    if (!stream) {
      return reply.code(404).send({
        error: "Not Found",
        message: `Artifact '${hash}' content missing`,
      });
    }

    const stat = await storage.stat(storageKey);
    reply.header("Content-Type", "application/octet-stream");
    if (stat.sizeBytes) {
      reply.header("Content-Length", stat.sizeBytes);
    }
    if (meta?.tag) {
      reply.header("x-artifact-tag", meta.tag);
    }
    if (meta?.durationMs) {
      reply.header("x-artifact-duration", meta.durationMs);
    }

    return reply.send(stream);
  });

  // GET /v8/artifacts/:hash/download-url - Get direct presigned S3/R2 download URL
  app.get<{ Params: { hash: string } }>(
    "/v8/artifacts/:hash/download-url",
    { preHandler: readAuth },
    async (request, reply) => {
      const hash = request.params.hash;
      const workspace = request.workspace!;
      const storageKey = `${workspace.id}/${hash}`;

      const exists = await storage.has(storageKey);
      if (!exists) {
        return reply.code(404).send({
          error: "Not Found",
          message: `Artifact '${hash}' not found in workspace '${workspace.slug}'`,
        });
      }

      if (!storage.supportsPresignedUrls || !storage.getPresignedGetUrl) {
        return reply.code(501).send({
          error: "Not Implemented",
          message: `Storage backend '${storage.name}' does not support presigned URLs`,
        });
      }

      const downloadUrl = await storage.getPresignedGetUrl(storageKey, {
        expiresInSeconds: config.presignedExpirySeconds,
      });

      const expiresAt = new Date(Date.now() + config.presignedExpirySeconds * 1000).toISOString();

      return reply.code(200).send({
        downloadUrl,
        expiresInSeconds: config.presignedExpirySeconds,
        expiresAt,
      });
    },
  );

  // POST /v8/artifacts/:hash/upload-url - Generate presigned S3/R2 direct upload URL
  app.post<{
    Params: { hash: string };
    Body: {
      sizeBytes?: number;
      contentType?: string;
      tag?: string;
      durationMs?: number;
    };
  }>("/v8/artifacts/:hash/upload-url", { preHandler: writeAuth }, async (request, reply) => {
    const hash = request.params.hash;
    const workspace = request.workspace!;
    const storageKey = `${workspace.id}/${hash}`;
    const { sizeBytes, contentType } = request.body || {};

    if (!storage.supportsPresignedUrls || !storage.getPresignedPutUrl) {
      return reply.code(501).send({
        error: "Not Implemented",
        message: `Storage backend '${storage.name}' does not support direct presigned uploads`,
      });
    }

    if (sizeBytes && sizeBytes > config.maxArtifactSizeBytes) {
      return reply.code(413).send({
        error: "Payload Too Large",
        message: `Artifact size ${sizeBytes} exceeds maximum of ${config.maxArtifactSizeBytes} bytes`,
      });
    }

    const uploadUrl = await storage.getPresignedPutUrl(storageKey, {
      expiresInSeconds: config.presignedExpirySeconds,
      sizeBytes,
      contentType: contentType || "application/octet-stream",
    });

    const expiresAt = new Date(Date.now() + config.presignedExpirySeconds * 1000).toISOString();

    return reply.code(200).send({
      uploadUrl,
      method: "PUT",
      headers: {
        "Content-Type": contentType || "application/octet-stream",
      },
      expiresInSeconds: config.presignedExpirySeconds,
      expiresAt,
    });
  });

  // POST /v8/artifacts/:hash/complete - Confirm direct presigned upload completed
  app.post<{
    Params: { hash: string };
    Body: {
      sizeBytes?: number;
      tag?: string;
      durationMs?: number;
      checksumSha256?: string;
      attestation?: DsseEnvelope | string;
    };
  }>("/v8/artifacts/:hash/complete", { preHandler: writeAuth }, async (request, reply) => {
    const hash = request.params.hash;
    const workspace = request.workspace!;
    const storageKey = `${workspace.id}/${hash}`;
    const { sizeBytes, tag, durationMs, checksumSha256, attestation } = request.body || {};

    // Verify that artifact was actually stored in storage backend
    const stat = await storage.stat(storageKey);
    if (!stat.exists) {
      return reply.code(400).send({
        error: "Bad Request",
        message: `Artifact '${hash}' was not found in storage. Did direct upload succeed?`,
      });
    }

    // Determine payload SHA-256 for integrity check
    let payloadSha256 = checksumSha256 || "";
    if (!payloadSha256) {
      const buffer = await storage.getBuffer(storageKey);
      if (buffer) {
        payloadSha256 = crypto.createHash("sha256").update(buffer).digest("hex");
      } else {
        payloadSha256 = hash;
      }
    }

    // Enforce Corporate Policy Gate, Checksum Integrity, and Attestation
    const policy = getPolicy();
    const evalResult = verifier.evaluatePolicy({
      envelope: attestation,
      artifactHash: hash,
      payloadSha256,
      expectedChecksum: checksumSha256,
      policy,
    });

    if (!evalResult.valid) {
      await storage.delete(storageKey);
      const isChecksumViolation = evalResult.violations.some((v) =>
        v.startsWith("CHECKSUM_MISMATCH"),
      );
      return reply.code(isChecksumViolation ? 400 : 403).send({
        error: isChecksumViolation ? "Checksum Mismatch" : "Corporate Policy Violation",
        message: evalResult.error,
        violations: evalResult.violations,
      });
    }

    const finalSize = stat.sizeBytes ?? sizeBytes ?? 0;

    let parsedEnv: DsseEnvelope | undefined;
    if (attestation && evalResult.signatureVerified) {
      try {
        parsedEnv = verifier.parseEnvelope(attestation);
      } catch {}
    }

    const record = await store.recordArtifact({
      hash,
      workspaceId: workspace.id,
      sizeBytes: finalSize,
      sha256: payloadSha256,
      tag,
      durationMs,
      isAttested: evalResult.signatureVerified,
      attestationVerified: evalResult.signatureVerified,
      attestationSignerKeyId: evalResult.signerKeyId,
      builderId: evalResult.builderId,
      ciRunner: evalResult.ciRunner,
      attestationStatement: evalResult.statement,
      attestationEnvelope: parsedEnv,
    });

    await store.recordEvent({
      workspaceId: workspace.id,
      hash,
      eventType: "upload",
      durationSavedMs: 0,
    });

    return reply.code(200).send({
      status: "stored",
      hash: record.hash,
      sizeBytes: record.sizeBytes,
      sha256: payloadSha256,
      attested: record.isAttested ?? false,
      verified: record.attestationVerified ?? false,
      signerKeyId: record.attestationSignerKeyId,
    });
  });

  // HEAD /v8/artifacts/:hash - Fast cache hit / existence probe
  app.head<{ Params: { hash: string } }>(
    "/v8/artifacts/:hash",
    { preHandler: readAuth },
    async (request, reply) => {
      const hash = request.params.hash;
      const workspace = request.workspace!;
      const storageKey = `${workspace.id}/${hash}`;

      const exists = await storage.has(storageKey);
      if (!exists) {
        return reply.code(404).send();
      }

      const stat = await storage.stat(storageKey);
      if (stat.sizeBytes) {
        reply.header("Content-Length", stat.sizeBytes);
      }
      return reply.code(200).send();
    },
  );

  // PUT /v8/artifacts/:hash - Upload and save cached artifact
  app.put<{ Params: { hash: string } }>(
    "/v8/artifacts/:hash",
    { preHandler: writeAuth },
    async (request, reply) => {
      const hash = request.params.hash;
      const workspace = request.workspace!;
      const storageKey = `${workspace.id}/${hash}`;

      const tag = request.headers["x-artifact-tag"] as string | undefined;
      const durationHeader = request.headers["x-artifact-duration"];
      const durationMs = durationHeader ? Number.parseInt(durationHeader as string, 10) : undefined;
      const attestationHeader = (request.headers["x-poly-attestation"] ||
        request.headers["x-artifact-attestation"]) as string | undefined;
      const explicitChecksum = (request.headers["x-artifact-sha256"] ||
        request.headers["x-poly-sha256"]) as string | undefined;

      // Handle raw body stream or buffer
      let bodyData: Buffer | import("node:stream").Readable;
      if (Buffer.isBuffer(request.body)) {
        bodyData = request.body;
      } else if (typeof request.body === "string") {
        bodyData = Buffer.from(request.body);
      } else {
        // Fallback to underlying raw HTTP stream
        bodyData = request.raw;
      }

      // Check artifact size ceiling if Content-Length provided
      const contentLength = Number.parseInt(
        (request.headers["content-length"] as string) || "0",
        10,
      );
      if (contentLength > config.maxArtifactSizeBytes) {
        return reply.code(413).send({
          error: "Payload Too Large",
          message: `Artifact size ${contentLength} bytes exceeds cluster maximum of ${config.maxArtifactSizeBytes} bytes`,
        });
      }

      const putResult = await storage.put(storageKey, bodyData, contentLength);
      const payloadSha256 = putResult.sha256 || "";

      // Enforce Corporate Policy Gate, Checksum Integrity, and Attestation
      const policy = getPolicy();
      const evalResult = verifier.evaluatePolicy({
        envelope: attestationHeader,
        artifactHash: hash,
        payloadSha256,
        expectedChecksum: explicitChecksum,
        policy,
      });

      if (!evalResult.valid) {
        // Prevent cache poisoning: remove rejected binary immediately
        await storage.delete(storageKey);
        const isChecksumViolation = evalResult.violations.some((v) =>
          v.startsWith("CHECKSUM_MISMATCH"),
        );
        return reply.code(isChecksumViolation ? 400 : 403).send({
          error: isChecksumViolation ? "Checksum Mismatch" : "Corporate Policy Violation",
          message: evalResult.error,
          violations: evalResult.violations,
        });
      }

      let parsedEnv: DsseEnvelope | undefined;
      if (attestationHeader && evalResult.signatureVerified) {
        try {
          parsedEnv = verifier.parseEnvelope(attestationHeader);
        } catch {}
      }

      // Record metadata
      const record = await store.recordArtifact({
        hash,
        workspaceId: workspace.id,
        sizeBytes: putResult.sizeBytes,
        sha256: putResult.sha256,
        tag,
        durationMs,
        isAttested: evalResult.signatureVerified,
        attestationVerified: evalResult.signatureVerified,
        attestationSignerKeyId: evalResult.signerKeyId,
        builderId: evalResult.builderId,
        ciRunner: evalResult.ciRunner,
        attestationStatement: evalResult.statement,
        attestationEnvelope: parsedEnv,
      });

      // Record upload event
      await store.recordEvent({
        workspaceId: workspace.id,
        hash,
        eventType: "upload",
        durationSavedMs: 0,
      });

      return reply.code(200).send({
        status: "stored",
        hash: record.hash,
        sizeBytes: record.sizeBytes,
        sha256: putResult.sha256,
        attested: record.isAttested ?? false,
        verified: record.attestationVerified ?? false,
        signerKeyId: record.attestationSignerKeyId,
      });
    },
  );

  // POST /v8/artifacts/:hash/attestation - Submit & verify cryptographic in-toto attestation
  app.post<{
    Params: { hash: string };
    Body: { envelope: DsseEnvelope | string };
  }>("/v8/artifacts/:hash/attestation", { preHandler: writeAuth }, async (request, reply) => {
    const hash = request.params.hash;
    const workspace = request.workspace!;
    const storageKey = `${workspace.id}/${hash}`;

    const exists = await storage.has(storageKey);
    if (!exists) {
      return reply.code(404).send({
        error: "Not Found",
        message: `Artifact '${hash}' not found in workspace '${workspace.slug}'`,
      });
    }

    const meta = await store.getArtifact(workspace.id, hash);
    let payloadSha256 = meta?.sha256 || "";
    if (!payloadSha256) {
      const buffer = await storage.getBuffer(storageKey);
      if (buffer) {
        payloadSha256 = crypto.createHash("sha256").update(buffer).digest("hex");
      } else {
        payloadSha256 = hash;
      }
    }

    const policy = getPolicy();
    const evalResult = verifier.evaluatePolicy({
      envelope: request.body.envelope,
      artifactHash: hash,
      payloadSha256,
      policy,
    });

    if (!evalResult.valid) {
      return reply.code(403).send({
        error: "Corporate Policy Violation",
        message: evalResult.error,
        violations: evalResult.violations,
      });
    }

    const parsedEnv = verifier.parseEnvelope(request.body.envelope);
    await store.attachAttestation({
      workspaceId: workspace.id,
      hash,
      isAttested: true,
      attestationVerified: evalResult.signatureVerified,
      attestationSignerKeyId: evalResult.signerKeyId,
      builderId: evalResult.builderId,
      ciRunner: evalResult.ciRunner,
      attestationEnvelope: parsedEnv,
      attestationStatement: evalResult.statement,
    });

    return reply.code(200).send({
      status: "attested",
      verified: true,
      signerKeyId: evalResult.signerKeyId,
      builderId: evalResult.builderId,
      ciRunner: evalResult.ciRunner,
      statement: evalResult.statement,
    });
  });

  // GET /v8/artifacts/:hash/attestation - Retrieve verified SLSA attestation statement
  app.get<{ Params: { hash: string } }>(
    "/v8/artifacts/:hash/attestation",
    { preHandler: readAuth },
    async (request, reply) => {
      const hash = request.params.hash;
      const workspace = request.workspace!;
      const meta = await store.getArtifact(workspace.id, hash);

      if (!meta) {
        return reply.code(404).send({
          error: "Not Found",
          message: `Artifact '${hash}' not found in workspace '${workspace.slug}'`,
        });
      }

      if (!meta.isAttested || !meta.attestationStatement) {
        return reply.code(404).send({
          error: "Not Found",
          message: `No cryptographic attestation recorded for artifact '${hash}'`,
        });
      }

      return reply.code(200).send({
        hash: meta.hash,
        isAttested: meta.isAttested,
        attestationVerified: meta.attestationVerified,
        signerKeyId: meta.attestationSignerKeyId,
        builderId: meta.builderId,
        ciRunner: meta.ciRunner,
        statement: meta.attestationStatement,
        envelope: meta.attestationEnvelope,
      });
    },
  );

  // DELETE /v8/artifacts/:hash - Invalidate artifact
  app.delete<{ Params: { hash: string } }>(
    "/v8/artifacts/:hash",
    { preHandler: writeAuth },
    async (request, reply) => {
      const hash = request.params.hash;
      const workspace = request.workspace!;
      const storageKey = `${workspace.id}/${hash}`;

      await storage.delete(storageKey);
      await store.deleteArtifact(workspace.id, hash);

      await store.recordEvent({
        workspaceId: workspace.id,
        hash,
        eventType: "delete",
        durationSavedMs: 0,
      });

      return reply.code(200).send({
        status: "deleted",
        hash,
      });
    },
  );
}
