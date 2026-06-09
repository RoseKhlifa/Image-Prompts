import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client.ts";

// One-shot pre-launch cleanup: wipe every prompt that came from the
// crawl import pipeline (source='imported') AND its dependent rows.
//
// Spares anything written by a real user (source='site') and any seed
// demo content (source='nanobanana_seed' if present).
//
// Steps, in order (FK / business-rule ordering matters):
//   1. NULL the back-references from submissions + import_tokens
//      (those have ON DELETE NO ACTION on prompts.id)
//   2. Wipe child rows directly attached to the prompt: prompt_tags,
//      prompt_images, favorites, likes, notifications
//   3. Wipe `import_batches` history (stale once the prompts are gone)
//   4. Delete the prompts themselves
//   5. Recompute tags.usage_count from the remaining prompt_tags rows
//      so the sidebar counters stop showing phantom numbers
//
// Idempotent: runs against a "no imports" state harmlessly.

async function main() {
  console.log("[cleanup] starting imported-prompt purge");

  const result = await db.transaction(async (tx) => {
    // ── 1. Collect the prompt ids we're about to drop ──────────────
    const ids = await tx.execute(sql`
      SELECT id FROM prompts WHERE source = 'imported'
    `);
    const rows = (ids as unknown as { rows: Array<{ id: string }> }).rows ?? [];
    const promptIds = rows.map((r) => r.id);
    console.log(`[cleanup] found ${promptIds.length} imported prompts`);

    if (promptIds.length === 0) return { deleted: 0 };

    // ── 2. NULL out NO-ACTION back-references ──────────────────────
    await tx.execute(sql`
      UPDATE submissions SET promoted_to = NULL
      WHERE promoted_to IN (SELECT id FROM prompts WHERE source = 'imported')
    `);
    await tx.execute(sql`
      UPDATE submissions SET original_prompt_id = NULL
      WHERE original_prompt_id IN (SELECT id FROM prompts WHERE source = 'imported')
    `);
    await tx.execute(sql`
      UPDATE import_tokens SET prompt_id = NULL
      WHERE prompt_id IN (SELECT id FROM prompts WHERE source = 'imported')
    `);

    // ── 3. Wipe directly-attached child rows ───────────────────────
    const ptDel = await tx.execute(sql`
      DELETE FROM prompt_tags
      WHERE prompt_id IN (SELECT id FROM prompts WHERE source = 'imported')
    `);
    console.log(`[cleanup] deleted prompt_tags: ${ptDel.rowCount ?? 0}`);

    const piDel = await tx.execute(sql`
      DELETE FROM prompt_images
      WHERE prompt_id IN (SELECT id FROM prompts WHERE source = 'imported')
    `);
    console.log(`[cleanup] deleted prompt_images: ${piDel.rowCount ?? 0}`);

    const favDel = await tx.execute(sql`
      DELETE FROM favorites
      WHERE prompt_id IN (SELECT id FROM prompts WHERE source = 'imported')
    `);
    console.log(`[cleanup] deleted favorites: ${favDel.rowCount ?? 0}`);

    const likeDel = await tx.execute(sql`
      DELETE FROM likes
      WHERE prompt_id IN (SELECT id FROM prompts WHERE source = 'imported')
    `);
    console.log(`[cleanup] deleted likes: ${likeDel.rowCount ?? 0}`);

    // notifications stores prompt id in jsonb payload — match by JSON path
    const notifDel = await tx.execute(sql`
      DELETE FROM notifications
      WHERE (payload->>'promptId') IN (
        SELECT id::text FROM prompts WHERE source = 'imported'
      )
    `);
    console.log(`[cleanup] deleted notifications: ${notifDel.rowCount ?? 0}`);

    // ── 4. Wipe import_batches (stale audit history) ───────────────
    const batchDel = await tx.execute(
      sql`DELETE FROM import_batches`,
    );
    console.log(`[cleanup] deleted import_batches: ${batchDel.rowCount ?? 0}`);

    // ── 5. Finally delete the prompts ──────────────────────────────
    const promptDel = await tx.execute(sql`
      DELETE FROM prompts WHERE source = 'imported'
    `);
    console.log(`[cleanup] deleted prompts: ${promptDel.rowCount ?? 0}`);

    return { deleted: promptDel.rowCount ?? 0 };
  });

  // ── 6. Recompute tags.usage_count outside the transaction ──────
  console.log("[cleanup] recomputing tags.usage_count …");
  await db.execute(sql`
    UPDATE tags SET usage_count = (
      SELECT count(*) FROM prompt_tags WHERE tag_id = tags.id
    )
  `);

  // Show what's left
  const after = await db.execute(sql`
    SELECT source, count(*)::int AS n FROM prompts GROUP BY source ORDER BY source
  `);
  console.log("[cleanup] remaining prompts:");
  for (const row of (after as unknown as { rows: Array<{ source: string; n: number }> }).rows ?? []) {
    console.log(`  source=${row.source}: ${row.n}`);
  }

  console.log(`[cleanup] done. deleted=${result.deleted}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[cleanup] failed:", err);
  process.exit(1);
});
