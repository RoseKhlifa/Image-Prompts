import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Activity, Check, Pencil, RefreshCw, Trash2, X } from "lucide-react";
import {
  useCreateR2Account,
  useDeleteR2Account,
  useOwnerR2Accounts,
  useSyncR2Usage,
  useTestR2Connection,
  useUpdateR2Account,
  type OwnerR2Account,
  type R2EditInput,
  type R2TestResult,
  type R2WriteInput,
} from "../../lib/hooks/useOwnerR2";
import { toast } from "../../lib/toast";

/**
 * /:locale/rosekhlifa/r2 — owner-only CRUD for the R2 account pool.
 *
 * Backed by /api/owner/r2-accounts (W3.2) plus the two ops endpoints
 * /test + /sync-usage (W3.3). Secrets are never echoed by the server, so
 * the edit modal pre-fills every field EXCEPT `accessKeySecret`; leaving
 * the secret blank on save sends a patch without the key, preserving the
 * existing encrypted value at rest.
 *
 * Theming is via tokens (`bg-panel / text-ink / bg-accent / bg-accent-soft /
 * border-border-soft / bg-danger / bg-success`) so the owner-theme zinc +
 * emerald skin from OwnerLayout re-skins the page automatically — no
 * hardcoded zinc-* / emerald-* classes for the page body.
 */
