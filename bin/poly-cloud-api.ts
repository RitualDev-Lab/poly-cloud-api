#!/usr/bin/env node
import { loadConfig } from "../src/config.js";
import { createPolyCloudServer } from "../src/server.js";

const VERSION = "0.1.0";

const HELP = `
Poly Cloud API - Enterprise Remote Cache & Analytics Server (v${VERSION})

USAGE:
  poly-cloud-api [command] [options]

COMMANDS:
  start                     Start the remote cache server (default)
  health                    Probe server health
  help, --help, -h          Show this help message
  version, --version, -v    Show version number

OPTIONS (start):
  --port, -p <number>       Port to listen on (default: 8080 or PORT env)
  --host <string>           Host interface to bind to (default: 0.0.0.0)
  --storage, -s <backend>   Storage engine: 'local', 's3', or 'memory' (default: local)
  --storage-dir <path>      Directory for local disk storage (default: ./data/artifacts)
  --db-path <path>          Path to SQLite metadata database (default: ./data/metadata.sqlite)
  --no-auth                 Disable API token authentication
  --admin-token <token>     Master cluster admin token (default: env or auto-generated)

EXAMPLES:
  $ poly-cloud-api start --port 8080 --storage local
  $ poly-cloud-api start --storage s3 --port 8080
  $ poly-cloud-api health
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] || "start";

  if (command === "-v" || command === "--version" || command === "version") {
    console.log(`poly-cloud-api v${VERSION}`);
    process.exit(0);
  }

  if (command === "-h" || command === "--help" || command === "help") {
    console.log(HELP);
    process.exit(0);
  }

  // Parse flags
  const getFlag = (flags: string[]): string | undefined => {
    for (let i = 0; i < args.length; i++) {
      if (flags.includes(args[i]) && args[i + 1]) {
        return args[i + 1];
      }
    }
    return undefined;
  };

  const hasFlag = (flags: string[]): boolean => {
    return args.some((a) => flags.includes(a));
  };

  if (command === "health") {
    const port = Number.parseInt(getFlag(["--port", "-p"]) || process.env.PORT || "8080", 10);
    const host = getFlag(["--host"]) || "127.0.0.1";
    try {
      const res = await fetch(`http://${host}:${port}/api/v1/health`);
      if (res.ok) {
        const body = await res.json();
        console.log("poly-cloud-api is HEALTHY:");
        console.log(JSON.stringify(body, null, 2));
        process.exit(0);
      } else {
        console.error(`poly-cloud-api is UNHEALTHY (HTTP ${res.status})`);
        process.exit(1);
      }
    } catch (err: unknown) {
      console.error(`Failed to connect to poly-cloud-api: ${(err as Error).message}`);
      process.exit(1);
    }
  }

  if (command === "start" || !command.startsWith("-")) {
    const config = loadConfig({
      port: getFlag(["--port", "-p"]) ? Number.parseInt(getFlag(["--port", "-p"])!, 10) : undefined,
      host: getFlag(["--host"]),
      storageBackend: getFlag(["--storage", "-s"]) as "local" | "s3" | "memory" | undefined,
      storageLocalDir: getFlag(["--storage-dir"]),
      metadataDbPath: getFlag(["--db-path"]),
      authEnabled: hasFlag(["--no-auth"]) ? false : undefined,
      defaultAdminToken: getFlag(["--admin-token"]),
    });

    console.log("\n========================================================");
    console.log(`  🚀 Poly Cloud Remote Cache Server v${VERSION}`);
    console.log("========================================================");
    console.log(`  • Storage Backend : ${config.storageBackend.toUpperCase()}`);
    if (config.storageBackend === "local") {
      console.log(`  • Storage Dir     : ${config.storageLocalDir}`);
    } else if (config.storageBackend === "s3") {
      console.log(`  • S3 Bucket       : ${config.s3.bucket} (${config.s3.region})`);
      if (config.s3.endpoint) console.log(`  • S3 Endpoint     : ${config.s3.endpoint}`);
    }
    console.log(`  • Auth Enabled    : ${config.authEnabled ? "YES (Bearer Token)" : "NO"}`);
    console.log(`  • Admin Token     : ${config.defaultAdminToken}`);
    console.log(`  • Default Team    : ${config.defaultWorkspace}`);
    console.log(
      `  • Max Artifact    : ${Math.round(config.maxArtifactSizeBytes / 1024 / 1024)} MB`,
    );
    console.log("========================================================\n");

    const server = await createPolyCloudServer(config);
    const address = await server.start();
    console.log(`✅ Server listening on ${address}`);
    console.log(`🖥️  Web Dashboard:          ${address}/dashboard`);
    console.log(`📊 Health check endpoint:   ${address}/api/v1/health`);
    console.log(`📈 Metrics endpoint:        ${address}/api/v1/metrics`);
    console.log(`⚡ Turborepo cache endpoint: ${address}/v8/artifacts/:hash\n`);

    const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
    for (const signal of signals) {
      process.on(signal, async () => {
        console.log(`\nReceived ${signal}, shutting down gracefully...`);
        await server.stop();
        console.log("poly-cloud-api stopped cleanly.");
        process.exit(0);
      });
    }
  }
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
