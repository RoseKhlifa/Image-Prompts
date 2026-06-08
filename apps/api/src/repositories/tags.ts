import { sql, asc, desc, inArray, eq, and } from "drizzle-orm";
import { db } from "../db/client.ts";
import { tags, promptTags, favorites, prompts } from "../db/schema/index.ts";

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
export async function listTags(limit = 100, scope?: TagScope) {
  if (!scope) {
    const rows = await db
      .select()
      .from(tags)
      .orderBy(desc(tags.usageCount), asc(tags.slug))
      .limit(limit);
    return rows.map((t) => ({
      id: t.id,
      slug: t.slug,
      name: t.name,
      usageCount: t.usageCount,
    }));
  }

  const scopedCount = sql<number>`count(*)::int`;

  if (scope.kind === "favorites") {
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
      .groupBy(tags.id, tags.slug, tags.name)
      .orderBy(desc(scopedCount), asc(tags.slug))
      .limit(limit);
    return rows.map((r) => ({ ...r, usageCount: Number(r.usageCount ?? 0) }));
  }

  // scope.kind === "mine"
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
        eq(prompts.contributorId, scope.userId),
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
      sql`${tags.slug} ILIKE ${like}
          OR (${tags.name} ->> 'zh') ILIKE ${like}
          OR (${tags.name} ->> 'en') ILIKE ${like}`,
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
