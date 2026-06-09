import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiFetch, type ApiError } from "../api";

export type Severity = "info" | "warning" | "critical";
export type DisplayMode = "banner" | "popup";
export type AnnouncementBilingual = { zh?: string; en?: string };

/**
 * Owner-facing announcement row. Mirrors the API repo type — dates come
 * back as ISO strings (Date.toJSON()), so we keep them as `string` here.
 *
 * `deletedAt` is non-null on soft-deleted rows; the owner list returns
 * those too (the page filters them only when computing the active pill).
 */
export type OwnerAnnouncement = {
  id: string;
  title: AnnouncementBilingual;
  body: AnnouncementBilingual;
  severity: Severity;
  displayMode: DisplayMode;
  startsAt: string;
  endsAt: string | null;
  dismissible: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  updatedBy: string | null;
  deletedAt: string | null;
};

/**
 * POST body for create + PATCH body for update (Partial<this> for patch).
 *
 * `title` / `body` require at least one of `zh` / `en` to be non-empty,
 * matching the zod refine() on the server. We don't model that constraint
 * at the type level — the page-level validation enforces it before submit.
 */
export type AnnouncementInput = {
  title: AnnouncementBilingual;
  body: AnnouncementBilingual;
  severity: Severity;
  displayMode?: DisplayMode;       // default "banner"
  startsAt: string;
  endsAt?: string;
  dismissible?: boolean;
};

/**
 * Owner list (every row, including soft-deleted). The server returns them
 * newest-first; the page can sort further if needed.
 */
export function useOwnerAnnouncements(): UseQueryResult<
  { items: OwnerAnnouncement[] },
  ApiError
> {
  return useQuery({
    queryKey: ["owner", "announcements"],
    queryFn: ({ signal }) =>
      apiFetch<{ items: OwnerAnnouncement[] }>("/api/owner/announcements", { signal }),
    staleTime: 10_000,
  });
}

/**
 * Invalidate both query keys after every write. Without invalidating
 * `["announcements"]` the banner would stay stale until the 60s window
 * elapses — owners would publish a banner and not see it.
 */
function useInvalidateAnnouncements() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["owner", "announcements"] });
    qc.invalidateQueries({ queryKey: ["announcements"] });
  };
}

export function useCreateAnnouncement(): UseMutationResult<
  OwnerAnnouncement,
  ApiError,
  AnnouncementInput
> {
  const invalidate = useInvalidateAnnouncements();
  return useMutation({
    mutationFn: (input) =>
      apiFetch<OwnerAnnouncement>("/api/owner/announcements", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateAnnouncement(): UseMutationResult<
  OwnerAnnouncement,
  ApiError,
  { id: string; patch: Partial<AnnouncementInput> }
> {
  const invalidate = useInvalidateAnnouncements();
  return useMutation({
    mutationFn: ({ id, patch }) =>
      apiFetch<OwnerAnnouncement>(`/api/owner/announcements/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteAnnouncement(): UseMutationResult<
  { id: string; deleted: true },
  ApiError,
  string
> {
  const invalidate = useInvalidateAnnouncements();
  return useMutation({
    mutationFn: (id) =>
      apiFetch<{ id: string; deleted: true }>(`/api/owner/announcements/${id}`, {
        method: "DELETE",
      }),
    onSuccess: invalidate,
  });
}
