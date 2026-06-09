import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  prompts as promptsTable,
  promptImages,
  promptTags,
  tags as tagsTable,
  categories,
  submissions,
  importTokens,
} from "../db/schema/index.ts";
import { users } from "../db/schema/auth.ts";
import { bi } from "../lib/bilingual.ts";
import { ensureNsfwTag } from "../lib/nsfw.ts";

// ── Types ────────────────────────────────────────────────────────────────
//
// Owner-side prompt management. The owner can list, read, create-direct
// (skipping the submissions queue), edit, and delete any prompt — there's
// no contributor-ownership check beyond requireOwner() at the route layer.

export type Bilingual = { zh?: string; en?: string };

export type OwnerPromptListItem = {
  id: string;
  slug: string;
  title: Bilingual;
  aspectRatio: string | null;
  viewCount: number;
  likeCount: number;
  sendCount: number;
  favoriteCount: number;
  approvedAt: Date;
  createdAt: Date;
  category: { id: string; slug: string; name: Bilingual };
  contributor: { id: string; name: string | null; image: string | null } | null;
  primaryImage: {
    // r2 pair is null for imported prompts; the frontend falls back to remoteUrl.
    r2AccountId: string | null;
    r2Key: string | null;
    remoteUrl: string | null;
    width: number | null;
    height: number | null;
    lqip: string | null;
  } | null;
  tagSlugs: string[];
  /** Non-null when source='imported'. Owner UI can show a source-attribution chip. */
  sourceSite: string | null;
  sourceUrl: string | null;
};

export type OwnerPromptImage = {
  id: string;
  // r2 pair is null for imported prompts; remoteUrl holds the external CDN URL instead.
  r2AccountId: string | null;
  r2Key: string | null;
  remoteUrl: string | null;
  order: number;
  altText: string | null;
  width: number | null;
  height: number | null;
  lqip: string | null;
};

export type OwnerPromptDetail = {
  id: string;
  slug: string;
  title: Bilingual;
  prompt: Bilingual;
  negativePrompt: Bilingual | null;
  notes: Bilingual | null;
  aspectRatio: string | null;
  source: "site" | "nanobanana_seed" | "imported";
  approvedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  category: { id: string; slug: string; name: Bilingual };
  contributor: { id: string; name: string | null; image: string | null } | null;
  tagSlugs: string[];
  images: OwnerPromptImage[];
  /** Non-null when source='imported'. */
  sourceSite: string | null;
  sourceUrl: string | null;
};

export type OwnerPromptImageInput = {
  r2AccountId: string;
  r2Key: string;
  altText?: string;
  width?: number;
  height?: number;
  lqip?: string;
};

export type OwnerPromptCreateInput = {
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
  images: OwnerPromptImageInput[];
};

export type OwnerPromptUpdatePatch = Partial<{
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
  /**
   * Optional ordered image list. When provided, the repo diff-replaces the
   * prompt's image set: entries whose r2Key starts with `prompts/<thisId>/`
   * are treated as "kept" (we reorder them), entries whose r2Key starts with
   * `submissions/` are treated as "new" (the ROUTE layer migrates them
   * post-tx via copyObject + INSERT). Existing rows not in the list are
   * removed (the route layer best-effort deletes their R2 objects post-tx).
   * Any other prefix is rejected with `invalid_image_key`.
   */
  images: OwnerPromptImageInput[];
}>;

/**
 * Result of updatePromptForOwner. `removedKeys` are images the caller must
 * best-effort delete from R2 post-tx. `migrateKeys` are images the caller
 * must copyObject from submissions/ → prompts/<id>/<targetOrder>.<ext> and
 * then INSERT into prompt_images (we deliberately do NOT insert here so the
 * INSERT only happens once the R2 copy succeeded).
 */
export type OwnerPromptUpdateResult = {
  detail: OwnerPromptDetail;
  removedKeys: Array<{ r2AccountId: string; r2Key: string }>;
  migrateKeys: Array<{
    r2AccountId: string;
    r2Key: string;
    altText: string | null;
    width: number | null;
    height: number | null;
    lqip: string | null;
    targetOrder: number;
  }>;
};

