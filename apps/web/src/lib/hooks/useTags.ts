import { useQuery } from "@tanstack/react-query";
import type { TagSummary } from "@ip/shared";
import { apiFetch } from "../api";

// ★ M4 Task 25: /api/tags' new default `limit` is 8 (geared at autocomplete).
//   The sidebar wants up to 20, so pass it explicitly here.
const SIDEBAR_TAG_LIMIT = 20;

export type TagScope = "favorites" | "mine";

/**
 * `scope` (optional) switches data source; `categorySlug` (optional) narrows
 * the count to prompts in that category and composes with `scope`:
 *
 *   no args             — global tags (precomputed usage_count)
 *   scope only          — tags from the user's data (favorites/mine)
 *   category only       — tags from prompts in that category (sidebar uses
 *                          this when the user is browsing /prompts?category=X)
 *   scope + category    — both filters AND'd together
 *
 * Filtered queries return only tags with ≥1 occurrence in the subset.
 */
export function useTags(scope?: TagScope, categorySlug?: string) {
  return useQuery<TagSummary[]>({
    queryKey: [
      "tags",
      {
        limit: SIDEBAR_TAG_LIMIT,
        scope: scope ?? "global",
        category: categorySlug ?? null,
      },
    ],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ limit: String(SIDEBAR_TAG_LIMIT) });
      if (scope) params.set("scope", scope);
      if (categorySlug) params.set("category", categorySlug);
      return apiFetch<TagSummary[]>(`/api/tags?${params.toString()}`, { signal });
    },
    staleTime: 5 * 60_000,
  });
}
