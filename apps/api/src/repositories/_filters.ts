// apps/api/src/repositories/_filters.ts
//
// Reusable list-query predicates. Currently just NSFW exclusion. Kept in its
// own file so the wiring is obvious at every call site (`import { excludeNsfw }`)
// and so the helper has one place to evolve if the rule changes.

import { sql, type SQL } from "drizzle-orm";

/**
 * SQL fragment that excludes prompts whose category is `nsfw`.
 *
 * Use as a WHERE clause AND-condition in any list query that joins or
 * subselects against `categories`. The fragment is a `NOT EXISTS` subquery
 * keyed on `prompts.category_id` so it works regardless of whether the
 * outer query has already joined `categories`.
 *
 * To bypass (e.g. `?category=nsfw`), simply don't append this fragment.
 */
export function excludeNsfw(): SQL {
  return sql`NOT EXISTS (
    SELECT 1 FROM categories c
    WHERE c.id = prompts.category_id AND c.slug = 'nsfw'
  )`;
}
