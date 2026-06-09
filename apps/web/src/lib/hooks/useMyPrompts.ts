import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import type { SubmissionInput } from "@ip/shared";
import { apiFetch, type ApiError } from "../api";

// ── DELETE /api/me/prompts/:id ───────────────────────────────────────────
//
// Immediate self-delete for a prompt the signed-in user contributed. After
// success we invalidate every public surface that could show a stale row:
//   - ["prompts"] — the list/detail caches in usePromptDetail/usePromptList
//   - ["stats"]   — the homepage counter
//   - ["categories"] — promptCount drops by 1
// We don't invalidate ["my-submissions"] here — the prompt itself is gone,
// not a submission; the user's submissions tab is unaffected.

export function useDeleteMyPrompt(): UseMutationResult<
  { id: string; deleted: true },
  ApiError,
  { id: string; slug: string }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }) =>
      apiFetch<{ id: string; deleted: true }>(`/api/me/prompts/${id}`, {
        method: "DELETE",
      }),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["prompts"] });
      qc.invalidateQueries({ queryKey: ["prompts", vars.slug] });
      qc.invalidateQueries({ queryKey: ["prompts", "detail", vars.slug] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["categories"] });
    },
  });
}

// ── POST /api/me/prompts/:id/edit ────────────────────────────────────────
//
// Queue a self-edit submission. The body matches POST /api/submissions —
// SubmissionInput from @ip/shared — and the server INSERTs a submissions row
// with originalPromptId = the URL :id. The moderator's approval will UPDATE
// the original prompt in place rather than INSERT a new one.

export function useSubmitMyPromptEdit(): UseMutationResult<
  { submissionId: string; status: "pending" },
  ApiError,
  { id: string; input: SubmissionInput }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }) =>
      apiFetch<{ submissionId: string; status: "pending" }>(
        `/api/me/prompts/${id}/edit`,
        {
          method: "POST",
          body: JSON.stringify(input),
        },
      ),
    onSuccess: () => {
      // The user's submissions tab now has a fresh pending row. The original
      // prompt's detail cache is unchanged (it's still the pre-edit version)
      // until the moderator approves and the user re-fetches.
      qc.invalidateQueries({ queryKey: ["my-submissions"] });
    },
  });
}
