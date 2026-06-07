import { Hono } from "hono";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { verifyAuth } from "@hono/auth-js";
import { eq } from "drizzle-orm";
import { PresignRequestSchema, SubmissionInputSchema } from "@ip/shared";
import { zv } from "../lib/validate.ts";
import { requireUserId } from "../middleware/auth.ts";
import { createRateLimiter } from "../lib/rate-limit.ts";
import { pickWriteAccount } from "../lib/r2-scheduler.ts";
import { presignPut, headObject } from "../lib/r2-ops.ts";
import { buildSubmissionKey, mimeToExt } from "../lib/r2-keys.ts";
import { SUBMIT_CONFIG } from "../lib/submit-config.ts";
import {
  computeDailyLimit,
  resetDailyCountIfNeeded,
  incrementDailyCountIfUnderLimit,
} from "../lib/daily-limit.ts";
import { db } from "../db/client.ts";
import { categories, r2Accounts } from "../db/schema/index.ts";
import { getUserForSubmission } from "../repositories/users.ts";
import { getTagsBySlugs } from "../repositories/tags.ts";
import { createSubmission } from "../repositories/submissions.ts";

// Presign is cheap (no DB writes, no permanent commitment) so the bucket is
// loose: 60/min/user + 120/min/IP. Separate limiter instances isolate this
// route from other rate-limited paths.
const presignUserLimiter = createRateLimiter({ limit: 60, windowMs: 60_000 });
const presignIpLimiter = createRateLimiter({ limit: 120, windowMs: 60_000 });

// Create is much costlier than presign (DB writes + R2 HEADs + permanent
// commitment), so the bucket is tighter: 6/hour/user + 30/hour/IP.
const createUserLimiter = createRateLimiter({ limit: 6, windowMs: 60 * 60 * 1000 });
const createIpLimiter = createRateLimiter({ limit: 30, windowMs: 60 * 60 * 1000 });

function clientIp(c: Context): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    "unknown"
  );
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

