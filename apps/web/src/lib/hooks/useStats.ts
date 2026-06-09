import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api";

export type StatsSummary = {
  publishedCount: number;
  contributorCount: number;
  categoryCount: number;
  tagCount: number;
};

export function useStats() {
  return useQuery<StatsSummary>({
    queryKey: ["stats", "summary"],
    queryFn: () => apiFetch("/api/stats/summary"),
    staleTime: 30 * 60 * 1000, // 30 min per spec §3.7
  });
}
