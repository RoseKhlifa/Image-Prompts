import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { verifyAuth } from "@hono/auth-js";
import { requireUserId } from "../middleware/auth.ts";
import { banCheck } from "../middleware/ban-check.ts";
import { zv } from "../lib/validate.ts";
import {
  loadTranslatorConfig,
  translate,
  TranslateException,
} from "../lib/translator.ts";
import { createRateLimiter, type RateLimiter } from "../lib/rate-limit.ts";

/**
 * M10b W4.2: POST /api/translate.
 *
 * Translates a snippet between zh and en using the OpenAI /responses-
 * compatible translator wired in W4.1. Authenticated callers only; banned
 * users are rejected by banCheck() with 403 banned. Per-user-per-hour rate
 * limit is enforced from translator.rate_limit_per_user_hour (live config
 * — re-read with a 60s TTL so /rosekhlifa/config changes propagate without
 * a server restart).
 *
 * TranslateException codes are mapped to HTTP responses so the web client
 * gets a stable {message} string per failure mode (see error.ts for the
 * top-level shape).
 */

const BodySchema = z.object({
  text: z.string().min(1).max(8000),
  fromLocale: z.enum(["zh", "en"]),
  toLocale: z.enum(["zh", "en"]),
});

const app = new Hono();

app.use("*", verifyAuth(), banCheck());

// Per-user limiter rebuilt on the first request after a 60s TTL — since
// translator.rate_limit_per_user_hour can be changed live via
// /rosekhlifa/config, we don't want a freshly tightened limit to wait an
// hour to take effect. We also rebuild eagerly when we observe a config
// change (cachedLimit !== config.rateLimitPerUserHour).
let cachedLimiter: RateLimiter | null = null;
let cachedLimiterAt = 0;
let cachedLimit = 0;
const LIMITER_REFRESH_MS = 60_000;

app.post("/", zv("json", BodySchema), async (c) => {
  const userId = requireUserId(c);
  const input = c.req.valid("json");
  if (input.fromLocale === input.toLocale) {
    throw new HTTPException(400, { message: "same_locale" });
  }
  const config = await loadTranslatorConfig();

  // Rate limit (per user, per hour). The limiter itself is single-process —
  // for multi-instance we'd swap createRateLimiter for a Redis-backed one
  // and the route logic would stay identical.
  if (
    !cachedLimiter ||
    Date.now() - cachedLimiterAt > LIMITER_REFRESH_MS ||
    cachedLimit !== config.rateLimitPerUserHour
  ) {
    cachedLimiter = createRateLimiter({
      limit: config.rateLimitPerUserHour,
      windowMs: 3_600_000,
    });
    cachedLimiterAt = Date.now();
    cachedLimit = config.rateLimitPerUserHour;
  }
  if (!cachedLimiter.check(`translate:${userId}`)) {
    throw new HTTPException(429, { message: "rate_limited" });
  }

  try {
    const result = await translate(input, config);
    return c.json(result);
  } catch (e) {
    if (e instanceof TranslateException) {
      switch (e.detail.code) {
        case "translator_disabled":
          throw new HTTPException(403, { message: "translator_disabled" });
        case "translator_unconfigured":
          throw new HTTPException(503, { message: "translator_unconfigured" });
        case "text_too_long":
          throw new HTTPException(400, {
            message: `text_too_long:${e.detail.maxChars}`,
          });
        case "upstream_error":
          throw new HTTPException(502, {
            message: `upstream_error:${e.detail.status}`,
          });
        case "network_error":
          throw new HTTPException(502, {
            message: `network_error:${e.detail.error}`,
          });
        case "empty_response":
          throw new HTTPException(502, { message: "empty_response" });
        case "rate_limited":
          throw new HTTPException(429, { message: "rate_limited" });
      }
    }
    throw e;
  }
});

/**
 * Test-only: drop the cached limiter so each test sees a fresh counter.
 * Not exported from a barrel; importers must reach into routes/translate.ts
 * directly, which is the contract we want (tests should know they're
 * poking module state).
 */
export function _resetLimiter() {
  cachedLimiter = null;
  cachedLimiterAt = 0;
  cachedLimit = 0;
}

export default app;
