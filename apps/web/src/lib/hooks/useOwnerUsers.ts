import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiFetch, type ApiError } from "../api";

export type OwnerUserRole = "user" | "moderator" | "admin";

export type OwnerUserListRow = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  role: OwnerUserRole;
  publishedPrompts: number;
  totalSubmissions: number;
  rejectedCount: number;
  bannedAt: string | null;
  createdAt: string;
};

export type OwnerUserRecentSubmission = {
  id: string;
  status: "pending" | "approved" | "rejected";
  titleZh: string | null;
  titleEn: string | null;
  createdAt: string;
};

export type OwnerUserDetail = OwnerUserListRow & {
  communityGuidelinesVersion: number;
  dailySubmissionCount: number;
  dailySubmissionResetAt: string | null;
  recentSubmissions: OwnerUserRecentSubmission[];
};

export type UsersListFilters = {
  q?: string;
  role?: OwnerUserRole;
  banned?: boolean;
};

type UsersListPage = {
  items: OwnerUserListRow[];
  nextCursor: string | null;
};

/**
 * Infinite list of owner users with optional filters. Mirrors the
 * pattern used by useAdminSubmissions — cursor-based pagination, the
 * server returns `nextCursor: null` when the last page has loaded.
 *
 * `filters` is part of the query key so changing the search / role
 * filter refetches from the first page.
 */
export function useOwnerUsersList(
  filters: UsersListFilters,
): UseInfiniteQueryResult<{ pages: UsersListPage[]; pageParams: (string | null)[] }, ApiError> {
  return useInfiniteQuery({
    queryKey: ["owner", "users", "list", filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      if (filters.q !== undefined && filters.q !== "") params.set("q", filters.q);
      if (filters.role !== undefined) params.set("role", filters.role);
      if (filters.banned !== undefined) params.set("banned", filters.banned ? "true" : "false");
      if (pageParam) params.set("cursor", pageParam);
      const qs = params.toString();
      const path = qs ? `/api/owner/users?${qs}` : "/api/owner/users";
      return apiFetch<UsersListPage>(path, { signal });
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useOwnerUserDetail(
  id: string | null,
): UseQueryResult<OwnerUserDetail | null, ApiError> {
  return useQuery({
    queryKey: ["owner", "users", "detail", id],
    queryFn: ({ signal }) => {
      if (!id) return Promise.resolve(null);
      return apiFetch<OwnerUserDetail>(`/api/owner/users/${id}`, { signal });
    },
    enabled: id !== null,
    staleTime: 10_000,
  });
}

export function useUpdateUserRole(): UseMutationResult<
  { id: string; role: OwnerUserRole },
  ApiError,
  { id: string; role: OwnerUserRole }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }) =>
      apiFetch<{ id: string; role: OwnerUserRole }>(`/api/owner/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      }),
    onSuccess: (_res, vars) => {
      // Invalidate both list and the specific detail; the dashboard pulls
      // recent activity from a different endpoint, so it doesn't need to
      // refetch here.
      qc.invalidateQueries({ queryKey: ["owner", "users", "list"] });
      qc.invalidateQueries({ queryKey: ["owner", "users", "detail", vars.id] });
    },
  });
}
