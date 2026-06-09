import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  submissions,
  users,
  prompts as promptsTable,
  promptImages,
  tags as tagsTable,
  promptTags,
  notifications,
  auditLog,
} from "../db/schema/index.ts";
import { bi } from "../lib/bilingual.ts";

type ImageInput = { r2AccountId: string; r2Key: string; altText?: string };

type CreateInput = {
  contributorId: string;
  titleZh: string | null;
  titleEn: string | null;
  promptZh: string | null;
  promptEn: string | null;
  negativePromptZh: string | null;
  negativePromptEn: string | null;
  notesZh: string | null;
  notesEn: string | null;
  aspectRatio: string | null;
  categoryId: string;
  tagSlugs: string[];
  images: ImageInput[];
  agreedGuidelinesVersion: number;
  /**
   * When set, this submission is a self-edit of the named prompt. Approving
   * the submission UPDATEs that prompt in place (see approveSubmission)
   * rather than inserting a new one. Omitted for vanilla submissions.
   */
  originalPromptId?: string;
};

export async function createSubmission(input: CreateInput): Promise<string> {
  const title = bi(input.titleZh, input.titleEn);
  const prompt = bi(input.promptZh, input.promptEn);
  if (!title || !prompt) {
    throw new Error("createSubmission: title/prompt cannot both be empty");
  }
  const [row] = await db
    .insert(submissions)
    .values({
      contributorId: input.contributorId,
      title,
      prompt,
      negativePrompt: bi(input.negativePromptZh, input.negativePromptEn),
      notes: bi(input.notesZh, input.notesEn),
      aspectRatio: input.aspectRatio,
      categoryId: input.categoryId,
      tagSlugs: input.tagSlugs,
      imageKeys: input.images.map((i) => ({
        r2AccountId: i.r2AccountId,
        r2Key: i.r2Key,
        ...(i.altText !== undefined ? { altText: i.altText } : {}),
      })),
      agreedGuidelinesVersion: input.agreedGuidelinesVersion,
      status: "pending",
      ...(input.originalPromptId !== undefined
        ? { originalPromptId: input.originalPromptId }
        : {}),
    })
    .returning({ id: submissions.id });
  return row!.id;
}

function flat(row: typeof submissions.$inferSelect) {
  const title = (row.title ?? {}) as { zh?: string; en?: string };
  const prompt = (row.prompt ?? {}) as { zh?: string; en?: string };
  const neg = (row.negativePrompt ?? null) as { zh?: string; en?: string } | null;
  const notes = (row.notes ?? null) as { zh?: string; en?: string } | null;
  return {
    titleZh: title.zh ?? null,
    titleEn: title.en ?? null,
    promptZh: prompt.zh ?? null,
    promptEn: prompt.en ?? null,
    negativePromptZh: neg?.zh ?? null,
    negativePromptEn: neg?.en ?? null,
    notesZh: notes?.zh ?? null,
    notesEn: notes?.en ?? null,
  };
}

/**
 * Alias the prompts table a second time so we can JOIN it twice: once for
 * `promoted_to` (already-approved → published prompt) and once for
 * `original_prompt_id` (self-edit pointer). drizzle uses the table name
 * verbatim in SQL, so we need a distinct alias to avoid the second JOIN
 * shadowing the first.
 */
import { alias } from "drizzle-orm/pg-core";
const originalPromptsAlias = alias(promptsTable, "original_prompts_alias");