// POST /api/submissions — create a new submission.
//
// Validation order is deliberate; cheaper checks first, and crucially the
// daily-count *mutation* is deferred until every read-only check has passed
// so a bad payload (unknown category, missing image, etc.) doesn't burn the
// user's daily quota:
//   1.  auth (verifyAuth)
//   2.  rate-limit (in-memory, sync)
//   3.  body shape (zod)
//   4.  read user
//   5.  guidelines acceptance (412 if stale)
//   6.  reset daily counter if a new Asia/Shanghai day rolled over
//   7.  re-read user + cheap pre-check against the daily cap (429 fast-fail;
//       racy on its own but saves R2 HEAD round-trips when obviously over)
//   8.  category exists
//   9.  tag slugs all exist
//   10. R2 account refs valid
//   11. R2 HEAD each image (existence + size)
//   12. atomic incrementDailyCountIfUnderLimit (race-safe gate, 429 on fail)
//   13. INSERT submission via repo
//
// The two-phase daily-limit check (steps 7 + 12) keeps both properties:
// step 7 is a non-binding ergonomic guard that avoids costly external work
// for users already at cap; step 12 is the real gate — its atomic UPDATE
// only succeeds once, so two parallel requests can't both squeak past the
// cap. The increment lands immediately before INSERT, so the only window
// in which a count is "burned" without a row is an INSERT failure, which
// is an acceptable tradeoff for race-safety.
app.post(
  "/",
  verifyAuth(),
  async (c, next) => {
    const userId = requireUserId(c);
    if (!createUserLimiter.check(`create:user:${userId}`)) {
      throw new HTTPException(429, { message: "rate_limit" });
    }
    if (!createIpLimiter.check(`create:ip:${clientIp(c)}`)) {
      throw new HTTPException(429, { message: "rate_limit" });
    }
    await next();
  },
  zv("json", SubmissionInputSchema),
  async (c) => {
    const userId = requireUserId(c);
    const input = c.req.valid("json");

    const user = await getUserForSubmission(userId);
    if (!user) throw new HTTPException(401, { message: "unauthorized" });

    if (user.communityGuidelinesVersion < SUBMIT_CONFIG.GUIDELINES_VERSION) {
      throw new HTTPException(412, { message: "guidelines_not_accepted" });
    }

    // Reset the counter if a new Asia/Shanghai day has rolled over, then
    // re-read so the cheap pre-check uses the post-reset value. This is a
    // non-binding pre-check — racy on its own — used purely as an ergonomic
    // fast-fail so we don't burn R2 HEAD requests on users already at cap.
    // The real race-safe gate is the atomic increment further down.
    await resetDailyCountIfNeeded(userId);
    const refreshed = (await getUserForSubmission(userId)) ?? user;
    const limit = computeDailyLimit(refreshed);
    if (refreshed.dailySubmissionCount >= limit) {
      throw new HTTPException(429, { message: "daily_limit_reached" });
    }

    // Category existence.
    const [cat] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, input.categoryId))
      .limit(1);
    if (!cat) {
      throw new HTTPException(400, { message: "invalid_category" });
    }

    // Tag slug existence — every submitted slug must be in the tags table.
    if (input.tagSlugs.length > 0) {
      const known = await getTagsBySlugs(input.tagSlugs);
      const unknown = input.tagSlugs.filter((s) => !known.has(s));
      if (unknown.length > 0) {
        throw new HTTPException(400, {
          message: `unknown_tags:${unknown.join(",")}`,
        });
      }
    }

    // Validate R2 account references and HEAD every image. The presign route
    // is the only legitimate source of (r2AccountId, r2Key) pairs, so an
    // unknown account here is a defensive guard against forged inputs.
    const accountIds = [...new Set(input.images.map((i) => i.r2AccountId))];
    const accountRows = await db.select().from(r2Accounts);
    const accMap = new Map(accountRows.map((a) => [a.id, a]));
    for (const id of accountIds) {
      if (!accMap.has(id)) {
        throw new HTTPException(400, { message: "invalid_r2_account" });
      }
    }

    for (const img of input.images) {
      const account = accMap.get(img.r2AccountId)!;
      const head = await headObject(account, img.r2Key);
      if (!head) {
        throw new HTTPException(400, { message: `image_missing:${img.r2Key}` });
      }
      if (head.contentLength > SUBMIT_CONFIG.MAX_IMAGE_SIZE_BYTES) {
        throw new HTTPException(400, { message: `image_too_large:${img.r2Key}` });
      }
    }

    // All read-only validation passed — now claim the daily-quota slot via
    // an atomic UPDATE. This is the binding race-safe gate: two parallel
    // requests at cap-minus-one cannot both succeed, because the UPDATE
    // WHERE dailySubmissionCount < limit only matches once.
    const incremented = await incrementDailyCountIfUnderLimit(userId, limit);
    if (!incremented) {
      throw new HTTPException(429, { message: "daily_limit_reached" });
    }

    const id = await createSubmission({
      contributorId: userId,
      titleZh: input.titleZh ?? null,
      titleEn: input.titleEn ?? null,
      promptZh: input.promptZh ?? null,
      promptEn: input.promptEn ?? null,
      negativePromptZh: input.negativePromptZh ?? null,
      negativePromptEn: input.negativePromptEn ?? null,
      notesZh: input.notesZh ?? null,
      notesEn: input.notesEn ?? null,
      aspectRatio: input.aspectRatio ?? null,
      categoryId: input.categoryId,
      tagSlugs: input.tagSlugs,
      images: input.images.map((i) => ({
        r2AccountId: i.r2AccountId,
        r2Key: i.r2Key,
        ...(i.altText !== undefined ? { altText: i.altText } : {}),
      })),
      agreedGuidelinesVersion: user.communityGuidelinesVersion,
    });

    return c.json({ id, status: "pending" }, 201);
  },
);

export default app;
