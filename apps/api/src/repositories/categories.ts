import { asc, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { categories, prompts } from "../db/schema/index.ts";

export async function listCategories() {
  const rows = await db
    .select({
      id: categories.id,
      slug: categories.slug,
      name: categories.name,
      order: categories.order,
      promptCount: sql<number>`(SELECT count(*)::int FROM ${prompts} WHERE ${prompts}."category_id" = ${categories}."id")`,
    })
    .from(categories)
    .orderBy(asc(categories.order), asc(categories.slug));
  return rows.map((r) => ({ ...r, promptCount: Number(r.promptCount ?? 0) }));
}
