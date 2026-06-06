import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { env } from "./env.ts";
import { errorHandler } from "./middleware/error.ts";
import healthRoute from "./routes/health.ts";
import promptsRoute from "./routes/prompts.ts";
import categoriesRoute from "./routes/categories.ts";
import tagsRoute from "./routes/tags.ts";
import publicRoute from "./routes/public.ts";

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
  app.route("/api/prompts", promptsRoute);
  app.route("/api/categories", categoriesRoute);
  app.route("/api/tags", tagsRoute);
  app.route("/api/public", publicRoute);

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError(errorHandler);

  return app;
}
