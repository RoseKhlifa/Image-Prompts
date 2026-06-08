import { sql } from "drizzle-orm";
import { db } from "../src/db/client.ts";

async function main() {
  const tables = ["likes", "favorites", "view_log", "import_tokens"];
  for (const t of tables) {
    const r = await db.execute(sql.raw(`SELECT COUNT(*)::int AS c FROM ${t}`));
    const n = ((r.rows ?? r)[0] as { c: number }).c;
    console.log(`${t.padEnd(20)} ${n}`);
  }
  console.log("\n--- prompts counters ---");
  const r = await db.execute(sql.raw(
    `SELECT slug, like_count, favorite_count, view_count, send_count FROM prompts ORDER BY approved_at DESC`,
  ));
  for (const row of (r.rows ?? r)) {
    console.log(row);
  }
  console.log("\n--- likes rows (if any) ---");
  const lk = await db.execute(sql.raw(
    `SELECT l.user_id, l.prompt_id, p.slug, u.email
     FROM likes l
     JOIN prompts p ON l.prompt_id = p.id
     LEFT JOIN users u ON l.user_id = u.id
     LIMIT 50`,
  ));
  for (const row of (lk.rows ?? lk)) {
    console.log(row);
  }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
