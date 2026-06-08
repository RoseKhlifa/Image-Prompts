import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api";

export function useStats() {
  return useQuery<{ publishedCount: number }>({
    queryKey: ["stats", "summary"],
    queryFn: () => apiFetch("/api/stats/summary"),
    staleTime: 30 * 60 * 1000, // 30 min per spec §3.7
  });
}
