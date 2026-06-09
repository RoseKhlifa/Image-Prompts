// One-shot migrator: applies 0012_profile_enrich.sql + records it in drizzle's
// __drizzle_migrations table so a future `pnpm db:migrate` doesn't try to
// re-run it. Mirrors apply-0011-original-prompt.ts.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, pool } from "../src/db/client.ts";

async function main() {
  const tag = "0012_profile_enrich";
  const path = `./drizzle/${tag}.sql`;
  const ddl = readFileSync(path, "utf8");
  const hash = createHash("sha256").update(ddl).digest("hex");

  console.log(`Tag: ${tag}`);
  console.log(`Hash: ${hash}`);

  // Idempotency: skip if already in journal.
  const existing = await db.execute(sql`
    SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = ${hash}
  `);
  if (((existing as { rows: unknown[] }).rows ?? []).length > 0) {
    console.log("Already applied. Nothing to do.");
    await pool.end();
    return;
  }

  // Idempotency: also skip apply-of-DDL if the bio column already exists. We
  // still record the hash so the migrations table accepts a future
  // `pnpm db:migrate`. We use users.bio as the probe — the migration's other
  // changes (social_links column, user_pinned_prompts table) are added in
  // the same transaction so any one of them indicates the whole bundle ran.
  const colCheck = await db.execute(sql`
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'users'
       AND column_name = 'bio'
  `);
  const columnExists = ((colCheck as { rows: unknown[] }).rows ?? []).length > 0;

  if (columnExists) {
    console.log("Column users.bio already exists. Recording hash only.");
  } else {
    const stmts = ddl.split(";").map((s) => s.trim()).filter((s) => s.length > 0);
    for (const s of stmts) {
      console.log(`  -> ${s.slice(0, 80)}${s.length > 80 ? "..." : ""}`);
      await db.execute(sql.raw(s));
    }
  }

  await db.execute(sql`
    INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
    VALUES (${hash}, ${Date.now()})
  `);
  console.log("Migration recorded.");
  await pool.end();
}

main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
