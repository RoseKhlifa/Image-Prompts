import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api";

export type OwnerDashboardActivity = {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  payload: unknown;
  createdAt: string;
};
export type OwnerDashboard = {
  metrics: {
    publishedPrompts: number;
    totalUsers: number;
    pendingSubmissions: number;
    totalViews: number;
    totalLikes: number;
    totalFavorites: number;
    totalSubmissions: number;
    totalR2UsedBytes: number;
  };
  recentActivity: OwnerDashboardActivity[];
};

export function useOwnerDashboard() {
  return useQuery({
    queryKey: ["owner", "dashboard"],
    queryFn: () => apiFetch<OwnerDashboard>("/api/owner/dashboard"),
    staleTime: 30_000,
  });
}
