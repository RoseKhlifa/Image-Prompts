// One-shot: inspect each prompt's contributorId + counters + tags
import { sql } from "drizzle-orm";
import { db } from "../src/db/client.ts";

async function main() {
  const r = await db.execute(sql.raw(`
    SELECT
      p.slug,
      p.contributor_id IS NOT NULL AS has_contributor,
      p.contributor_id,
      u.email AS contributor_email,
      p.like_count, p.favorite_count, p.view_count, p.send_count,
      p.category_id,
      c.slug AS category_slug,
      ARRAY(SELECT t.slug FROM prompt_tags pt JOIN tags t ON pt.tag_id = t.id WHERE pt.prompt_id = p.id) AS tags
    FROM prompts p
    LEFT JOIN users u ON u.id = p.contributor_id
    LEFT JOIN categories c ON c.id = p.category_id
    ORDER BY p.approved_at DESC
  `));
  for (const row of (r.rows ?? r)) {
    console.log(row);
  }

  console.log("\n--- Categories with stale counts ---");
  const cats = await db.execute(sql.raw(`
    SELECT c.slug, c.prompt_count,
      (SELECT COUNT(*)::int FROM prompts p WHERE p.category_id = c.id) AS actual
    FROM categories c
    ORDER BY c.slug
  `));
  for (const row of (cats.rows ?? cats)) console.log(row);

  console.log("\n--- Tags with stale usage_count ---");
  const tags = await db.execute(sql.raw(`
    SELECT t.slug, t.usage_count,
      (SELECT COUNT(*)::int FROM prompt_tags pt WHERE pt.tag_id = t.id) AS actual
    FROM tags t
    WHERE t.usage_count > 0 OR EXISTS (SELECT 1 FROM prompt_tags pt WHERE pt.tag_id = t.id)
    ORDER BY t.usage_count DESC
  `));
  for (const row of (tags.rows ?? tags)) console.log(row);

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