export type OwnerPromptListFilters = {
  /** ILIKE match against title->>'zh', title->>'en', prompt->>'zh', prompt->>'en', slug. */
  q?: string;
  /** Slug of category to restrict to. */
  categorySlug?: string;
  /** base64 of `${createdAt.toISOString()}|${id}` for keyset pagination. */
  cursor?: string;
  /** Default 30, max 100. */
  limit?: number;
};

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

function clampLimit(limit?: number): number {
  if (!limit || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(limit, MAX_LIMIT);
}

function encodeCursor(createdAt: Date, id: string): string {
  const raw = `${createdAt.toISOString()}|${id}`;
  return Buffer.from(raw, "utf8").toString("base64");
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursor, "base64").toString("utf8");
    const sep = raw.indexOf("|");
    if (sep === -1) return null;
    const iso = raw.slice(0, sep);
    const id = raw.slice(sep + 1);
    const date = new Date(iso);
    if (Number.isNaN(date.getTime()) || !id) return null;
    return { createdAt: date, id };
  } catch {
    return null;
  }
}

/**
 * Generate a unique prompt slug. Strategy: kebab the title, retry with -N
 * suffix on conflict. Copied verbatim from submissions.ts:generateUniqueSlug
 * per the spec — keeping ownership inside this repo so the create path is
 * self-contained.
 */
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

// ── listAllPromptsForOwner ──────────────────────────────────────────────

