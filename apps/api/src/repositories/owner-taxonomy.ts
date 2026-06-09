import { asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { categories, tags, prompts, promptTags } from "../db/schema/index.ts";

// ── Types ────────────────────────────────────────────────────────────────
//
// Owner-only types: this repo is for the owner console's category + tag
// management surface. The public read paths (apps/api/src/repositories/
// categories.ts / tags.ts) project a narrower shape; we add fields that the
// owner cares about (promptCount derived from the JOIN, full createdAt)
// and keep the bilingual JSONB nullability honest.
//
// `Bilingual` permits zh and/or en; the route layer rejects both-empty.
// exactOptionalPropertyTypes is on, so `?:` here means "key may be absent";
// callers that have a possibly-undefined value must omit the key rather
// than set it to undefined.

export type Bilingual = { zh?: string; en?: string };

export type CategoryRow = {
  id: string;
  slug: string;
  name: Bilingual;
  description: Bilingual | null;
  order: number;
  promptCount: number;
  createdAt: Date;
};

export type TagRow = {
  id: string;
  slug: string;
  name: Bilingual;
  usageCount: number; // tags.usage_count column — incremented by approve flow
  promptCount: number; // live JOIN count via prompt_tags — source of truth
  createdAt: Date;
};

export type CategoryCreateInput = {
  slug: string;
  name: Bilingual;
  description?: Bilingual;
  order?: number;
};

export type CategoryUpdateInput = Partial<CategoryCreateInput>;

export type TagCreateInput = {
  slug: string;
  name: Bilingual;
};

export type TagUpdateInput = Partial<TagCreateInput>;

// ── Categories ──────────────────────────────────────────────────────────

const categoryPromptCountSql = sql<number>`(
  SELECT count(*)::int
  FROM ${prompts}
  WHERE ${prompts.categoryId} = ${categories.id}
)`;

/**
 * Full owner list. `promptCount` is a correlated subquery against `prompts`
 * — keeps the row shape consistent with the public listCategories() but
 * always uses the global (unscoped) count. Ordered by display order then
 * slug so the list is deterministic across runs.
 */
export async function listCategoriesForOwner(): Promise<CategoryRow[]> {
  const rows = await db
    .select({
      id: categories.id,
      slug: categories.slug,
      name: categories.name,
      description: categories.description,
      order: categories.order,
      promptCount: categoryPromptCountSql,
      createdAt: categories.createdAt,
    })
    .from(categories)
    .orderBy(asc(categories.order), asc(categories.slug));
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name as Bilingual,
    description: (r.description ?? null) as Bilingual | null,
    order: r.order,
    promptCount: Number(r.promptCount ?? 0),
    createdAt: r.createdAt,
  }));
}

export async function getCategoryForOwner(
  id: string,
): Promise<CategoryRow | null> {
  const rows = await db
    .select({
      id: categories.id,
      slug: categories.slug,
      name: categories.name,
      description: categories.description,
      order: categories.order,
      promptCount: categoryPromptCountSql,
      createdAt: categories.createdAt,
    })
    .from(categories)
    .where(eq(categories.id, id))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    slug: r.slug,
    name: r.name as Bilingual,
    description: (r.description ?? null) as Bilingual | null,
    order: r.order,
    promptCount: Number(r.promptCount ?? 0),
    createdAt: r.createdAt,
  };
}

export async function createCategory(
  input: CategoryCreateInput,
): Promise<CategoryRow> {
  // Build INSERT values key-by-key so exactOptionalPropertyTypes:true
  // doesn't see `{ description: undefined }` against a column that types
  // its value as `Bilingual | null | undefined`.
  const values: Partial<typeof categories.$inferInsert> & {
    slug: string;
    name: Bilingual;
  } = {
    slug: input.slug,
    name: input.name,
  };
  if (input.description !== undefined) values.description = input.description;
  if (input.order !== undefined) values.order = input.order;
  const [row] = await db
    .insert(categories)
    .values(values as typeof categories.$inferInsert)
    .returning();
  if (!row) throw new Error("category insert returned no row");
  // Re-read via the projection so the response carries the computed
  // promptCount (always 0 for a fresh row, but cheap + consistent).
  const got = await getCategoryForOwner(row.id);
  if (!got) throw new Error("category reread missed");
  return got;
}

export async function updateCategory(
  id: string,
  input: CategoryUpdateInput,
): Promise<CategoryRow | null> {
  // Build the SET clause from only the keys the caller actually supplied —
  // same exactOptionalPropertyTypes guard the announcements repo uses.
  const patch: Record<string, unknown> = {};
  if (input.slug !== undefined) patch.slug = input.slug;
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.order !== undefined) patch.order = input.order;
  if (Object.keys(patch).length === 0) {
    // Nothing to update — but we still need to know whether the row exists
    // so the caller can map "no fields + missing row" to 404 cleanly.
    return getCategoryForOwner(id);
  }
  const [row] = await db
    .update(categories)
    .set(patch as Partial<typeof categories.$inferInsert>)
    .where(eq(categories.id, id))
    .returning({ id: categories.id });
  if (!row) return null;
  return getCategoryForOwner(id);
}

