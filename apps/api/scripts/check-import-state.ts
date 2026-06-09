/**
 * One-shot verification of import state after the import sprint.
 * Reports total imported prompts, source-site breakdown, contributor presence,
 * and confirms the user's `冒险角色设计稿` prompt is still attributed correctly.
 *
 * Safe to run anytime — read-only.
 */
import { db } from "../src/db/client.ts";
import { prompts, importBatches } from "../src/db/schema/index.ts";
import { sql, eq, desc } from "drizzle-orm";

async function main() {
  const total = await db.execute(sql`SELECT COUNT(*)::int AS n FROM prompts WHERE source='imported'`);
  console.log("imported prompts:", total.rows);

  const bySite = await db.execute(sql`
    SELECT source_site, COUNT(*)::int AS n
    FROM prompts WHERE source='imported'
    GROUP BY source_site ORDER BY n DESC
  `);
  console.log("by source_site:");
  for (const r of bySite.rows) console.log("  ", r);

  // Imports attribute to the running admin (2026-06-09 UX decision).
  // Source attribution survives on source_site/source_url; cards render
  // the contributor normally.
  const attributed = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM prompts
    WHERE source='imported' AND contributor_id IS NOT NULL
  `);
  console.log("imported with attributed contributor:", attributed.rows);

  const userPrompt = await db
    .select({ slug: prompts.slug, contributorId: prompts.contributorId, source: prompts.source })
    .from(prompts)
    .where(eq(prompts.slug, "冒险角色设计稿"))
    .limit(1);
  console.log("user prompt:", userPrompt);

  const recentBatches = await db
    .select()
    .from(importBatches)
    .orderBy(desc(importBatches.startedAt))
    .limit(10);
  console.log("recent batches:");
  for (const b of recentBatches) {
    console.log(
      `  ${b.startedAt.toISOString()}  ${b.categorySlug.padEnd(24)}  ${b.dryRun ? "dry" : "live"}  +${b.inserted} ~${b.skippedDuplicate} !${b.failed}  ${b.status}`,
    );
  }

  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
