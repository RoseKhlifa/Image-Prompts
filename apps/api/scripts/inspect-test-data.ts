// One-shot inspection: count current DB state to understand what test data exists.
import { sql } from "drizzle-orm";
import { db } from "../src/db/client.ts";

async function main() {
  const counts: Array<{ table: string; n: number }> = [];

  async function count(label: string, query: string) {
    const r = await db.execute(sql.raw(query));
    const rows = r.rows ?? r;
    const n = Number((rows[0] as { c?: number; count?: number }).c ?? (rows[0] as { count?: number }).count ?? 0);
    counts.push({ table: label, n });
  }

  await count("users", "SELECT COUNT(*)::int AS c FROM users");
  await count("  users (with email like @qq)", "SELECT COUNT(*)::int AS c FROM users WHERE email LIKE '%@qq.com'");
  await count("  users (with email like @example)", "SELECT COUNT(*)::int AS c FROM users WHERE email LIKE '%@example.com'");
  await count("  users (with role=admin)", "SELECT COUNT(*)::int AS c FROM users WHERE role = 'admin'");
  await count("submissions", "SELECT COUNT(*)::int AS c FROM submissions");
  await count("  submissions (pending)", "SELECT COUNT(*)::int AS c FROM submissions WHERE status = 'pending'");
  await count("  submissions (approved)", "SELECT COUNT(*)::int AS c FROM submissions WHERE status = 'approved'");
  await count("  submissions (rejected)", "SELECT COUNT(*)::int AS c FROM submissions WHERE status = 'rejected'");
  await count("prompts (total)", "SELECT COUNT(*)::int AS c FROM prompts");
  await count("  prompts (source='nanobanana_seed')", "SELECT COUNT(*)::int AS c FROM prompts WHERE source = 'nanobanana_seed'");
  await count("  prompts (source='site')", "SELECT COUNT(*)::int AS c FROM prompts WHERE source = 'site'");
  await count("prompt_images (total)", "SELECT COUNT(*)::int AS c FROM prompt_images");
  await count("  prompt_images (for source='site' prompts)", "SELECT COUNT(*)::int AS c FROM prompt_images pi JOIN prompts p ON pi.prompt_id = p.id WHERE p.source = 'site'");
  await count("notifications", "SELECT COUNT(*)::int AS c FROM notifications");
  await count("audit_log", "SELECT COUNT(*)::int AS c FROM audit_log");
  await count("view_log", "SELECT COUNT(*)::int AS c FROM view_log");
  await count("likes", "SELECT COUNT(*)::int AS c FROM likes");
  await count("favorites", "SELECT COUNT(*)::int AS c FROM favorites");
  await count("r2_accounts", "SELECT COUNT(*)::int AS c FROM r2_accounts");
  await count("tags", "SELECT COUNT(*)::int AS c FROM tags");
  await count("categories", "SELECT COUNT(*)::int AS c FROM categories");

  console.log("\n=== DB COUNTS ===");
  for (const c of counts) console.log(`  ${c.table.padEnd(42)} ${c.n}`);

  console.log("\n=== USERS (all) ===");
  const users = await db.execute(sql.raw(
    `SELECT id, email, name, role, rejected_count, created_at FROM users ORDER BY created_at`,
  ));
  const userRows = (users.rows ?? users) as Array<Record<string, unknown>>;
  for (const u of userRows) {
    console.log(`  ${u.email} | role=${u.role} | rejected=${u.rejected_count} | id=${u.id}`);
  }

  console.log("\n=== SUBMISSIONS (top 20) ===");
  const subs = await db.execute(sql.raw(
    `SELECT s.id, s.status, s.created_at, u.email AS contributor_email,
            COALESCE(s.title->>'zh', s.title->>'en') AS title
     FROM submissions s JOIN users u ON s.contributor_id = u.id
     ORDER BY s.created_at DESC LIMIT 20`,
  ));
  const subRows = (subs.rows ?? subs) as Array<Record<string, unknown>>;
  for (const s of subRows) {
    console.log(`  [${s.status}] "${s.title}" by ${s.contributor_email} @ ${s.created_at}`);
  }

  console.log("\n=== PROMPTS (source='site', i.e. NOT seed) ===");
  const sitePrompts = await db.execute(sql.raw(
    `SELECT id, slug, COALESCE(title->>'zh', title->>'en') AS title, approved_at
     FROM prompts WHERE source = 'site' ORDER BY approved_at DESC LIMIT 20`,
  ));
  const sitePromptRows = (sitePrompts.rows ?? sitePrompts) as Array<Record<string, unknown>>;
  for (const p of sitePromptRows) {
    console.log(`  ${p.slug} | "${p.title}" | approved=${p.approved_at}`);
  }

  console.log("\n=== R2 ACCOUNTS ===");
  const r2 = await db.execute(sql.raw(
    `SELECT id, name, bucket, public_url, enabled, deleted_at FROM r2_accounts`,
  ));
  const r2Rows = (r2.rows ?? r2) as Array<Record<string, unknown>>;
  for (const r of r2Rows) {
    console.log(`  ${r.name} | bucket=${r.bucket} | enabled=${r.enabled} | deleted=${r.deleted_at} | id=${r.id}`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error("FAIL:", e);
  process.exit(1);
});
