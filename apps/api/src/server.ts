import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { env } from "./env.ts";
import { errorHandler } from "./middleware/error.ts";
import healthRoute from "./routes/health.ts";

export function createServer() {
  const app = new Hono();

  app.use("*", logger());
  app.use("*", secureHeaders());
  app.use(
    "*",
    cors({
      origin: [env.SITE_URL],
      credentials: true,
      allowHeaders: ["Content-Type", "Authorization", "X-Locale"],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  app.route("/api/health", healthRoute);

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError(errorHandler);

  return app;
}
