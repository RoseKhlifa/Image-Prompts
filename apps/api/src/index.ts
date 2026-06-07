import { serve } from "@hono/node-server";
import { env } from "./env.ts";
import { setupProxyDispatcher } from "./lib/proxy.ts";
import { createServer } from "./server.ts";

// Install proxy dispatcher BEFORE createServer / any auth module loads, so the
// first OAuth discovery fetch from Auth.js already goes through the proxy.
setupProxyDispatcher();

const app = createServer();

serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, (info) => {
  console.log(`✓ Image-Prompts API running on http://${info.address}:${info.port}`);
});

const shutdown = (signal: string) => {
  console.log(`\n[${signal}] shutting down...`);
  process.exit(0);
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
