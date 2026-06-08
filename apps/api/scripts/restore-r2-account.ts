/**
 * One-shot recovery for M10a Task 4 fallout.
 *
 * Background: Task 4's `pnpm db:seed` run TRUNCATEd r2_accounts (alongside
 * prompts / site_settings) and re-inserted the DEMO_R2_ACCOUNT placeholder.
 * The user's real Cloudflare R2 account row was wiped.
 *
 * This script restores it from the R2_DEV_* envs (which weren't touched —
 * .env is gitignored and seed only touches DB). Hard-deletes any existing
 * r2_accounts rows first because at this point the placeholder is the only
 * thing in there and nothing references it (prompts/prompt_images were
 * cleared too).
 *
 * Safe-to-rerun: idempotent by env values — re-running just replaces with
 * fresh ciphertext (the AES key changes the ciphertext each run, but the
 * plaintext secret stays the same so decrypt still works).
 */
import { db, pool } from "../src/db/client.ts";
import { r2Accounts, promptImages } from "../src/db/schema/index.ts";
import { sql } from "drizzle-orm";
import { encryptSecret } from "../src/lib/crypto.ts";
import { env } from "../src/env.ts";

async function main() {
  const required = [
    "R2_DEV_ENDPOINT",
    "R2_DEV_ACCESS_KEY_ID",
    "R2_DEV_ACCESS_KEY_SECRET",
    "R2_DEV_BUCKET",
    "R2_DEV_PUBLIC_URL",
  ] as const;
  for (const k of required) {
    if (!(env as Record<string, unknown>)[k]) {
      console.error(`Missing env: ${k}`);
      process.exit(1);
    }
  }

  // Safety: refuse if prompt_images still references any row (would orphan
  // image URLs). Should be empty after the demo cleanup, but check anyway.
  const [{ c }] = await db
    .select({ c: sql<number>`COUNT(*)::int` })
    .from(promptImages);
  if (c > 0) {
    console.error(
      `ABORT: ${c} prompt_images rows still reference r2_accounts. ` +
        `Resolve those first (delete or remap) before reseeding R2.`,
    );
    process.exit(1);
  }

  const existing = await db
    .select({ id: r2Accounts.id, name: r2Accounts.name })
    .from(r2Accounts);
  console.log(`Existing r2_accounts: ${existing.length}`);
  for (const r of existing) console.log(`  - ${r.name} (${r.id})`);

  if (existing.length > 0) {
    await db.delete(r2Accounts);
    console.log(`Deleted ${existing.length} placeholder row(s).`);
  }

  const accountId = (() => {
    const m = env.R2_DEV_ENDPOINT!.match(
      /^https:\/\/([^.]+)\.r2\.cloudflarestorage\.com/,
    );
    return m ? m[1]! : "unknown";
  })();

  const ciphertext = encryptSecret(env.R2_DEV_ACCESS_KEY_SECRET!);

  const [row] = await db
    .insert(r2Accounts)
    .values({
      name: "dev-primary",
      accountId,
      endpoint: env.R2_DEV_ENDPOINT!,
      accessKeyId: env.R2_DEV_ACCESS_KEY_ID!,
      accessKeySecretEncrypted: ciphertext,
      bucket: env.R2_DEV_BUCKET!,
      publicUrl: env.R2_DEV_PUBLIC_URL!,
      priority: 100,
      enabled: true,
    })
    .returning();
  console.log(`Restored R2 account: ${row!.id} (name=dev-primary)`);
  await pool.end();
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
