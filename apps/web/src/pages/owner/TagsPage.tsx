import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { Pencil, Trash2, X } from "lucide-react";
import { isLocale, pickBilingual, type Locale } from "@ip/shared";
import {
  useCreateOwnerTag,
  useDeleteOwnerTag,
  useOwnerTags,
  useUpdateOwnerTag,
  type Bilingual,
  type OwnerTag,
  type TagInput,
} from "../../lib/hooks/useOwnerTaxonomy";
import { toast } from "../../lib/toast";

/**
 * /:locale/rosekhlifa/tags — owner-only CRUD for prompt tags.
 *
 * Same pattern as CategoriesPage. Tags carry two count columns: `usageCount`
 * (precomputed tags.usage_count, bumped on approve) and `promptCount` (live
 * JOIN through prompt_tags). They can drift if no resync ran since the last
 * approve/delete, so we show both — the owner sees the discrepancy at a
 * glance.
 *
 * Hard delete with usage protection (same 409 in_use:N contract as
 * categories). The server checks the live prompt_tags JOIN (source of truth)
 * rather than the precomputed counter.
 */
export default function TagsPage() {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";

  const q = useOwnerTags();
  const items = q.data?.items ?? [];

  const [editing, setEditing] = useState<OwnerTag | null>(null);
  const [creating, setCreating] = useState(false);

  const deleteMut = useDeleteOwnerTag();

  function onDelete(row: OwnerTag) {
    if (!window.confirm(t("owner.tags.delete_confirm"))) return;
    deleteMut.mutate(row.id, {
      onSuccess: () => toast.success(t("owner.tags.delete_success")),
      onError: (err) => {
        const msg = err.message ?? "";
        if (msg.startsWith("in_use:")) {
          const count = Number(msg.slice("in_use:".length)) || 0;
          toast.error(t("owner.tags.delete_in_use", { count }));
        } else {
          toast.error(msg || t("common.error"));
        }
      },
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">
            {t("owner.tags.title")}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {t("owner.tags.subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-control bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-2"
        >
          {t("owner.tags.btn_new")}
        </button>
      </div>

      <div className="mt-5 overflow-x-auto rounded-card border border-border-soft bg-panel">
        <table className="w-full text-sm">
          <thead className="border-b border-border-soft text-xs uppercase tracking-wider text-ink-muted">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">
                {t("owner.tags.col_slug")}
              </th>
              <th className="px-4 py-3 text-left font-semibold">
                {t("owner.tags.col_name")}
              </th>
              <th className="px-4 py-3 text-right font-semibold">
                {t("owner.tags.col_usage_count")}
              </th>
              <th className="px-4 py-3 text-right font-semibold">
                {t("owner.tags.col_prompt_count")}
              </th>
              <th className="px-4 py-3 text-right font-semibold">
                {t("owner.tags.col_actions")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {q.isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink-muted">
                  {t("common.loading")}
                </td>
              </tr>
            )}
            {q.isError && !q.isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-danger">
                  {t("common.error_load")}
                </td>
              </tr>
            )}
            {!q.isLoading && !q.isError && items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink-muted">
                  {t("owner.tags.no_tags")}
                </td>
              </tr>
            )}
            {items.map((row) => (
              <TagRow
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
        <TagModal
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

function TagRow({
  row,
  locale,
  onEdit,
  onDelete,
}: {
  row: OwnerTag;
  locale: Locale;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const name = pickBilingual(row.name, locale) ?? "—";
  // Highlight when the precomputed counter has drifted from the live JOIN
  // count — same data, different sources of truth.
  const drift = row.usageCount !== row.promptCount;
  return (
    <tr className="hover:bg-bg-2">
      <td className="px-4 py-3 font-mono text-xs text-ink-muted">{row.slug}</td>
      <td className="px-4 py-3">
        <span className="text-sm font-medium text-ink">{name}</span>
      </td>
      <td className="px-4 py-3 text-right text-xs text-ink-muted">
        {row.usageCount}
      </td>
      <td className="px-4 py-3 text-right text-xs">
        <span
          className={drift ? "font-semibold text-amber-700 dark:text-amber-300" : "text-ink-muted"}
        >
          {row.promptCount}
        </span>
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
            aria-label="delete"
            className="rounded-control p-1.5 text-ink-muted hover:bg-danger/10 hover:text-danger"
          >
            <Trash2 size={14} aria-hidden />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ── Modal ───────────────────────────────────────────────────────────────

function TagModal({
  existing,
  onClose,
}: {
  existing: OwnerTag | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const createMut = useCreateOwnerTag();
  const updateMut = useUpdateOwnerTag();

  const [slug, setSlug] = useState(existing?.slug ?? "");
  const [nameZh, setNameZh] = useState(existing?.name.zh ?? "");
  const [nameEn, setNameEn] = useState(existing?.name.en ?? "");
  const [errors, setErrors] = useState<string[]>([]);

  const pending = createMut.isPending || updateMut.isPending;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, onClose]);

  function validate(): string[] {
    const errs: string[] = [];
    if (!/^[a-z0-9-]{1,40}$/.test(slug)) {
      errs.push(t("owner.tags.modal_slug_invalid"));
    }
    if (nameZh.trim() === "" && nameEn.trim() === "") {
      errs.push(t("owner.tags.modal_name_required"));
    }
    return errs;
  }

  function buildInput(): TagInput {
    const name: Bilingual = {};
    if (nameZh.trim() !== "") name.zh = nameZh.trim();
    if (nameEn.trim() !== "") name.en = nameEn.trim();
    return { slug, name };
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
            toast.success(t("owner.tags.save_success_update"));
            onClose();
          },
          onError: (err) =>
            toast.error(
              err.message
                ? `${t("owner.tags.save_failed")}: ${err.message}`
                : t("owner.tags.save_failed"),
            ),
        },
      );
    } else {
      createMut.mutate(input, {
        onSuccess: () => {
          toast.success(t("owner.tags.save_success_create"));
          onClose();
        },
        onError: (err) =>
          toast.error(
            err.message
              ? `${t("owner.tags.save_failed")}: ${err.message}`
              : t("owner.tags.save_failed"),
          ),
      });
    }
  }

  const modalTitle = existing
    ? t("owner.tags.modal_title_edit")
    : t("owner.tags.modal_title_create");

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
        className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-card bg-panel p-6 shadow-card"
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

        <div className="mt-4">
          <Field label={t("owner.tags.modal_slug")}>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              maxLength={40}
              disabled={pending}
              className="w-full rounded-control border border-border-soft bg-panel-2 px-3 py-1.5 font-mono text-sm text-ink placeholder:text-ink-dim focus:border-accent focus:outline-none"
            />
          </Field>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label={t("owner.tags.modal_name_zh")}>
            <input
              type="text"
              value={nameZh}
              onChange={(e) => setNameZh(e.target.value)}
              maxLength={40}
              disabled={pending}
              className="w-full rounded-control border border-border-soft bg-panel-2 px-3 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:border-accent focus:outline-none"
            />
          </Field>
          <Field label={t("owner.tags.modal_name_en")}>
            <input
              type="text"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              maxLength={40}
              disabled={pending}
              className="w-full rounded-control border border-border-soft bg-panel-2 px-3 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:border-accent focus:outline-none"
            />
          </Field>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-control border border-border-soft px-3 py-1.5 text-xs font-medium text-ink hover:bg-panel-2 disabled:opacity-40"
          >
            {t("owner.tags.modal_cancel")}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="rounded-control bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-2 disabled:opacity-40"
          >
            {pending
              ? t("owner.tags.modal_saving")
              : t("owner.tags.modal_save")}
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