export async function getSubmissionById(id: string) {
  const rows = await db
    .select({
      s: submissions,
      contributor: {
        id: users.id,
        name: users.name,
        email: users.email,
        rejectedCount: users.rejectedCount,
      },
      promotedSlug: promptsTable.slug,
      originalSlug: originalPromptsAlias.slug,
    })
    .from(submissions)
    .leftJoin(users, eq(submissions.contributorId, users.id))
    .leftJoin(promptsTable, eq(submissions.promotedTo, promptsTable.id))
    .leftJoin(
      originalPromptsAlias,
      eq(submissions.originalPromptId, originalPromptsAlias.id),
    )
    .where(eq(submissions.id, id))
    .limit(1);
  const r = rows[0];
  if (!r || !r.contributor) return null;
  const s = r.s;
  const f = flat(s);
  return {
    id: s.id,
    status: s.status,
    ...f,
    rejectReason: s.rejectReason,
    aspectRatio: s.aspectRatio,
    categoryId: s.categoryId,
    tagSlugs: s.tagSlugs,
    agreedGuidelinesVersion: s.agreedGuidelinesVersion,
    images: s.imageKeys,
    primaryImage: s.imageKeys.length > 0
      ? { r2AccountId: s.imageKeys[0]!.r2AccountId, r2Key: s.imageKeys[0]!.r2Key }
      : null,
    promotedTo: s.promotedTo
      ? { promptId: s.promotedTo, slug: r.promotedSlug ?? "" }
      : null,
    originalPromptId: s.originalPromptId,
    originalPromptSlug: s.originalPromptId ? r.originalSlug ?? null : null,
    createdAt: s.createdAt.toISOString(),
    reviewedAt: s.reviewedAt ? s.reviewedAt.toISOString() : null,
    contributor: r.contributor,
  };
}

type ListOpts = {
  cursor: string | null;
  limit: number;
  status: "pending" | "approved" | "rejected" | null;
};

function listItem(
  s: typeof submissions.$inferSelect,
  promotedSlug: string | null = null,
  promotedImage: { r2AccountId: string; r2Key: string } | null = null,
  originalSlug: string | null = null,
) {
  const f = flat(s);
  return {
    id: s.id,
    status: s.status,
    titleZh: f.titleZh,
    titleEn: f.titleEn,
    rejectReason: s.rejectReason,
    primaryImage: promotedImage
      ? promotedImage
      : s.imageKeys.length > 0
      ? { r2AccountId: s.imageKeys[0]!.r2AccountId, r2Key: s.imageKeys[0]!.r2Key }
      : null,
    promotedTo: s.promotedTo && promotedSlug
      ? { promptId: s.promotedTo, slug: promotedSlug }
      : null,
    originalPromptId: s.originalPromptId,
    originalPromptSlug: s.originalPromptId ? originalSlug : null,
    createdAt: s.createdAt.toISOString(),
    reviewedAt: s.reviewedAt ? s.reviewedAt.toISOString() : null,
  };
}

export async function listForUser(userId: string, opts: ListOpts) {
  const conds = [eq(submissions.contributorId, userId)];
  if (opts.status) conds.push(eq(submissions.status, opts.status));
  if (opts.cursor) conds.push(lt(submissions.createdAt, new Date(opts.cursor)));
  const rows = await db
    .select({
      s: submissions,
      promotedSlug: promptsTable.slug,
      promotedImage: {
        r2AccountId: promptImages.r2AccountId,
        r2Key: promptImages.r2Key,
      },
      originalSlug: originalPromptsAlias.slug,
    })
    .from(submissions)
    .leftJoin(promptsTable, eq(submissions.promotedTo, promptsTable.id))
    .leftJoin(
      promptImages,
      and(
        eq(promptImages.promptId, submissions.promotedTo),
        eq(promptImages.order, 0),
      ),
    )
    .leftJoin(
      originalPromptsAlias,
      eq(submissions.originalPromptId, originalPromptsAlias.id),
    )
    .where(and(...conds))
    .orderBy(desc(submissions.createdAt))
    .limit(opts.limit + 1);
  const trimmed = rows.slice(0, opts.limit);
  return {
    items: trimmed.map((r) =>
      listItem(
        r.s,
        r.promotedSlug,
        r.promotedImage && r.promotedImage.r2AccountId && r.promotedImage.r2Key
          ? { r2AccountId: r.promotedImage.r2AccountId, r2Key: r.promotedImage.r2Key }
          : null,
        r.originalSlug,
      ),
    ),
    nextCursor:
      rows.length > opts.limit
        ? trimmed[trimmed.length - 1]!.s.createdAt.toISOString()
        : null,
  };
}

