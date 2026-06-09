import { sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { prompts, categories, tags } from "../db/schema/index.ts";
import { excludeNsfw } from "./_filters.ts";

export async function getStatsSummary() {
  // Public-facing counters. Excludes NSFW so the headline numbers match
  // what an unauthenticated visitor can actually browse. About-page
  // surfaces all four; homepage just uses publishedCount.
  const [r] = await db
    .select({
      publishedCount: sql<number>`COUNT(*)::int`,
      contributorCount: sql<number>`COUNT(DISTINCT ${prompts.contributorId})::int`,
    })
    .from(prompts)
    .where(excludeNsfw());

  const [c] = await db
    .select({
      categoryCount: sql<number>`COUNT(*)::int`,
    })
    .from(categories)
    .where(sql`${categories.slug} <> 'nsfw'`);

  const [tg] = await db
    .select({
      tagCount: sql<number>`COUNT(*)::int`,
    })
    .from(tags)
    .where(sql`${tags.slug} <> 'nsfw'`);

  return {
    publishedCount: r?.publishedCount ?? 0,
    contributorCount: r?.contributorCount ?? 0,
    categoryCount: c?.categoryCount ?? 0,
    tagCount: tg?.tagCount ?? 0,
  };
}
