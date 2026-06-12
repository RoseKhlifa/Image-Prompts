import { db, pool } from "./client.ts";
import * as schema from "./schema/index.ts";
import { DEMO_SITE_SETTINGS } from "./seed-data.ts";

// One-shot insert for the 24 demo site_settings rows that the owner UI
// (/rosekhlifa/config) reads via GET /api/owner/settings.
//
// Why this script exists separately from seed.ts:
//   seed.ts TRUNCATEs prompts / prompt_images / categories / tags / r2_accounts
//   before running. On a production database with real user prompts that's
//   destructive. This script ONLY touches site_settings and uses
//   ON CONFLICT DO NOTHING so it's idempotent and non-destructive:
//     - first run: inserts every key that's missing
//     - repeat runs: silently skips already-seeded rows
//     - existing rows you manually tuned via the owner UI: untouched
//
// Run on the VPS once:
//   pnpm -F api exec tsx src/db/seed-site-settings-only.ts
async function main() {
  let inserted = 0;
  for (const setting of DEMO_SITE_SETTINGS) {
    const r = await db
      .insert(schema.siteSettings)
      .values(setting)
      .onConflictDoNothing()
      .returning({ key: schema.siteSettings.key });
    if (r.length > 0) inserted++;
  }
  console.log(
    `site_settings: ${inserted} inserted, ${DEMO_SITE_SETTINGS.length - inserted} already present (skipped).`,
  );
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  pool.end().finally(() => process.exit(1));
});
