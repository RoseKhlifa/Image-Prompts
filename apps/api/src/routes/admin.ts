import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { ApproveInputSchema, RejectInputSchema } from "@ip/shared";
import { requireRole } from "../middleware/role.ts";
import { softAuth, requireUserId, getRole } from "../middleware/auth.ts";
import { zv } from "../lib/validate.ts";
import {
  listForAdmin,
  getSubmissionById,
  approveSubmission,
  rejectSubmission,
  AlreadyResolvedError,
  NotFoundError,
} from "../repositories/submissions.ts";
import { copyObject, deleteObject } from "../lib/r2-ops.ts";
import { buildPromptKey } from "../lib/r2-keys.ts";
import { db } from "../db/client.ts";
import { r2Accounts, promptImages, submissions } from "../db/schema/index.ts";

const app = new Hono();

// All admin routes require admin or moderator role
app.use("*", softAuth(), requireRole("admin", "moderator"));

const ListQuerySchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

app.get(
  "/submissions",
  zv("query", ListQuerySchema),
  async (c) => {
    const q = c.req.valid("query");
    const r = await listForAdmin({
      cursor: q.cursor ?? null,
      limit: q.limit,
      status: q.status ?? null,
    });
    return c.json(r);
  },
);

const UuidParamSchema = z.object({ id: z.string().uuid() });

app.get(
  "/submissions/:id",
  zv("param", UuidParamSchema),
  async (c) => {
    const sub = await getSubmissionById(c.req.valid("param").id);
    if (!sub) throw new HTTPException(404, { message: "not_found" });
    return c.json(sub);
  },
);

// POST /api/admin/submissions/:id/approve — promote a pending submission to a
// published prompt and migrate its images out of submissions/ into prompts/.
//
// Authorization:
//   - The `app.use("*", softAuth(), requireRole("admin", "moderator"))` above
//     already gates this to admin+moderator. The role re-check below is
//     defense in depth so the edits gate has a guaranteed role string.
//
// Edits gate:
//   - The optional `edits` partial overrides submission fields when the
//     prompt row is created. Moderators may NOT pass any edits — that's
//     admin-only (the audit-log row records hadEdits + the edits object).
//
// Failure modes:
//   - NotFoundError    -> 404 not_found
//   - AlreadyResolvedError -> 409 not_pending  (idempotent re-call after
//     approve/reject already happened)
//   - any other repo error -> propagates as 500
//
// Image migration runs AFTER the approve transaction commits. The repo
// already INSERTed the prompts row and UPDATEd the submission to "approved"
// in a single tx; image copy is intentionally outside that tx because S3
// CopyObject can be slow and we don't want to hold a long-running DB tx.
// Failure here leaves a dirty state (prompt row exists but prompt_images
// is partial or empty) — per spec we surface 500 image_migration_failed
// and let an operator clean up; nothing here auto-rolls-back.
app.post(
  "/submissions/:id/approve",
  zv("param", UuidParamSchema),
  zv("json", ApproveInputSchema),
  async (c) => {
    const actorId = requireUserId(c);
    const role = getRole(c);
    if (role !== "admin" && role !== "moderator") {
      // softAuth + requireRole already gated this, but defense-in-depth
      // ensures the `edits` check below sees a known role.
      throw new HTTPException(403, { message: "forbidden" });
    }
    const subId = c.req.valid("param").id;
    const body = c.req.valid("json");

    // Strip undefined-valued keys: zod with optional() produces `{k: undefined}`
    // which `exactOptionalPropertyTypes: true` rejects when assigning to
    // Partial<{k: T}>. Also lets `hasEdits` reflect actually-supplied fields.
    const editsRaw = body.edits ?? {};
    const edits: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(editsRaw)) {
      if (v !== undefined) edits[k] = v;
    }
    const hasEdits = Object.keys(edits).length > 0;
    if (hasEdits && role !== "admin") {
      throw new HTTPException(403, { message: "edits_require_admin" });
    }

    let promptId: string;
    let slug: string;
    try {
      ({ promptId, slug } = await approveSubmission({
        submissionId: subId,
        actorId,
        actorRole: role,
        edits: edits as Parameters<typeof approveSubmission>[0]["edits"],
      }));
    } catch (e: unknown) {
      if (e instanceof NotFoundError) {
        throw new HTTPException(404, { message: "not_found" });
      }
      if (e instanceof AlreadyResolvedError) {
        throw new HTTPException(409, { message: "not_pending" });
      }
      throw e;
    }

    // Post-transaction image migration. Each image is copied from
    // submissions/<user>/<uuid>.<ext> to prompts/<promptId>/<idx>.<ext>,
    // then an INSERT into prompt_images is performed, then the original is
    // best-effort deleted (a failed delete logs but does not fail the
    // request — orphan submission objects are tolerable).
    try {
      const [subRow] = await db
        .select()
        .from(submissions)
        .where(eq(submissions.id, subId))
        .limit(1);
      const imageKeys = subRow!.imageKeys;
      const accRows = await db.select().from(r2Accounts);
      const accMap = new Map(accRows.map((a) => [a.id, a]));
      for (const [idx, img] of imageKeys.entries()) {
        const account = accMap.get(img.r2AccountId);
        if (!account) throw new Error(`unknown account ${img.r2AccountId}`);
        const ext = img.r2Key.split(".").pop() ?? "jpg";
        const newKey = buildPromptKey(promptId, idx, ext);
        await copyObject(account, img.r2Key, newKey);
        await db.insert(promptImages).values({
          promptId,
          r2AccountId: img.r2AccountId,
          r2Key: newKey,
          altText: img.altText ?? null,
          order: idx,
        });
        try {
          await deleteObject(account, img.r2Key);
        } catch (e) {
          console.warn("[approve] delete original failed", img.r2Key, e);
        }
      }
    } catch (e: unknown) {
      console.error("[approve] image migration failed", { subId, promptId, e });
      throw new HTTPException(500, { message: "image_migration_failed" });
    }

    return c.json({ promptId, slug });
  },
);

