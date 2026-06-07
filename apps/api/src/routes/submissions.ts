import { Hono } from "hono";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { verifyAuth } from "@hono/auth-js";
import { PresignRequestSchema } from "@ip/shared";
import { zv } from "../lib/validate.ts";
import { createRateLimiter } from "../lib/rate-limit.ts";
import { pickWriteAccount } from "../lib/r2-scheduler.ts";
import { presignPut } from "../lib/r2-ops.ts";
import { buildSubmissionKey, mimeToExt } from "../lib/r2-keys.ts";
import { SUBMIT_CONFIG } from "../lib/submit-config.ts";
import { computeDailyLimit, resetDailyCountIfNeeded } from "../lib/daily-limit.ts";
import { getUserForSubmission } from "../repositories/users.ts";

// Per-user 60/min + per-IP 120/min — rate-limit module returns a sync
// boolean from check(); separate limiter instances isolate this route from
// other rate-limited paths.
const presignUserLimiter = createRateLimiter({ limit: 60, windowMs: 60_000 });
const presignIpLimiter = createRateLimiter({ limit: 120, windowMs: 60_000 });

function clientIp(c: Context): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    "unknown"
  );
}

function requireUserId(c: Context): string {
  const authUser = c.get("authUser") as
    | { session?: { user?: { id?: string } } }
    | null
    | undefined;
  const id = authUser?.session?.user?.id;
  if (!id) throw new HTTPException(401, { message: "unauthorized" });
  return id;
}

const app = new Hono();

app.post("/presign", verifyAuth(), zv("json", PresignRequestSchema), async (c) => {
  const userId = requireUserId(c);
  if (!presignUserLimiter.check(userId)) {
    throw new HTTPException(429, { message: "rate_limit" });
  }
  if (!presignIpLimiter.check(clientIp(c))) {
    throw new HTTPException(429, { message: "rate_limit" });
  }

  const input = c.req.valid("json");

  // Lazily roll the daily counter if the previous reset was before today's
  // Asia/Shanghai midnight, then re-read the slice we need.
  await resetDailyCountIfNeeded(userId);
  const user = await getUserForSubmission(userId);
  if (!user) throw new HTTPException(401, { message: "unauthorized" });
  const limit = computeDailyLimit(user);
  if (user.dailySubmissionCount >= limit) {
    throw new HTTPException(429, { message: "daily_limit_reached" });
  }

  const account = await pickWriteAccount();
  const ext = mimeToExt(input.contentType);
  const key = buildSubmissionKey(userId, ext);
  const { uploadUrl, expiresAt } = await presignPut({
    account,
    key,
    contentType: input.contentType,
    contentLength: input.size,
    ttlSeconds: SUBMIT_CONFIG.PRESIGN_TTL_SECONDS,
  });
  return c.json({
    r2AccountId: account.id,
    r2Key: key,
    uploadUrl,
    expiresAt: expiresAt.toISOString(),
  });
});

export default app;