export async function listAllPromptsForOwner(
  filters: OwnerPromptListFilters,
): Promise<{ items: OwnerPromptListItem[]; nextCursor: string | null }> {
  const limit = clampLimit(filters.limit);

  // Resolve category slug → id up front so the WHERE clause stays simple.
  let categoryId: string | undefined;
  if (filters.categorySlug) {
    const [row] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, filters.categorySlug))
      .limit(1);
    if (!row) return { items: [], nextCursor: null };
    categoryId = row.id;
  }

  const conditions = [];

  if (filters.q) {
    const pattern = `%${filters.q}%`;
    conditions.push(
      sql`(${promptsTable.title}->>'zh' ILIKE ${pattern}
          OR ${promptsTable.title}->>'en' ILIKE ${pattern}
          OR ${promptsTable.prompt}->>'zh' ILIKE ${pattern}
          OR ${promptsTable.prompt}->>'en' ILIKE ${pattern}
          OR ${promptsTable.slug} ILIKE ${pattern})`,
    );
  }

  if (categoryId) conditions.push(eq(promptsTable.categoryId, categoryId));

  if (filters.cursor) {
    const decoded = decodeCursor(filters.cursor);
    if (decoded) {
      // Keyset on (createdAt desc, id desc) matching audit/users pattern.
      conditions.push(
        sql`(${promptsTable.createdAt} < ${decoded.createdAt}
            OR (${promptsTable.createdAt} = ${decoded.createdAt} AND ${promptsTable.id} < ${decoded.id}))`,
      );
    }
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: promptsTable.id,
      slug: promptsTable.slug,
      title: promptsTable.title,
      aspectRatio: promptsTable.aspectRatio,
      viewCount: promptsTable.viewCount,
      likeCount: promptsTable.likeCount,
      sendCount: promptsTable.sendCount,
      favoriteCount: promptsTable.favoriteCount,
      approvedAt: promptsTable.approvedAt,
      createdAt: promptsTable.createdAt,
      categoryId: promptsTable.categoryId,
      categorySlug: categories.slug,
      categoryName: categories.name,
      contributorId: promptsTable.contributorId,
      contributorName: users.name,
      contributorImage: users.image,
      sourceSite: promptsTable.sourceSite,
      sourceUrl: promptsTable.sourceUrl,
    })
    .from(promptsTable)
    .innerJoin(categories, eq(categories.id, promptsTable.categoryId))
    .leftJoin(users, eq(users.id, promptsTable.contributorId))
    .where(where)
    .orderBy(desc(promptsTable.createdAt), desc(promptsTable.id))
    .limit(limit + 1);

  const trimmed = rows.slice(0, limit);
  if (trimmed.length === 0) return { items: [], nextCursor: null };

  const ids = trimmed.map((r) => r.id);

  // Primary image (order=0) per prompt — same approach as listPrompts().
  const images = await db
    .select({
      promptId: promptImages.promptId,
      r2AccountId: promptImages.r2AccountId,
      r2Key: promptImages.r2Key,
      remoteUrl: promptImages.remoteUrl,
      width: promptImages.width,
      height: promptImages.height,
      lqip: promptImages.lqip,
      order: promptImages.order,
    })
    .from(promptImages)
    .where(inArray(promptImages.promptId, ids))
    .orderBy(asc(promptImages.order));
  const firstImageByPrompt = new Map<string, (typeof images)[number]>();
  for (const img of images) {
    if (!firstImageByPrompt.has(img.promptId)) firstImageByPrompt.set(img.promptId, img);
  }

  // Tag slugs per prompt (slugs only — the table shows them as a comma list,
  // no name resolution needed for the owner UI).
  const tagsRows = await db
    .select({ promptId: promptTags.promptId, slug: tagsTable.slug })
    .from(promptTags)
    .innerJoin(tagsTable, eq(tagsTable.id, promptTags.tagId))
    .where(inArray(promptTags.promptId, ids));
  const tagSlugsByPrompt = new Map<string, string[]>();
  for (const r of tagsRows) {
    const list = tagSlugsByPrompt.get(r.promptId) ?? [];
    list.push(r.slug);
    tagSlugsByPrompt.set(r.promptId, list);
  }

  const items: OwnerPromptListItem[] = trimmed.map((r) => {
    const img = firstImageByPrompt.get(r.id);
    return {
      id: r.id,
      slug: r.slug,
      title: r.title as Bilingual,
      aspectRatio: r.aspectRatio,
      viewCount: r.viewCount,
      likeCount: r.likeCount,
      sendCount: r.sendCount,
      favoriteCount: r.favoriteCount,
      approvedAt: r.approvedAt,
      createdAt: r.createdAt,
      category: {
        id: r.categoryId,
        slug: r.categorySlug,
        name: r.categoryName as Bilingual,
      },
      contributor: r.contributorId
        ? {
            id: r.contributorId,
            name: r.contributorName,
            image: r.contributorImage,
          }
        : null,
      primaryImage: img
        ? {
            r2AccountId: img.r2AccountId,
            r2Key: img.r2Key,
            remoteUrl: img.remoteUrl,
            width: img.width,
            height: img.height,
            lqip: img.lqip,
          }
        : null,
      tagSlugs: tagSlugsByPrompt.get(r.id) ?? [],
      sourceSite: r.sourceSite,
      sourceUrl: r.sourceUrl,
    };
  });

  const nextCursor =
    rows.length > limit
      ? encodeCursor(
          trimmed[trimmed.length - 1]!.createdAt,
          trimmed[trimmed.length - 1]!.id,
        )
      : null;

  return { items, nextCursor };
}

// ── getPromptForOwner ───────────────────────────────────────────────────

