import { sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { prompts } from "../db/schema/index.ts";

export async function getStatsSummary() {
  const [r] = await db
    .select({ publishedCount: sql<number>`COUNT(*)::int` })
    .from(prompts);
  return { publishedCount: r?.publishedCount ?? 0 };
}
