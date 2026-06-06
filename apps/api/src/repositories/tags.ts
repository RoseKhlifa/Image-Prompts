import { desc, asc } from "drizzle-orm";
import { db } from "../db/client.ts";
import { tags } from "../db/schema/index.ts";

export async function listTags(limit = 100) {
  const rows = await db
    .select()
    .from(tags)
    .orderBy(desc(tags.usageCount), asc(tags.slug))
    .limit(limit);
  return rows.map((t) => ({
    id: t.id,
    slug: t.slug,
    name: t.name,
    usageCount: t.usageCount,
  }));
}
