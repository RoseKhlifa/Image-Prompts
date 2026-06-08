import { db, pool } from "../src/db/client.ts";
import { siteSettings } from "../src/db/schema/index.ts";
import { inArray } from "drizzle-orm";

async function main() {
  const deleted = await db
    .delete(siteSettings)
    .where(inArray(siteSettings.key, ["community_guidelines.version", "translation.enabled"]))
    .returning({ key: siteSettings.key });
  console.log(`Deleted outdated keys: ${deleted.map((r) => r.key).join(", ") || "(none)"}`);
  await pool.end();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
