import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { Pencil, Trash2, X } from "lucide-react";
import { isLocale, pickBilingual, type Locale } from "@ip/shared";
import {
  useCreateAnnouncement,
  useDeleteAnnouncement,
  useOwnerAnnouncements,
  useUpdateAnnouncement,
  type AnnouncementBilingual,
  type AnnouncementInput,
  type OwnerAnnouncement,
  type Severity,
} from "../../lib/hooks/useOwnerAnnouncements";
import { toast } from "../../lib/toast";

const SEVERITIES: Severity[] = ["info", "warning", "critical"];

type ComputedStatus = "deleted" | "draft" | "active" | "expired";

/**
 * /:locale/rosekhlifa/announcements — owner-only CRUD for site banners.
 *
 * Mirrors the AuditPage / UsersPage chrome (sticky title, owner-theme
 * tokens) and binds to the W2.4 endpoints via useOwnerAnnouncements.
 *
 * All theming is via tokens (`bg-panel / text-ink / bg-accent-soft /
 * border-border-soft`) so the owner zinc/emerald skin from owner-theme
 * (OwnerLayout) re-skins the page automatically — no hardcoded zinc-* /
 * emerald-* classes for the page body.
 *
 * Warning severity falls back to amber-500 utilities because the theme
 * tokens don't define a `--warning` token (info / danger / success only —
 * see styles/tokens.css). Amber reads correctly against both the Apple
 * HIG (light) and zinc panels (owner-theme).
 */
