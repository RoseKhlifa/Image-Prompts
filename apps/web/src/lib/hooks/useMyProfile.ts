import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PromptSummary } from "@ip/shared";
import { apiFetch } from "../api";
import type { BilingualText, SocialLinks } from "./useUser";

/**
 * PATCH /api/me/profile — update bio + social links. Empty string on a side
 * or slot drops it; omit a key to leave it as-is.
 */
export type UpdateProfileInput = {
  bio?: BilingualText;
  socialLinks?: SocialLinks;
};

export type UpdateProfileResponse = {
  bio: BilingualText | null;
  socialLinks: SocialLinks | null;
};

export function useUpdateMyProfile(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation<UpdateProfileResponse, unknown, UpdateProfileInput>({
    mutationFn: (input) =>
      apiFetch<UpdateProfileResponse>("/api/me/profile", {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      // useUser cache key is ["user", id]; useSession key is ["auth", "session"].
      // Bio/socialLinks land on the user payload only — session shape isn't
      // affected — but we invalidate both to keep avatar / role in sync if
      // the user's Auth.js row was bumped on the server side.
      if (userId) qc.invalidateQueries({ queryKey: ["user", userId] });
      qc.invalidateQueries({ queryKey: ["auth", "session"] });
    },
  });
}

/**
 * PUT /api/me/profile/pins — replace the pinned prompt set with the supplied
 * list of prompt ids (max 3). Empty array clears all pins.
 */
export type SetPinsInput = { promptIds: string[] };
export type SetPinsResponse = { pinnedPrompts: PromptSummary[] };

export function useSetMyPins(userId: string | undefined) {
  const qc = useQueryClient();
  return useMutation<SetPinsResponse, unknown, SetPinsInput>({
    mutationFn: (input) =>
      apiFetch<SetPinsResponse>("/api/me/profile/pins", {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      if (userId) qc.invalidateQueries({ queryKey: ["user", userId] });
      qc.invalidateQueries({ queryKey: ["auth", "session"] });
    },
  });
}
