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
// Mirrors the owner-taxonomy.ts API repo. createdAt arrives as an ISO string
// (Date.toJSON()), so we keep it as `string` here for symmetry with the
// other owner hooks (useOwnerAnnouncements, etc.).

export type Bilingual = { zh?: string; en?: string };

export type OwnerCategory = {
  id: string;
  slug: string;
  name: Bilingual;
  description: Bilingual | null;
  order: number;
  promptCount: number;
  createdAt: string;
};

export type OwnerTag = {
  id: string;
  slug: string;
  name: Bilingual;
  usageCount: number;
  promptCount: number;
  createdAt: string;
};

export type CategoryInput = {
  slug: string;
  name: Bilingual;
  description?: Bilingual;
  order?: number;
};

export type TagInput = {
  slug: string;
  name: Bilingual;
};

// ── Categories ──────────────────────────────────────────────────────────

export function useOwnerCategories(): UseQueryResult<
  { items: OwnerCategory[] },
  ApiError
> {
  return useQuery({
    queryKey: ["owner", "categories"],
    queryFn: ({ signal }) =>
      apiFetch<{ items: OwnerCategory[] }>("/api/owner/categories", { signal }),
    staleTime: 10_000,
  });
}

/**
 * Invalidate the owner key + the public `["categories"]` family so the
 * sidebar's category list refreshes after every mutation. The public
 * useCategories hook keys are shaped `["categories", { scope }]`, so we
 * invalidate the prefix to catch every scoped variant in one go.
 */
function useInvalidateCategories() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["owner", "categories"] });
    qc.invalidateQueries({ queryKey: ["categories"] });
  };
}

export function useCreateOwnerCategory(): UseMutationResult<
  OwnerCategory,
  ApiError,
  CategoryInput
> {
  const invalidate = useInvalidateCategories();
  return useMutation({
    mutationFn: (input) =>
      apiFetch<OwnerCategory>("/api/owner/categories", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateOwnerCategory(): UseMutationResult<
  OwnerCategory,
  ApiError,
  { id: string; patch: Partial<CategoryInput> }
> {
  const invalidate = useInvalidateCategories();
  return useMutation({
    mutationFn: ({ id, patch }) =>
      apiFetch<OwnerCategory>(`/api/owner/categories/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteOwnerCategory(): UseMutationResult<
  { id: string; deleted: true },
  ApiError,
  string
> {
  const invalidate = useInvalidateCategories();
  return useMutation({
    mutationFn: (id) =>
      apiFetch<{ id: string; deleted: true }>(`/api/owner/categories/${id}`, {
        method: "DELETE",
      }),
    onSuccess: invalidate,
  });
}

// ── Tags ────────────────────────────────────────────────────────────────

export function useOwnerTags(): UseQueryResult<{ items: OwnerTag[] }, ApiError> {
  return useQuery({
    queryKey: ["owner", "tags"],
    queryFn: ({ signal }) =>
      apiFetch<{ items: OwnerTag[] }>("/api/owner/tags", { signal }),
    staleTime: 10_000,
  });
}

function useInvalidateTags() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["owner", "tags"] });
    qc.invalidateQueries({ queryKey: ["tags"] });
  };
}

export function useCreateOwnerTag(): UseMutationResult<
  OwnerTag,
  ApiError,
  TagInput
> {
  const invalidate = useInvalidateTags();
  return useMutation({
    mutationFn: (input) =>
      apiFetch<OwnerTag>("/api/owner/tags", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateOwnerTag(): UseMutationResult<
  OwnerTag,
  ApiError,
  { id: string; patch: Partial<TagInput> }
> {
  const invalidate = useInvalidateTags();
  return useMutation({
    mutationFn: ({ id, patch }) =>
      apiFetch<OwnerTag>(`/api/owner/tags/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteOwnerTag(): UseMutationResult<
  { id: string; deleted: true },
  ApiError,
  string
> {
  const invalidate = useInvalidateTags();
  return useMutation({
    mutationFn: (id) =>
      apiFetch<{ id: string; deleted: true }>(`/api/owner/tags/${id}`, {
        method: "DELETE",
      }),
    onSuccess: invalidate,
  });
}