/**
 * Hard delete — categories have no soft_delete column. Refuse to delete when
 * any prompt rows reference this category (`prompts.category_id` FK is NOT
 * NULL, so deleting an in-use category would either fail with FK 23503 or
 * cascade-orphan published content; either way the right answer is "ask the
 * owner to migrate the affected prompts first"). Returns a discriminated
 * union the route layer maps onto HTTP statuses.
 */
export async function deleteCategory(
  id: string,
): Promise<
  | { ok: true }
  | { ok: false; reason: "in_use"; count: number }
  | { ok: false; reason: "not_found" }
> {
  // Existence check first so we can return "not_found" without consulting
  // the prompts table (small but pleasant savings on the happy 404 path).
  const existing = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.id, id))
    .limit(1);
  if (existing.length === 0) {
    return { ok: false, reason: "not_found" };
  }
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(prompts)
    .where(eq(prompts.categoryId, id));
  const usage = Number(count ?? 0);
  if (usage > 0) {
    return { ok: false, reason: "in_use", count: usage };
  }
  await db.delete(categories).where(eq(categories.id, id));
  return { ok: true };
}

// ── Tags ────────────────────────────────────────────────────────────────

const tagPromptCountSql = sql<number>`(
  SELECT count(*)::int
  FROM ${promptTags}
  WHERE ${promptTags.tagId} = ${tags.id}
)`;

/**
 * Full owner list. `usageCount` returns the precomputed `tags.usage_count`
 * column; `promptCount` is a fresh correlated count against `prompt_tags`.
 * The two can drift if the approve flow's bumpUsage drifts from the live
 * data (no resync job exists yet), so the owner UI shows both side-by-side.
 */
export async function listTagsForOwner(): Promise<TagRow[]> {
  const rows = await db
    .select({
      id: tags.id,
      slug: tags.slug,
      name: tags.name,
      usageCount: tags.usageCount,
      promptCount: tagPromptCountSql,
      createdAt: tags.createdAt,
    })
    .from(tags)
    .orderBy(desc(tags.usageCount), asc(tags.slug));
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name as Bilingual,
    usageCount: Number(r.usageCount ?? 0),
    promptCount: Number(r.promptCount ?? 0),
    createdAt: r.createdAt,
  }));
}

export async function getTagForOwner(id: string): Promise<TagRow | null> {
  const rows = await db
    .select({
      id: tags.id,
      slug: tags.slug,
      name: tags.name,
      usageCount: tags.usageCount,
      promptCount: tagPromptCountSql,
      createdAt: tags.createdAt,
    })
    .from(tags)
    .where(eq(tags.id, id))
    .limit(1);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    slug: r.slug,
    name: r.name as Bilingual,
    usageCount: Number(r.usageCount ?? 0),
    promptCount: Number(r.promptCount ?? 0),
    createdAt: r.createdAt,
  };
}

export async function createTag(input: TagCreateInput): Promise<TagRow> {
  const [row] = await db
    .insert(tags)
    .values({
      slug: input.slug,
      name: input.name,
    })
    .returning();
  if (!row) throw new Error("tag insert returned no row");
  const got = await getTagForOwner(row.id);
  if (!got) throw new Error("tag reread missed");
  return got;
}

export async function updateTag(
  id: string,
  input: TagUpdateInput,
): Promise<TagRow | null> {
  const patch: Record<string, unknown> = {};
  if (input.slug !== undefined) patch.slug = input.slug;
  if (input.name !== undefined) patch.name = input.name;
  if (Object.keys(patch).length === 0) {
    return getTagForOwner(id);
  }
  const [row] = await db
    .update(tags)
    .set(patch as Partial<typeof tags.$inferInsert>)
    .where(eq(tags.id, id))
    .returning({ id: tags.id });
  if (!row) return null;
  return getTagForOwner(id);
}

/**
 * Hard delete with usage protection. We refuse when any prompt_tags row
 * references this tag — same posture as deleteCategory. We check
 * prompt_tags (the live JOIN) rather than tags.usage_count because the
 * precomputed counter can drift from the truth between approve cycles.
 */
export async function deleteTag(
  id: string,
): Promise<
  | { ok: true }
  | { ok: false; reason: "in_use"; count: number }
  | { ok: false; reason: "not_found" }
> {
  const existing = await db
    .select({ id: tags.id })
    .from(tags)
    .where(eq(tags.id, id))
    .limit(1);
  if (existing.length === 0) {
    return { ok: false, reason: "not_found" };
  }
  const [{ count } = { count: 0 }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(promptTags)
    .where(eq(promptTags.tagId, id));
  const usage = Number(count ?? 0);
  if (usage > 0) {
    return { ok: false, reason: "in_use", count: usage };
  }
  await db.delete(tags).where(eq(tags.id, id));
  return { ok: true };
}