export async function listForAdmin(opts: ListOpts) {
  const conds = [];
  if (opts.status) conds.push(eq(submissions.status, opts.status));
  if (opts.cursor) conds.push(lt(submissions.createdAt, new Date(opts.cursor)));
  const where = conds.length > 0 ? and(...conds) : undefined;
  const rows = await db
    .select({
      s: submissions,
      promotedSlug: promptsTable.slug,
      promotedImage: {
        r2AccountId: promptImages.r2AccountId,
        r2Key: promptImages.r2Key,
      },
      contributor: {
        id: users.id,
        name: users.name,
        email: users.email,
        rejectedCount: users.rejectedCount,
      },
      originalSlug: originalPromptsAlias.slug,
    })
    .from(submissions)
    .leftJoin(promptsTable, eq(submissions.promotedTo, promptsTable.id))
    .leftJoin(
      promptImages,
      and(
        eq(promptImages.promptId, submissions.promotedTo),
        eq(promptImages.order, 0),
      ),
    )
    .leftJoin(
      originalPromptsAlias,
      eq(submissions.originalPromptId, originalPromptsAlias.id),
    )
    .innerJoin(users, eq(submissions.contributorId, users.id))
    .where(where)
    .orderBy(desc(submissions.createdAt))
    .limit(opts.limit + 1);
  const trimmed = rows.slice(0, opts.limit);
  return {
    items: trimmed.map((r) => ({
      ...listItem(
        r.s,
        r.promotedSlug,
        r.promotedImage && r.promotedImage.r2AccountId && r.promotedImage.r2Key
          ? { r2AccountId: r.promotedImage.r2AccountId, r2Key: r.promotedImage.r2Key }
          : null,
        r.originalSlug,
      ),
      contributor: r.contributor,
    })),
    nextCursor:
      rows.length > opts.limit
        ? trimmed[trimmed.length - 1]!.s.createdAt.toISOString()
        : null,
  };
}

export class AlreadyResolvedError extends Error {
  constructor() {
    super("submission already resolved");
    this.name = "AlreadyResolvedError";
  }
}

export class NotFoundError extends Error {
  constructor() {
    super("submission not found");
    this.name = "NotFoundError";
  }
}

type ApproveInput = {
  submissionId: string;
  actorId: string;
  actorRole: "admin" | "moderator";
  edits: Partial<{
    titleZh: string;
    titleEn: string;
    promptZh: string;
    promptEn: string;
    negativePromptZh: string;
    negativePromptEn: string;
    notesZh: string;
    notesEn: string;
    aspectRatio: string;
    categoryId: string;
    tagSlugs: string[];
  }>;
};

/** Generate a unique prompt slug. Strategy: kebab the title, retry with -N suffix on conflict. */
async function generateUniqueSlug(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  candidate: string,
): Promise<string> {
  const base = candidate
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "prompt";
  for (let i = 0; i < 16; i++) {
    const trial = i === 0 ? base : `${base}-${i + 1}`;
    const exists = await tx
      .select({ id: promptsTable.id })
      .from(promptsTable)
      .where(eq(promptsTable.slug, trial))
      .limit(1);
    if (exists.length === 0) return trial;
  }
  throw new Error("could not generate unique slug");
}

/**
 * Result of approveSubmission. `mode` distinguishes the two paths:
 *
 *   - "insert": fresh approval, no originalPromptId. The route migrates each
 *     `imageKeys` entry (submissions/<user>/<uuid>.<ext>) into
 *     `prompts/<promptId>/<idx>.<ext>` and INSERTs a prompt_images row.
 *
 *   - "update": self-edit approval. The submission's originalPromptId pointed
 *     at an existing prompt; the repo UPDATEd that prompt's fields and did
 *     diff-replace on tags + image rows. The route still needs to do R2 work:
 *     migrate every `migrateKeys` entry (the submission's images) into
 *     prompts/<id>/<targetOrder>.<ext> + INSERT prompt_images, and best-effort
 *     deleteObject every removedKey.
 */
export type ApproveResult =
  | {
      mode: "insert";
      promptId: string;
      slug: string;
    }
  | {
      mode: "update";
      promptId: string;
      slug: string;
      migrateKeys: Array<{
        r2AccountId: string;
        r2Key: string;
        altText: string | null;
        targetOrder: number;
      }>;
      removedKeys: Array<{ r2AccountId: string; r2Key: string }>;
    };

