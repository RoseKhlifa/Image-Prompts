/**
 * One-shot: walk every existing tag through `lookupCanonicalTag()` and merge
 * aliases into their canonical row. After this runs:
 *   - Tags that match the canonical map gain a proper bilingual name + the
 *     canonical slug (creates the canonical row if it didn't already exist).
 *   - prompt_tags rows pointing at alias tags are re-pointed to the canonical
 *     id (with ON CONFLICT DO NOTHING so duplicate (prompt, canonical) pairs
 *     don't blow up).
 *   - The alias tag rows are deleted.
 *   - tag.usage_count is recomputed from prompt_tags so the post-merge counts
 *     are accurate.
 *
 * Idempotent: re-running is safe — already-canonical tags are touched only
 * to refresh the bilingual name, alias rows that no longer exist are no-ops.
 */
import { db } from "../src/db/client.ts";
import { tags, promptTags } from "../src/db/schema/index.ts";
import { eq, sql, inArray } from "drizzle-orm";
import { lookupCanonicalTag, type TagCanon } from "../src/lib/tag-normalize.ts";

type ExistingTag = {
  id: string;
  slug: string;
  name: { zh?: string; en?: string } | null;
  usageCount: number;
};

async function ensureCanonical(canon: TagCanon): Promise<string> {
  await db
    .insert(tags)
    .values({ slug: canon.slug, name: { zh: canon.zh, en: canon.en } })
    .onConflictDoUpdate({
      target: tags.slug,
      set: { name: { zh: canon.zh, en: canon.en } },
    });
  const [row] = await db
    .select({ id: tags.id })
    .from(tags)
    .where(eq(tags.slug, canon.slug))
    .limit(1);
  return row!.id;
}

async function main() {
  const existing = (await db
    .select({
      id: tags.id,
      slug: tags.slug,
      name: tags.name,
      usageCount: tags.usageCount,
    })
    .from(tags)) as ExistingTag[];

  console.log(`Found ${existing.length} tags total.\n`);

  let touched = 0;
  let merged = 0;
  let untouched = 0;

  for (const t of existing) {
    const probes = [t.slug, t.name?.zh ?? "", t.name?.en ?? ""].filter(Boolean);
    let canon: TagCanon | null = null;
    for (const p of probes) {
      canon = lookupCanonicalTag(p);
      if (canon) break;
    }

    if (!canon) {
      untouched++;
      console.log(`  · skip   ${t.slug}  (no canon match)`);
      continue;
    }

    if (t.slug === canon.slug) {
      // Already canonical slug — just refresh the bilingual name.
      await db
        .update(tags)
        .set({ name: { zh: canon.zh, en: canon.en } })
        .where(eq(tags.id, t.id));
      touched++;
      console.log(`  · rename ${t.slug}  →  ${canon.zh} / ${canon.en}`);
      continue;
    }

    // Alias — merge into canonical.
    const canonId = await ensureCanonical(canon);

    // Move prompt_tags rows: insert (prompt_id, canonId) ON CONFLICT DO NOTHING,
    // then delete the alias rows. Drizzle doesn't have a single-statement
    // "INSERT … SELECT" so we do it via raw SQL.
    await db.execute(sql`
      INSERT INTO prompt_tags (prompt_id, tag_id)
      SELECT prompt_id, ${canonId}::uuid FROM prompt_tags WHERE tag_id = ${t.id}::uuid
      ON CONFLICT DO NOTHING
    `);
    await db.delete(promptTags).where(eq(promptTags.tagId, t.id));
    await db.delete(tags).where(eq(tags.id, t.id));

    merged++;
    console.log(`  ✓ merge  ${t.slug}  →  ${canon.slug}  (${canon.zh} / ${canon.en})`);
  }

  // Recompute usage_count from prompt_tags as the source of truth.
  console.log(`\nRecomputing tag usage_count from prompt_tags…`);
  await db.execute(sql`
    UPDATE tags t
    SET usage_count = COALESCE(c.n, 0)
    FROM (
      SELECT tag_id, COUNT(*)::int AS n FROM prompt_tags GROUP BY tag_id
    ) c
    WHERE c.tag_id = t.id
  `);
  await db.execute(sql`
    UPDATE tags SET usage_count = 0
    WHERE id NOT IN (SELECT tag_id FROM prompt_tags)
  `);

  const finalCount = await db.select({ n: sql<number>`count(*)::int` }).from(tags);
  console.log(`\nSummary:`);
  console.log(`  renamed:  ${touched}`);
  console.log(`  merged:   ${merged}`);
  console.log(`  skipped:  ${untouched}`);
  console.log(`  tags now: ${finalCount[0]?.n ?? 0}`);

  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
