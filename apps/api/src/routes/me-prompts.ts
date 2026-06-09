import { Hono } from "hono";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { verifyAuth } from "@hono/auth-js";
import { eq } from "drizzle-orm";
import { SubmissionInputSchema } from "@ip/shared";
import { z } from "zod";
import { zv } from "../lib/validate.ts";
import { requireUserId } from "../middleware/auth.ts";
import { banCheck } from "../middleware/ban-check.ts";
import { createRateLimiter } from "../lib/rate-limit.ts";
import { db } from "../db/client.ts";
import {
  prompts as promptsTable,
  categories,
  r2Accounts,
} from "../db/schema/index.ts";
import { deletePromptForOwner } from "../repositories/owner-prompts.ts";
import { createSubmission } from "../repositories/submissions.ts";
import { recordAudit } from "../repositories/audit.ts";
import { getUserForSubmission } from "../repositories/users.ts";
import { getTagsBySlugs } from "../repositories/tags.ts";
import { deleteObject, headObject } from "../lib/r2-ops.ts";
import { getSubmitConfig } from "../lib/submit-config.ts";
import {
  computeDailyLimit,
  resetDailyCountIfNeeded,
  incrementDailyCountIfUnderLimit,
} from "../lib/daily-limit.ts";

const app = new Hono();

// All /api/me/prompts/* handlers require an authenticated, unbanned session.
// This is the *user-owned* prompt surface — distinct from /api/owner/prompts
// (which is gated by requireOwner) and /api/admin/submissions (which is gated
// by requireRole). Contributor ownership is checked per-handler.
app.use("*", verifyAuth(), banCheck());

const UuidParamSchema = z.object({ id: z.string().uuid() });

// Self-edit uses the same rate buckets as the canonical /api/submissions POST
// flow — costlier than presign. Per-user 6/hour matches the public flow's
// `createUserLimiter`; per-IP 30/hour keeps headroom for a single user
// behind a proxy.
const editUserLimiter = createRateLimiter({ limit: 6, windowMs: 60 * 60 * 1000 });
const editIpLimiter = createRateLimiter({ limit: 30, windowMs: 60 * 60 * 1000 });

function clientIp(c: Context): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    "unknown"
  );
}

// ── DELETE /:id — immediate self-delete ──────────────────────────────────
//
// Contributor-only: the session user must be the prompt's contributorId. The
// owner already has the parallel /api/owner/prompts/:id DELETE; this surface
// gives ordinary users the same affordance for their own contributions only.
// We reuse deletePromptForOwner (which is contributor-agnostic at the repo
// layer — the route is the gate).
app.delete("/:id", zv("param", UuidParamSchema), async (c) => {
  const userId = requireUserId(c);
  const { id } = c.req.valid("param");

  const [row] = await db
    .select({ contributorId: promptsTable.contributorId })
    .from(promptsTable)
    .where(eq(promptsTable.id, id))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "not_found" });
  if (row.contributorId !== userId) {
    throw new HTTPException(403, { message: "not_owner" });
  }

  const result = await deletePromptForOwner(id);
  if (!result) throw new HTTPException(404, { message: "not_found" });

  // Best-effort R2 cleanup — same posture as the owner DELETE route.
  try {
    const accRows = await db.select().from(r2Accounts);
    const accMap = new Map(accRows.map((a) => [a.id, a]));
    for (const img of result.imageKeys) {
      const account = accMap.get(img.r2AccountId);
      if (account) {
        try {
          await deleteObject(account, img.r2Key);
        } catch (e) {
          console.warn("[me.delete] R2 delete failed", img.r2Key, e);
        }
      }
    }
  } catch (e) {
    console.warn("[me.delete] R2 cleanup error", e);
  }

  await recordAudit({
    actorId: userId,
    action: "prompt.self_delete",
    targetType: "prompt",
    targetId: id,
    payload: { deletedImageCount: result.imageKeys.length },
  });
  return c.json({ id, deleted: true });
});

