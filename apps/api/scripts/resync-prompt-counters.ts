// Resync denormalized counters on `prompts` to match the source-of-truth
// tables. Use this after the test suite has polluted dev counters (the test
// fixtures bump like_count/favorite_count/view_count/send_count without
// rolling them back).
//
// Cardinality source:
//   like_count     ← SELECT COUNT(*) FROM likes WHERE prompt_id = p.id
//   favorite_count ← SELECT COUNT(*) FROM favorites WHERE prompt_id = p.id
//   view_count     ← SELECT COUNT(*) FROM view_log WHERE prompt_id = p.id
//   send_count     ← SELECT COUNT(*) FROM import_tokens WHERE prompt_id = p.id AND used_at IS NOT NULL
import { sql } from "drizzle-orm";
import { db } from "../src/db/client.ts";

async function main() {
  // 1. Snapshot before
  const beforeRows = await db.execute(sql.raw(
    `SELECT slug, like_count, favorite_count, view_count, send_count FROM prompts ORDER BY slug`,
  ));
  console.log("--- BEFORE ---");
  for (const r of (beforeRows.rows ?? beforeRows)) console.log(r);

  // 2. Apply resync in one statement
  const result = await db.execute(sql.raw(`
    UPDATE prompts p SET
      like_count     = COALESCE((SELECT COUNT(*)::int FROM likes WHERE prompt_id = p.id), 0),
      favorite_count = COALESCE((SELECT COUNT(*)::int FROM favorites WHERE prompt_id = p.id), 0),
      view_count     = COALESCE((SELECT COUNT(*)::int FROM view_log WHERE prompt_id = p.id), 0),
      send_count     = COALESCE((SELECT COUNT(*)::int FROM import_tokens WHERE prompt_id = p.id AND used_at IS NOT NULL), 0)
  `));
  console.log(`\nResynced ${result.rowCount ?? "?"} prompts.`);

  // 3. Snapshot after
  const afterRows = await db.execute(sql.raw(
    `SELECT slug, like_count, favorite_count, view_count, send_count FROM prompts ORDER BY slug`,
  ));
  console.log("\n--- AFTER ---");
  for (const r of (afterRows.rows ?? afterRows)) console.log(r);

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