export async function approveSubmission(input: ApproveInput): Promise<ApproveResult> {
  const sub = await getSubmissionById(input.submissionId);
  if (!sub) throw new NotFoundError();
  if (sub.status !== "pending") throw new AlreadyResolvedError();

  const final = {
    titleZh: input.edits.titleZh ?? sub.titleZh,
    titleEn: input.edits.titleEn ?? sub.titleEn,
    promptZh: input.edits.promptZh ?? sub.promptZh,
    promptEn: input.edits.promptEn ?? sub.promptEn,
    negativePromptZh: input.edits.negativePromptZh ?? sub.negativePromptZh,
    negativePromptEn: input.edits.negativePromptEn ?? sub.negativePromptEn,
    notesZh: input.edits.notesZh ?? sub.notesZh,
    notesEn: input.edits.notesEn ?? sub.notesEn,
    aspectRatio: input.edits.aspectRatio ?? sub.aspectRatio,
    categoryId: input.edits.categoryId ?? sub.categoryId,
    tagSlugs: input.edits.tagSlugs ?? sub.tagSlugs,
  };

  // Branch on the edit-approval path. When `originalPromptId` is set, we
  // UPDATE that existing prompt in place rather than INSERTing a fresh row.
  if (sub.originalPromptId) {
    return await approveEditSubmission(input, sub, final);
  }

  const result = await db.transaction(async (tx) => {
    const slug = await generateUniqueSlug(
      tx,
      final.titleZh ?? final.titleEn ?? "prompt",
    );
    const title = bi(final.titleZh, final.titleEn);
    const prompt = bi(final.promptZh, final.promptEn);
    if (!title || !prompt) throw new Error("approve: title/prompt cannot be empty");

    // 1. INSERT prompt first — we need promptId for the conditional UPDATE.
    //    If the race gate below fails, the transaction rollback will undo this INSERT.
    const [p] = await tx
      .insert(promptsTable)
      .values({
        slug,
        source: "site",
        title,
        prompt,
        negativePrompt: bi(final.negativePromptZh, final.negativePromptEn),
        notes: bi(final.notesZh, final.notesEn),
        aspectRatio: final.aspectRatio,
        categoryId: final.categoryId,
        contributorId: sub.contributor.id,
        approvedAt: new Date(),
      })
      .returning({ id: promptsTable.id });

    const promptId = p!.id;

    // 2. RACE GATE: conditional UPDATE on submissions WHERE status='pending'.
    //    If 0 rows are affected, another concurrent approve/reject won the race
    //    — throw to roll back this transaction (including the prompt INSERT above).
    const updateResult = await tx
      .update(submissions)
      .set({
        status: "approved",
        promotedTo: promptId,
        reviewedBy: input.actorId,
        reviewedAt: new Date(),
      })
      .where(
        and(
          eq(submissions.id, input.submissionId),
          eq(submissions.status, "pending"),
        ),
      );
    if ((updateResult.rowCount ?? 0) === 0) {
      throw new AlreadyResolvedError();
    }

    // 3. We own this submission now — apply the rest of the side effects.
    if (final.tagSlugs.length > 0) {
      const tagRows = await tx
        .select({ id: tagsTable.id, slug: tagsTable.slug })
        .from(tagsTable)
        .where(inArray(tagsTable.slug, final.tagSlugs));
      if (tagRows.length > 0) {
        await tx
          .insert(promptTags)
          .values(tagRows.map((t) => ({ promptId, tagId: t.id })));
        await tx
          .update(tagsTable)
          .set({ usageCount: sql`${tagsTable.usageCount} + 1` })
          .where(inArray(tagsTable.slug, final.tagSlugs));
      }
    }

    await tx.insert(notifications).values({
      userId: sub.contributor.id,
      type: "submission_approved",
      payload: {
        submissionId: input.submissionId,
        promptId,
        promptSlug: slug,
        titleZh: final.titleZh,
        titleEn: final.titleEn,
      },
    });

    const hadEdits = Object.keys(input.edits).length > 0;
    await tx.insert(auditLog).values({
      actorId: input.actorId,
      action: "submission.approve",
      targetType: "submission",
      targetId: input.submissionId,
      payload: { promptId, hadEdits, edits: hadEdits ? input.edits : undefined },
    });

    return { promptId, slug };
  });

  return { mode: "insert", promptId: result.promptId, slug: result.slug };
}

