import { useQuery } from "@tanstack/react-query";
import type { PromptSummary } from "@ip/shared";
import { apiFetch } from "../api";

export type UserFavoritesResponse = {
  items: PromptSummary[];
  nextCursor: string | null;
};

export function useUserFavorites(id: string | undefined, enabled: boolean) {
  return useQuery<UserFavoritesResponse>({
    queryKey: ["user", id, "favorites"],
    queryFn: ({ signal }) =>
      apiFetch<UserFavoritesResponse>(`/api/users/${id}/favorites`, { signal }),
    enabled: !!id && enabled,
    staleTime: 60 * 1000,
  });
}
