import * as crypto from "node:crypto";
import type {
  AttestationVerificationResult,
  CorporateAttestationPolicy,
  DsseEnvelope,
  InTotoStatement,
  InTotoSubject,
} from "./types.js";

export class AttestationVerifier {
  /**
   * Parses an envelope from a DsseEnvelope object or a JSON / Base64 string.
   */
  parseEnvelope(input: DsseEnvelope | string): DsseEnvelope {
    if (typeof input === "object" && input !== null) {
      return input;
    }

    if (typeof input === "string") {
      const trimmed = input.trim();
      // Try parsing direct JSON
      if (trimmed.startsWith("{")) {
        return JSON.parse(trimmed) as DsseEnvelope;
      }
      // Try decoding base64 JSON
      const decoded = Buffer.from(trimmed, "base64").toString("utf-8");
      return JSON.parse(decoded) as DsseEnvelope;
    }

    throw new Error("Invalid envelope input type");
  }

  /**
   * Decodes and parses the in-toto Statement from a DSSE envelope payload.
   */
  decodeStatement(envelope: DsseEnvelope): InTotoStatement {
    if (!envelope.payload) {
      throw new Error("Envelope contains empty payload");
    }
    const payloadBuffer = Buffer.from(envelope.payload, "base64");
    const jsonStr = payloadBuffer.toString("utf-8");
    return JSON.parse(jsonStr) as InTotoStatement;
  }

  /**
   * Cryptographically verifies envelope signatures against trusted corporate public keys.
   */
  verifySignature(
    envelope: DsseEnvelope,
    trustedPublicKeys: Record<string, string>,
  ): { verified: boolean; keyId?: string; error?: string } {
    if (!envelope.signatures || envelope.signatures.length === 0) {
      return { verified: false, error: "Envelope contains no cryptographic signatures" };
    }

    const payloadBuffer = Buffer.from(envelope.payload, "base64");
    const availableKeys = Object.entries(trustedPublicKeys);

    if (availableKeys.length === 0) {
      return { verified: false, error: "No trusted public keys configured on server" };
    }

    for (const sigItem of envelope.signatures) {
      const sigBuffer = Buffer.from(sigItem.sig, "base64");
      const keyId = sigItem.keyid;

      // Find matching key: either by keyId or iterate all trusted keys
      const candidateKeys: string[] = [];
      if (keyId && trustedPublicKeys[keyId]) {
        candidateKeys.push(trustedPublicKeys[keyId]);
      } else {
        // Fallback: test against all trusted corporate keys
        for (const [, keyPem] of availableKeys) {
          candidateKeys.push(keyPem);
        }
      }

      for (const keyPem of candidateKeys) {
        try {
          const pubKeyObj = crypto.createPublicKey(keyPem);
          let verified = false;

          if (pubKeyObj.asymmetricKeyType === "ed25519") {
            verified = crypto.verify(null, payloadBuffer, pubKeyObj, sigBuffer);
          } else {
            verified = crypto.verify("sha256", payloadBuffer, pubKeyObj, sigBuffer);
          }

          if (verified) {
            return { verified: true, keyId: keyId || "trusted-key" };
          }
        } catch {
          // Continue trying next candidate key
        }
      }
    }

    return {
      verified: false,
      error: "Cryptographic signature verification failed: signature does not match trusted keys",
    };
  }

  /**
   * Validates that the in-toto statement contains an attested subject matching the target artifact.
   */
  verifySubject(
    statement: InTotoStatement,
    artifactHash: string,
    payloadSha256?: string,
  ): { matched: boolean; error?: string } {
    if (!statement.subject || !Array.isArray(statement.subject) || statement.subject.length === 0) {
      return { matched: false, error: "In-toto statement contains no subjects" };
    }

    const targetSha = payloadSha256?.toLowerCase();
    const targetHash = artifactHash.toLowerCase();

    for (const sub of statement.subject) {
      const subSha = sub.digest?.sha256?.toLowerCase();
      const subName = sub.name?.toLowerCase();

      // Match 1: Subject digest matches the computed artifact SHA-256
      if (targetSha && subSha === targetSha) {
        return { matched: true };
      }

      // Match 2: Subject digest matches the artifact hash key
      if (subSha && subSha === targetHash) {
        return { matched: true };
      }

      // Match 3: Subject name matches the artifact hash key
      if (subName && (subName === targetHash || subName.endsWith(`/${targetHash}`))) {
        // If subject has sha256 and targetSha is known, verify they match
        if (targetSha && subSha && subSha !== targetSha) {
          return {
            matched: false,
            error: `Subject name matches '${artifactHash}', but attested SHA-256 '${subSha}' does not match actual payload '${targetSha}'`,
          };
        }
        return { matched: true };
      }
    }

    return {
      matched: false,
      error: `Artifact '${artifactHash}' is not present in in-toto attestation subject list`,
    };
  }

