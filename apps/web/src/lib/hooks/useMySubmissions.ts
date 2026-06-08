import { useInfiniteQuery } from "@tanstack/react-query";
import type { SubmissionListItem } from "@ip/shared";
import { apiFetch } from "../api";

type Page = { items: SubmissionListItem[]; nextCursor: string | null };

export function useMySubmissions(status: SubmissionListItem["status"] | "all" = "all") {
  return useInfiniteQuery({
    queryKey: ["me", "submissions", { status }],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams();
      if (status !== "all") params.set("status", status);
      if (pageParam) params.set("cursor", pageParam);
      return apiFetch<Page>(`/api/me/submissions?${params.toString()}`, { signal });
    },
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}
