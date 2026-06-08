import { useQuery } from "@tanstack/react-query";
import type { PromptSummary } from "@ip/shared";
import { apiFetch } from "../api";

export type UserPromptsResponse = {
  items: PromptSummary[];
  nextCursor: string | null;
};

export function useUserPrompts(id: string | undefined) {
  return useQuery<UserPromptsResponse>({
    queryKey: ["user", id, "prompts"],
    queryFn: ({ signal }) =>
      apiFetch<UserPromptsResponse>(`/api/users/${id}/prompts`, { signal }),
    enabled: !!id,
    staleTime: 60 * 1000,
  });
}
