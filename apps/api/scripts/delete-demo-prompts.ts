// Delete the 31 M1-demo prompts that were seeded on 2026-06-07 (source='site',
// approved_at < 2026-06-08). Today's manually-submitted+approved prompts
// (4 of them, approved 2026-06-08 12:xx) are kept intact.
//
// Cleanup order: prompt_tags → prompt_images → prompts (no FK cascade on
// prompt_images.prompt_id per the schema; we just do it manually).
//
// We do NOT touch R2 — these 31 prompts' prompt_images.r2_key point at
// nanobanana CDN (M1 placeholder), not our own bucket, so no orphans.
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "../src/db/client.ts";
import { prompts, promptImages, promptTags } from "../src/db/schema/index.ts";

async function main() {
  // 1. Find target IDs
  const targets = await db
    .select({
      id: prompts.id,
      slug: prompts.slug,
      approvedAt: prompts.approvedAt,
    })
    .from(prompts)
    .where(
      and(
        eq(prompts.source, "site"),
        lt(prompts.approvedAt, new Date("2026-06-08T00:00:00+08:00")),
      ),
    );

  console.log(`Found ${targets.length} prompts to delete:`);
  for (const t of targets) {
    console.log(`  - ${t.slug} (approved ${t.approvedAt?.toISOString()})`);
  }

  if (targets.length === 0) {
    console.log("\nNothing to do.");
    process.exit(0);
  }

  if (targets.length > 50) {
    console.error(
      `\nABORT: would delete ${targets.length} rows (expected ~31). Refusing — investigate.`,
    );
    process.exit(1);
  }

  const ids = targets.map((t) => t.id);

  // Pre-count related rows
  const imgCount = await db
    .select({ c: sql<number>`COUNT(*)::int` })
    .from(promptImages)
    .where(inArray(promptImages.promptId, ids));
  const tagCount = await db
    .select({ c: sql<number>`COUNT(*)::int` })
    .from(promptTags)
    .where(inArray(promptTags.promptId, ids));
  console.log(
    `\nWill also delete: ${imgCount[0]!.c} prompt_images rows, ${tagCount[0]!.c} prompt_tags rows`,
  );

  // 2. Transaction
  await db.transaction(async (tx) => {
    await tx.delete(promptTags).where(inArray(promptTags.promptId, ids));
    await tx.delete(promptImages).where(inArray(promptImages.promptId, ids));
    const r = await tx.delete(prompts).where(inArray(prompts.id, ids));
    console.log(`\nDeleted ${r.rowCount ?? "?"} prompts rows.`);
  });

  // 3. Verify
  const remaining = await db
    .select({ c: sql<number>`COUNT(*)::int` })
    .from(prompts)
    .where(eq(prompts.source, "site"));
  console.log(`\nRemaining 'site' prompts: ${remaining[0]!.c}`);

  process.exit(0);
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