  /**
   * Enforces corporate policy gates, cryptographic verification, and checksum integrity.
   */
  evaluatePolicy(options: {
    envelope?: DsseEnvelope | string;
    artifactHash: string;
    payloadSha256: string;
    expectedChecksum?: string;
    policy: CorporateAttestationPolicy;
  }): AttestationVerificationResult {
    const { envelope, artifactHash, payloadSha256, expectedChecksum, policy } = options;
    const violations: string[] = [];

    // 1. Checksum Integrity Enforcement
    if (policy.enforceChecksumMatch !== false) {
      // If expected checksum was explicitly provided (e.g. via header)
      if (expectedChecksum && expectedChecksum.toLowerCase() !== payloadSha256.toLowerCase()) {
        violations.push(
          `CHECKSUM_MISMATCH: Provided checksum '${expectedChecksum}' does not match computed SHA-256 '${payloadSha256}'`,
        );
      }

      // If artifact hash itself is a 64-character hex SHA-256 digest (Poly / Turborepo standard)
      const isSha256Hex = /^[a-fA-F0-9]{64}$/.test(artifactHash);
      if (isSha256Hex && artifactHash.toLowerCase() !== payloadSha256.toLowerCase()) {
        violations.push(
          `CHECKSUM_MISMATCH: Artifact hash '${artifactHash}' does not match computed SHA-256 '${payloadSha256}'`,
        );
      }
    }

    // 2. Attestation Requirement Check
    if (!envelope) {
      if (policy.requireAttestation) {
        violations.push(
          "UNSIGNED_ARTIFACT: Artifact must be cryptographically attested per corporate policy",
        );
        return {
          valid: false,
          signatureVerified: false,
          subjectMatched: false,
          policyPassed: false,
          violations,
          error: "Unsigned artifact rejected by policy",
        };
      }

      // If attestation is not required and none provided, pass as long as checksum matched
      return {
        valid: violations.length === 0,
        signatureVerified: false,
        subjectMatched: false,
        policyPassed: violations.length === 0,
        violations,
      };
    }

    // 3. Envelope Parse & Cryptographic Signature Check
    let parsedEnvelope: DsseEnvelope;
    let statement: InTotoStatement;
    try {
      parsedEnvelope = this.parseEnvelope(envelope);
      statement = this.decodeStatement(parsedEnvelope);
    } catch (e) {
      violations.push(`MALFORMED_ATTESTATION: Failed to parse DSSE envelope: ${String(e)}`);
      return {
        valid: false,
        signatureVerified: false,
        subjectMatched: false,
        policyPassed: false,
        violations,
        error: String(e),
      };
    }

    // Verify cryptographic signature
    const sigResult = this.verifySignature(parsedEnvelope, policy.trustedPublicKeys);
    if (!sigResult.verified) {
      violations.push(`SIGNATURE_VERIFICATION_FAILED: ${sigResult.error}`);
    }

    // 4. In-toto Subject Verification
    let subjectMatched = true;
    if (policy.enforceSubjectMatch !== false) {
      const subResult = this.verifySubject(statement, artifactHash, payloadSha256);
      if (!subResult.matched) {
        subjectMatched = false;
        violations.push(`SUBJECT_MISMATCH: ${subResult.error}`);
      }
    }

    // 5. Corporate Policy Gates (SLSA Predicate inspection)
    const sysParams = statement.predicate?.buildDefinition?.systemParameters;
    const builder = statement.predicate?.runDetails?.builder;

    const ciRunner = sysParams?.ciRunner;
    const arch = sysParams?.arch;
    const platform = sysParams?.platform;
    const builderId = builder?.id;

    // Allowed CI Runners Policy
    if (
      policy.allowedRunners &&
      policy.allowedRunners.length > 0 &&
      (!ciRunner || !policy.allowedRunners.includes(ciRunner))
    ) {
      violations.push(
        `UNAPPROVED_RUNNER: Runner '${ciRunner || "unknown"}' is not in approved list [${policy.allowedRunners.join(", ")}]`,
      );
    }

    // Allowed Architecture Policy
    if (
      policy.allowedArchitectures &&
      policy.allowedArchitectures.length > 0 &&
      (!arch || !policy.allowedArchitectures.includes(arch))
    ) {
      violations.push(
        `UNAPPROVED_ARCH: Architecture '${arch || "unknown"}' is not in approved list [${policy.allowedArchitectures.join(", ")}]`,
      );
    }

    // Allowed Platform Policy
    if (
      policy.allowedPlatforms &&
      policy.allowedPlatforms.length > 0 &&
      (!platform || !policy.allowedPlatforms.includes(platform))
    ) {
      violations.push(
        `UNAPPROVED_PLATFORM: Platform '${platform || "unknown"}' is not in approved list [${policy.allowedPlatforms.join(", ")}]`,
      );
    }

    // Allowed Builders Policy
    if (
      policy.allowedBuilders &&
      policy.allowedBuilders.length > 0 &&
      (!builderId || !policy.allowedBuilders.includes(builderId))
    ) {
      violations.push(
        `UNAPPROVED_BUILDER: Builder '${builderId || "unknown"}' is not in approved list [${policy.allowedBuilders.join(", ")}]`,
      );
    }

    const isValid = violations.length === 0;

    return {
      valid: isValid,
      signatureVerified: sigResult.verified,
      subjectMatched,
      policyPassed: isValid,
      signerKeyId: sigResult.keyId,
      statement,
      builderId,
      ciRunner,
      violations,
      error: isValid ? undefined : violations.join("; "),
    };
  }