export async function getPromptForOwner(
  id: string,
): Promise<OwnerPromptDetail | null> {
  const [row] = await db
    .select({
      id: promptsTable.id,
      slug: promptsTable.slug,
      title: promptsTable.title,
      prompt: promptsTable.prompt,
      negativePrompt: promptsTable.negativePrompt,
      notes: promptsTable.notes,
      aspectRatio: promptsTable.aspectRatio,
      source: promptsTable.source,
      approvedAt: promptsTable.approvedAt,
      createdAt: promptsTable.createdAt,
      updatedAt: promptsTable.updatedAt,
      categoryId: promptsTable.categoryId,
      categorySlug: categories.slug,
      categoryName: categories.name,
      contributorId: promptsTable.contributorId,
      contributorName: users.name,
      contributorImage: users.image,
      sourceSite: promptsTable.sourceSite,
      sourceUrl: promptsTable.sourceUrl,
    })
    .from(promptsTable)
    .innerJoin(categories, eq(categories.id, promptsTable.categoryId))
    .leftJoin(users, eq(users.id, promptsTable.contributorId))
    .where(eq(promptsTable.id, id))
    .limit(1);

  if (!row) return null;

  const imgRows = await db
    .select()
    .from(promptImages)
    .where(eq(promptImages.promptId, id))
    .orderBy(asc(promptImages.order));

  const tagRows = await db
    .select({ slug: tagsTable.slug })
    .from(promptTags)
    .innerJoin(tagsTable, eq(tagsTable.id, promptTags.tagId))
    .where(eq(promptTags.promptId, id));

  return {
    id: row.id,
    slug: row.slug,
    title: row.title as Bilingual,
    prompt: row.prompt as Bilingual,
    negativePrompt: (row.negativePrompt ?? null) as Bilingual | null,
    notes: (row.notes ?? null) as Bilingual | null,
    aspectRatio: row.aspectRatio,
    source: row.source,
    approvedAt: row.approvedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    category: {
      id: row.categoryId,
      slug: row.categorySlug,
      name: row.categoryName as Bilingual,
    },
    contributor: row.contributorId
      ? {
          id: row.contributorId,
          name: row.contributorName,
          image: row.contributorImage,
        }
      : null,
    tagSlugs: tagRows.map((r) => r.slug),
    images: imgRows.map((i) => ({
      id: i.id,
      r2AccountId: i.r2AccountId,
      r2Key: i.r2Key,
      remoteUrl: i.remoteUrl,
      order: i.order,
      altText: i.altText,
      width: i.width,
      height: i.height,
      lqip: i.lqip,
    })),
    sourceSite: row.sourceSite,
    sourceUrl: row.sourceUrl,
  };
}

// ── createPromptDirect ──────────────────────────────────────────────────

/**
 * Direct create — skips the submissions queue entirely. Caller (the owner
 * route) is responsible for migrating the R2 keys out of submissions/ AFTER
 * this returns and the prompt row exists. We don't fire notifications —
 * the owner is the creator, no one to notify.
 */
export async function createPromptDirect(
  input: OwnerPromptCreateInput,
  ownerId: string,
): Promise<{ id: string; slug: string }> {
  const title = bi(input.titleZh, input.titleEn);
  const prompt = bi(input.promptZh, input.promptEn);
  if (!title || !prompt) {
    throw new Error("createPromptDirect: title/prompt cannot both be empty");
  }

  return await db.transaction(async (tx) => {
    // NSFW marker: ensure the `nsfw` tag is in the tag list when category
    // is nsfw (auto-appended if absent). Other categories unaffected.
    const tagSlugs = await ensureNsfwTag(tx, input.categoryId, input.tagSlugs);
    const slug = await generateUniqueSlug(
      tx,
      input.titleZh ?? input.titleEn ?? "prompt",
    );

    const [p] = await tx
      .insert(promptsTable)
      .values({
        slug,
        source: "site",
        title,
        prompt,
        negativePrompt: bi(input.negativePromptZh, input.negativePromptEn),
        notes: bi(input.notesZh, input.notesEn),
        aspectRatio: input.aspectRatio,
        categoryId: input.categoryId,
        contributorId: ownerId,
        approvedAt: new Date(),
      })
      .returning({ id: promptsTable.id });

    const promptId = p!.id;

    if (tagSlugs.length > 0) {
      const tagRows = await tx
        .select({ id: tagsTable.id, slug: tagsTable.slug })
        .from(tagsTable)
        .where(inArray(tagsTable.slug, tagSlugs));
      if (tagRows.length > 0) {
        await tx
          .insert(promptTags)
          .values(tagRows.map((tg) => ({ promptId, tagId: tg.id })));
        await tx
          .update(tagsTable)
          .set({ usageCount: sql`${tagsTable.usageCount} + 1` })
          .where(inArray(tagsTable.slug, tagSlugs));
      }
    }

    if (input.images.length > 0) {
      await tx.insert(promptImages).values(
        input.images.map((img, idx) => ({
          promptId,
          r2AccountId: img.r2AccountId,
          r2Key: img.r2Key,
          order: idx,
          altText: img.altText ?? null,
          width: img.width ?? null,
          height: img.height ?? null,
          lqip: img.lqip ?? null,
        })),
      );
    }

    return { id: promptId, slug };
  });
}

