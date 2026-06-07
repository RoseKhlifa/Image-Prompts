import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../api";
import { postFavorite, deleteFavorite, type FavoriteResponse } from "../interactions";

export type FavoriteState = { favorited: boolean };

export type UseFavoriteMutationOptions = {
  promptId: string;
  onAuthRequired?: () => void;
  onError?: (err: unknown) => void;
};

export function useFavoriteMutation(opts: UseFavoriteMutationOptions) {
  const qc = useQueryClient();
  return useMutation<FavoriteResponse, unknown, { action: "favorite" | "unfavorite" }>({
    mutationFn: async ({ action }) => {
      if (action === "favorite") return postFavorite(opts.promptId);
      return deleteFavorite(opts.promptId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prompts"] });
      qc.invalidateQueries({ queryKey: ["me", "favorites"] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) {
        opts.onAuthRequired?.();
      } else if (err instanceof ApiError && (err.status === 409 || err.status === 404)) {
        // Silent
      } else {
        opts.onError?.(err);
      }
    },
  });
}
