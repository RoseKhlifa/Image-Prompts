import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../api";
import { postLike, deleteLike, type LikeResponse } from "../interactions";

export type LikeState = { liked: boolean; count: number };

export type UseLikeMutationOptions = {
  promptId: string;
  onAuthRequired?: () => void;
  onError?: (err: unknown) => void;
};

/**
 * Mutation that toggles a like. Caller owns the optimistic local state
 * (so the LikeButton can update visually before the network roundtrip
 * resolves). On success we adopt the server's like_count to stay in sync
 * with other tabs / cards.
 */
export function useLikeMutation(opts: UseLikeMutationOptions) {
  const qc = useQueryClient();
  return useMutation<LikeResponse, unknown, { action: "like" | "unlike"; previous: LikeState }>({
    mutationFn: async ({ action }) => {
      if (action === "like") return postLike(opts.promptId);
      return deleteLike(opts.promptId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prompts"] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) {
        opts.onAuthRequired?.();
      } else if (err instanceof ApiError && (err.status === 409 || err.status === 404)) {
        // Silent — server says state already matches optimistic
      } else {
        opts.onError?.(err);
      }
    },
  });
}
