import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client.ts";

// Seeds both the `nsfw` category and the `nsfw` tag. Both display as
// "NSFW" in zh + en (no localized "敏感内容" / etc). The tag is created
// here so submission flows that look it up via `getTagsBySlugs` find a
// row with a sensible display name from day one — the tag is hidden
// from the sidebar tag list but still appears wherever tag chips would
// otherwise be rendered (currently nowhere, since the detail page
// filters it out).
//
// Idempotent: re-running on a DB that already has the rows in their
// expected shape is a no-op. If the rows exist but the names drift
// (e.g. an older seed wrote "敏感内容"), this script does NOT correct
// them — fix those by hand once and re-run.
async function main() {
  const catResult = await db.execute(sql`
    INSERT INTO categories (slug, name, description, "order")
    VALUES (
      'nsfw',
      '{"zh":"NSFW","en":"NSFW"}'::jsonb,
      '{"zh":"可能引起不适或生理厌恶的内容,访问需确认免责声明。","en":"Content that may cause distress or visceral revulsion. Acknowledgment required to view."}'::jsonb,
      9999
    )
    ON CONFLICT (slug) DO NOTHING
    RETURNING id, slug;
  `);
  const catRows = (catResult as unknown as { rows: Array<{ id: string; slug: string }> }).rows ?? [];
  if (catRows.length > 0) {
    console.log(`[seed-nsfw] inserted category ${catRows[0]!.slug} id=${catRows[0]!.id}`);
  } else {
    console.log("[seed-nsfw] category already exists, nothing to do");
  }

  const tagResult = await db.execute(sql`
    INSERT INTO tags (slug, name, usage_count)
    VALUES ('nsfw', '{"zh":"NSFW","en":"NSFW"}'::jsonb, 0)
    ON CONFLICT (slug) DO NOTHING
    RETURNING id, slug;
  `);
  const tagRows = (tagResult as unknown as { rows: Array<{ id: string; slug: string }> }).rows ?? [];
  if (tagRows.length > 0) {
    console.log(`[seed-nsfw] inserted tag ${tagRows[0]!.slug} id=${tagRows[0]!.id}`);
  } else {
    console.log("[seed-nsfw] tag already exists, nothing to do");
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[seed-nsfw] failed:", err);
  process.exit(1);
});
