import type { WorkspaceTier } from "../metadata/types.js";

export interface TierConfig {
  tier: WorkspaceTier;
  name: string;
  priceMonthlyUsd: number;
  quotaBytes: number;
  quotaLabel: string;
  maxArtifactSizeBytes: number;
  defaultTtlSeconds: number;
  dodoProductId?: string;
  checkoutUrl?: string;
  features: string[];
}

export const TIER_CONFIGS: Record<WorkspaceTier, TierConfig> = {
  free: {
    tier: "free",
    name: "Developer Free Tier",
    priceMonthlyUsd: 0,
    quotaBytes: 1 * 1024 * 1024 * 1024, // 1 GB
    quotaLabel: "1 GB",
    maxArtifactSizeBytes: 100 * 1024 * 1024, // 100 MB
    defaultTtlSeconds: 7 * 86400, // 7 days
    features: [
      "1 GB remote build cache storage",
      "Turborepo & Poly CLI protocol support",
      "7-day cache retention",
      "Community GitHub support"
    ]
  },
  pro: {
    tier: "pro",
    name: "Pro Team Cloud Cache",
    priceMonthlyUsd: 29,
    quotaBytes: 50 * 1024 * 1024 * 1024, // 50 GB
    quotaLabel: "50 GB",
    maxArtifactSizeBytes: 500 * 1024 * 1024, // 500 MB
    defaultTtlSeconds: 30 * 86400, // 30 days
    dodoProductId: "pdt_0NpjONNytUpW7gzjoDlYW",
    checkoutUrl: "https://checkout.dodopayments.com/buy/pdt_0NpjONNytUpW7gzjoDlYW",
    features: [
      "50 GB high-speed global remote cache",
      "30-day cache retention with deduplication",
      "GitHub Actions OIDC zero-secret authentication",
      "Sub-15ms cache hits via Cloudflare R2 / S3",
      "Priority developer support"
    ]
  },
  enterprise: {
    tier: "enterprise",
    name: "Enterprise Dedicated Cloud",
    priceMonthlyUsd: 199,
    quotaBytes: 500 * 1024 * 1024 * 1024, // 500 GB
    quotaLabel: "500 GB",
    maxArtifactSizeBytes: 2 * 1024 * 1024 * 1024, // 2 GB
    defaultTtlSeconds: 90 * 86400, // 90 days
    dodoProductId: "pdt_0NrFSmrXT8zU2u5BKGJ7y",
    checkoutUrl: "https://checkout.dodopayments.com/buy/pdt_0NrFSmrXT8zU2u5BKGJ7y",
    features: [
      "500 GB dedicated enterprise cache",
      "90-day retention with LRU watermark auto-eviction",
      "Cryptographic SLSA Provenance & Ed25519 in-toto verification",
      "Role-Based Team Tokens & SSO Integration",
      "99.99% uptime SLA"
    ]
  }
};
