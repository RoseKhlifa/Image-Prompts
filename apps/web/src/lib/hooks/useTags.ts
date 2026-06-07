import { useQuery } from "@tanstack/react-query";
import type { TagSummary } from "@ip/shared";
import { apiFetch } from "../api";

// ★ M4 Task 25: /api/tags' new default `limit` is 8 (geared at autocomplete).
//   The sidebar wants up to 20, so pass it explicitly here.
const SIDEBAR_TAG_LIMIT = 20;

export function useTags() {
  return useQuery<TagSummary[]>({
    queryKey: ["tags", { limit: SIDEBAR_TAG_LIMIT }],
    queryFn: ({ signal }) =>
      apiFetch<TagSummary[]>(`/api/tags?limit=${SIDEBAR_TAG_LIMIT}`, { signal }),
    staleTime: 5 * 60_000,
  });
}
