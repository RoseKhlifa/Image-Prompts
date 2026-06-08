import { useInfiniteQuery } from "@tanstack/react-query";
import { apiFetch } from "../api";
import type { AdminSubmissionListItem } from "@ip/shared";

type Page = { items: AdminSubmissionListItem[]; nextCursor: string | null };
type Status = "pending" | "approved" | "rejected";

export function useAdminSubmissions(status: Status = "pending") {
  return useInfiniteQuery({
    queryKey: ["admin", "submissions", { status }],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      params.set("status", status);
      if (pageParam) params.set("cursor", pageParam);
      return apiFetch<Page>(`/api/admin/submissions?${params.toString()}`, { signal });
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
