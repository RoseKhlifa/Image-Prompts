import { asc, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { categories, prompts, favorites } from "../db/schema/index.ts";

export type CategoryScope =
  | { kind: "favorites"; userId: string }
  | { kind: "mine"; userId: string };

/**
 * Return every category with a `promptCount` field. `scope` narrows what the
 * count means:
 *
 *   undefined  — global: every published prompt
 *   favorites  — only prompts the user has favorited
 *   mine       — only prompts the user authored (contributorId = userId)
 *
 * Categories are always all returned regardless of scope (so the sidebar can
 * still render the full category list even when the user has 0 favorites in
 * some categories — those rows just show count 0).
 */
export async function listCategories(scope?: CategoryScope) {
  const promptCount =
    scope?.kind === "favorites"
      ? sql<number>`(
          SELECT count(*)::int
          FROM ${prompts}
          INNER JOIN ${favorites} ON ${favorites}."prompt_id" = ${prompts}."id"
          WHERE ${prompts}."category_id" = ${categories}."id"
            AND ${favorites}."user_id" = ${scope.userId}
        )`
      : scope?.kind === "mine"
        ? sql<number>`(
            SELECT count(*)::int
            FROM ${prompts}
            WHERE ${prompts}."category_id" = ${categories}."id"
              AND ${prompts}."contributor_id" = ${scope.userId}
          )`
        : sql<number>`(SELECT count(*)::int FROM ${prompts} WHERE ${prompts}."category_id" = ${categories}."id")`;

  const rows = await db
    .select({
      id: categories.id,
      slug: categories.slug,
      name: categories.name,
      order: categories.order,
      promptCount,
    })
    .from(categories)
    .orderBy(asc(categories.order), asc(categories.slug));
  return rows.map((r) => ({ ...r, promptCount: Number(r.promptCount ?? 0) }));
}
