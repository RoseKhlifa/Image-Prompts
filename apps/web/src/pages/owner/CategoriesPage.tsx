import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { Pencil, Trash2, X } from "lucide-react";
import { isLocale, pickBilingual, type Locale } from "@ip/shared";
import {
  useCreateOwnerCategory,
  useDeleteOwnerCategory,
  useOwnerCategories,
  useUpdateOwnerCategory,
  type Bilingual,
  type CategoryInput,
  type OwnerCategory,
} from "../../lib/hooks/useOwnerTaxonomy";
import { toast } from "../../lib/toast";

/**
 * /:locale/rosekhlifa/categories — owner-only CRUD for prompt categories.
 *
 * Mirrors the AnnouncementsPage chrome (sticky title, owner-theme tokens) and
 * binds to /api/owner/categories. Hard delete with usage protection: the
 * server returns 409 `in_use:N` when ≥1 prompt references the category, and
 * we surface a translated toast with the count so the owner knows what's in
 * the way. Theming is via tokens (bg-panel / text-ink / border-border-soft)
 * so the owner zinc/emerald skin re-skins this page automatically.
 */
export default function CategoriesPage() {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";

  const q = useOwnerCategories();
  const items = q.data?.items ?? [];

  const [editing, setEditing] = useState<OwnerCategory | null>(null);
  const [creating, setCreating] = useState(false);

  const deleteMut = useDeleteOwnerCategory();

  function onDelete(row: OwnerCategory) {
    if (!window.confirm(t("owner.categories.delete_confirm"))) return;
    deleteMut.mutate(row.id, {
      onSuccess: () => toast.success(t("owner.categories.delete_success")),
      onError: (err) => {
        // Server returns `in_use:N` — we extract N for the translated toast.
        const msg = err.message ?? "";
        if (msg.startsWith("in_use:")) {
          const count = Number(msg.slice("in_use:".length)) || 0;
          toast.error(t("owner.categories.delete_in_use", { count }));
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
            {t("owner.categories.title")}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {t("owner.categories.subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-control bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-2"
        >
          {t("owner.categories.btn_new")}
        </button>
      </div>

      <div className="mt-5 overflow-x-auto rounded-card border border-border-soft bg-panel">
        <table className="w-full text-sm">
          <thead className="border-b border-border-soft text-xs uppercase tracking-wider text-ink-muted">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">
                {t("owner.categories.col_slug")}
              </th>
              <th className="px-4 py-3 text-left font-semibold">
                {t("owner.categories.col_name")}
              </th>
              <th className="px-4 py-3 text-left font-semibold">
                {t("owner.categories.col_description")}
              </th>
              <th className="px-4 py-3 text-right font-semibold">
                {t("owner.categories.col_order")}
              </th>
              <th className="px-4 py-3 text-right font-semibold">
                {t("owner.categories.col_prompt_count")}
              </th>
              <th className="px-4 py-3 text-right font-semibold">
                {t("owner.categories.col_actions")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {q.isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-ink-muted">
                  {t("common.loading")}
                </td>
              </tr>
            )}
            {q.isError && !q.isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-danger">
                  {t("common.error_load")}
                </td>
              </tr>
            )}
            {!q.isLoading && !q.isError && items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-ink-muted">
                  {t("owner.categories.no_categories")}
                </td>
              </tr>
            )}
            {items.map((row) => (
              <CategoryRow
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
        <CategoryModal
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

function CategoryRow({
  row,
  locale,
  onEdit,
  onDelete,
}: {
  row: OwnerCategory;
  locale: Locale;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const name = pickBilingual(row.name, locale) ?? "—";
  const description = pickBilingual(row.description, locale) ?? "";
  return (
    <tr className="hover:bg-bg-2">
      <td className="px-4 py-3 font-mono text-xs text-ink-muted">{row.slug}</td>
      <td className="px-4 py-3">
        <span className="text-sm font-medium text-ink">{name}</span>
      </td>
      <td className="max-w-xs px-4 py-3">
        <div
          className="truncate text-xs text-ink-muted"
          title={description}
        >
          {description || "—"}
        </div>
      </td>
      <td className="px-4 py-3 text-right text-xs text-ink-muted">
        {row.order}
      </td>
      <td className="px-4 py-3 text-right text-xs text-ink-muted">
        {row.promptCount}
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

function CategoryModal({
  existing,
  onClose,
}: {
  existing: OwnerCategory | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const createMut = useCreateOwnerCategory();
  const updateMut = useUpdateOwnerCategory();

  const [slug, setSlug] = useState(existing?.slug ?? "");
  const [nameZh, setNameZh] = useState(existing?.name.zh ?? "");
  const [nameEn, setNameEn] = useState(existing?.name.en ?? "");
  const [descZh, setDescZh] = useState(existing?.description?.zh ?? "");
  const [descEn, setDescEn] = useState(existing?.description?.en ?? "");
  const [order, setOrder] = useState<number>(existing?.order ?? 0);
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
      errs.push(t("owner.categories.modal_slug_invalid"));
    }
    if (nameZh.trim() === "" && nameEn.trim() === "") {
      errs.push(t("owner.categories.modal_name_required"));
    }
    return errs;
  }

  function buildInput(): CategoryInput {
    const name: Bilingual = {};
    if (nameZh.trim() !== "") name.zh = nameZh.trim();
    if (nameEn.trim() !== "") name.en = nameEn.trim();
    const description: Bilingual = {};
    if (descZh.trim() !== "") description.zh = descZh.trim();
    if (descEn.trim() !== "") description.en = descEn.trim();
    const input: CategoryInput = {
      slug,
      name,
      order,
    };
    if (description.zh !== undefined || description.en !== undefined) {
      input.description = description;
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
            toast.success(t("owner.categories.save_success_update"));
            onClose();
          },
          onError: (err) =>
            toast.error(
              err.message
                ? `${t("owner.categories.save_failed")}: ${err.message}`
                : t("owner.categories.save_failed"),
            ),
        },
      );
    } else {
      createMut.mutate(input, {
        onSuccess: () => {
          toast.success(t("owner.categories.save_success_create"));
          onClose();
        },
        onError: (err) =>
          toast.error(
            err.message
              ? `${t("owner.categories.save_failed")}: ${err.message}`
              : t("owner.categories.save_failed"),
          ),
      });
    }
  }

  const modalTitle = existing
    ? t("owner.categories.modal_title_edit")
    : t("owner.categories.modal_title_create");

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

        <div className="mt-4">
          <Field label={t("owner.categories.modal_slug")}>
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
          <Field label={t("owner.categories.modal_name_zh")}>
            <input
              type="text"
              value={nameZh}
              onChange={(e) => setNameZh(e.target.value)}
              maxLength={60}
              disabled={pending}
              className="w-full rounded-control border border-border-soft bg-panel-2 px-3 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:border-accent focus:outline-none"
            />
          </Field>
          <Field label={t("owner.categories.modal_name_en")}>
            <input
              type="text"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              maxLength={60}
              disabled={pending}
              className="w-full rounded-control border border-border-soft bg-panel-2 px-3 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:border-accent focus:outline-none"
            />
          </Field>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label={t("owner.categories.modal_description_zh")}>
            <textarea
              value={descZh}
              onChange={(e) => setDescZh(e.target.value)}
              maxLength={400}
              rows={3}
              disabled={pending}
              className="w-full resize-none rounded-control border border-border-soft bg-panel-2 px-3 py-2 text-sm text-ink placeholder:text-ink-dim focus:border-accent focus:outline-none"
            />
          </Field>
          <Field label={t("owner.categories.modal_description_en")}>
            <textarea
              value={descEn}
              onChange={(e) => setDescEn(e.target.value)}
              maxLength={400}
              rows={3}
              disabled={pending}
              className="w-full resize-none rounded-control border border-border-soft bg-panel-2 px-3 py-2 text-sm text-ink placeholder:text-ink-dim focus:border-accent focus:outline-none"
            />
          </Field>
        </div>

        <div className="mt-3 sm:max-w-xs">
          <Field label={t("owner.categories.modal_order")}>
            <input
              type="number"
              value={order}
              onChange={(e) => setOrder(Number(e.target.value))}
              min={0}
              max={10_000}
              disabled={pending}
              className="w-full rounded-control border border-border-soft bg-panel-2 px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
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
            {t("owner.categories.modal_cancel")}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="rounded-control bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-2 disabled:opacity-40"
          >
            {pending
              ? t("owner.categories.modal_saving")
              : t("owner.categories.modal_save")}
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
