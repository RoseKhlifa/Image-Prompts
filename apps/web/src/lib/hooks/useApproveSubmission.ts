import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "../api";
import type { ApproveInput } from "@ip/shared";

export function useApproveSubmission(opts: {
  onSuccess?: (r: { promptId: string; slug: string }) => void;
  onError?: (code: string) => void;
}) {
  const qc = useQueryClient();
  return useMutation<
    { promptId: string; slug: string },
    ApiError,
    { id: string; edits: ApproveInput["edits"] }
  >({
    mutationFn: ({ id, edits }) =>
      apiFetch<{ promptId: string; slug: string }>(
        `/api/admin/submissions/${id}/approve`,
        { method: "POST", body: JSON.stringify({ edits: edits ?? {} }) },
      ),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ["admin", "submissions"] });
      opts.onSuccess?.(r);
    },
    onError: (err) => opts.onError?.(err.code ?? err.message ?? "unknown"),
  });
}