type FinalFields = {
  titleZh: string | null;
  titleEn: string | null;
  promptZh: string | null;
  promptEn: string | null;
  negativePromptZh: string | null;
  negativePromptEn: string | null;
  notesZh: string | null;
  notesEn: string | null;
  aspectRatio: string | null;
  categoryId: string;
  tagSlugs: string[];
};

/**
 * Edit-approval path. The submission's originalPromptId points at an existing
 * prompt; we UPDATE that prompt's fields, diff-replace its tag set, and
 * diff-replace its image rows. The route receives `migrateKeys` (submissions/*
 * → prompts/<id>/<order>.<ext>) and `removedKeys` (existing rows to nuke).
 *
 * Image diff semantics differ from the owner-prompts repo: the submission's
 * imageKeys are the AUTHORITATIVE new image set. Every submission image is a
 * fresh upload in submissions/ (the user picked them through the upload
 * pipeline), so every submission image is a "migrate", and every existing
 * row whose r2Key isn't in the submission's set is a "remove". Crucially,
 * this gives the user a full replace; partial keep-and-add isn't supported
 * for self-edits in this iteration (the user can only replace, not keep).
 */
async function approveEditSubmission(
  input: ApproveInput,
  sub: NonNullable<Awaited<ReturnType<typeof getSubmissionById>>>,
  final: FinalFields,
): Promise<ApproveResult> {
  if (!sub.originalPromptId) {
    throw new Error("approveEditSubmission requires originalPromptId");
  }
  const promptId = sub.originalPromptId;

  const result = await db.transaction(async (tx) => {
    // 1. Read the existing prompt to make sure it still exists (a self-edit
    //    submission could outlive its target if the user later deletes the
    //    original via the self-delete endpoint).
    const [existing] = await tx
      .select({ id: promptsTable.id, slug: promptsTable.slug })
      .from(promptsTable)
      .where(eq(promptsTable.id, promptId))
      .limit(1);
    if (!existing) {
      // Original prompt is gone — treat the submission like a normal new-
      // insert approval. We don't take that path here; instead surface a
      // clear error so an operator can decide.
      throw new Error("original_prompt_gone");
    }

    const title = bi(final.titleZh, final.titleEn);
    const prompt = bi(final.promptZh, final.promptEn);
    if (!title || !prompt) throw new Error("approve_edit: title/prompt cannot be empty");

    // 2. UPDATE the original prompt's fields.
    await tx
      .update(promptsTable)
      .set({
        title,
        prompt,
        negativePrompt: bi(final.negativePromptZh, final.negativePromptEn),
        notes: bi(final.notesZh, final.notesEn),
        aspectRatio: final.aspectRatio,
        categoryId: final.categoryId,
        updatedAt: sql`now()`,
      })
      .where(eq(promptsTable.id, promptId));

    // 3. RACE GATE: conditional UPDATE on submissions WHERE status='pending'.
    const updateResult = await tx
      .update(submissions)
      .set({
        status: "approved",
        promotedTo: promptId,
        reviewedBy: input.actorId,
        reviewedAt: new Date(),
      })
      .where(
        and(
          eq(submissions.id, input.submissionId),
          eq(submissions.status, "pending"),
        ),
      );
    if ((updateResult.rowCount ?? 0) === 0) {
      throw new AlreadyResolvedError();
    }

    // 4. Diff-replace tags on the existing prompt.
    const existingTags = await tx
      .select({ slug: tagsTable.slug })
      .from(promptTags)
      .innerJoin(tagsTable, eq(tagsTable.id, promptTags.tagId))
      .where(eq(promptTags.promptId, promptId));
    const before = new Set(existingTags.map((r) => r.slug));
    const after = new Set(final.tagSlugs);
    const added = [...after].filter((s) => !before.has(s));
    const removedTags = [...before].filter((s) => !after.has(s));

    await tx.delete(promptTags).where(eq(promptTags.promptId, promptId));
    if (final.tagSlugs.length > 0) {
      const tagRows = await tx
        .select({ id: tagsTable.id, slug: tagsTable.slug })
        .from(tagsTable)
        .where(inArray(tagsTable.slug, final.tagSlugs));
      if (tagRows.length > 0) {
        await tx
          .insert(promptTags)
          .values(tagRows.map((t) => ({ promptId, tagId: t.id })));
      }
    }
    if (added.length > 0) {
      await tx
        .update(tagsTable)
        .set({ usageCount: sql`${tagsTable.usageCount} + 1` })
        .where(inArray(tagsTable.slug, added));
    }
    if (removedTags.length > 0) {
      await tx
        .update(tagsTable)
        .set({ usageCount: sql`GREATEST(${tagsTable.usageCount} - 1, 0)` })
        .where(inArray(tagsTable.slug, removedTags));
    }

    // 5. Diff-replace images. The submission's imageKeys are the
    //    authoritative new set. We capture removed rows + delete them in-tx;
    //    the route migrates the new submission keys post-tx via copyObject.
    const existingImages = await tx
      .select({
        id: promptImages.id,
        r2AccountId: promptImages.r2AccountId,
        r2Key: promptImages.r2Key,
      })
      .from(promptImages)
      .where(eq(promptImages.promptId, promptId));

    const removedImages = existingImages.map((r) => ({
      r2AccountId: r.r2AccountId,
      r2Key: r.r2Key,
    }));

    if (existingImages.length > 0) {
      await tx
        .delete(promptImages)
        .where(inArray(promptImages.id, existingImages.map((r) => r.id)));
    }

    // 6. Notification: same shape as the insert path so the user gets a
    //    "your submission was approved" surface.
    await tx.insert(notifications).values({
      userId: sub.contributor.id,
      type: "submission_approved",
      payload: {
        submissionId: input.submissionId,
        promptId,
        promptSlug: existing.slug,
        titleZh: final.titleZh,
        titleEn: final.titleEn,
      },
    });

    const hadEdits = Object.keys(input.edits).length > 0;
    await tx.insert(auditLog).values({
      actorId: input.actorId,
      action: "submission.approve_edit",
      targetType: "submission",
      targetId: input.submissionId,
      payload: { promptId, hadEdits, edits: hadEdits ? input.edits : undefined },
    });

    // 7. Migrate buckets — the route handles R2 work + INSERT post-tx.
    const migrateKeys = sub.images.map((img, idx) => ({
      r2AccountId: img.r2AccountId,
      r2Key: img.r2Key,
      altText: img.altText ?? null,
      targetOrder: idx,
    }));

    return {
      promptId,
      slug: existing.slug,
      migrateKeys,
      removedKeys: removedImages,
    };
  });

  return {
    mode: "update" as const,
    promptId: result.promptId,
    slug: result.slug,
    migrateKeys: result.migrateKeys,
    removedKeys: result.removedKeys,
  };
}

