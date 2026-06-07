import { useQuery } from "@tanstack/react-query";
import type { TagSummary } from "@ip/shared";
import { apiFetch } from "../api";

/**
 * Autocomplete for the submission form's TagPicker. Hits /api/tags?q=&limit=,
 * which returns the top usageCount-ordered tags matching `q` (slug or
 * bilingual name substring). Empty q returns top tags overall — useful as a
 * "no-input" initial set.
 *
 * Default limit of 8 matches the API default; callers (the sidebar) can pass
 * a larger value via useTags.
 */
export function useTagSuggestions(q: string, limit = 8) {
  const trimmed = q.trim();
  return useQuery<TagSummary[]>({
    queryKey: ["tags", { q: trimmed, limit }],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      if (trimmed) params.set("q", trimmed);
      params.set("limit", String(limit));
      return apiFetch<TagSummary[]>(`/api/tags?${params.toString()}`, { signal });
    },
    staleTime: 30_000,
  });
}
