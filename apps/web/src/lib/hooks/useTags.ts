import { useQuery } from "@tanstack/react-query";
import type { TagSummary } from "@ip/shared";
import { apiFetch } from "../api";

// ★ M4 Task 25: /api/tags' new default `limit` is 8 (geared at autocomplete).
//   The sidebar wants up to 20, so pass it explicitly here.
const SIDEBAR_TAG_LIMIT = 20;

export type TagScope = "favorites" | "mine";

/**
 * `scope` (optional) switches data source:
 *
 *   undefined  — global tags (precomputed usage_count, default sidebar mode)
 *   "favorites" — tags appearing on the signed-in user's favorited prompts
 *   "mine"      — tags appearing on the signed-in user's authored prompts
 *
 * Scoped queries return only tags with ≥1 occurrence in the user's data.
 */
export function useTags(scope?: TagScope) {
  return useQuery<TagSummary[]>({
    queryKey: ["tags", { limit: SIDEBAR_TAG_LIMIT, scope: scope ?? "global" }],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ limit: String(SIDEBAR_TAG_LIMIT) });
      if (scope) params.set("scope", scope);
      return apiFetch<TagSummary[]>(`/api/tags?${params.toString()}`, { signal });
    },
    staleTime: 5 * 60_000,
  });
}
