/**
 * One-shot: attribute all `source='imported'` prompts to the admin user.
 *
 * Per 2026-06-09 UX decision the owner doesn't want a source chip surfaced on
 * cards. Imported prompts now display as contributed by the admin (RoseKhlifa,
 * 2221542777@qq.com). Source attribution is preserved in `source_url` /
 * `source_site` columns and rendered as a subtle line on the detail page.
 *
 * Idempotent: re-running after success is a no-op (the WHERE is contributor_id
 * IS NULL).
 */
import { db } from "../src/db/client.ts";
import { prompts } from "../src/db/schema/index.ts";
import { users } from "../src/db/schema/auth.ts";
import { eq, sql, isNull, and } from "drizzle-orm";

const ADMIN_EMAIL = "2221542777@qq.com";

async function main() {
  const [admin] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.email, ADMIN_EMAIL))
    .limit(1);
  if (!admin) {
    console.error(`Admin user ${ADMIN_EMAIL} not found`);
    process.exit(1);
  }
  console.log(`Admin: ${admin.email} (${admin.id})`);

  const before = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM prompts WHERE source='imported' AND contributor_id IS NULL
  `);
  console.log(`imported with null contributor (before):`, before.rows);

  const result = await db
    .update(prompts)
    .set({ contributorId: admin.id, updatedAt: sql`now()` })
    .where(and(eq(prompts.source, "imported"), isNull(prompts.contributorId)));
  console.log(`updated rows:`, result.rowCount);

  const after = await db.execute(sql`
    SELECT COUNT(*)::int AS n FROM prompts WHERE source='imported' AND contributor_id IS NULL
  `);
  console.log(`imported with null contributor (after):`, after.rows);

  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
