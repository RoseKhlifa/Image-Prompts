import { useQuery } from "@tanstack/react-query";
import type { PromptDetail, PromptSummary } from "@ip/shared";
import { apiFetch } from "../api";

export type PromptDetailWithRelated = PromptDetail & {
  related: Array<
    Pick<
      PromptSummary,
      | "id"
      | "slug"
      | "title"
      | "aspectRatio"
      | "viewCount"
      | "likeCount"
      | "sendCount"
      | "favoriteCount"
      | "approvedAt"
      | "primaryImage"
    >
  >;
};

export function usePromptDetail(slug: string | undefined) {
  return useQuery<PromptDetailWithRelated>({
    queryKey: ["prompts", "detail", slug],
    queryFn: ({ signal }) => apiFetch<PromptDetailWithRelated>(`/api/prompts/${slug}`, { signal }),
    enabled: Boolean(slug),
  });
}