// ── POST /:id/edit — queue a self-edit submission ───────────────────────
//
// Contributor-only: the session user must be the prompt's contributorId. The
// request body is identical to POST /api/submissions; we run the same
// daily-limit + guidelines + R2-existence gates, then INSERT a submission
// with originalPromptId = :id so the moderator's approval UPDATEs the
// original prompt rather than creating a new one.
app.post(
  "/:id/edit",
  zv("param", UuidParamSchema),
  async (c, next) => {
    const userId = requireUserId(c);
    if (!editUserLimiter.check(`edit:user:${userId}`)) {
      throw new HTTPException(429, { message: "rate_limit" });
    }
    if (!editIpLimiter.check(`edit:ip:${clientIp(c)}`)) {
      throw new HTTPException(429, { message: "rate_limit" });
    }
    await next();
  },
  zv("json", SubmissionInputSchema),
  async (c) => {
    const userId = requireUserId(c);
    const { id: originalPromptId } = c.req.valid("param");
    const input = c.req.valid("json");
    const cfg = await getSubmitConfig();

    const [target] = await db
      .select({ contributorId: promptsTable.contributorId })
      .from(promptsTable)
      .where(eq(promptsTable.id, originalPromptId))
      .limit(1);
    if (!target) throw new HTTPException(404, { message: "not_found" });
    if (target.contributorId !== userId) {
      throw new HTTPException(403, { message: "not_owner" });
    }

    const user = await getUserForSubmission(userId);
    if (!user) throw new HTTPException(401, { message: "unauthorized" });

    if (user.communityGuidelinesVersion < cfg.GUIDELINES_VERSION) {
      throw new HTTPException(412, { message: "guidelines_not_accepted" });
    }

    await resetDailyCountIfNeeded(userId);
    const refreshed = (await getUserForSubmission(userId)) ?? user;
    const limit = await computeDailyLimit(refreshed);
    if (refreshed.dailySubmissionCount >= limit) {
      throw new HTTPException(429, { message: "daily_limit_reached" });
    }

    const [cat] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.id, input.categoryId))
      .limit(1);
    if (!cat) {
      throw new HTTPException(400, { message: "invalid_category" });
    }

    if (input.tagSlugs.length > 0) {
      const known = await getTagsBySlugs(input.tagSlugs);
      const unknown = input.tagSlugs.filter((s) => !known.has(s));
      if (unknown.length > 0) {
        throw new HTTPException(400, {
          message: `unknown_tags:${unknown.join(",")}`,
        });
      }
    }

    const accountIds = [...new Set(input.images.map((i) => i.r2AccountId))];
    const accountRows = await db.select().from(r2Accounts);
    const accMap = new Map(accountRows.map((a) => [a.id, a]));
    for (const accId of accountIds) {
      if (!accMap.has(accId)) {
        throw new HTTPException(400, { message: "invalid_r2_account" });
      }
    }
    for (const img of input.images) {
      const account = accMap.get(img.r2AccountId)!;
      const head = await headObject(account, img.r2Key);
      if (!head) {
        throw new HTTPException(400, { message: `image_missing:${img.r2Key}` });
      }
      if (head.contentLength > cfg.MAX_IMAGE_SIZE_BYTES) {
        throw new HTTPException(400, {
          message: `image_too_large:${img.r2Key}`,
        });
      }
    }

    const incremented = await incrementDailyCountIfUnderLimit(userId, limit);
    if (!incremented) {
      throw new HTTPException(429, { message: "daily_limit_reached" });
    }

    const submissionId = await createSubmission({
      contributorId: userId,
      titleZh: input.title,
      titleEn: input.title,
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
      originalPromptId,
    });

    await recordAudit({
      actorId: userId,
      action: "prompt.self_edit_submitted",
      targetType: "submission",
      targetId: submissionId,
      payload: { originalPromptId },
    });

    return c.json({ submissionId, status: "pending" as const }, 201);
  },
);

export default app;
