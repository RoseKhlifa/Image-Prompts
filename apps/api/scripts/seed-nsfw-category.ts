import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client.ts";

async function main() {
  const result = await db.execute(sql`
    INSERT INTO categories (slug, name, description, "order")
    VALUES (
      'nsfw',
      '{"zh":"敏感内容","en":"NSFW"}'::jsonb,
      '{"zh":"可能引起不适或生理厌恶的内容,访问需确认免责声明。","en":"Content that may cause distress or visceral revulsion. Acknowledgment required to view."}'::jsonb,
      9999
    )
    ON CONFLICT (slug) DO NOTHING
    RETURNING id, slug;
  `);
  const rows = (result as unknown as { rows: Array<{ id: string; slug: string }> }).rows ?? [];
  if (rows.length > 0) {
    console.log(`[seed-nsfw] inserted category ${rows[0]!.slug} id=${rows[0]!.id}`);
  } else {
    console.log("[seed-nsfw] category already exists, nothing to do");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed-nsfw] failed:", err);
  process.exit(1);
});
