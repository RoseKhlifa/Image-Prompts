import { useQuery } from "@tanstack/react-query";
import type { CategorySummary } from "@ip/shared";
import { apiFetch } from "../api";

export type CategoryScope = "favorites" | "mine";

/**
 * `scope` (optional) narrows the promptCount returned per category:
 *
 *   undefined  — global counts (every published prompt)
 *   "favorites" — only the signed-in user's favorited prompts (needs auth)
 *   "mine"      — only the signed-in user's authored prompts (needs auth)
 *
 * The query key includes scope so the global cache and per-scope caches
 * don't collide.
 */
export function useCategories(scope?: CategoryScope) {
  return useQuery<CategorySummary[]>({
    queryKey: ["categories", { scope: scope ?? "global" }],
    queryFn: ({ signal }) => {
      const qs = scope ? `?scope=${scope}` : "";
      return apiFetch<CategorySummary[]>(`/api/categories${qs}`, { signal });
    },
    staleTime: 5 * 60_000, // categories rarely change
  });
}
