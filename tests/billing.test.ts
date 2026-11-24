import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { MemoryMetadataStore } from "../src/metadata/store.js";
import { createPolyCloudServer } from "../src/server.js";
import { MemoryStorage } from "../src/storage/memory.js";

test("Poly Remote Cloud Cache Tiering & Billing Suite", async (t) => {
  const webhookSecret = "whsec_poly_cloud_test_secret_123456";
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

  // Setup workspace with a low 500-byte quota to test paywall / quota limits
  const lowQuotaWs = await store.ensureWorkspace("startup-team", "Startup Team", 500, "free");
  const { rawToken: writeToken } = await store.createToken({
    workspaceId: lowQuotaWs.id,
    name: "team-ci-writer",
    role: "write",
  });

  await t.test("GET /api/v1/billing/tiers returns tier definitions and pricing", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/billing/tiers",
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.success, true);
    assert.ok(body.tiers.free);
    assert.ok(body.tiers.pro);
    assert.ok(body.tiers.enterprise);
    assert.equal(body.tiers.pro.priceMonthlyUsd, 29);
    assert.equal(body.tiers.pro.quotaLabel, "50 GB");
  });

  await t.test("POST /api/v1/billing/checkout generates Dodo checkout link", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/billing/checkout",
      payload: {
        workspaceSlug: "startup-team",
        tier: "pro",
        email: "lead@startup.io",
      },
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.success, true);
    assert.equal(body.workspaceSlug, "startup-team");
    assert.equal(body.tier, "pro");
    assert.ok(body.checkoutUrl.includes("checkout.dodopayments.com"));
    assert.ok(body.checkoutUrl.includes("metadata.workspace=startup-team"));
    assert.ok(body.checkoutUrl.includes("metadata.tier=pro"));
    assert.ok(body.checkoutUrl.includes("email=lead%40startup.io"));
  });

  await t.test("PUT /v8/artifacts/:hash returns 402 Payment Required when quota is exceeded", async () => {
    // Artifact size is 600 bytes, which exceeds the 500-byte quota
    const artifactPayload = Buffer.alloc(600, "x");
    const res = await app.inject({
      method: "PUT",
      url: "/v8/artifacts/oversized-hash?team=startup-team",
      headers: {
        authorization: `Bearer ${writeToken}`,
        "content-type": "application/octet-stream",
        "content-length": "600",
      },
      payload: artifactPayload,
    });

    assert.equal(res.statusCode, 402);
    assert.ok(res.headers["x-poly-upgrade-url"]);
    const body = JSON.parse(res.body);
    assert.equal(body.error, "Payment Required");
    assert.equal(body.code, "QUOTA_EXCEEDED");
    assert.equal(body.tier, "free");
    assert.ok(body.upgradeUrl.includes("checkout.dodopayments.com"));
  });

  await t.test("POST /api/v1/billing/webhooks/dodo enforces signature and upgrades workspace to Pro", async () => {
    process.env.DODO_WEBHOOK_SECRET = webhookSecret;

    const payload = {
      event_id: "evt_sub_active_101",
      type: "subscription.active",
      data: {
        subscription_id: "sub_dodo_live_999",
        product_id: "pdt_0NpjONNytUpW7gzjoDlYW",
        metadata: {
          workspace: "startup-team",
          tier: "pro",
        },
      },
    };

    const rawBody = JSON.stringify(payload);
    const sig = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/billing/webhooks/dodo",
      headers: {
        "webhook-signature": `sha256=${sig}`,
        "content-type": "application/json",
      },
      payload,
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.success, true);
    assert.equal(body.tier, "pro");
    assert.equal(body.quotaBytes, 50 * 1024 * 1024 * 1024);

    // Verify workspace in store is now Pro
    const ws = await store.getWorkspaceBySlug("startup-team");
    assert.equal(ws?.tier, "pro");
    assert.equal(ws?.quotaBytes, 50 * 1024 * 1024 * 1024);
    assert.equal(ws?.subscriptionStatus, "active");

    // Upload the 600-byte artifact again: now it must succeed on the 50 GB Pro tier!
    const artifactPayload = Buffer.alloc(600, "x");
    const uploadRes = await app.inject({
      method: "PUT",
      url: "/v8/artifacts/oversized-hash?team=startup-team",
      headers: {
        authorization: `Bearer ${writeToken}`,
        "content-type": "application/octet-stream",
        "content-length": "600",
      },
      payload: artifactPayload,
    });

    assert.equal(uploadRes.statusCode, 200);
    const uploadBody = JSON.parse(uploadRes.body);
    assert.equal(uploadBody.status, "stored");
  });

  await t.test("GET /api/v1/workspaces/:slug/billing reports active Pro status", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/workspaces/startup-team/billing",
    });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.workspaceSlug, "startup-team");
    assert.equal(body.tier, "pro");
    assert.equal(body.priceMonthlyUsd, 29);
    assert.equal(body.subscriptionStatus, "active");
    assert.ok(body.usedBytes >= 600);
  });

  await t.test("POST /api/v1/billing/webhooks/dodo downgrades workspace on subscription.cancelled", async () => {
    const payload = {
      event_id: "evt_sub_cancel_102",
      type: "subscription.cancelled",
      data: {
        subscription_id: "sub_dodo_live_999",
        metadata: {
          workspace: "startup-team",
        },
      },
    };

    const rawBody = JSON.stringify(payload);
    const sig = crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/billing/webhooks/dodo",
      headers: {
        "webhook-signature": `sha256=${sig}`,
        "content-type": "application/json",
      },
      payload,
    });

    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.tier, "free");
    assert.equal(body.quotaBytes, 1024 * 1024 * 1024);

    const ws = await store.getWorkspaceBySlug("startup-team");
    assert.equal(ws?.tier, "free");
    assert.equal(ws?.subscriptionStatus, "cancelled");
  });
});
