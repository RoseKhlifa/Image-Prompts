import { useQuery } from "@tanstack/react-query";
import type { PromptSummary } from "@ip/shared";
import { apiFetch } from "../api";

export type MyFavoritesResponse = {
  items: PromptSummary[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

export function useMyFavorites(page: number, pageSize = 24) {
  return useQuery<MyFavoritesResponse>({
    queryKey: ["me", "favorites", { page, pageSize }],
    queryFn: ({ signal }) =>
      apiFetch<MyFavoritesResponse>(
        `/api/me/favorites?page=${page}&pageSize=${pageSize}`,
        { signal },
      ),
    staleTime: 30 * 1000,
  });
}
