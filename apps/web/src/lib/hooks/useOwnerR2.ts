import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiFetch, type ApiError } from "../api";

export type OwnerR2Account = {
  id: string;
  name: string;
  accountId: string;
  endpoint: string;
  bucket: string;
  publicUrl: string;
  priority: number;
  enabled: boolean;
  usedBytes: number | null;
  lastSyncedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
};

/**
 * Body for POST /api/owner/r2-accounts. Mirrors R2CreateBodySchema on the
 * server: every field is required (including `accessKeySecret`, which is the
 * ONLY place the cleartext value lives — at rest the repo encrypts it).
 *
 * `priority` defaults to 100 and `enabled` defaults to true server-side, but
 * the modal always sends them explicitly to make the audit trail unambiguous.
 */
export type R2WriteInput = {
  name: string;
  accountId: string;
  endpoint: string;
  accessKeyId: string;
  /**
   * Cleartext on the wire. The server's repo encrypts before insert and never
   * echoes it back. On edit, the modal sends this key only when the operator
   * retypes a new value — see `R2EditInput`.
   */
  accessKeySecret: string;
  bucket: string;
  publicUrl: string;
  priority?: number;
  enabled?: boolean;
};

/**
 * Body for PATCH /api/owner/r2-accounts/:id. Every field is optional. The
 * caller (the modal) builds a minimal patch containing only fields that
 * changed; in particular `accessKeySecret` is omitted when the operator left
 * the secret input blank, which preserves the existing encrypted value.
 */
export type R2EditInput = Partial<R2WriteInput>;

/** POST /api/owner/r2-accounts/:id/test response — see r2-ops.testConnection. */
export type R2TestResult = {
  ok: boolean;
  status: number | null;
  latencyMs: number;
  error?: string;
};

/** POST /api/owner/r2-accounts/:id/sync-usage response — see r2-ops.syncUsage. */
export type R2SyncResult = {
  usedBytes: number;
  objectCount: number;
};

export function useOwnerR2Accounts(): UseQueryResult<
  { items: OwnerR2Account[] },
  ApiError
> {
  return useQuery({
    queryKey: ["owner", "r2-accounts"],
    queryFn: ({ signal }) =>
      apiFetch<{ items: OwnerR2Account[] }>("/api/owner/r2-accounts", { signal }),
    staleTime: 30_000,
  });
}

/**
 * Invalidate the owner R2 list cache after any write. The runtime read path
 * (the pool the API uses to mint upload URLs) has its own server-side cache
 * with a separate TTL and is intentionally NOT touched here — operators see
 * the change in the panel immediately; uploaders pick it up on the next
 * cache miss.
 */
function useInvalidateR2Accounts() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["owner", "r2-accounts"] });
  };
}

export function useCreateR2Account(): UseMutationResult<
  { id: string },
  ApiError,
  R2WriteInput
> {
  const invalidate = useInvalidateR2Accounts();
  return useMutation({
    mutationFn: (input) =>
      apiFetch<{ id: string }>("/api/owner/r2-accounts", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: invalidate,
  });
}

export function useUpdateR2Account(): UseMutationResult<
  OwnerR2Account,
  ApiError,
  { id: string; patch: R2EditInput }
> {
  const invalidate = useInvalidateR2Accounts();
  return useMutation({
    mutationFn: ({ id, patch }) =>
      apiFetch<OwnerR2Account>(`/api/owner/r2-accounts/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      }),
    onSuccess: invalidate,
  });
}

export function useDeleteR2Account(): UseMutationResult<
  { id: string; deleted: true },
  ApiError,
  string
> {
  const invalidate = useInvalidateR2Accounts();
  return useMutation({
    mutationFn: (id) =>
      apiFetch<{ id: string; deleted: true }>(`/api/owner/r2-accounts/${id}`, {
        method: "DELETE",
      }),
    onSuccess: invalidate,
  });
}

/**
 * Probe an R2 account for reachability. We deliberately DON'T toast on the
 * result — the page renders a transient inline status badge next to the
 * button (see R2Page). Only the error path (mutation rejected) reaches the
 * page's onError handler.
 *
 * No cache invalidation: a probe doesn't mutate any row.
 */
export function useTestR2Connection(): UseMutationResult<
  R2TestResult,
  ApiError,
  string
> {
  return useMutation({
    mutationFn: (id) =>
      apiFetch<R2TestResult>(`/api/owner/r2-accounts/${id}/test`, {
        method: "POST",
      }),
  });
}

/**
 * Walk every object in the bucket and persist `used_bytes` + `last_synced_at`.
 * The server runs this synchronously; large buckets can take 30s+, so the
 * page must show a spinner while in flight and disable the button.
 *
 * Invalidates the list so the row's `usedBytes` + `lastSyncedAt` cells
 * refresh without a manual reload.
 */
export function useSyncR2Usage(): UseMutationResult<
  R2SyncResult,
  ApiError,
  string
> {
  const invalidate = useInvalidateR2Accounts();
  return useMutation({
    mutationFn: (id) =>
      apiFetch<R2SyncResult>(`/api/owner/r2-accounts/${id}/sync-usage`, {
        method: "POST",
      }),
    onSuccess: invalidate,
  });
}
