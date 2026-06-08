/**
 * One-shot cleanup for M10a Task 4 fallout.
 *
 * Background: Task 4 implementer ran `pnpm db:seed` to verify the new
 * site_settings keys. seed.ts TRUNCATEs prompts (among other tables) and
 * re-inserts the 31 M1 DEMO_PROMPTS — wiping the user's hand-imported data.
 *
 * The earlier delete-demo-prompts.ts only deletes M1-era rows
 * (approved_at < 2026-06-08), which doesn't catch this batch because it was
 * approved today. This script deletes ALL source='site' prompts regardless of
 * approval date — safe to run because the user's imported prompts had a
 * different source (or are now gone, in which case there's nothing else to
 * preserve).
 *
 * Hard cap at 100 rows to avoid accidental mass-delete if state drifts.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../src/db/client.ts";
import { prompts, promptImages, promptTags } from "../src/db/schema/index.ts";

async function main() {
  const targets = await db
    .select({ id: prompts.id, slug: prompts.slug, approvedAt: prompts.approvedAt })
    .from(prompts)
    .where(eq(prompts.source, "site"));

  console.log(`Found ${targets.length} site-source prompts:`);
  for (const t of targets) {
    console.log(`  - ${t.slug} (approved ${t.approvedAt?.toISOString()})`);
  }

  if (targets.length === 0) {
    console.log("\nNothing to do.");
    process.exit(0);
  }
  if (targets.length > 100) {
    console.error(
      `\nABORT: would delete ${targets.length} rows (expected ~31). Refusing.`,
    );
    process.exit(1);
  }

  const ids = targets.map((t) => t.id);

  const [{ c: imgCount }] = await db
    .select({ c: sql<number>`COUNT(*)::int` })
    .from(promptImages)
    .where(inArray(promptImages.promptId, ids));
  const [{ c: tagCount }] = await db
    .select({ c: sql<number>`COUNT(*)::int` })
    .from(promptTags)
    .where(inArray(promptTags.promptId, ids));
  console.log(`\nWill also delete: ${imgCount} prompt_images, ${tagCount} prompt_tags`);

  await db.transaction(async (tx) => {
    await tx.delete(promptTags).where(inArray(promptTags.promptId, ids));
    await tx.delete(promptImages).where(inArray(promptImages.promptId, ids));
    const r = await tx.delete(prompts).where(inArray(prompts.id, ids));
    console.log(`\nDeleted ${r.rowCount ?? "?"} prompts rows.`);
  });

  const [{ c: remaining }] = await db
    .select({ c: sql<number>`COUNT(*)::int` })
    .from(prompts)
    .where(eq(prompts.source, "site"));
  console.log(`Remaining site-source prompts: ${remaining}`);

  process.exit(0);
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