export default function R2Page() {
  const { t } = useTranslation();
  const q = useOwnerR2Accounts();
  const items = q.data?.items ?? [];

  const [editing, setEditing] = useState<OwnerR2Account | null>(null);
  const [creating, setCreating] = useState(false);

  const deleteMut = useDeleteR2Account();

  function onDelete(row: OwnerR2Account) {
    if (!window.confirm(t("owner.r2.delete_confirm"))) return;
    deleteMut.mutate(row.id, {
      onSuccess: () => toast.success(t("owner.r2.delete_success")),
      onError: (err) => toast.error(err.message ?? t("common.error")),
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-semibold text-ink">{t("owner.r2.title")}</h1>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-control bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-2"
        >
          {t("owner.r2.btn_new")}
        </button>
      </div>

      <div className="mt-5 overflow-x-auto rounded-card border border-border-soft bg-panel">
        <table className="w-full text-sm">
          <thead className="border-b border-border-soft text-xs uppercase tracking-wider text-ink-muted">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">
                {t("owner.r2.col_name")}
              </th>
              <th className="px-4 py-3 text-left font-semibold">
                {t("owner.r2.col_endpoint")}
              </th>
              <th className="px-4 py-3 text-left font-semibold">
                {t("owner.r2.col_bucket")}
              </th>
              <th className="px-4 py-3 text-right font-semibold">
                {t("owner.r2.col_priority")}
              </th>
              <th className="px-4 py-3 text-left font-semibold">
                {t("owner.r2.col_enabled")}
              </th>
              <th className="px-4 py-3 text-right font-semibold">
                {t("owner.r2.col_used")}
              </th>
              <th className="px-4 py-3 text-left font-semibold">
                {t("owner.r2.col_synced")}
              </th>
              <th className="px-4 py-3 text-right font-semibold">
                {t("owner.r2.col_actions")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {q.isLoading && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-ink-muted">
                  {t("common.loading")}
                </td>
              </tr>
            )}
            {q.isError && !q.isLoading && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-danger">
                  {t("common.error_load")}
                </td>
              </tr>
            )}
            {!q.isLoading && !q.isError && items.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-ink-muted">
                  {t("owner.r2.no_accounts")}
                </td>
              </tr>
            )}
            {items.map((row) => (
              <R2Row
                key={row.id}
                row={row}
                onEdit={() => setEditing(row)}
                onDelete={() => onDelete(row)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {(creating || editing !== null) && (
        <R2Modal
          existing={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

// ── Row ─────────────────────────────────────────────────────────────────

function R2Row({
  row,
  onEdit,
  onDelete,
}: {
  row: OwnerR2Account;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const testMut = useTestR2Connection();
  const syncMut = useSyncR2Usage();

  // Transient inline status badge next to the Test button. The hook itself
  // doesn't toast; we surface success/failure as a 5-second inline span
  // that fades back to the resting icon. `Date.now()` keys the timer so a
  // rapid second click resets the window cleanly.
  const [testBanner, setTestBanner] = useState<R2TestResult | null>(null);
  useEffect(() => {
    if (testBanner === null) return;
    const handle = window.setTimeout(() => setTestBanner(null), 5000);
    return () => window.clearTimeout(handle);
  }, [testBanner]);

  function runTest() {
    testMut.mutate(row.id, {
      onSuccess: (result) => setTestBanner(result),
      onError: (err) =>
        setTestBanner({
          ok: false,
          status: null,
          latencyMs: 0,
          ...(err.message !== undefined ? { error: err.message } : {}),
        }),
    });
  }

  function runSync() {
    syncMut.mutate(row.id, {
      onSuccess: (result) =>
        toast.success(
          t("owner.r2.sync_success", {
            bytes: fmtBytes(result.usedBytes),
            objects: result.objectCount.toLocaleString(),
          }),
        ),
      onError: (err) => toast.error(err.message ?? t("owner.r2.sync_failed")),
    });
  }

  const deleted = row.deletedAt !== null;

  return (
    <tr className={`hover:bg-bg-2 ${deleted ? "opacity-50" : ""}`}>
      <td className="px-4 py-3">
        <div className="text-sm font-medium text-ink">{row.name}</div>
      </td>
      <td className="px-4 py-3 font-mono text-xs text-ink-muted">
        {truncate(row.endpoint, 36)}
      </td>
      <td className="px-4 py-3 font-mono text-xs text-ink-muted">{row.bucket}</td>
      <td className="px-4 py-3 text-right text-sm tabular-nums text-ink">
        {row.priority}
      </td>
      <td className="px-4 py-3">
        <EnabledPill enabled={row.enabled} />
      </td>
      <td className="px-4 py-3 text-right text-sm tabular-nums text-ink">
        {fmtBytes(row.usedBytes)}
      </td>
      <td className="px-4 py-3 text-xs text-ink-muted">
        {row.lastSyncedAt ? new Date(row.lastSyncedAt).toLocaleString() : "—"}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-1">
          {testBanner !== null && <TestResultBadge result={testBanner} />}
          <IconButton
            label={t("owner.r2.action_test")}
            onClick={runTest}
            disabled={testMut.isPending || deleted}
          >
            {testMut.isPending ? (
              <Activity size={14} className="animate-pulse" aria-hidden />
            ) : testBanner !== null ? (
              testBanner.ok ? (
                <Check size={14} className="text-success" aria-hidden />
              ) : (
                <X size={14} className="text-danger" aria-hidden />
              )
            ) : (
              <Activity size={14} aria-hidden />
            )}
          </IconButton>
          <IconButton
            label={t("owner.r2.action_sync")}
            onClick={runSync}
            disabled={syncMut.isPending || deleted}
          >
            <RefreshCw
              size={14}
              className={syncMut.isPending ? "animate-spin" : ""}
              aria-hidden
            />
          </IconButton>
          <IconButton
            label={t("owner.r2.action_edit")}
            onClick={onEdit}
            disabled={deleted}
          >
            <Pencil size={14} aria-hidden />
          </IconButton>
          <IconButton
            label={t("owner.r2.action_delete")}
            onClick={onDelete}
            disabled={deleted}
            danger
          >
            <Trash2 size={14} aria-hidden />
          </IconButton>
        </div>
      </td>
    </tr>
  );
}

/**
 * 5-second inline result badge. The map from R2TestResult → translated text
 * mirrors the server's testConnection() contract:
 *
 *   ok=true,  status=200/404/401/403  →  test_success (the connection works;
 *                                        4xx still tells us the host answered)
 *   ok=false, status=<number>         →  test_failed (5xx server error)
 *   ok=false, status=null             →  test_network_error (DNS/TLS/timeout;
 *                                        `error` carries the SDK message)
 */
function TestResultBadge({ result }: { result: R2TestResult }) {
  const { t } = useTranslation();
  if (result.status === null) {
    return (
      <span className="rounded-pill bg-danger/15 px-2 py-0.5 text-[10px] font-medium text-danger">
        {t("owner.r2.test_network_error", { error: result.error ?? "" })}
      </span>
    );
  }
  if (result.ok) {
    return (
      <span className="rounded-pill bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">
        {t("owner.r2.test_success", { status: String(result.status) })}
      </span>
    );
  }
  return (
    <span className="rounded-pill bg-danger/15 px-2 py-0.5 text-[10px] font-medium text-danger">
      {t("owner.r2.test_failed", { status: String(result.status) })}
    </span>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  const hover = danger
    ? "hover:bg-danger/10 hover:text-danger"
    : "hover:bg-surface hover:text-ink";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`rounded-control p-1.5 text-ink-muted ${hover} disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-muted`}
    >
      {children}
    </button>
  );
}

function EnabledPill({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation();
  const className = enabled
    ? "bg-success/15 text-success"
    : "bg-bg-2 text-ink-muted";
  return (
    <span
      className={`inline-flex items-center rounded-pill px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {enabled ? t("owner.r2.enabled_yes") : t("owner.r2.enabled_no")}
    </span>
  );
}

// ── Modal ───────────────────────────────────────────────────────────────

/**
 * Create / edit modal. Same component handles both modes — pass `existing`
 * (the row from the list) to prefill + switch to PATCH; omit it for the
 * +new path → POST.
 *
 * Secret handling is the load-bearing detail: the API never echoes
 * `accessKeySecret`, so the secret input defaults EMPTY in both modes. On
 * create the field is required; on edit it's optional and we omit it from
 * the patch when the operator leaves it blank, preserving the encrypted
 * value at rest. The placeholder makes that contract visible in the UI.
 *
 * Client-side validation matches the server's R2*BodySchema: required
 * strings, endpoint + publicUrl must parse via `new URL()`, priority is an
 * integer in [0, 1000]. The server is still the source of truth — failures
 * surface via the mutation onError toast.
 */
function R2Modal({
  existing,
  onClose,
}: {
  existing: OwnerR2Account | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const createMut = useCreateR2Account();
  const updateMut = useUpdateR2Account();

  const [name, setName] = useState(existing?.name ?? "");
  const [accountId, setAccountId] = useState(existing?.accountId ?? "");
  const [endpoint, setEndpoint] = useState(existing?.endpoint ?? "");
  const [bucket, setBucket] = useState(existing?.bucket ?? "");
  const [publicUrl, setPublicUrl] = useState(existing?.publicUrl ?? "");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [accessKeySecret, setAccessKeySecret] = useState("");
  const [priority, setPriority] = useState<string>(
    existing ? String(existing.priority) : "100",
  );
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);

  const [errors, setErrors] = useState<string[]>([]);

  const pending = createMut.isPending || updateMut.isPending;
  const isEdit = existing !== null;

  // Initial snapshot for change detection on edit. Stored in `useState`
  // initializer so the value is captured once at mount — subsequent renders
  // (driven by input edits) compare against the pristine row, not the
  // latest input state. We never call the setter; the modal is recreated
  // on a different row.
  const [initial] = useState(() =>
    existing
      ? {
          name: existing.name,
          accountId: existing.accountId,
          endpoint: existing.endpoint,
          bucket: existing.bucket,
          publicUrl: existing.publicUrl,
          priority: existing.priority,
          enabled: existing.enabled,
        }
      : null,
  );

  // Close on Escape — mirrors AnnouncementModal. Each modal in this tree
  // wires its own listener; we deliberately don't share a primitive yet.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, onClose]);

  function validate(): string[] {
    const errs: string[] = [];
    if (name.trim() === "") errs.push(`${t("owner.r2.modal_name")}: ${t("owner.r2.modal_field_required")}`);
    if (accountId.trim() === "")
      errs.push(`${t("owner.r2.modal_account_id")}: ${t("owner.r2.modal_field_required")}`);
    if (bucket.trim() === "")
      errs.push(`${t("owner.r2.modal_bucket")}: ${t("owner.r2.modal_field_required")}`);
    if (accessKeyId.trim() === "" && !isEdit)
      errs.push(
        `${t("owner.r2.modal_access_key_id")}: ${t("owner.r2.modal_field_required")}`,
      );
    if (accessKeySecret.trim() === "" && !isEdit)
      errs.push(
        `${t("owner.r2.modal_access_key_secret")}: ${t("owner.r2.modal_field_required")}`,
      );
    if (endpoint.trim() === "") {
      errs.push(`${t("owner.r2.modal_endpoint")}: ${t("owner.r2.modal_field_required")}`);
    } else if (!isUrl(endpoint)) {
      errs.push(`${t("owner.r2.modal_endpoint")}: ${t("owner.r2.modal_invalid_url")}`);
    }
    if (publicUrl.trim() === "") {
      errs.push(`${t("owner.r2.modal_public_url")}: ${t("owner.r2.modal_field_required")}`);
    } else if (!isUrl(publicUrl)) {
      errs.push(`${t("owner.r2.modal_public_url")}: ${t("owner.r2.modal_invalid_url")}`);
    }
    const p = Number(priority);
    if (!Number.isInteger(p) || p < 0 || p > 1000) {
      errs.push(`${t("owner.r2.modal_priority")}: 0–1000`);
    }
    return errs;
  }

  function buildCreate(): R2WriteInput {
    return {
      name: name.trim(),
      accountId: accountId.trim(),
      endpoint: endpoint.trim(),
      accessKeyId: accessKeyId.trim(),
      accessKeySecret: accessKeySecret,
      bucket: bucket.trim(),
      publicUrl: publicUrl.trim(),
      priority: Number(priority),
      enabled,
    };
  }

  function buildPatch(): R2EditInput {
    // Only ship fields that actually changed from `initial`. Secret + key
    // ID are sent ONLY when the operator typed a value — leaving them
    // blank preserves the existing at-rest values.
    if (!initial) return {};
    const patch: R2EditInput = {};
    const trimmedName = name.trim();
    if (trimmedName !== initial.name) patch.name = trimmedName;
    const trimmedAccount = accountId.trim();
    if (trimmedAccount !== initial.accountId) patch.accountId = trimmedAccount;
    const trimmedEndpoint = endpoint.trim();
    if (trimmedEndpoint !== initial.endpoint) patch.endpoint = trimmedEndpoint;
    const trimmedBucket = bucket.trim();
    if (trimmedBucket !== initial.bucket) patch.bucket = trimmedBucket;
    const trimmedPublic = publicUrl.trim();
    if (trimmedPublic !== initial.publicUrl) patch.publicUrl = trimmedPublic;
    const trimmedKeyId = accessKeyId.trim();
    if (trimmedKeyId !== "") patch.accessKeyId = trimmedKeyId;
    if (accessKeySecret !== "") patch.accessKeySecret = accessKeySecret;
    const p = Number(priority);
    if (p !== initial.priority) patch.priority = p;
    if (enabled !== initial.enabled) patch.enabled = enabled;
    return patch;
  }

  function submit() {
    const errs = validate();
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    setErrors([]);
    if (existing) {
      const patch = buildPatch();
      updateMut.mutate(
        { id: existing.id, patch },
        {
          onSuccess: () => {
            toast.success(t("owner.r2.save_success_update"));
            onClose();
          },
          onError: (err) =>
            toast.error(err.message ?? t("owner.r2.save_failed")),
        },
      );
    } else {
      createMut.mutate(buildCreate(), {
        onSuccess: () => {
          toast.success(t("owner.r2.save_success_create"));
          onClose();
        },
        onError: (err) => toast.error(err.message ?? t("owner.r2.save_failed")),
      });
    }
  }

  const modalTitle = existing
    ? t("owner.r2.modal_title_edit")
    : t("owner.r2.modal_title_create");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={modalTitle}
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 px-4"
      onClick={() => {
        if (!pending) onClose();
      }}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-card bg-panel p-6 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-ink">{modalTitle}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label="close"
            className="rounded-control p-1 text-ink-muted hover:bg-surface hover:text-ink disabled:opacity-40"
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        {errors.length > 0 && (
          <div className="mt-3 rounded-control bg-danger/10 px-3 py-2 text-xs text-danger">
            {errors.map((e) => (
              <div key={e}>{e}</div>
            ))}
          </div>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label={t("owner.r2.modal_name")}>
            <TextInput value={name} onChange={setName} disabled={pending} />
          </Field>
          <Field label={t("owner.r2.modal_account_id")}>
            <TextInput
              value={accountId}
              onChange={setAccountId}
              disabled={pending}
              mono
            />
          </Field>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label={t("owner.r2.modal_endpoint")}>
            <TextInput
              value={endpoint}
              onChange={setEndpoint}
              disabled={pending}
              placeholder="https://<acct>.r2.cloudflarestorage.com"
              mono
            />
          </Field>
          <Field label={t("owner.r2.modal_bucket")}>
            <TextInput value={bucket} onChange={setBucket} disabled={pending} mono />
          </Field>
        </div>

        <div className="mt-3">
          <Field label={t("owner.r2.modal_public_url")}>
            <TextInput
              value={publicUrl}
              onChange={setPublicUrl}
              disabled={pending}
              placeholder="https://cdn.example.com"
              mono
            />
          </Field>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label={t("owner.r2.modal_access_key_id")}>
            <TextInput
              value={accessKeyId}
              onChange={setAccessKeyId}
              disabled={pending}
              placeholder={
                isEdit ? t("owner.r2.modal_secret_placeholder_edit") : ""
              }
              mono
            />
          </Field>
          <Field label={t("owner.r2.modal_access_key_secret")}>
            <TextInput
              value={accessKeySecret}
              onChange={setAccessKeySecret}
              disabled={pending}
              placeholder={
                isEdit ? t("owner.r2.modal_secret_placeholder_edit") : ""
              }
              type="password"
              mono
            />
          </Field>
        </div>

        <div className="mt-3 grid items-end gap-3 sm:grid-cols-2">
          <Field label={t("owner.r2.modal_priority")}>
            <input
              type="number"
              min={0}
              max={1000}
              step={1}
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              disabled={pending}
              className="w-full rounded-control border border-border-soft bg-panel-2 px-3 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:border-accent focus:outline-none"
            />
          </Field>
          <label className="inline-flex items-center gap-2 self-end pb-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              disabled={pending}
              className="rounded border-border-soft accent-accent"
            />
            <span>{t("owner.r2.modal_enabled")}</span>
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-control border border-border-soft px-3 py-1.5 text-xs font-medium text-ink hover:bg-panel-2 disabled:opacity-40"
          >
            {t("owner.r2.modal_cancel")}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="rounded-control bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-2 disabled:opacity-40"
          >
            {pending ? t("owner.r2.modal_saving") : t("owner.r2.modal_save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wider text-ink-muted">
        {label}
      </span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

function TextInput({
  value,
  onChange,
  disabled,
  placeholder,
  type = "text",
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  placeholder?: string;
  type?: "text" | "password";
  mono?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder={placeholder}
      autoComplete="off"
      className={`w-full rounded-control border border-border-soft bg-panel-2 px-3 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:border-accent focus:outline-none ${
        mono ? "font-mono" : ""
      }`}
    />
  );
}

// ── helpers ─────────────────────────────────────────────────────────────

function fmtBytes(n: number | null): string {
  if (n === null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

function isUrl(s: string): boolean {
  try {
    new URL(s);
    return true;
  } catch {
    return false;
  }
}
