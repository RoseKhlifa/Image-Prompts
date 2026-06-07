import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../api";

/**
 * Mutation hook that PATCHes /api/me/community-guidelines with the version the
 * user just accepted. On success the session query is invalidated so the
 * useCommunityGuidelinesGate hook re-derives `needsAccept` from the fresh
 * `communityGuidelinesVersion`.
 *
 * Caller passes the version (typically `requiredVersion` from the gate).
 */
export function useAcceptGuidelines() {
  const qc = useQueryClient();
  return useMutation<{ ok: true }, unknown, number>({
    mutationFn: (version: number) =>
      apiFetch<{ ok: true }>("/api/me/community-guidelines", {
        method: "PATCH",
        body: JSON.stringify({ version }),
      }),
    onSuccess: () => {
      // Matches the query key in useSession.ts (["auth", "session"]).
      qc.invalidateQueries({ queryKey: ["auth", "session"] });
    },
  });
}
