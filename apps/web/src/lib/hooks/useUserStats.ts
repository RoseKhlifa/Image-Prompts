import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api";

export type UserStats = {
  publishedCount: number;
  totalViews: number;
  totalLikes: number;
  totalFavorites: number;
};

export function useUserStats(id: string | undefined) {
  return useQuery<UserStats>({
    queryKey: ["user", id, "stats"],
    queryFn: ({ signal }) => apiFetch<UserStats>(`/api/users/${id}/stats`, { signal }),
    enabled: !!id,
    staleTime: 60 * 1000,
  });
}
