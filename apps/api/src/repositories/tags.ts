import { sql, asc, desc, inArray, eq, and, ne } from "drizzle-orm";
import { db } from "../db/client.ts";
import { tags, promptTags, favorites, prompts, categories } from "../db/schema/index.ts";

// The `nsfw` tag is an internal marker (every NSFW-category prompt carries it,
// and only it). It must never appear in the sidebar tag list or the submission
// autocomplete — the category is the user-facing entry point.
const NSFW_TAG_SLUG = "nsfw";

export type TagScope =
  | { kind: "favorites"; userId: string }
  | { kind: "mine"; userId: string };

/**
 * Return tags ordered by usage, where usage is counted within `scope`:
 *
 *   undefined  — global: tags.usage_count (precomputed at approve/delete time)
 *   favorites  — only tags attached to the user's favorited prompts
 *   mine       — only tags attached to the user's own (contributed) prompts
 *
 * Scoped variants JOIN prompt_tags + the scoping table and return only tags
 * with ≥1 match (no "0-everywhere" rows — keeps the sidebar focused on
 * tags the user actually has data for).
 */
/**
 * `categorySlug` (optional) further narrows the count to prompts in that
 * category. Combines with `scope` — e.g. `mine` + `categorySlug="food"`
 * returns tags from the user's own food prompts. With neither set, the
 * fast-path query reads precomputed `usage_count`.
 */
export async function listTags(
  limit = 100,
  scope?: TagScope,
  categorySlug?: string,
) {
  // Fast path: no scope, no category — use precomputed usage_count.
  if (!scope && !categorySlug) {
    const rows = await db
      .select()
      .from(tags)
      .where(ne(tags.slug, NSFW_TAG_SLUG))
      .orderBy(desc(tags.usageCount), asc(tags.slug))
      .limit(limit);
    return rows.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      usageCount: t.usageCount,
    }));
  }

  // Otherwise count occurrences via JOIN, with optional category + scope filters.
  const scopedCount = sql<number>`count(*)::int`;

  // Category-only (no user scope) — JOIN prompts + categories, count occurrences.
  if (!scope && categorySlug) {
    const rows = await db
      .select({
        id: tags.id,
        slug: tags.slug,
        name: tags.name,
        usageCount: scopedCount,
      })
      .from(tags)
      .innerJoin(promptTags, eq(promptTags.tagId, tags.id))
      .innerJoin(prompts, eq(prompts.id, promptTags.promptId))
      .innerJoin(categories, eq(categories.id, prompts.categoryId))
      .where(and(ne(tags.slug, NSFW_TAG_SLUG), eq(categories.slug, categorySlug)))
      .groupBy(tags.id, tags.slug, tags.name)
      .orderBy(desc(scopedCount), asc(tags.slug))
      .limit(limit);
    return rows.map((r) => ({ ...r, usageCount: Number(r.usageCount ?? 0) }));
  }

  if (scope?.kind === "favorites") {
    // favorites scope, optionally narrowed to a category.
    const rows = await db
      .select({
        id: tags.id,
        slug: tags.slug,
        name: tags.name,
        usageCount: scopedCount,
      })
      .from(tags)
      .innerJoin(promptTags, eq(promptTags.tagId, tags.id))
      .innerJoin(
        favorites,
        and(
          eq(favorites.promptId, promptTags.promptId),
          eq(favorites.userId, scope.userId),
        ),
      )
      // Join prompts + categories ONLY when categorySlug is requested — they
      // don't influence the favorites filter otherwise.
      .innerJoin(prompts, eq(prompts.id, promptTags.promptId))
      .innerJoin(categories, eq(categories.id, prompts.categoryId))
      .where(
        and(
          ne(tags.slug, NSFW_TAG_SLUG),
          categorySlug ? eq(categories.slug, categorySlug) : undefined,
        ),
      )
      .groupBy(tags.id, tags.slug, tags.name)
      .orderBy(desc(scopedCount), asc(tags.slug))
      .limit(limit);
    return rows.map((r) => ({ ...r, usageCount: Number(r.usageCount ?? 0) }));
  }

  // scope.kind === "mine" (with or without category)
  const rows = await db
    .select({
      id: tags.id,
      slug: tags.slug,
      name: tags.name,
      usageCount: scopedCount,
    })
    .from(tags)
    .innerJoin(promptTags, eq(promptTags.tagId, tags.id))
    .innerJoin(
      prompts,
      and(
        eq(prompts.id, promptTags.promptId),
        eq(prompts.contributorId, scope!.userId),
      ),
    )
    .innerJoin(categories, eq(categories.id, prompts.categoryId))
    .where(
      and(
        ne(tags.slug, NSFW_TAG_SLUG),
        categorySlug ? eq(categories.slug, categorySlug) : undefined,
      ),
    )
    .groupBy(tags.id, tags.slug, tags.name)
    .orderBy(desc(scopedCount), asc(tags.slug))
    .limit(limit);
  return rows.map((r) => ({ ...r, usageCount: Number(r.usageCount ?? 0) }));
}

/**
 * Autocomplete for the submission form's TagPicker. Empty q returns top
 * usageCount-ordered. Non-empty q matches against slug OR bilingual name
 * (zh, en) by substring (case-insensitive for ascii).
 */
export async function searchTags(q: string, limit = 8) {
  const trimmed = q.trim();
  if (trimmed.length === 0) {
    const rows = await db
      .select()
      .from(tags)
      .where(ne(tags.slug, NSFW_TAG_SLUG))
      .orderBy(desc(tags.usageCount), asc(tags.slug))
      .limit(limit);
    return rows.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      usageCount: t.usageCount,
    }));
  }
  const like = `%${trimmed}%`;
  const rows = await db
    .select()
    .from(tags)
    .where(
      and(
        ne(tags.slug, NSFW_TAG_SLUG),
        sql`(${tags.slug} ILIKE ${like}
          OR (${tags.name} ->> 'zh') ILIKE ${like}
          OR (${tags.name} ->> 'en') ILIKE ${like})`,
      ),
    )
    .orderBy(desc(tags.usageCount), asc(tags.slug))
    .limit(limit);
  return rows.map((t) => ({
    id: t.id,
    slug: t.slug,
    name: t.name,
    usageCount: t.usageCount,
  }));
}

/**
 * Resolve a list of slugs to rows. Returns a Map<slug, row>. Callers use this
 * both to validate that all submitted slugs exist in the whitelist AND to
 * resolve slugs → tag ids for the prompt_tags insert at approve time.
 */
export async function getTagsBySlugs(slugs: ReadonlyArray<string>) {
  if (slugs.length === 0) return new Map<string, typeof tags.$inferSelect>();
  const rows = await db.select().from(tags).where(inArray(tags.slug, [...slugs]));
  return new Map(rows.map((r) => [r.slug, r]));
}

/**
 * Increment usageCount by 1 for every matching slug. Called from inside the
 * approve transaction so the count tracks "how many published prompts use
 * this tag". Noop on empty input (saves a SQL round-trip).
 */
export async function bumpUsage(slugs: ReadonlyArray<string>): Promise<void> {
  if (slugs.length === 0) return;
  await db
    .update(tags)
    .set({ usageCount: sql`${tags.usageCount} + 1` })
    .where(inArray(tags.slug, [...slugs]));
}
