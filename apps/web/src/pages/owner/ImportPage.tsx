import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ExternalLink, Upload, X } from "lucide-react";
import {
  useImportHistory,
  useImportManifest,
  useStartImport,
  useUploadImport,
  type ImportBatchStatus,
  type ImportRunResult,
  type ManifestEntry,
} from "../../lib/hooks/useOwnerImports";
import { toast } from "../../lib/toast";

/**
 * /:locale/rosekhlifa/import — owner-only crawled-prompt import surface.
 *
 * Two stacked tables:
 *
 *  - Manifest table: one row per category from
 *    <import.data_root>/exports/manifest.json. Each row has a "Dry-run 10"
 *    button (parses but writes nothing) + a "Run import" button (live).
 *    A run is synchronous on the server side; we disable the row's buttons
 *    while a request is in flight to prevent double-submits.
 *
 *  - History table: most recent batches (newest first) with status pill +
 *    inserted/skipped/failed counters in mono so they line up.
 *
 * Theming follows the owner-shell zinc/emerald palette (mirrors AuditPage /
 * AnnouncementsPage). All copy is bilingual via the `owner.import.*` keys.
 */
export default function ImportPage() {
  const { t } = useTranslation();
  const manifest = useImportManifest();
  const history = useImportHistory();
  const startMut = useStartImport();
  const [busySlug, setBusySlug] = useState<string | null>(null);

  function run(entry: ManifestEntry, dryRun: boolean) {
    setBusySlug(entry.slug);
    startMut.mutate(
      dryRun
        ? { categorySlug: entry.slug, dryRun: true, limit: 10 }
        : { categorySlug: entry.slug },
      {
        onSuccess: (data) => {
          toast.success(
            t("owner.import.run_success", {
              inserted: data.inserted,
              skipped: data.skippedDuplicate,
              failed: data.failed,
            }),
          );
          setBusySlug(null);
        },
        onError: (err) => {
          toast.error(err.message ?? t("owner.import.run_failed"));
          setBusySlug(null);
        },
      },
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">
            {t("owner.import.title")}
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            {t("owner.import.subtitle", {
              root: manifest.data?.dataRoot ?? "…",
            })}
          </p>
        </div>
      </div>

      {manifest.isError && (
        <div className="mt-6 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          <AlertTriangle size={16} aria-hidden />
          <span>{t("owner.import.manifest_unreadable")}</span>
          {manifest.error?.message && (
            <code className="ml-2 truncate font-mono text-[11px] text-amber-200/80">
              {manifest.error.message}
            </code>
          )}
        </div>
      )}

      <UploadSection />

      <h2 className="mt-10 text-lg font-semibold text-zinc-100">
        {t("owner.import.manifest_title")}
      </h2>
      <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-800 text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">
                {t("owner.import.col_slug")}
              </th>
              <th className="px-4 py-3 text-left font-semibold">
                {t("owner.import.col_name")}
              </th>
              <th className="px-4 py-3 text-right font-semibold">
                {t("owner.import.col_count")}
              </th>
              <th className="px-4 py-3 text-right font-semibold">
                {t("owner.import.col_actions")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {manifest.isLoading && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-zinc-500">
                  {t("common.loading")}
                </td>
              </tr>
            )}
            {!manifest.isLoading && manifest.data && manifest.data.categories.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-zinc-500">
                  {t("owner.import.history_empty")}
                </td>
              </tr>
            )}
            {manifest.data?.categories.map((entry) => {
              const busy = busySlug === entry.slug;
              return (
                <tr key={entry.slug} className="hover:bg-zinc-900/60">
                  <td className="px-4 py-2 font-mono text-xs text-zinc-300">
                    {entry.slug}
                  </td>
                  <td className="px-4 py-2 text-sm text-zinc-200">
                    {entry.name}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-zinc-400">
                    {entry.count.toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => run(entry, true)}
                        disabled={busy}
                        className="rounded-md bg-zinc-800 px-3 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {t("owner.import.dry_run")}
                      </button>
                      <button
                        type="button"
                        onClick={() => run(entry, false)}
                        disabled={busy}
                        className="rounded-md bg-emerald-500 px-3 py-1 text-xs font-medium text-zinc-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {busy ? "…" : t("owner.import.run")}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2 className="mt-10 text-lg font-semibold text-zinc-100">
        {t("owner.import.history_title")}
      </h2>
      {history.data && history.data.items.length > 0 ? (
        <div className="mt-3 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-800 text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">
                  {t("owner.import.col_started_at")}
                </th>
                <th className="px-4 py-3 text-left font-semibold">
                  {t("owner.import.col_slug")}
                </th>
                <th className="px-4 py-3 text-left font-semibold">
                  {t("owner.import.col_status")}
                </th>
                <th className="px-4 py-3 text-right font-semibold">
                  {t("owner.import.col_inserted")}
                </th>
                <th className="px-4 py-3 text-right font-semibold">
                  {t("owner.import.col_skipped")}
                </th>
                <th className="px-4 py-3 text-right font-semibold">
                  {t("owner.import.col_failed")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {history.data.items.map((b) => (
                <tr key={b.id} className="hover:bg-zinc-900/60">
                  <td className="px-4 py-2 font-mono text-xs text-zinc-300">
                    {new Date(b.startedAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-zinc-300">
                    <div className="flex items-center gap-1.5">
                      <span>{b.categorySlug}</span>
                      {b.dryRun && (
                        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-amber-300">
                          dry
                        </span>
                      )}
                      <span className="font-mono text-[10px] text-zinc-600">
                        {b.id.slice(0, 8)}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-2 text-xs">
                    <StatusPill status={b.status} />
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-emerald-400">
                    +{b.inserted.toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-zinc-400">
                    ~{b.skippedDuplicate.toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-rose-400">
                    !{b.failed.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : history.isLoading ? (
        <p className="mt-3 text-sm text-zinc-500">{t("common.loading")}</p>
      ) : (
        <p className="mt-3 text-sm text-zinc-500">
          {t("owner.import.history_empty")}
        </p>
      )}

      <p className="mt-8 flex items-center gap-1.5 text-xs text-zinc-600">
        <ExternalLink size={12} aria-hidden />
        <span>{t("owner.import.subtitle", { root: manifest.data?.dataRoot ?? "…" })}</span>
      </p>
    </div>
  );
}

function StatusPill({ status }: { status: ImportBatchStatus }) {
  const cls =
    status === "done"
      ? "rounded bg-emerald-500/20 px-2 py-0.5 text-emerald-300"
      : status === "failed"
      ? "rounded bg-rose-500/20 px-2 py-0.5 text-rose-300"
      : status === "running"
      ? "rounded bg-amber-500/20 px-2 py-0.5 text-amber-300"
      : "rounded bg-zinc-700 px-2 py-0.5 text-zinc-300";
  return <span className={cls}>{status}</span>;
}

type UploadResult = { filename: string; result?: ImportRunResult; error?: string };

/**
 * Local-file import surface. Drag-drop or pick `<name>.jsonl` files; the
 * server stages each in os.tmpdir() and runs `importCategoryJsonl` against
 * it. Use this on the VPS when the data isn't on the server's disk —
 * lets the owner skip scp/rsync entirely.
 *
 * Multiple files queue up; the upload mutation fires one at a time so each
 * file gets its own `import_batches` row in the audit/history feed.
 */
function UploadSection() {
  const { t } = useTranslation();
  const uploadMut = useUploadImport();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [dryRun, setDryRun] = useState(false);
  const [limitText, setLimitText] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [busyIdx, setBusyIdx] = useState<number | null>(null);
  const [results, setResults] = useState<UploadResult[]>([]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const next = Array.from(list).filter((f) =>
      f.name.toLowerCase().endsWith(".jsonl"),
    );
    setFiles((prev) => [...prev, ...next]);
  }

  function removeAt(i: number) {
    setFiles((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function uploadAll() {
    if (files.length === 0) return;
    setResults([]);
    const parsedLimit = limitText ? Number(limitText) : undefined;
    const limit =
      parsedLimit !== undefined && !Number.isNaN(parsedLimit) && parsedLimit > 0
        ? parsedLimit
        : undefined;
    let okCount = 0;
    let failCount = 0;
    for (let i = 0; i < files.length; i++) {
      setBusyIdx(i);
      const file = files[i]!;
      try {
        const result = await uploadMut.mutateAsync({
          file,
          dryRun,
          ...(limit !== undefined ? { limit } : {}),
        });
        setResults((prev) => [...prev, { filename: file.name, result }]);
        okCount++;
      } catch (e) {
        const message = e instanceof Error ? e.message : "unknown_error";
        setResults((prev) => [...prev, { filename: file.name, error: message }]);
        failCount++;
      }
    }
    setBusyIdx(null);
    if (failCount === 0) {
      toast.success(t("owner.import.upload_complete_all", { n: okCount }));
    } else {
      toast.error(
        t("owner.import.upload_complete_partial", { ok: okCount, fail: failCount }),
      );
    }
    setFiles([]);
  }

  const dropClass = dragOver
    ? "border-emerald-500 bg-emerald-500/5"
    : "border-zinc-700 hover:border-zinc-600";
  const totalBytes = files.reduce((acc, f) => acc + f.size, 0);

  return (
    <section className="mt-5 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
      <h2 className="text-lg font-semibold text-zinc-100">
        {t("owner.import.upload_title")}
      </h2>
      <p className="mt-1 text-xs text-zinc-400">
        {t("owner.import.upload_subtitle")}
      </p>

      <div
        onDragEnter={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          addFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`mt-3 cursor-pointer rounded-lg border-2 border-dashed px-4 py-8 text-center transition ${dropClass}`}
      >
        <Upload size={20} className="mx-auto text-zinc-500" aria-hidden />
        <p className="mt-2 text-sm text-zinc-300">
          {t("owner.import.drop_hint")}
        </p>
        <p className="mt-1 text-xs text-zinc-500">
          {t("owner.import.drop_subhint")}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".jsonl"
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {files.length > 0 && (
        <ul className="mt-3 divide-y divide-zinc-800 rounded border border-zinc-800">
          {files.map((f, i) => (
            <li
              key={`${f.name}-${i}`}
              className="flex items-center justify-between px-3 py-2 text-sm"
            >
              <span className="truncate font-mono text-xs text-zinc-300">
                {f.name}
                <span className="ml-2 text-zinc-500">
                  ({(f.size / 1024).toFixed(1)} KB)
                </span>
              </span>
              <button
                type="button"
                onClick={() => removeAt(i)}
                disabled={busyIdx !== null}
                aria-label={t("common.close")}
                className="rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-rose-400 disabled:opacity-40"
              >
                <X size={14} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-zinc-300">
          <input
            type="checkbox"
            checked={dryRun}
            onChange={(e) => setDryRun(e.target.checked)}
            disabled={busyIdx !== null}
          />
          {t("owner.import.dry_run_checkbox")}
        </label>
        <input
          type="number"
          min={1}
          value={limitText}
          onChange={(e) => setLimitText(e.target.value)}
          placeholder={t("owner.import.limit_placeholder")}
          disabled={busyIdx !== null}
          className="w-44 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none disabled:opacity-40"
        />
        {files.length > 0 && (
          <span className="text-xs text-zinc-500">
            {t("owner.import.upload_total", {
              n: files.length,
              kb: (totalBytes / 1024).toFixed(1),
            })}
          </span>
        )}
        <button
          type="button"
          onClick={uploadAll}
          disabled={files.length === 0 || busyIdx !== null}
          className="ml-auto rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-medium text-zinc-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busyIdx !== null
            ? t("owner.import.uploading", {
                i: busyIdx + 1,
                n: files.length,
                file: files[busyIdx]?.name ?? "",
              })
            : t("owner.import.upload_button", { n: files.length })}
        </button>
      </div>

      {results.length > 0 && (
        <ul className="mt-4 divide-y divide-zinc-800 rounded border border-zinc-800 text-xs">
          {results.map((r, i) => (
            <li
              key={`${r.filename}-${i}`}
              className="flex items-center justify-between px-3 py-2 font-mono"
            >
              <span className="truncate text-zinc-300">{r.filename}</span>
              {r.result ? (
                <span className="shrink-0 space-x-2">
                  <span className="text-emerald-400">+{r.result.inserted}</span>
                  <span className="text-zinc-500">~{r.result.skippedDuplicate}</span>
                  <span className="text-rose-400">!{r.result.failed}</span>
                  {r.result.dryRun && (
                    <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] uppercase text-amber-300">
                      dry
                    </span>
                  )}
                </span>
              ) : (
                <span className="shrink-0 text-rose-400">{r.error}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
