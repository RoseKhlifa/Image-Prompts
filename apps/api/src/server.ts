import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { authHandler } from "@hono/auth-js";
import { authConfig } from "./auth/index.ts";
import { env } from "./env.ts";
import { errorHandler } from "./middleware/error.ts";
import healthRoute from "./routes/health.ts";
import promptsRoute from "./routes/prompts.ts";
import categoriesRoute from "./routes/categories.ts";
import tagsRoute from "./routes/tags.ts";
import publicRoute from "./routes/public.ts";
import importTokensRoute from "./routes/import-tokens.ts";
import interactionsRoute from "./routes/interactions.ts";
import meRoute from "./routes/me.ts";
import submissionsRoute from "./routes/submissions.ts";
import adminRoute from "./routes/admin.ts";
import ownerRoute from "./routes/owner.ts";
import usersRoute from "./routes/users.ts";
import statsRoutes from "./routes/stats.ts";
import announcementsRoute from "./routes/announcements.ts";
import translateRoute from "./routes/translate.ts";

export function createServer() {
  const app = new Hono();

  app.use("*", logger());
  app.use("*", secureHeaders());
  app.use(
    "*",
    cors({
      origin: [env.SITE_URL],
      credentials: true, // ★ M3: required for Auth.js session cookies
      allowHeaders: ["Content-Type", "Authorization", "X-Locale"],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  // ★ M3: Auth.js middleware. Order:
  //   1. authConfig must run before authHandler — it injects c.var.authConfig,
  //      which authHandler reads to know providers/secret/adapter.
  //   2. authHandler claims everything under /api/auth/*.
  //   3. Route handlers that need session info call getAuthUser(c) or use
  //      the verifyAuth() middleware — both populate c.var.authUser.
  app.use("*", authConfig);
  app.use("/api/auth/*", authHandler());

  app.route("/api/health", healthRoute);
  app.route("/api/prompts", promptsRoute);
  app.route("/api/categories", categoriesRoute);
  app.route("/api/tags", tagsRoute);
  app.route("/api/public", publicRoute);
  app.route("/api/import-tokens", importTokensRoute);
  // ★ M5: like/favorite/view toggles share the /api/prompts prefix with
  //   listing — Hono dispatches per-method so they don't conflict.
  app.route("/api/prompts", interactionsRoute);
  app.route("/api/me", meRoute);
  app.route("/api/submissions", submissionsRoute);
  app.route("/api/admin", adminRoute);
  app.route("/api/owner", ownerRoute);
  app.route("/api/users", usersRoute);
  app.route("/api/stats", statsRoutes);
  // ★ M10b W2.4: public announcements feed (active rows only). No auth, no
  //   banCheck — banned users and anons alike must be able to see banners.
  app.route("/api/announcements", announcementsRoute);
  // ★ M10b W4.2: prompt translator (zh↔en). verifyAuth + banCheck + per-user
  //   rate limit inside the route module.
  app.route("/api/translate", translateRoute);

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError(errorHandler);

  return app;
}
