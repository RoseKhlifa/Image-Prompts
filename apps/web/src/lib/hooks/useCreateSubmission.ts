import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SubmissionInput } from "@ip/shared";
import { apiFetch, type ApiError } from "../api";
import { clearDraft } from "../submission-draft";

export type CreateSubmissionResult = { id: string; status: "pending" };

export function useCreateSubmission(opts: {
  onAuthRequired?: () => void;
  onGuidelinesRequired?: () => void;
  onError?: (code: string) => void;
}) {
  const qc = useQueryClient();
  return useMutation<CreateSubmissionResult, ApiError, SubmissionInput>({
    mutationFn: (input) =>
      apiFetch<CreateSubmissionResult>("/api/submissions", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      clearDraft();
      qc.invalidateQueries({ queryKey: ["me", "submissions"] });
    },
    onError: (err) => {
      if (err.status === 401) {
        opts.onAuthRequired?.();
      } else if (err.status === 412) {
        opts.onGuidelinesRequired?.();
      } else {
        opts.onError?.(err.code);
      }
    },
  });
}
