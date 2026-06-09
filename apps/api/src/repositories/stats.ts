import { sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { prompts } from "../db/schema/index.ts";
import { excludeNsfw } from "./_filters.ts";

export async function getStatsSummary() {
  // Public-facing counter (homepage). Excludes NSFW so the headline number
  // matches what an unauthenticated visitor can actually browse.
  const [r] = await db
    .select({ publishedCount: sql<number>`COUNT(*)::int` })
    .from(prompts)
    .where(excludeNsfw());
  return { publishedCount: r?.publishedCount ?? 0 };
}
