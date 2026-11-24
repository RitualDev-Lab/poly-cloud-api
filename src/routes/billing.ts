import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import * as crypto from "node:crypto";
import type { PolyCloudConfig } from "../config.js";
import type { MetadataStore, WorkspaceTier } from "../metadata/types.js";
import { TIER_CONFIGS } from "../billing/types.js";

export interface BillingRouteOptions {
  store: MetadataStore;
  config: PolyCloudConfig;
  dodoWebhookSecret?: string;
}

export async function registerBillingRoutes(
  app: FastifyInstance,
  options: BillingRouteOptions,
): Promise<void> {
  const { store, config } = options;
  const webhookSecret = options.dodoWebhookSecret || process.env.DODO_WEBHOOK_SECRET;
  const processedWebhookEvents = new Set<string>();

  // 1. GET /api/v1/billing/tiers - Public listing of cache storage tiers & pricing
  app.get("/api/v1/billing/tiers", async (_request, reply) => {
    return reply.code(200).send({
      success: true,
      service: "Poly Remote Cloud Cache Tiering",
      tiers: TIER_CONFIGS,
    });
  });

  // 2. POST /api/v1/billing/checkout - Generate Dodo Payments checkout session for workspace upgrade
  app.post<{
    Body: {
      workspaceSlug: string;
      tier: "pro" | "enterprise";
      email?: string;
      returnUrl?: string;
    };
  }>("/api/v1/billing/checkout", async (request, reply) => {
    const { workspaceSlug, tier, email, returnUrl } = request.body || {};

    if (!workspaceSlug) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "workspaceSlug is required to initiate an upgrade checkout",
      });
    }

    if (!tier || !["pro", "enterprise"].includes(tier)) {
      return reply.code(400).send({
        error: "Bad Request",
        message: "tier must be either 'pro' or 'enterprise'",
      });
    }

    const ws = await store.getWorkspaceBySlug(workspaceSlug);
    if (!ws) {
      return reply.code(404).send({
        error: "Not Found",
        message: `Workspace '${workspaceSlug}' not found`,
      });
    }

    const tierConfig = TIER_CONFIGS[tier];
    const callback = returnUrl || "https://poly.ritualdev.in/dashboard?upgrade=success";
    const checkoutUrl = `${tierConfig.checkoutUrl}?quantity=1&metadata.workspace=${encodeURIComponent(
      workspaceSlug,
    )}&metadata.tier=${tier}${email ? `&email=${encodeURIComponent(email)}` : ""}&return_url=${encodeURIComponent(
      callback,
    )}`;

    return reply.code(200).send({
      success: true,
      workspaceSlug,
      tier,
      productId: tierConfig.dodoProductId,
      priceMonthlyUsd: tierConfig.priceMonthlyUsd,
      quotaBytes: tierConfig.quotaBytes,
      quotaLabel: tierConfig.quotaLabel,
      checkoutUrl,
    });
  });

  // 3. GET /api/v1/workspaces/:slug/billing - Detailed workspace billing status & usage
  app.get<{ Params: { slug: string } }>(
    "/api/v1/workspaces/:slug/billing",
    async (request, reply) => {
      const slug = request.params.slug;
      const ws = await store.getWorkspaceBySlug(slug);

      if (!ws) {
        return reply.code(404).send({
          error: "Not Found",
          message: `Workspace '${slug}' not found`,
        });
      }

      const stats = await store.getWorkspaceStats(slug);
      const tier: WorkspaceTier = ws.tier || "free";
      const currentTierConfig = TIER_CONFIGS[tier];

      return reply.code(200).send({
        workspaceSlug: ws.slug,
        name: ws.name,
        tier,
        tierName: currentTierConfig.name,
        priceMonthlyUsd: currentTierConfig.priceMonthlyUsd,
        quotaBytes: ws.quotaBytes,
        quotaLabel: currentTierConfig.quotaLabel,
        usedBytes: stats.totalSizeBytes,
        usedPercent: stats.quotaUsedPercent,
        subscriptionId: ws.subscriptionId,
        subscriptionStatus: ws.subscriptionStatus || "none",
        subscriptionExpiresAt: ws.subscriptionExpiresAt,
        upgradeAvailable: tier === "free" ? ["pro", "enterprise"] : tier === "pro" ? ["enterprise"] : [],
      });
    },
  );

  // 4. POST /api/v1/billing/webhooks/dodo - Dodo Payments subscription webhook processor
  app.post("/api/v1/billing/webhooks/dodo", async (request, reply) => {
    const webhookSecret = options.dodoWebhookSecret || process.env.DODO_WEBHOOK_SECRET;

    // Cryptographic signature check (Fail-closed)
    const sigHeader =
      (request.headers["webhook-signature"] as string) ||
      (request.headers["x-dodo-signature"] as string) ||
      (request.headers["signature"] as string);

    if (!webhookSecret) {
      return reply.code(500).send({
        error: "Configuration Error",
        message: "DODO_WEBHOOK_SECRET is not configured on server",
      });
    }

    if (!sigHeader) {
      return reply.code(401).send({
        error: "Unauthorized",
        message: "Missing webhook signature header",
      });
    }

    // Raw body validation
    const rawBody =
      typeof request.body === "string"
        ? request.body
        : Buffer.isBuffer(request.body)
          ? request.body.toString("utf-8")
          : JSON.stringify(request.body);

    const sigParts = sigHeader.includes("v1=") ? sigHeader.split(",") : [sigHeader];
    let signatureToCompare = sigHeader.replace(/^sha256=/, "").trim();
    for (const part of sigParts) {
      const [k, v] = part.trim().split("=");
      if (k === "v1") signatureToCompare = v;
    }

    try {
      const computedHex = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
      const sigBuf = Buffer.from(signatureToCompare, "hex");
      const compBuf = Buffer.from(computedHex, "hex");

      if (sigBuf.length !== compBuf.length || !crypto.timingSafeEqual(sigBuf, compBuf)) {
        return reply.code(401).send({
          error: "Unauthorized",
          message: "Invalid Dodo Payments signature",
        });
      }
    } catch (err: any) {
      return reply.code(401).send({
        error: "Unauthorized",
        message: `Signature verification failed: ${err.message}`,
      });
    }

    const payload = (typeof request.body === "object" ? request.body : JSON.parse(rawBody)) as any;
    const eventType = payload.type || payload.event_type;
    const data = payload.data || {};

    // Replay attack defense
    const eventId =
      payload.id ||
      payload.event_id ||
      (data.payment_id ? `${eventType}_${data.payment_id}` : undefined) ||
      (data.subscription_id ? `${eventType}_${data.subscription_id}` : undefined);
    if (eventId) {
      if (processedWebhookEvents.has(eventId)) {
        return reply.code(409).send({
          error: "Conflict",
          message: `Duplicate webhook event detected: ${eventId} (replay rejected)`,
        });
      }
      processedWebhookEvents.add(eventId);
    }

    // Extract workspace identifier
    const meta = data.metadata || {};
    const customerMeta = data.customer?.metadata || {};
    const workspaceSlug =
      meta.workspace ||
      meta.workspaceSlug ||
      meta.workspace_slug ||
      customerMeta.workspace ||
      customerMeta.workspaceSlug;

    if (!workspaceSlug) {
      return reply.code(422).send({
        error: "Unprocessable Entity",
        message: "Missing required 'workspace' in checkout metadata",
      });
    }

    const ws = await store.getWorkspaceBySlug(workspaceSlug);
    if (!ws) {
      return reply.code(404).send({
        error: "Not Found",
        message: `Target workspace '${workspaceSlug}' does not exist`,
      });
    }

    // Handle fulfillment: upgrade workspace on payment.succeeded / subscription.active
    if (
      eventType === "payment.succeeded" ||
      eventType === "subscription.active" ||
      eventType === "subscription.renewed"
    ) {
      const rawTier = (meta.tier || "pro").toLowerCase();
      const targetTier: WorkspaceTier = ["pro", "enterprise"].includes(rawTier)
        ? (rawTier as WorkspaceTier)
        : "pro";
      const targetConfig = TIER_CONFIGS[targetTier];

      let expiresAt: string;
      if (data.next_billing_date) {
        expiresAt = new Date(data.next_billing_date).toISOString();
      } else {
        expiresAt = new Date(Date.now() + 31 * 86400 * 1000).toISOString();
      }

      await store.updateWorkspace(ws.id, {
        tier: targetTier,
        quotaBytes: targetConfig.quotaBytes,
        defaultTtlSeconds: targetConfig.defaultTtlSeconds,
        subscriptionId: data.subscription_id || data.payment_id,
        subscriptionStatus: "active",
        subscriptionExpiresAt: expiresAt,
      });

      return reply.code(200).send({
        success: true,
        event: eventType,
        workspaceSlug,
        tier: targetTier,
        quotaBytes: targetConfig.quotaBytes,
        message: `Successfully upgraded workspace '${workspaceSlug}' to ${targetConfig.name} (${targetConfig.quotaLabel})`,
      });
    }

    // Handle cancellation / refund: downgrade back to free tier
    if (eventType === "subscription.cancelled" || eventType === "payment.refunded") {
      const freeConfig = TIER_CONFIGS.free;
      await store.updateWorkspace(ws.id, {
        tier: "free",
        quotaBytes: freeConfig.quotaBytes,
        defaultTtlSeconds: freeConfig.defaultTtlSeconds,
        subscriptionStatus: "cancelled",
      });

      return reply.code(200).send({
        success: true,
        event: eventType,
        workspaceSlug,
        tier: "free",
        quotaBytes: freeConfig.quotaBytes,
        message: `Downgraded workspace '${workspaceSlug}' to Free Tier (${freeConfig.quotaLabel})`,
      });
    }

    return reply.code(200).send({
      success: true,
      event: eventType,
      message: `Event '${eventType}' acknowledged without state modification`,
    });
  });
}
