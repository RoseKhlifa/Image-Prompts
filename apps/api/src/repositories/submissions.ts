import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  submissions,
  users,
  prompts as promptsTable,
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

function listItem(s: typeof submissions.$inferSelect, promotedSlug: string | null = null) {
  const f = flat(s);
  return {
    id: s.id,
    status: s.status,
    titleZh: f.titleZh,
    titleEn: f.titleEn,
    rejectReason: s.rejectReason,
    primaryImage: s.imageKeys.length > 0
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
    .select({ s: submissions, promotedSlug: promptsTable.slug })
    .from(submissions)
    .leftJoin(promptsTable, eq(submissions.promotedTo, promptsTable.id))
    .where(and(...conds))
    .orderBy(desc(submissions.createdAt))
    .limit(opts.limit + 1);
  const trimmed = rows.slice(0, opts.limit);
  return {
    items: trimmed.map((r) => listItem(r.s, r.promotedSlug)),
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
      contributor: {
        id: users.id,
        name: users.name,
        email: users.email,
        rejectedCount: users.rejectedCount,
      },
    })
    .from(submissions)
    .leftJoin(promptsTable, eq(submissions.promotedTo, promptsTable.id))
    .leftJoin(users, eq(submissions.contributorId, users.id))
    .where(where)
    .orderBy(desc(submissions.createdAt))
    .limit(opts.limit + 1);
  const trimmed = rows.slice(0, opts.limit);
  return {
    items: trimmed
      .filter((r) => r.contributor !== null)
      .map((r) => ({
        ...listItem(r.s, r.promotedSlug),
        contributor: r.contributor!,
      })),
    nextCursor:
      rows.length > opts.limit
        ? trimmed[trimmed.length - 1]!.s.createdAt.toISOString()
        : null,
  };
}
