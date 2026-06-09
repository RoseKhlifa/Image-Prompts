import "dotenv/config";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../src/db/client.ts";
import { prompts, tags, promptTags } from "../src/db/schema/index.ts";
import { resolveTagForImport } from "../src/lib/tag-normalize.ts";

// One-shot: sync tags on existing NSFW prompts using the re-tagged JSONL
// dump at G:\promptsandimages\exports\nanobanana_website\nsfw.jsonl
// (519 records). Each record is matched to a prompt by external_id; its
// prompt_tags rows are replaced with the new set derived from
// `normalized_tags`. Tags that don't yet exist are upserted with the
// canonical bilingual name from `resolveTagForImport`. Usage counts are
// recomputed at the end (full table refresh) so any drift introduced
// by the wipe-and-rewrite is corrected in a single pass.
//
// Idempotent: re-running produces the same final state.

const DEFAULT_FILE =
  "G:\\promptsandimages\\exports\\nanobanana_website\\nsfw.jsonl";

type Rec = {
  externalId: string;
  slugs: string[];
};

async function main() {
  const filePath = process.argv[2] ?? DEFAULT_FILE;
  console.log(`[sync-nsfw-tags] reading ${filePath}`);

  const rl = createInterface({
    input: createReadStream(filePath, "utf8"),
  });

  const records: Rec[] = [];
  const tagBySlug = new Map<string, { zh: string; en: string }>();

  for await (const line of rl) {
    if (!line.trim()) continue;
    const r = JSON.parse(line) as {
      id: string;
      normalized_tags?: string[];
    };
    const slugs: string[] = [];
    for (const name of r.normalized_tags ?? []) {
      const t = resolveTagForImport(name);
      slugs.push(t.slug);
      if (!tagBySlug.has(t.slug)) tagBySlug.set(t.slug, { zh: t.zh, en: t.en });
    }
    records.push({ externalId: r.id, slugs });
  }
  console.log(
    `[sync-nsfw-tags] parsed ${records.length} records · ${tagBySlug.size} distinct tag slugs`,
  );

  // Upsert tags (idempotent — keep existing names if they're already set,
  // since the owner may have edited them via the taxonomy admin).
  for (const [slug, name] of tagBySlug) {
    await db.execute(sql`
      INSERT INTO tags (slug, name)
      VALUES (${slug}, ${JSON.stringify(name)}::jsonb)
      ON CONFLICT (slug) DO NOTHING;
    `);
  }

  // Slug → id map covering ALL referenced slugs.
  const allSlugs = [...tagBySlug.keys()];
  const tagRows = await db
    .select({ id: tags.id, slug: tags.slug })
    .from(tags)
    .where(inArray(tags.slug, allSlugs));
  const slugToId = new Map(tagRows.map((r) => [r.slug, r.id]));
  console.log(`[sync-nsfw-tags] resolved ${slugToId.size} tag ids`);

  // External_id → promptId map.
  const externalIds = records.map((r) => r.externalId);
  const promptRows = await db
    .select({ id: prompts.id, externalId: prompts.externalId })
    .from(prompts)
    .where(inArray(prompts.externalId, externalIds));
  const externalToPromptId = new Map<string, string>(
    promptRows
      .filter((r) => r.externalId !== null)
      .map((r) => [r.externalId as string, r.id]),
  );
  console.log(
    `[sync-nsfw-tags] matched ${externalToPromptId.size} / ${records.length} prompts by external_id`,
  );

  let synced = 0;
  let notFound = 0;
  let emptyTags = 0;

  for (const rec of records) {
    const promptId = externalToPromptId.get(rec.externalId);
    if (!promptId) {
      notFound++;
      continue;
    }
    const tagIds = rec.slugs
      .map((s) => slugToId.get(s))
      .filter((id): id is string => typeof id === "string");
    if (tagIds.length === 0) {
      emptyTags++;
      continue;
    }
    await db.transaction(async (tx) => {
      await tx.delete(promptTags).where(eq(promptTags.promptId, promptId));
      await tx
        .insert(promptTags)
        .values(tagIds.map((tagId) => ({ promptId, tagId })));
    });
    synced++;
  }
  console.log(
    `[sync-nsfw-tags] synced=${synced} not_found=${notFound} empty_tags=${emptyTags}`,
  );

  console.log("[sync-nsfw-tags] recomputing tags.usage_count …");
  const before = await db
    .select({ slug: tags.slug, usageCount: tags.usageCount })
    .from(tags)
    .where(inArray(tags.slug, allSlugs))
    .orderBy(tags.slug);
  await db.execute(sql`
    UPDATE tags SET usage_count = (
      SELECT count(*) FROM prompt_tags WHERE tag_id = tags.id
    );
  `);
  const after = await db
    .select({ slug: tags.slug, usageCount: tags.usageCount })
    .from(tags)
    .where(inArray(tags.slug, allSlugs))
    .orderBy(tags.slug);
  console.log("[sync-nsfw-tags] usage_count for touched tags (before → after):");
  const beforeMap = new Map(before.map((r) => [r.slug, r.usageCount]));
  for (const row of after) {
    const b = beforeMap.get(row.slug) ?? 0;
    console.log(`  ${row.slug}: ${b} → ${row.usageCount}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[sync-nsfw-tags] failed:", err);
  process.exit(1);
});
