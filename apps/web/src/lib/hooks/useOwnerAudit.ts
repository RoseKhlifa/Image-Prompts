import {
  useInfiniteQuery,
  type UseInfiniteQueryResult,
} from "@tanstack/react-query";
import { apiFetch, type ApiError } from "../api";

/**
 * Read-side bindings for GET /api/owner/audit (W1.4 endpoint).
 *
 * Same shape as useOwnerUsersList: cursor-based pagination, filters baked
 * into the query key so changing a filter refetches from page one. Server
 * decides when there's no more data by returning `nextCursor: null`.
 */
export type OwnerAuditRow = {
  id: string;
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  payload: unknown;
  /** ISO from API (JSON-encoded Date). */
  createdAt: string;
};

export type OwnerAuditFilters = {
  /** e.g. "user." or "submission.role." — server uses LIKE prefix. */
  actionPrefix?: string;
  /** UUID; server validates shape. */
  actorId?: string;
  targetType?: string;
};

type OwnerAuditPage = {
  items: OwnerAuditRow[];
  nextCursor: string | null;
};

export function useOwnerAudit(
  filters: OwnerAuditFilters,
): UseInfiniteQueryResult<
  { pages: OwnerAuditPage[]; pageParams: (string | null)[] },
  ApiError
> {
  return useInfiniteQuery({
    queryKey: ["owner", "audit", "list", filters],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      if (filters.actionPrefix !== undefined && filters.actionPrefix !== "")
        params.set("actionPrefix", filters.actionPrefix);
      if (filters.actorId !== undefined && filters.actorId !== "")
        params.set("actorId", filters.actorId);
      if (filters.targetType !== undefined && filters.targetType !== "")
        params.set("targetType", filters.targetType);
      if (pageParam) params.set("cursor", pageParam);
      const qs = params.toString();
      const path = qs ? `/api/owner/audit?${qs}` : "/api/owner/audit";
      return apiFetch<OwnerAuditPage>(path, { signal });
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