type RejectInput = {
  submissionId: string;
  actorId: string;
  reason: string;
};

export async function rejectSubmission(input: RejectInput): Promise<void> {
  const sub = await getSubmissionById(input.submissionId);
  if (!sub) throw new NotFoundError();
  if (sub.status !== "pending") throw new AlreadyResolvedError();

  await db.transaction(async (tx) => {
    // RACE GATE: conditional UPDATE on submissions WHERE status='pending'.
    //    If 0 rows are affected, another concurrent approve/reject won the race
    //    — throw to roll back this transaction.
    const updateResult = await tx
      .update(submissions)
      .set({
        status: "rejected",
        rejectReason: input.reason,
        reviewedBy: input.actorId,
        reviewedAt: new Date(),
      })
      .where(
        and(
          eq(submissions.id, input.submissionId),
          eq(submissions.status, "pending"),
        ),
      );
    if ((updateResult.rowCount ?? 0) === 0) {
      throw new AlreadyResolvedError();
    }

    // We own this submission now — apply the rest of the side effects.
    await tx
      .update(users)
      .set({ rejectedCount: sql`${users.rejectedCount} + 1` })
      .where(eq(users.id, sub.contributor.id));

    await tx.insert(notifications).values({
      userId: sub.contributor.id,
      type: "submission_rejected",
      payload: {
        submissionId: input.submissionId,
        reason: input.reason,
        titleZh: sub.titleZh,
        titleEn: sub.titleEn,
      },
    });

    await tx.insert(auditLog).values({
      actorId: input.actorId,
      action: "submission.reject",
      targetType: "submission",
      targetId: input.submissionId,
      payload: { reason: input.reason },
    });
  });
}