// ── updatePromptForOwner ────────────────────────────────────────────────

/**
 * Patch any subset of writable fields on a prompt. tagSlugs and images use
 * "replace" semantics:
 *
 *  - tagSlugs: delete existing prompt_tags rows, insert new ones, adjust
 *    tags.usage_count deltas (bump for added slugs, decrement for removed).
 *
 *  - images: diff-replace. We partition the incoming list into kept (r2Key
 *    starts with `prompts/<id>/`) and migrate (r2Key starts with
 *    `submissions/`). Existing rows whose r2Key isn't in the kept set are
 *    removed (and surfaced for R2 cleanup); migrate rows are NOT inserted
 *    here — the route does that AFTER the R2 copyObject succeeds.
 *
 * Returns null if the prompt doesn't exist; the route maps that to 404.
 * Otherwise returns { detail, removedKeys, migrateKeys } so the route can do
 * the R2 work outside this transaction.
 */
export async function updatePromptForOwner(
  id: string,
  patch: OwnerPromptUpdatePatch,
): Promise<OwnerPromptUpdateResult | null> {
  // Existence check up front so we can return null without entering the tx.
  // Also pull categoryId so the NSFW invariant has the existing category to
  // fall back to when the patch omits it.
  const existing = await db
    .select({
      id: promptsTable.id,
      categoryId: promptsTable.categoryId,
      titleZh: sql<string | null>`${promptsTable.title}->>'zh'`,
      titleEn: sql<string | null>`${promptsTable.title}->>'en'`,
      promptZh: sql<string | null>`${promptsTable.prompt}->>'zh'`,
      promptEn: sql<string | null>`${promptsTable.prompt}->>'en'`,
      negZh: sql<string | null>`${promptsTable.negativePrompt}->>'zh'`,
      negEn: sql<string | null>`${promptsTable.negativePrompt}->>'en'`,
      notesZh: sql<string | null>`${promptsTable.notes}->>'zh'`,
      notesEn: sql<string | null>`${promptsTable.notes}->>'en'`,
    })
    .from(promptsTable)
    .where(eq(promptsTable.id, id))
    .limit(1);
  if (existing.length === 0) return null;
  const cur = existing[0]!;

  // Merge bilingual jsonb fields: only overwrite the side the caller actually
  // supplied. A caller that wants to clear a side must send an empty string;
  // `undefined` means "leave as-is".
  function mergeBi(
    curZh: string | null,
    curEn: string | null,
    nextZh: string | null | undefined,
    nextEn: string | null | undefined,
  ): { zh?: string; en?: string } | null {
    const out: { zh?: string; en?: string } = {};
    const finalZh = nextZh !== undefined ? nextZh : curZh;
    const finalEn = nextEn !== undefined ? nextEn : curEn;
    if (finalZh && finalZh.length > 0) out.zh = finalZh;
    if (finalEn && finalEn.length > 0) out.en = finalEn;
    return Object.keys(out).length > 0 ? out : null;
  }

  // Image diff buckets — populated inside the tx, returned by the function.
  const removedKeys: OwnerPromptUpdateResult["removedKeys"] = [];
  const migrateKeys: OwnerPromptUpdateResult["migrateKeys"] = [];

  await db.transaction(async (tx) => {
    // NSFW marker: ensure the `nsfw` tag is present on the POST-PATCH state
    // when category is nsfw. categoryId falls back to the existing row's
    // category; tagSlugs fall back to the existing attached slugs. So
    // moving an existing prompt INTO nsfw (without a tag patch) still
    // gets the marker added.
    const effectiveCategoryId = patch.categoryId ?? cur.categoryId;
    const hasExplicitTagPatch = patch.tagSlugs !== undefined;
    let targetTagSlugs: string[];
    if (hasExplicitTagPatch) {
      targetTagSlugs = patch.tagSlugs!;
    } else {
      const existingTags = await tx
        .select({ slug: tagsTable.slug })
        .from(promptTags)
        .innerJoin(tagsTable, eq(tagsTable.id, promptTags.tagId))
        .where(eq(promptTags.promptId, id));
      targetTagSlugs = existingTags.map((r) => r.slug);
    }
    const effectiveTagSlugs = await ensureNsfwTag(
      tx,
      effectiveCategoryId,
      targetTagSlugs,
    );
    const tagListChanged =
      hasExplicitTagPatch || effectiveTagSlugs.length !== targetTagSlugs.length;

    const setClause: Record<string, unknown> = { updatedAt: sql`now()` };

    if (patch.titleZh !== undefined || patch.titleEn !== undefined) {
      const merged = mergeBi(cur.titleZh, cur.titleEn, patch.titleZh, patch.titleEn);
      if (!merged) throw new Error("title cannot be cleared (bilingual_required)");
      setClause.title = merged;
    }
    if (patch.promptZh !== undefined || patch.promptEn !== undefined) {
      const merged = mergeBi(cur.promptZh, cur.promptEn, patch.promptZh, patch.promptEn);
      if (!merged) throw new Error("prompt cannot be cleared (bilingual_required)");
      setClause.prompt = merged;
    }
    if (patch.negativePromptZh !== undefined || patch.negativePromptEn !== undefined) {
      setClause.negativePrompt = mergeBi(
        cur.negZh,
        cur.negEn,
        patch.negativePromptZh,
        patch.negativePromptEn,
      );
    }
    if (patch.notesZh !== undefined || patch.notesEn !== undefined) {
      setClause.notes = mergeBi(
        cur.notesZh,
        cur.notesEn,
        patch.notesZh,
        patch.notesEn,
      );
    }
    if (patch.aspectRatio !== undefined) setClause.aspectRatio = patch.aspectRatio;
    if (patch.categoryId !== undefined) setClause.categoryId = patch.categoryId;

    // Only update if we have non-trivial changes (updatedAt is the floor — we
    // always bump it so the audit trail captures any PATCH call).
    await tx
      .update(promptsTable)
      .set(setClause as Partial<typeof promptsTable.$inferInsert>)
      .where(eq(promptsTable.id, id));

    if (tagListChanged) {
      // Read current tag slugs inside the tx so the diff includes any rows
      // attached by an earlier-committed patch.
      const existingTags = await tx
        .select({ slug: tagsTable.slug })
        .from(promptTags)
        .innerJoin(tagsTable, eq(tagsTable.id, promptTags.tagId))
        .where(eq(promptTags.promptId, id));
      const before = new Set(existingTags.map((r) => r.slug));
      const after = new Set(effectiveTagSlugs);
      const added = [...after].filter((s) => !before.has(s));
      const removed = [...before].filter((s) => !after.has(s));

      // Wipe & re-insert is simpler than diffing on the join table; the
      // delete+insert is cheap because prompt_tags is keyed on promptId.
      await tx.delete(promptTags).where(eq(promptTags.promptId, id));
      if (effectiveTagSlugs.length > 0) {
        const tagRows = await tx
          .select({ id: tagsTable.id, slug: tagsTable.slug })
          .from(tagsTable)
          .where(inArray(tagsTable.slug, effectiveTagSlugs));
        if (tagRows.length > 0) {
          await tx
            .insert(promptTags)
            .values(tagRows.map((tg) => ({ promptId: id, tagId: tg.id })));
        }
      }
      // Adjust usage_count deltas based on actual slug changes.
      if (added.length > 0) {
        await tx
          .update(tagsTable)
          .set({ usageCount: sql`${tagsTable.usageCount} + 1` })
          .where(inArray(tagsTable.slug, added));
      }
      if (removed.length > 0) {
        await tx
          .update(tagsTable)
          .set({ usageCount: sql`GREATEST(${tagsTable.usageCount} - 1, 0)` })
          .where(inArray(tagsTable.slug, removed));
      }
    }

    // ── Image diff-replace ──────────────────────────────────────────────
    //
    // The incoming list is the authoritative ordering. Every entry must live
    // in either `prompts/<id>/` (already a member — we may reorder it) or
    // `submissions/` (a fresh upload — the route copies it post-tx). Any
    // other prefix is a programmer error and rejects the request.
    if (patch.images !== undefined) {
      const promptPrefix = `prompts/${id}/`;
      for (const img of patch.images) {
        const isKept = img.r2Key.startsWith(promptPrefix);
        const isNew = img.r2Key.startsWith("submissions/");
        if (!isKept && !isNew) {
          throw new Error(`invalid_image_key:${img.r2Key}`);
        }
      }

      const existing = await tx
        .select({
          id: promptImages.id,
          r2AccountId: promptImages.r2AccountId,
          r2Key: promptImages.r2Key,
        })
        .from(promptImages)
        .where(eq(promptImages.promptId, id));

      const keptKeys = new Set(
        patch.images.filter((i) => i.r2Key.startsWith(promptPrefix)).map((i) => i.r2Key),
      );

      // 1. Remove existing rows whose key isn't in the kept set.
      //    Imported rows have null r2 pair → keptKeys.has(null-ish) is always
      //    false, so they get DELETED here (which is fine — the route just
      //    skips R2 cleanup for entries with null r2 pair).
      const removedRows = existing.filter((r) => !keptKeys.has(r.r2Key ?? ""));
      if (removedRows.length > 0) {
        await tx
          .delete(promptImages)
          .where(inArray(promptImages.id, removedRows.map((r) => r.id)));
        for (const r of removedRows) {
          if (r.r2AccountId && r.r2Key) {
            removedKeys.push({ r2AccountId: r.r2AccountId, r2Key: r.r2Key });
          }
        }
      }

      // 2. Reassign `order` on kept rows to match the position in patch.images.
      //
      // We bump every kept row's order to a temporary +1000 offset first so the
      // intermediate values can't collide with the final ones. The two-pass is
      // because prompt_images has no UNIQUE constraint on (promptId, order)
      // today, but a future unique index would make a one-pass UPDATE break
      // if any kept rows shuffle. Cheaper than a partial unique now.
      const keptInOrder: Array<{ id: string; r2Key: string; targetOrder: number }> = [];
      for (let idx = 0; idx < patch.images.length; idx += 1) {
        const img = patch.images[idx]!;
        if (!img.r2Key.startsWith(promptPrefix)) continue;
        const row = existing.find((r) => r.r2Key === img.r2Key);
        if (!row) continue; // Caller asserted it was kept but the row is gone; ignore.
        keptInOrder.push({ id: row.id, r2Key: img.r2Key, targetOrder: idx });
      }
      if (keptInOrder.length > 0) {
        for (const k of keptInOrder) {
          await tx
            .update(promptImages)
            .set({ order: k.targetOrder + 1000 })
            .where(eq(promptImages.id, k.id));
        }
        for (const k of keptInOrder) {
          await tx
            .update(promptImages)
            .set({ order: k.targetOrder })
            .where(eq(promptImages.id, k.id));
        }
      }

      // 3. Collect migrate buckets — the route INSERTs after copyObject.
      for (let idx = 0; idx < patch.images.length; idx += 1) {
        const img = patch.images[idx]!;
        if (!img.r2Key.startsWith("submissions/")) continue;
        migrateKeys.push({
          r2AccountId: img.r2AccountId,
          r2Key: img.r2Key,
          altText: img.altText ?? null,
          width: img.width ?? null,
          height: img.height ?? null,
          lqip: img.lqip ?? null,
          targetOrder: idx,
        });
      }
    }
  });

  const detail = await getPromptForOwner(id);
  if (!detail) return null;
  return { detail, removedKeys, migrateKeys };
}

