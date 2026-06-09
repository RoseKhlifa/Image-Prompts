import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiFetch, type ApiError } from "../api";

// ── Types ────────────────────────────────────────────────────────────────
//
// Mirror of /api/owner/prompts shapes. Dates arrive as ISO strings via
// JSON, so we keep them as `string` here (matches useOwnerTaxonomy /
// useOwnerAnnouncements). `images.order` is the canonical sort key.

export type Bilingual = { zh?: string; en?: string };

export type OwnerPromptListItem = {
  id: string;
  slug: string;
  title: Bilingual;
  aspectRatio: string | null;
  viewCount: number;
  likeCount: number;
  sendCount: number;
  favoriteCount: number;
  approvedAt: string;
  createdAt: string;
  category: { id: string; slug: string; name: Bilingual };
  contributor: { id: string; name: string | null; image: string | null } | null;
  primaryImage: {
    r2AccountId: string;
    r2Key: string;
    width: number | null;
    height: number | null;
    lqip: string | null;
  } | null;
  tagSlugs: string[];
};

export type OwnerPromptImage = {
  id: string;
  r2AccountId: string;
  r2Key: string;
  order: number;
  altText: string | null;
  width: number | null;
  height: number | null;
  lqip: string | null;
};

export type OwnerPromptDetail = {
  id: string;
  slug: string;
  title: Bilingual;
  prompt: Bilingual;
  negativePrompt: Bilingual | null;
  notes: Bilingual | null;
  aspectRatio: string | null;
  source: "site" | "nanobanana_seed";
  approvedAt: string;
  createdAt: string;
  updatedAt: string;
  category: { id: string; slug: string; name: Bilingual };
  contributor: { id: string; name: string | null; image: string | null } | null;
  tagSlugs: string[];
  images: OwnerPromptImage[];
};

export type OwnerPromptImageInput = {
  r2AccountId: string;
  r2Key: string;
  altText?: string;
  width?: number;
  height?: number;
  lqip?: string;
};

/**
 * Body shape for POST /api/owner/prompts. All string fields are optional on
 * the wire — server requires `titleZh || titleEn` and `promptZh || promptEn`
 * via zod refine(). categoryId is required; images is 1-10; tagSlugs ≤ 10.
 */
export type OwnerPromptInput = {
  titleZh?: string;
  titleEn?: string;
  promptZh?: string;
  promptEn?: string;
  negativePromptZh?: string;
  negativePromptEn?: string;
  notesZh?: string;
  notesEn?: string;
  aspectRatio?: string;
  categoryId: string;
  tagSlugs: string[];
  images: OwnerPromptImageInput[];
};

export type OwnerPromptUpdatePatch = Partial<Omit<OwnerPromptInput, "images">>;

export type OwnerPromptListFilters = {
  q?: string;
  categorySlug?: string;
  limit?: number;
};

// ── Queries ─────────────────────────────────────────────────────────────

export function useOwnerPrompts(
  filters: OwnerPromptListFilters = {},
): UseQueryResult<
  { items: OwnerPromptListItem[]; nextCursor: string | null },
  ApiError
> {
  // Stable key shape (sorted object) so the cache doesn't churn on key order.
  const key = {
    q: filters.q ?? "",
    categorySlug: filters.categorySlug ?? "",
    limit: filters.limit ?? 30,
  };
  return useQuery({
    queryKey: ["owner", "prompts", key],
    queryFn: ({ signal }) => {
      const qs = new URLSearchParams();
      if (filters.q) qs.set("q", filters.q);
      if (filters.categorySlug) qs.set("categorySlug", filters.categorySlug);
      if (filters.limit) qs.set("limit", String(filters.limit));
      const tail = qs.toString();
      return apiFetch<{ items: OwnerPromptListItem[]; nextCursor: string | null }>(
        `/api/owner/prompts${tail ? `?${tail}` : ""}`,
        { signal },
      );
    },
    staleTime: 10_000,
  });
}

export function useOwnerPromptDetail(
  id: string | null | undefined,
): UseQueryResult<OwnerPromptDetail, ApiError> {
  return useQuery({
    queryKey: ["owner", "prompts", id],
    queryFn: ({ signal }) =>
      apiFetch<OwnerPromptDetail>(`/api/owner/prompts/${id}`, { signal }),
    enabled: Boolean(id),
    staleTime: 10_000,
  });
}

// ── Mutations ───────────────────────────────────────────────────────────

/**
 * After any owner-prompt write, invalidate the owner list + every public
 * surface that could show a stale row: the public list/detail cache, the
 * homepage stats counters, and the category dropdown (its promptCount
 * changes when a prompt is created/deleted).
 */
function useInvalidateOwnerPrompts() {
  const qc = useQueryClient();
  return (slug?: string) => {
    qc.invalidateQueries({ queryKey: ["owner", "prompts"] });
    qc.invalidateQueries({ queryKey: ["prompts"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
    qc.invalidateQueries({ queryKey: ["categories"] });
    if (slug) qc.invalidateQueries({ queryKey: ["prompts", slug] });
  };
}

export function useCreateOwnerPrompt(): UseMutationResult<
  { id: string; slug: string },
  ApiError,
  OwnerPromptInput
> {
  const invalidate = useInvalidateOwnerPrompts();
  return useMutation({
    mutationFn: (input) =>
      apiFetch<{ id: string; slug: string }>("/api/owner/prompts", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: (data) => invalidate(data.slug),
  });
}

export function useUpdateOwnerPrompt(): UseMutationResult<
  OwnerPromptDetail,
  ApiError,
  { id: string; patch: OwnerPromptUpdatePatch }
> {
  const invalidate = useInvalidateOwnerPrompts();
  return useMutation({
    mutationFn: ({ id, patch }) =>
      apiFetch<OwnerPromptDetail>(`/api/owner/prompts/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: (data) => invalidate(data.slug),
  });
}

export function useDeleteOwnerPrompt(): UseMutationResult<
  { id: string; deleted: true },
  ApiError,
  string
> {
  const invalidate = useInvalidateOwnerPrompts();
  return useMutation({
    mutationFn: (id) =>
      apiFetch<{ id: string; deleted: true }>(`/api/owner/prompts/${id}`, {
        method: "DELETE",
      }),
    onSuccess: () => invalidate(),
  });
}
