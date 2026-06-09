/**
 * Restore "冒险角色设计稿" to its rightful contributor after the
 * prompts.test.ts test pollution nulled it.
 *
 * Run with:
 *   pnpm exec tsx scripts/restore-user-prompt.ts
 *
 * Background: prompts.test.ts grabs `latestPromptForTest()` (the most-recently
 * created prompt anywhere in the DB) and mutates its contributor_id during
 * tests. Before the user authored their own prompt, this only hit demo seeded
 * prompts (no harm). Now the user's prompt is the latest, so every full test
 * run nulls its contributor.
 *
 * Recovery: write contributor_id = 圆滑 (rosekhlifa@gmail.com) verbatim, the
 * account the user confirmed authored it.
 */
import { db } from "../src/db/client.ts";
import { prompts } from "../src/db/schema/index.ts";
import { users } from "../src/db/schema/auth.ts";
import { eq, sql } from "drizzle-orm";

const TARGET_SLUG = "冒险角色设计稿";
const CONTRIBUTOR_EMAIL = "rosekhlifa@gmail.com";

async function main() {
  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.email, CONTRIBUTOR_EMAIL))
    .limit(1);
  if (!user) {
    console.error(`User ${CONTRIBUTOR_EMAIL} not found`);
    process.exit(1);
  }

  const [before] = await db
    .select({
      id: prompts.id,
      slug: prompts.slug,
      contributorId: prompts.contributorId,
    })
    .from(prompts)
    .where(eq(prompts.slug, TARGET_SLUG))
    .limit(1);
  if (!before) {
    console.error(`Prompt slug=${TARGET_SLUG} not found`);
    process.exit(1);
  }

  console.log("Before:", before);
  console.log("User:", user);

  await db
    .update(prompts)
    .set({ contributorId: user.id, updatedAt: sql`now()` })
    .where(eq(prompts.slug, TARGET_SLUG));

  const [after] = await db
    .select({
      id: prompts.id,
      slug: prompts.slug,
      contributorId: prompts.contributorId,
    })
    .from(prompts)
    .where(eq(prompts.slug, TARGET_SLUG))
    .limit(1);
  console.log("After:", after);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
