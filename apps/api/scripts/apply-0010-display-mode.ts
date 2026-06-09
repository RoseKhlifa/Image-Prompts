// One-shot migrator: applies 0010_m10b_announcement_display_mode.sql + records
// it in drizzle's __drizzle_migrations table so a future `pnpm db:migrate`
// doesn't try to re-run it. Mirrors the manual recovery the W2.1 implementer
// did when drizzle-kit silently swallowed migration 0008/0009.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db, pool } from "../src/db/client.ts";

async function main() {
  const tag = "0010_m10b_announcement_display_mode";
  const path = `./drizzle/${tag}.sql`;
  const ddl = readFileSync(path, "utf8");
  const hash = createHash("sha256").update(ddl).digest("hex");

  console.log(`Tag: ${tag}`);
  console.log(`Hash: ${hash}`);

  // Idempotency: skip if already in journal
  const existing = await db.execute(sql`
    SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = ${hash}
  `);
  if (((existing as { rows: unknown[] }).rows ?? []).length > 0) {
    console.log("Already applied. Nothing to do.");
    await pool.end();
    return;
  }

  // Apply DDL statements
  const stmts = ddl.split(";").map((s) => s.trim()).filter((s) => s.length > 0);
  for (const s of stmts) {
    console.log(`  -> ${s.slice(0, 80)}${s.length > 80 ? "..." : ""}`);
    await db.execute(sql.raw(s));
  }

  // Record in journal
  await db.execute(sql`
    INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
    VALUES (${hash}, ${Date.now()})
  `);
  console.log("Migration applied + recorded.");
  await pool.end();
}

main().catch((e) => { console.error("FAIL:", e); process.exit(1); });
