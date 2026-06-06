import { useQuery } from "@tanstack/react-query";
import type { TagSummary } from "@ip/shared";
import { apiFetch } from "../api";

export function useTags() {
  return useQuery<TagSummary[]>({
    queryKey: ["tags"],
    queryFn: ({ signal }) => apiFetch<TagSummary[]>("/api/tags", { signal }),
    staleTime: 5 * 60_000,
  });
}
