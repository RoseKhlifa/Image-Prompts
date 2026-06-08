import { sql } from "drizzle-orm";
import { db } from "../src/db/client.ts";

async function main() {
  const r = await db.execute(sql.raw(
    `SELECT slug, like_count, favorite_count, view_count, send_count, approved_at
     FROM prompts ORDER BY approved_at DESC LIMIT 10`,
  ));
  console.log(JSON.stringify(r.rows ?? r, null, 2));
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
