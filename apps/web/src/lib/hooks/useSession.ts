import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "../api";

export type Session = {
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
    role: "user" | "moderator" | "admin";
    /**
     * The version of the community guidelines the user has accepted. Added by
     * the Auth.js session callback (M4 Task 26). Optional in the type so older
     * call sites that don't read it continue to compile; the API always
     * injects 0 when the user has never accepted.
     */
    communityGuidelinesVersion?: number;
    /**
     * ★ M10a: derived in API session callback from OWNER_EMAILS env. True iff
     * user is admin AND their email matches the env whitelist. UI uses this
     * to decide whether to show /rosekhlifa nav entry and 403-guard pages.
     */
    isOwner?: boolean;
  };
  expires: string;
};

const SESSION_QUERY_KEY = ["auth", "session"] as const;

export function useSession() {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: async (): Promise<Session | null> => {
      try {
        const data = await apiFetch<Session | null>("/api/auth/session");
        return data ?? null;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60 * 1000,
    retry: false,
  });
}

export function useInvalidateSession() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
}
