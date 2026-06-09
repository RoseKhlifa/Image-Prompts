import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiFetch, type ApiError } from "../api";

export const REPORT_REASONS = [
  "copyright",
  "nsfw_misclass",
  "illegal",
  "spam",
  "inappropriate",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export type ReportStatus = "open" | "reviewing" | "resolved" | "dismissed";

export type CreateReportInput = {
  targetType: "prompt";
  targetId: string;
  reason: ReportReason;
  detail?: string;
};

export type CreateReportResult = { id: string; deduped: boolean };

export function useCreateReport(): UseMutationResult<
  CreateReportResult,
  ApiError,
  CreateReportInput
> {
  return useMutation({
    mutationFn: (input) =>
      apiFetch<CreateReportResult>("/api/reports", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  });
}

// ── Owner queue ────────────────────────────────────────────────────────

export type OwnerReportRow = {
  id: string;
  reporter: { id: string; name: string | null; email: string | null } | null;
  targetType: string;
  targetId: string;
  reason: string;
  detail: string | null;
  status: ReportStatus;
  actionTaken: string | null;
  reviewer: { id: string; name: string | null } | null;
  reviewedAt: string | null;
  createdAt: string;
  target: { slug: string; title: { zh?: string; en?: string } | null } | null;
};

export type OwnerReportsPage = {
  items: OwnerReportRow[];
  total: number;
  hasMore: boolean;
};

export function useOwnerReports(filters: {
  status?: ReportStatus;
  page: number;
  pageSize?: number;
}): UseQueryResult<OwnerReportsPage, ApiError> {
  const pageSize = filters.pageSize ?? 20;
  return useQuery({
    queryKey: ["owner", "reports", filters.status ?? "all", filters.page, pageSize],
    queryFn: ({ signal }) => {
      const qs = new URLSearchParams({
        page: String(filters.page),
        pageSize: String(pageSize),
      });
      if (filters.status) qs.set("status", filters.status);
      return apiFetch<OwnerReportsPage>(`/api/owner/reports?${qs.toString()}`, {
        signal,
      });
    },
    staleTime: 10_000,
  });
}

export function useOwnerReportCounts(): UseQueryResult<
  Record<ReportStatus, number>,
  ApiError
> {
  return useQuery({
    queryKey: ["owner", "reports", "counts"],
    queryFn: ({ signal }) =>
      apiFetch<Record<ReportStatus, number>>("/api/owner/reports/counts", {
        signal,
      }),
    staleTime: 30_000,
  });
}

export function useUpdateReport(): UseMutationResult<
  { id: string },
  ApiError,
  { id: string; status: ReportStatus; actionTaken?: string }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, actionTaken }) =>
      apiFetch<{ id: string }>(`/api/owner/reports/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          status,
          ...(actionTaken ? { actionTaken } : {}),
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["owner", "reports"] });
    },
  });
}
