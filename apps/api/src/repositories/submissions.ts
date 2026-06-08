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
    })
    .from(submissions)
    .leftJoin(users, eq(submissions.contributorId, users.id))
    .leftJoin(promptsTable, eq(submissions.promotedTo, promptsTable.id))
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

export async function approveSubmission(input: ApproveInput): Promise<{
  promptId: string;
  slug: string;
}> {
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

  return result;
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
