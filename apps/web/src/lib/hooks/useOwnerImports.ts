import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { apiFetch, type ApiError } from "../api";

// ── Wire types ──────────────────────────────────────────────────────────
//
// Mirror of the /api/owner/imports response shapes. Dates arrive as ISO
// strings via JSON. Repo-side `ImportBatchRow` is the source of truth; this
// file just declares the consumer-side view of it.

export type ImportBatchStatus = "pending" | "running" | "done" | "failed";

export type ImportBatchDTO = {
  id: string;
  categorySlug: string;
  sourceFile: string;
  total: number;
  inserted: number;
  skippedDuplicate: number;
  failed: number;
  failedRecords: Array<{ line: number; externalId?: string; error: string }>;
  status: ImportBatchStatus;
  dryRun: boolean;
  startedBy: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export type ManifestEntry = {
  slug: string;
  name: string;
  count: number;
  jsonl: string;
};

export type ImportManifestResponse = {
  dataRoot: string;
  categories: ManifestEntry[];
};

export type ImportRunResult = {
  batchId: string;
  status: ImportBatchStatus;
  dryRun: boolean;
  total: number;
  inserted: number;
  skippedDuplicate: number;
  failed: number;
  failedRecords: Array<{ line: number; externalId?: string; error: string }>;
};

export type StartImportInput = {
  categorySlug: string;
  dryRun?: boolean;
  limit?: number;
};

// ── Queries ─────────────────────────────────────────────────────────────

/**
 * Reads the 16-category manifest at <import.data_root>/exports/manifest.json.
 * 5-min staleTime — the file rarely changes during a single session.
 */
export function useImportManifest(): UseQueryResult<ImportManifestResponse, ApiError> {
  return useQuery({
    queryKey: ["owner", "imports", "manifest"],
    queryFn: ({ signal }) =>
      apiFetch<ImportManifestResponse>("/api/owner/imports/manifest", { signal }),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Recent batch history (newest first). 30s staleTime so a successful run's
 * mutation can invalidate this key and the UI sees the new row instantly.
 */
export function useImportHistory(): UseQueryResult<{ items: ImportBatchDTO[] }, ApiError> {
  return useQuery({
    queryKey: ["owner", "imports", "history"],
    queryFn: ({ signal }) =>
      apiFetch<{ items: ImportBatchDTO[] }>("/api/owner/imports", { signal }),
    staleTime: 30 * 1000,
  });
}

// ── Mutation ────────────────────────────────────────────────────────────

/**
 * Trigger an import. The server runs `importCategoryJsonl` synchronously and
 * returns the full `ImportCategoryResult`. On success we invalidate the
 * import-history key (so the new batch row appears) plus the public prompts
 * + stats keys (a live run changes the homepage list + counts).
 */
export function useStartImport(): UseMutationResult<
  ImportRunResult,
  ApiError,
  StartImportInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) =>
      apiFetch<ImportRunResult>("/api/owner/imports", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["owner", "imports"] });
      qc.invalidateQueries({ queryKey: ["prompts"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      qc.invalidateQueries({ queryKey: ["categories"] });
    },
  });
}
