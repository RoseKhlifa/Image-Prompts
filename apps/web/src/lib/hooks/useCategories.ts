import { useQuery } from "@tanstack/react-query";
import type { CategorySummary } from "@ip/shared";
import { apiFetch } from "../api";

export function useCategories() {
  return useQuery<CategorySummary[]>({
    queryKey: ["categories"],
    queryFn: ({ signal }) => apiFetch<CategorySummary[]>("/api/categories", { signal }),
    staleTime: 5 * 60_000, // categories rarely change
  });
}
