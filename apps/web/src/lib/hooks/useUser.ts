import { useQuery } from "@tanstack/react-query";
import type { PromptSummary } from "@ip/shared";
import { apiFetch } from "../api";

export type BilingualText = { zh?: string; en?: string };
export type SocialLinks = {
  github?: string;
  twitter?: string;
  bilibili?: string;
  website?: string;
};

export type UserPublic = {
  id: string;
  name: string | null;
  image: string | null;
  role: "user" | "moderator" | "admin";
  joinedAt: string;
  // M11 profile enrich: bilingual self-intro, may be null when never set.
  bio: BilingualText | null;
  // M11 profile enrich: fixed-slot URL set, may be null when none are set.
  socialLinks: SocialLinks | null;
  // M11 profile enrich: 0–3 pinned prompts ordered by pin order.
  pinnedPrompts: PromptSummary[];
};

export function useUser(id: string | undefined) {
  return useQuery<UserPublic>({
    queryKey: ["user", id],
    queryFn: ({ signal }) => apiFetch<UserPublic>(`/api/users/${id}`, { signal }),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}
