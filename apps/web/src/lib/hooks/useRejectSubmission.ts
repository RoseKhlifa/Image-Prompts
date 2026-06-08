import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "../api";

export function useRejectSubmission(opts: {
  onSuccess?: () => void;
  onError?: (code: string) => void;
}) {
  const qc = useQueryClient();
  return useMutation<{ ok: true }, ApiError, { id: string; reason: string }>({
    mutationFn: ({ id, reason }) =>
      apiFetch<{ ok: true }>(`/api/admin/submissions/${id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "submissions"] });
      opts.onSuccess?.();
    },
    onError: (err) => opts.onError?.(err.code ?? err.message ?? "unknown"),
  });
}