  /**
   * Helper: Generate a cryptographic Ed25519 or RSA keypair in SPKI/PKCS8 PEM format.
   */
  generateKeyPair(type: "ed25519" | "rsa" = "ed25519"): {
    privateKey: string;
    publicKey: string;
  } {
    if (type === "ed25519") {
      const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519", {
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" },
      });
      return { privateKey, publicKey };
    }

    const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });
    return { privateKey, publicKey };
  }

  /**
   * Helper: Construct an in-toto SLSA Provenance v1.0 Statement.
   */
  createAttestationStatement(options: {
    subjects: Array<{ name: string; sha256: string }>;
    builderId?: string;
    builderVersion?: string;
    ciRunner?: string;
    platform?: string;
    arch?: string;
    gitCommit?: string;
    gitBranch?: string;
  }): InTotoStatement {
    const now = new Date().toISOString();
    const subjectList: InTotoSubject[] = options.subjects.map((s) => ({
      name: s.name,
      digest: { sha256: s.sha256 },
    }));

    return {
      _type: "https://in-toto.io/Statement/v1",
      subject: subjectList,
      predicateType: "https://slsa.dev/provenance/v1",
      predicate: {
        buildDefinition: {
          buildType: "https://ritualdev.in/poly/slsa/v1",
          systemParameters: {
            platform: options.platform || process.platform,
            arch: options.arch || process.arch,
            nodeVersion: process.version,
            gitCommit: options.gitCommit,
            gitBranch: options.gitBranch,
            ciRunner: options.ciRunner || (process.env.GITHUB_ACTIONS ? "GitHub Actions" : "local"),
          },
        },
        runDetails: {
          builder: {
            id: options.builderId || "https://github.com/RitualDev-Lab/poly",
            version: options.builderVersion || "0.5.0",
          },
          metadata: {
            invocationId: crypto.randomUUID(),
            startedOn: now,
            finishedOn: now,
          },
        },
      },
    };
  }

  /**
   * Helper: Sign an in-toto statement with an Ed25519 or RSA private key into a DSSE envelope.
   */
  signStatement(
    statement: InTotoStatement,
    privateKeyPem: string,
    keyId = "poly-attest-key-1",
  ): DsseEnvelope {
    const payloadStr = JSON.stringify(statement);
    const payloadBuffer = Buffer.from(payloadStr, "utf-8");
    const payloadBase64 = payloadBuffer.toString("base64");

    const keyObj = crypto.createPrivateKey(privateKeyPem);
    let signatureBuffer: Buffer;
    if (keyObj.asymmetricKeyType === "ed25519") {
      signatureBuffer = crypto.sign(null, payloadBuffer, keyObj);
    } else {
      signatureBuffer = crypto.sign("sha256", payloadBuffer, keyObj);
    }

    return {
      payloadType: "application/vnd.in-toto+json",
      payload: payloadBase64,
      signatures: [
        {
          keyid: keyId,
          sig: signatureBuffer.toString("base64"),
        },
      ],
    };
  }
}
