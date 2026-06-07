import { sql, asc, desc, inArray } from "drizzle-orm";
import { db } from "../db/client.ts";
import { tags } from "../db/schema/index.ts";

export async function listTags(limit = 100) {
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