export default function AnnouncementsPage() {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";

  const q = useOwnerAnnouncements();
  const items = q.data?.items ?? [];

  const [editing, setEditing] = useState<OwnerAnnouncement | null>(null);
  const [creating, setCreating] = useState(false);

  const deleteMut = useDeleteAnnouncement();

  function onDelete(row: OwnerAnnouncement) {
    if (!window.confirm(t("owner.announcements.delete_confirm"))) return;
    deleteMut.mutate(row.id, {
      onSuccess: () => toast.success(t("owner.announcements.delete_success")),
      onError: (err) => toast.error(err.message ?? t("common.error")),
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">{t("owner.announcements.title")}</h1>
          <p className="mt-1 text-sm text-ink-muted">{t("owner.announcements.subtitle")}</p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-control bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-2"
        >
          {t("owner.announcements.btn_new")}
        </button>
      </div>

      <div className="mt-5 overflow-x-auto rounded-card border border-border-soft bg-panel">
        <table className="w-full text-sm">
          <thead className="border-b border-border-soft text-xs uppercase tracking-wider text-ink-muted">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">
                {t("owner.announcements.col_title")}
              </th>
              <th className="px-4 py-3 text-left font-semibold">
                {t("owner.announcements.col_severity")}
              </th>
              <th className="px-4 py-3 text-left font-semibold">
                {t("owner.announcements.col_status")}
              </th>
              <th className="px-4 py-3 text-left font-semibold">
                {t("owner.announcements.col_start")}
              </th>
              <th className="px-4 py-3 text-left font-semibold">
                {t("owner.announcements.col_end")}
              </th>
              <th className="px-4 py-3 text-left font-semibold">
                {t("owner.announcements.col_dismissible")}
              </th>
              <th className="px-4 py-3 text-right font-semibold">
                {t("owner.announcements.col_actions")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {q.isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-ink-muted">
                  {t("common.loading")}
                </td>
              </tr>
            )}
            {q.isError && !q.isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-danger">
                  {t("common.error_load")}
                </td>
              </tr>
            )}
            {!q.isLoading && !q.isError && items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-ink-muted">
                  {t("owner.announcements.no_announcements")}
                </td>
              </tr>
            )}
            {items.map((row) => (
              <AnnouncementRow
                key={row.id}
                row={row}
                locale={locale}
                onEdit={() => setEditing(row)}
                onDelete={() => onDelete(row)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {(creating || editing !== null) && (
        <AnnouncementModal
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

function AnnouncementRow({
  row,
  locale,
  onEdit,
  onDelete,
}: {
  row: OwnerAnnouncement;
  locale: Locale;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const title = pickBilingual(row.title, locale) ?? "—";
  const status = computeStatus(row);

  return (
    <tr className="hover:bg-bg-2">
      <td className="max-w-xs px-4 py-3">
        <div className="truncate text-sm font-medium text-ink" title={title}>
          {title}
        </div>
      </td>
      <td className="px-4 py-3">
        <SeverityPill severity={row.severity} />
      </td>
      <td className="px-4 py-3">
        <StatusPill status={status} />
      </td>
      <td className="px-4 py-3 text-xs text-ink-muted">
        {new Date(row.startsAt).toLocaleString()}
      </td>
      <td className="px-4 py-3 text-xs text-ink-muted">
        {row.endsAt ? new Date(row.endsAt).toLocaleString() : "—"}
      </td>
      <td className="px-4 py-3 text-xs text-ink-muted">
        {row.dismissible
          ? t("owner.announcements.yes")
          : t("owner.announcements.no")}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex justify-end gap-1">
          <button
            type="button"
            onClick={onEdit}
            aria-label="edit"
            className="rounded-control p-1.5 text-ink-muted hover:bg-surface hover:text-ink"
          >
            <Pencil size={14} aria-hidden />
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={row.deletedAt !== null}
            aria-label="delete"
            className="rounded-control p-1.5 text-ink-muted hover:bg-danger/10 hover:text-danger disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-ink-muted"
          >
            <Trash2 size={14} aria-hidden />
          </button>
        </div>
      </td>
    </tr>
  );
}

/**
 * Status pill driven from the row + current wall clock. Recomputed on each
 * render — the table is small (owner CRUD), no need for memoization, and
 * the colour drift across a minute boundary is acceptable for an admin
 * tool.
 */
function computeStatus(row: OwnerAnnouncement): ComputedStatus {
  if (row.deletedAt !== null) return "deleted";
  const now = Date.now();
  const startsAt = new Date(row.startsAt).getTime();
  if (startsAt > now) return "draft";
  if (row.endsAt !== null) {
    const endsAt = new Date(row.endsAt).getTime();
    if (endsAt < now) return "expired";
  }
  return "active";
}

function StatusPill({ status }: { status: ComputedStatus }) {
  const { t } = useTranslation();
  const labelKey = {
    deleted: "owner.announcements.status_deleted",
    draft: "owner.announcements.status_draft",
    active: "owner.announcements.status_active",
    expired: "owner.announcements.status_expired",
  }[status];
  const className = {
    deleted: "bg-danger/15 text-danger",
    draft: "bg-bg-2 text-ink-muted",
    active: "bg-success/15 text-success",
    expired: "bg-surface text-ink-muted",
  }[status];
  return (
    <span
      className={`inline-flex items-center rounded-pill px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {t(labelKey)}
    </span>
  );
}

function SeverityPill({ severity }: { severity: Severity }) {
  const { t } = useTranslation();
  const labelKey = {
    info: "owner.announcements.severity_info",
    warning: "owner.announcements.severity_warning",
    critical: "owner.announcements.severity_critical",
  }[severity];
  const className = {
    info: "bg-accent-soft text-accent",
    // No --warning token; amber fallback. Reads against both light Apple
    // HIG and dark owner-theme panels.
    warning: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    critical: "bg-danger/15 text-danger",
  }[severity];
  return (
    <span
      className={`inline-flex items-center rounded-pill px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {t(labelKey)}
    </span>
  );
}

// ── Modal ───────────────────────────────────────────────────────────────

/**
 * Create / edit modal. The same component handles both modes — pass
 * `existing` (the row from the table) to prefill + switch to PATCH; omit
 * it for the +new path → POST.
 *
 * datetime-local inputs use the local timezone `YYYY-MM-DDTHH:mm` format.
 * We adapt from ISO on read (existing row → input) and adapt back to ISO
 * on write (input → JSON body); the server stores UTC timestamps with TZ
 * and re-serializes them as ISO.
 *
 * Validation is client-side only beyond what the route's zod schema does.
 * The server is the source of truth for "title_required" / "body_required"
 * — we surface those translated up top to avoid a round-trip.
 */
function AnnouncementModal({
  existing,
  onClose,
}: {
  existing: OwnerAnnouncement | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const createMut = useCreateAnnouncement();
  const updateMut = useUpdateAnnouncement();

  const [titleZh, setTitleZh] = useState(existing?.title.zh ?? "");
  const [titleEn, setTitleEn] = useState(existing?.title.en ?? "");
  const [bodyZh, setBodyZh] = useState(existing?.body.zh ?? "");
  const [bodyEn, setBodyEn] = useState(existing?.body.en ?? "");
  const [severity, setSeverity] = useState<Severity>(existing?.severity ?? "info");
  const [startsAt, setStartsAt] = useState(
    isoToLocalDatetimeInput(existing?.startsAt ?? new Date().toISOString()),
  );
  const [endsAt, setEndsAt] = useState(
    existing?.endsAt ? isoToLocalDatetimeInput(existing.endsAt) : "",
  );
  const [dismissible, setDismissible] = useState(existing?.dismissible ?? true);

  const [errors, setErrors] = useState<string[]>([]);

  const pending = createMut.isPending || updateMut.isPending;

  // Close on Escape — drawers / modals across this codebase don't share
  // a primitive yet, so each one wires its own listener.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, onClose]);

  function validate(): string[] {
    const errs: string[] = [];
    if (titleZh.trim() === "" && titleEn.trim() === "") {
      errs.push(t("owner.announcements.modal_title_required"));
    }
    if (bodyZh.trim() === "" && bodyEn.trim() === "") {
      errs.push(t("owner.announcements.modal_body_required"));
    }
    if (endsAt !== "" && new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
      errs.push(t("owner.announcements.modal_end_after_start"));
    }
    return errs;
  }

  function buildInput(): AnnouncementInput {
    const title: AnnouncementBilingual = {};
    if (titleZh.trim() !== "") title.zh = titleZh.trim();
    if (titleEn.trim() !== "") title.en = titleEn.trim();
    const body: AnnouncementBilingual = {};
    if (bodyZh.trim() !== "") body.zh = bodyZh.trim();
    if (bodyEn.trim() !== "") body.en = bodyEn.trim();
    const input: AnnouncementInput = {
      title,
      body,
      severity,
      startsAt: localDatetimeInputToIso(startsAt),
      dismissible,
    };
    if (endsAt !== "") {
      input.endsAt = localDatetimeInputToIso(endsAt);
    }
    return input;
  }

  function submit() {
    const errs = validate();
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    setErrors([]);
    const input = buildInput();
    if (existing) {
      updateMut.mutate(
        { id: existing.id, patch: input },
        {
          onSuccess: () => {
            toast.success(t("owner.announcements.save_success_update"));
            onClose();
          },
          onError: (err) => toast.error(err.message ?? t("common.error")),
        },
      );
    } else {
      createMut.mutate(input, {
        onSuccess: () => {
          toast.success(t("owner.announcements.save_success_create"));
          onClose();
        },
        onError: (err) => toast.error(err.message ?? t("common.error")),
      });
    }
  }

  const modalTitle = existing
    ? t("owner.announcements.modal_title_edit")
    : t("owner.announcements.modal_title_create");

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
          <Field label={t("owner.announcements.modal_title_zh")}>
            <input
              type="text"
              value={titleZh}
              onChange={(e) => setTitleZh(e.target.value)}
              maxLength={200}
              disabled={pending}
              className="w-full rounded-control border border-border-soft bg-panel-2 px-3 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:border-accent focus:outline-none"
            />
          </Field>
          <Field label={t("owner.announcements.modal_title_en")}>
            <input
              type="text"
              value={titleEn}
              onChange={(e) => setTitleEn(e.target.value)}
              maxLength={200}
              disabled={pending}
              className="w-full rounded-control border border-border-soft bg-panel-2 px-3 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:border-accent focus:outline-none"
            />
          </Field>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label={t("owner.announcements.modal_body_zh")}>
            <textarea
              value={bodyZh}
              onChange={(e) => setBodyZh(e.target.value)}
              maxLength={4000}
              rows={4}
              disabled={pending}
              className="w-full resize-none rounded-control border border-border-soft bg-panel-2 px-3 py-2 text-sm text-ink placeholder:text-ink-dim focus:border-accent focus:outline-none"
            />
          </Field>
          <Field label={t("owner.announcements.modal_body_en")}>
            <textarea
              value={bodyEn}
              onChange={(e) => setBodyEn(e.target.value)}
              maxLength={4000}
              rows={4}
              disabled={pending}
              className="w-full resize-none rounded-control border border-border-soft bg-panel-2 px-3 py-2 text-sm text-ink placeholder:text-ink-dim focus:border-accent focus:outline-none"
            />
          </Field>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label={t("owner.announcements.modal_severity")}>
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as Severity)}
              disabled={pending}
              className="w-full rounded-control border border-border-soft bg-panel-2 px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
            >
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {t(`owner.announcements.severity_${s}`)}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("owner.announcements.modal_starts")}>
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              disabled={pending}
              className="w-full rounded-control border border-border-soft bg-panel-2 px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
            />
          </Field>
          <Field label={t("owner.announcements.modal_ends")}>
            <input
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
              disabled={pending}
              className="w-full rounded-control border border-border-soft bg-panel-2 px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
            />
          </Field>
        </div>

        <div className="mt-4">
          <label className="inline-flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={dismissible}
              onChange={(e) => setDismissible(e.target.checked)}
              disabled={pending}
              className="rounded border-border-soft accent-accent"
            />
            <span>{t("owner.announcements.modal_dismissible")}</span>
          </label>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-control border border-border-soft px-3 py-1.5 text-xs font-medium text-ink hover:bg-panel-2 disabled:opacity-40"
          >
            {t("owner.announcements.modal_cancel")}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="rounded-control bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-2 disabled:opacity-40"
          >
            {pending
              ? t("owner.announcements.modal_saving")
              : t("owner.announcements.modal_save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wider text-ink-muted">
        {label}
      </span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}

// ── datetime-local helpers ──────────────────────────────────────────────

/**
 * Adapt an ISO 8601 string (UTC, with offset) to the local-time string the
 * `<input type="datetime-local">` element expects: `YYYY-MM-DDTHH:mm`.
 *
 * `getTime()` returns the absolute instant; we offset by the local TZ
 * minutes so toISOString() over that adjusted instant prints the wall-clock
 * components for the user's locale. Trim seconds + the trailing Z.
 */
function isoToLocalDatetimeInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const tzAdjusted = new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
  return tzAdjusted.toISOString().slice(0, 16);
}

/**
 * Inverse of isoToLocalDatetimeInput — feed `YYYY-MM-DDTHH:mm` (assumed
 * local time) back to an ISO string. `new Date("YYYY-MM-DDTHH:mm")` parses
 * as local time in browsers (per HTML spec), which matches what the user
 * typed. `toISOString()` then normalizes to UTC for the server.
 */
function localDatetimeInputToIso(local: string): string {
  const d = new Date(local);
  return d.toISOString();
}