// ── deletePromptForOwner ────────────────────────────────────────────────

/**
 * Hard delete with manual cleanup. Cascade handles prompt_tags, likes,
 * favorites, view_log. We still need to:
 *   1. read prompt_images so the route can best-effort delete R2 objects
 *   2. decrement tags.usage_count for every attached tag
 *   3. NULL submissions.promoted_to (FK is ON DELETE no action)
 *   4. DELETE prompt_images (no FK cascade on prompt_id)
 *   5. DELETE the prompt row
 *
 * notifications.payload is jsonb-only with no FK column, so it's left as-is;
 * the broken `promptId` in old payloads is a soft reference and the UI
 * tolerates a missing target.
 *
 * Returns null when the prompt doesn't exist (route → 404).
 */
export async function deletePromptForOwner(
  id: string,
): Promise<{
  deleted: true;
  imageKeys: Array<{ r2AccountId: string; r2Key: string }>;
} | null> {
  const existing = await db
    .select({ id: promptsTable.id })
    .from(promptsTable)
    .where(eq(promptsTable.id, id))
    .limit(1);
  if (existing.length === 0) return null;

  return await db.transaction(async (tx) => {
    // 1. Capture images for the route's post-tx R2 cleanup.
    const imgs = await tx
      .select({
        r2AccountId: promptImages.r2AccountId,
        r2Key: promptImages.r2Key,
      })
      .from(promptImages)
      .where(eq(promptImages.promptId, id));

    // 2. Decrement tags.usage_count for every attached tag.
    const tagRows = await tx
      .select({ slug: tagsTable.slug })
      .from(promptTags)
      .innerJoin(tagsTable, eq(tagsTable.id, promptTags.tagId))
      .where(eq(promptTags.promptId, id));
    if (tagRows.length > 0) {
      await tx
        .update(tagsTable)
        .set({ usageCount: sql`GREATEST(${tagsTable.usageCount} - 1, 0)` })
        .where(inArray(tagsTable.slug, tagRows.map((r) => r.slug)));
    }

    // 3. NULL non-cascading FKs into prompts so the DELETE isn't blocked.
    //    All three are ON DELETE NO ACTION in the actual DB (see migrations
    //    0006 / 0011 — neither carries an onDelete clause):
    //      - submissions.promoted_to  (post-approval published prompt pointer)
    //      - submissions.original_prompt_id  (self-edit target, migration 0011)
    //      - import_tokens.prompt_id  (studio launch tokens, migration 0006)
    //    `prompt_tags`, `likes`, `favorites`, `view_log`, `user_pinned_prompts`
    //    all cascade on prompt delete — no manual NULL needed.
    await tx
      .update(submissions)
      .set({ promotedTo: null })
      .where(eq(submissions.promotedTo, id));
    await tx
      .update(submissions)
      .set({ originalPromptId: null })
      .where(eq(submissions.originalPromptId, id));
    await tx
      .update(importTokens)
      .set({ promptId: null })
      .where(eq(importTokens.promptId, id));

    // 4. DELETE prompt_images (no FK cascade on prompt_id).
    await tx.delete(promptImages).where(eq(promptImages.promptId, id));

    // 5. DELETE the prompt row — cascade clears prompt_tags / likes /
    //    favorites / view_log.
    await tx.delete(promptsTable).where(eq(promptsTable.id, id));

    return {
      deleted: true as const,
      // Only R2-backed images are surfaced for cleanup; imported (remoteUrl)
      // rows have a null r2 pair and the route has nothing to delete from R2.
      imageKeys: imgs
        .filter(
          (i): i is { r2AccountId: string; r2Key: string } =>
            i.r2AccountId !== null && i.r2Key !== null,
        )
        .map((i) => ({ r2AccountId: i.r2AccountId, r2Key: i.r2Key })),
    };
  });
}
