import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api";
import type { AdminSubmissionDetail } from "@ip/shared";

export function useAdminSubmissionDetail(id: string | null) {
  return useQuery({
    queryKey: ["admin", "submissions", id],
    queryFn: ({ signal }) =>
      apiFetch<AdminSubmissionDetail>(`/api/admin/submissions/${id}`, { signal }),
    enabled: !!id,
  });
}
