import { useSession } from "./useSession";

/**
 * The current required version of the community guidelines. Bumped whenever
 * the guidelines text changes materially; every authenticated user with a
 * lower accepted version must re-accept before submitting.
 *
 * Mirrors SUBMIT_CONFIG.GUIDELINES_VERSION on the API side.
 */
const REQUIRED_VERSION = 1;

export type CommunityGuidelinesGate = {
  /** True when the user is signed in AND their accepted version is < required. */
  needsAccept: boolean;
  /** The required version (so the modal can submit it back). */
  requiredVersion: number;
  /** Session is still being fetched — caller should not act yet. */
  isLoading: boolean;
  /** True iff a session exists (i.e. user is signed in). */
  isAuthed: boolean;
};

/**
 * Derived gate state from the session: do we need to show the community
 * guidelines modal before letting the user submit?
 *
 * The session carries `communityGuidelinesVersion` (injected by the Auth.js
 * session callback in apps/api/src/auth/index.ts) — we compare it against the
 * frontend-pinned REQUIRED_VERSION. Anonymous users never see the gate.
 */
export function useCommunityGuidelinesGate(): CommunityGuidelinesGate {
  const session = useSession();
  const isAuthed = !!session.data;
  const acceptedVersion = session.data?.user.communityGuidelinesVersion ?? 0;
  return {
    needsAccept: isAuthed && acceptedVersion < REQUIRED_VERSION,
    requiredVersion: REQUIRED_VERSION,
    isLoading: session.isLoading,
    isAuthed,
  };
}
