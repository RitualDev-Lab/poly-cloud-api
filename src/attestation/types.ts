export interface InTotoSubject {
  name: string;
  digest: {
    sha256: string;
  };
}

export interface SlsaProvenancePredicate {
  buildDefinition: {
    buildType: string;
    externalParameters?: {
      workspaceDir?: string;
      configHash?: string;
      lockfileHash?: string;
      ecosystems?: string[];
    };
    systemParameters: {
      platform?: string;
      arch?: string;
      nodeVersion?: string;
      gitCommit?: string;
      gitBranch?: string;
      ciRunner?: string;
    };
    resolvedDependencies?: Array<{
      uri: string;
      digest: { sha256?: string };
    }>;
  };
  runDetails: {
    builder: {
      id: string;
      version?: string;
    };
    metadata?: {
      invocationId?: string;
      startedOn?: string;
      finishedOn?: string;
    };
    byproducts?: Array<{
      name: string;
      contentHash: string;
    }>;
  };
}

export interface InTotoStatement {
  _type: "https://in-toto.io/Statement/v1";
  subject: InTotoSubject[];
  predicateType: "https://slsa.dev/provenance/v1";
  predicate: SlsaProvenancePredicate;
}

export interface DsseEnvelope {
  payloadType: "application/vnd.in-toto+json" | string;
  payload: string; // Base64 encoded UTF-8 JSON of InTotoStatement
  signatures: Array<{
    keyid: string;
    sig: string; // Base64 encoded signature
  }>;
}

export interface CorporateAttestationPolicy {
  /** If true, unsigned artifacts are strictly forbidden */
  requireAttestation: boolean;
  /** Map of keyId -> SPKI PEM or raw PEM strings trusted by the corporate policy */
  trustedPublicKeys: Record<string, string>;
  /** Approved CI runner environments (e.g. ["GitHub Actions", "GitLab CI"]) */
  allowedRunners?: string[];
  /** Approved CPU architectures (e.g. ["x64", "arm64"]) */
  allowedArchitectures?: string[];
  /** Approved OS platforms (e.g. ["linux", "darwin", "win32"]) */
  allowedPlatforms?: string[];
  /** Approved builder IDs (e.g. ["https://github.com/RitualDev-Lab/poly"]) */
  allowedBuilders?: string[];
  /** Whether to strictly enforce SHA-256 match between subject digest and artifact */
  enforceSubjectMatch?: boolean;
  /** Whether to enforce payload SHA-256 digest against artifact hash */
  enforceChecksumMatch?: boolean;
}

export interface AttestationVerificationResult {
  valid: boolean;
  signatureVerified: boolean;
  subjectMatched: boolean;
  policyPassed: boolean;
  signerKeyId?: string;
  statement?: InTotoStatement;
  builderId?: string;
  ciRunner?: string;
  violations: string[];
  error?: string;
}

export interface ArtifactAttestationRecord {
  hash: string;
  workspaceId: string;
  isAttested: boolean;
  attestationVerified: boolean;
  signerKeyId?: string;
  builderId?: string;
  ciRunner?: string;
  platform?: string;
  arch?: string;
  statement?: InTotoStatement;
  envelope?: DsseEnvelope;
  verifiedAt: string;
}
