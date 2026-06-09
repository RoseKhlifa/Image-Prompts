// One-shot migrator: applies 0013_import_crawled_prompts.sql + records it in
// drizzle's __drizzle_migrations table so a future `pnpm db:migrate` doesn't
// try to re-run it. Mirrors apply-0012-profile-enrich.ts.
//
// Special wrinkle: `ALTER TYPE "prompt_source" ADD VALUE 'imported'` cannot
// run inside a transaction block, so we issue it as a standalone statement
// BEFORE the rest of the DDL. `IF NOT EXISTS` keeps it idempotent.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, pool } from "../src/db/client.ts";

async function main() {
  const tag = "0013_import_crawled_prompts";
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

  // Idempotency: also skip apply-of-DDL if the probe column already exists. We
  // still record the hash so the migrations table accepts a future
  // `pnpm db:migrate`. We use prompts.external_id as the probe — all of the
  // migration's changes (prompt_images columns, import_batches table, enum
  // value) are added in the same DDL bundle so any one of them indicates the
  // whole bundle ran.
  const colCheck = await db.execute(sql`
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'prompts'
       AND column_name = 'external_id'
  `);
  const columnExists = ((colCheck as { rows: unknown[] }).rows ?? []).length > 0;

  if (columnExists) {
    console.log("Column prompts.external_id already exists. Recording hash only.");
  } else {
    // 1. Extend the prompt_source enum OUTSIDE any transaction. Postgres
    //    forbids ALTER TYPE ... ADD VALUE inside a transaction block, and
    //    db.execute() with a single statement auto-commits, so this is safe.
    //    IF NOT EXISTS keeps it idempotent.
    console.log("Extending prompt_source enum with 'imported'...");
    await db.execute(
      sql`ALTER TYPE "prompt_source" ADD VALUE IF NOT EXISTS 'imported'`,
    );

    // 2. Apply the rest of the DDL statement-by-statement. Strip `--` line
    //    comments first so they don't disguise the leading keyword of a
    //    statement (matters for `ALTER TABLE` blocks preceded by a `-- ...`
    //    header in the .sql file).
    console.log(`Applying ${tag}...`);
    const stripped = ddl
      .split("\n")
      .map((line) => {
        const i = line.indexOf("--");
        return i >= 0 ? line.slice(0, i) : line;
      })
      .join("\n");
    const stmts = stripped
      .split(";")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
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
