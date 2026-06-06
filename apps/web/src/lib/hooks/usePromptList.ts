import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { z } from "zod";
import type { PromptListQuerySchema, PromptSummary, Paginated } from "@ip/shared";
import { apiFetch } from "../api";

export type PromptListQuery = z.input<typeof PromptListQuerySchema>;

export function usePromptList(query: PromptListQuery) {
  return useQuery<Paginated<PromptSummary>>({
    queryKey: ["prompts", query],
    queryFn: ({ signal }) =>
      apiFetch<Paginated<PromptSummary>>("/api/prompts", {
        query: query as Record<string, string | number | boolean | undefined | null>,
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}
