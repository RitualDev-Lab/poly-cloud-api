import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

test("Kubernetes Helm Chart (charts/poly-cloud-api)", async (t) => {
  const chartDir = path.resolve("charts", "poly-cloud-api");
  const templatesDir = path.join(chartDir, "templates");

  await t.test("Chart.yaml contains valid metadata", () => {
    const chartYamlPath = path.join(chartDir, "Chart.yaml");
    assert.ok(fs.existsSync(chartYamlPath), "Chart.yaml must exist");

    const content = fs.readFileSync(chartYamlPath, "utf8");
    assert.match(content, /apiVersion:\s*v2/);
    assert.match(content, /name:\s*poly-cloud-api/);
    assert.match(content, /version:\s*[0-9]+\.[0-9]+\.[0-9]+/);
    assert.match(content, /appVersion:\s*"[0-9]+\.[0-9]+\.[0-9]+"/);
  });

  await t.test("values.yaml provides comprehensive enterprise defaults", () => {
    const valuesPath = path.join(chartDir, "values.yaml");
    assert.ok(fs.existsSync(valuesPath), "values.yaml must exist");

    const content = fs.readFileSync(valuesPath, "utf8");
    // Core parameters
    assert.match(content, /replicaCount:\s*\d+/);
    assert.match(content, /repository:\s*ghcr\.io\/ritualdev-lab\/poly-cloud-api/);

    // Autoscaling & HPA
    assert.match(content, /autoscaling:/);
    assert.match(content, /minReplicas:\s*\d+/);
    assert.match(content, /maxReplicas:\s*\d+/);

    // Ingress & TLS
    assert.match(content, /ingress:/);
    assert.match(content, /cert-manager\.io\/cluster-issuer/);

    // Prometheus ServiceMonitor
    assert.match(content, /serviceMonitor:/);
    assert.match(content, /path:\s*\/api\/v1\/metrics/);

    // Storage backends (S3, R2, MinIO)
    assert.match(content, /storageBackend:\s*"s3"/);
    assert.match(content, /s3:/);
    assert.match(content, /bucket:/);

    // Direct presigned URLs
    assert.match(content, /presignedUrls:/);

    // OIDC auth
    assert.match(content, /oidc:/);

    // Optimizer & LRU auto-eviction
    assert.match(content, /optimizer:/);
    assert.match(content, /autoEvictionEnabled:\s*true/);
    assert.match(content, /deduplicationEnabled:\s*true/);
  });

  await t.test("Templates exist and have valid syntax balance", () => {
    const expectedTemplates = [
      "_helpers.tpl",
      "deployment.yaml",
      "service.yaml",
      "serviceaccount.yaml",
      "configmap.yaml",
      "secret.yaml",
      "hpa.yaml",
      "ingress.yaml",
      "servicemonitor.yaml",
      "pvc.yaml",
      "NOTES.txt",
    ];

    for (const file of expectedTemplates) {
      const templatePath = path.join(templatesDir, file);
      assert.ok(fs.existsSync(templatePath), `Template ${file} must exist`);

      const content = fs.readFileSync(templatePath, "utf8");
      assert.ok(content.length > 0, `Template ${file} must not be empty`);

      // Verify template braces balance: number of {{ must equal number of }}
      const openBraces = (content.match(/\{\{/g) || []).length;
      const closeBraces = (content.match(/\}\}/g) || []).length;
      assert.equal(openBraces, closeBraces, `Template ${file} has unbalanced Helm template braces`);
    }
  });

  await t.test("Deployment template includes health probes and security context", () => {
    const deploymentPath = path.join(templatesDir, "deployment.yaml");
    const content = fs.readFileSync(deploymentPath, "utf8");

    assert.match(content, /kind:\s*Deployment/);
    assert.match(content, /livenessProbe:/);
    assert.match(content, /readinessProbe:/);
    assert.match(content, /startupProbe:/);
    assert.match(content, /securityContext:/);
    assert.match(content, /configMapRef:/);
  });

  await t.test("HPA template targets autoscaling/v2", () => {
    const hpaPath = path.join(templatesDir, "hpa.yaml");
    const content = fs.readFileSync(hpaPath, "utf8");

    assert.match(content, /apiVersion:\s*autoscaling\/v2/);
    assert.match(content, /kind:\s*HorizontalPodAutoscaler/);
    assert.match(content, /scaleTargetRef:/);
  });

  await t.test("ServiceMonitor template targets Prometheus Operator", () => {
    const smPath = path.join(templatesDir, "servicemonitor.yaml");
    const content = fs.readFileSync(smPath, "utf8");

    assert.match(content, /apiVersion:\s*monitoring\.coreos\.com\/v1/);
    assert.match(content, /kind:\s*ServiceMonitor/);
  });
});