// POST /api/admin/submissions/:id/reject — flip a pending submission to
// rejected, bump the contributor's rejectedCount, fire a submission_rejected
// notification, and append an audit row.
//
// Authorization:
//   - `app.use("*", softAuth(), requireRole("admin", "moderator"))` already
//     gates this to admin+moderator. Unlike approve, there is NO
//     admin-only restriction on reject — moderators may reject too.
//
// Failure modes:
//   - NotFoundError         -> 404 not_found
//   - AlreadyResolvedError  -> 409 not_pending
//
// R2 cleanup runs AFTER the reject transaction commits. Each image delete
// is best-effort (own try/catch) so one failure doesn't skip the rest;
// the outer try/catch covers DB read failure. Failed deletes are logged
// only — bucket lifecycle eventually evicts orphaned submission objects.
app.post(
  "/submissions/:id/reject",
  zv("param", UuidParamSchema),
  zv("json", RejectInputSchema),
  async (c) => {
    const actorId = requireUserId(c);
    const subId = c.req.valid("param").id;
    const { reason } = c.req.valid("json");

    try {
      await rejectSubmission({ submissionId: subId, actorId, reason });
    } catch (e: unknown) {
      if (e instanceof NotFoundError) {
        throw new HTTPException(404, { message: "not_found" });
      }
      if (e instanceof AlreadyResolvedError) {
        throw new HTTPException(409, { message: "not_pending" });
      }
      throw e;
    }

    // Best-effort cleanup of R2 objects (don't block on failure).
    try {
      const [subRow] = await db
        .select()
        .from(submissions)
        .where(eq(submissions.id, subId))
        .limit(1);
      if (subRow) {
        const accRows = await db.select().from(r2Accounts);
        const accMap = new Map(accRows.map((a) => [a.id, a]));
        for (const img of subRow.imageKeys) {
          const account = accMap.get(img.r2AccountId);
          if (account) {
            try {
              await deleteObject(account, img.r2Key);
            } catch (e) {
              console.warn("[reject] delete failed", img.r2Key, e);
            }
          }
        }
      }
    } catch (e) {
      console.warn("[reject] R2 cleanup error", e);
    }

    return c.json({ ok: true });
  },
);

export default app;
