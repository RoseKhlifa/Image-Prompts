// Fix dev DB state polluted by tests + missing contributorId on prompt "12".
// Idempotent.
import { sql } from "drizzle-orm";
import { db } from "../src/db/client.ts";

async function main() {
  // 1. Backfill prompt `12` contributor from its submission's contributor_id
  //    (or use the only admin user if no matching submission exists).
  const backfill = await db.execute(sql.raw(`
    UPDATE prompts p
    SET contributor_id = (
      SELECT s.contributor_id FROM submissions s
      WHERE s.promoted_to = p.id LIMIT 1
    )
    WHERE p.contributor_id IS NULL
      AND EXISTS (SELECT 1 FROM submissions s WHERE s.promoted_to = p.id AND s.contributor_id IS NOT NULL)
  `));
  console.log(`Backfilled contributor_id from submissions: ${backfill.rowCount ?? "?"} rows`);

  // For prompts still NULL but where there's only one admin (typical dev case), set to that admin.
  const fallback = await db.execute(sql.raw(`
    UPDATE prompts p
    SET contributor_id = (SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1)
    WHERE p.contributor_id IS NULL
      AND (SELECT COUNT(*) FROM users WHERE role = 'admin') = 1
  `));
  console.log(`Backfilled contributor_id to sole admin: ${fallback.rowCount ?? "?"} rows`);

  // 2. Resync prompts counters (likes/favorites/views/sends)
  const counters = await db.execute(sql.raw(`
    UPDATE prompts p SET
      like_count     = COALESCE((SELECT COUNT(*)::int FROM likes WHERE prompt_id = p.id), 0),
      favorite_count = COALESCE((SELECT COUNT(*)::int FROM favorites WHERE prompt_id = p.id), 0),
      view_count     = COALESCE((SELECT COUNT(*)::int FROM view_log WHERE prompt_id = p.id), 0),
      send_count     = COALESCE((SELECT COUNT(*)::int FROM import_tokens WHERE prompt_id = p.id AND used_at IS NOT NULL), 0)
  `));
  console.log(`Resynced prompt counters: ${counters.rowCount ?? "?"} rows`);

  // 3. (skipped: categories has no stored prompt_count column — sidebar computes at query time)

  // 4. Resync tags.usage_count
  const tags = await db.execute(sql.raw(`
    UPDATE tags t SET
      usage_count = COALESCE((SELECT COUNT(*)::int FROM prompt_tags WHERE tag_id = t.id), 0)
  `));
  console.log(`Resynced tag usage_count: ${tags.rowCount ?? "?"} rows`);

  // 5. Snapshot AFTER
  console.log("\n--- prompts after ---");
  const after = await db.execute(sql.raw(`
    SELECT slug, contributor_id IS NOT NULL AS has_contributor, like_count, favorite_count, view_count, send_count
    FROM prompts ORDER BY approved_at DESC
  `));
  for (const row of (after.rows ?? after)) console.log(row);

  console.log("\n--- tags with usage > 0 after ---");
  const tagsAfter = await db.execute(sql.raw(`
    SELECT slug, usage_count FROM tags WHERE usage_count > 0 ORDER BY usage_count DESC
  `));
  for (const row of (tagsAfter.rows ?? tagsAfter)) console.log(row);

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
