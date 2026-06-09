import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { Pencil, Trash2 } from "lucide-react";
import { isLocale, pickBilingual, type Locale } from "@ip/shared";
import {
  useDeleteOwnerPrompt,
  useOwnerPrompts,
  type OwnerPromptListItem,
} from "../../lib/hooks/useOwnerPrompts";
import { useCategories } from "../../lib/hooks/useCategories";
import { useR2PoolMap } from "../../lib/hooks/useR2Pool";
import { resolveImageUrl } from "../../lib/imageUrl";
import { toast } from "../../lib/toast";
import OwnerPromptFormModal from "../../components/owner/OwnerPromptFormModal";

/**
 * /:locale/rosekhlifa/prompts — direct prompt management for the owner.
 *
 * - Search box debounced 300ms (avoids a query per keystroke).
 * - Category select reads the public useCategories hook (with promptCount).
 * - 新建直投 opens the form modal in create mode, which POSTs to
 *   /api/owner/prompts (skips the submissions queue + migrates R2 keys).
 * - Each row's pencil opens the modal in edit mode; trash hard-deletes with
 *   server-side cleanup (notifications.prompt_id NULL, submissions.promoted_to
 *   NULL, tag usage_count delta).
 *
 * Theming is via tokens (bg-panel / text-ink / border-border-soft) so the
 * owner zinc/emerald skin from OwnerLayout re-skins this page automatically.
 */
export default function PromptsPage() {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";

  const [qInput, setQInput] = useState("");
  const [qDebounced, setQDebounced] = useState("");
  const [categorySlug, setCategorySlug] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Debounce search input → query key so we don't hit the API per keystroke.
  useEffect(() => {
    const h = setTimeout(() => setQDebounced(qInput.trim()), 300);
    return () => clearTimeout(h);
  }, [qInput]);

  // Type-safe filters object honoring exactOptionalPropertyTypes — only carry
  // through keys with non-empty values.
  const filters = useMemo(() => {
    const f: { q?: string; categorySlug?: string } = {};
    if (qDebounced) f.q = qDebounced;
    if (categorySlug) f.categorySlug = categorySlug;
    return f;
  }, [qDebounced, categorySlug]);

  const listQ = useOwnerPrompts(filters);
  const items = useMemo(
    () => listQ.data?.pages.flatMap((p) => p.items) ?? [],
    [listQ.data],
  );
  const categoriesQ = useCategories();
  const categories = categoriesQ.data ?? [];

  const deleteMut = useDeleteOwnerPrompt();

  function onDelete(row: OwnerPromptListItem) {
    const title =
      pickBilingual(row.title, locale) ?? row.slug;
    if (!window.confirm(t("detail.delete_confirm", { title }))) return;
    deleteMut.mutate(row.id, {
      onSuccess: () => toast.success(t("detail.deleted")),
      onError: (err) => toast.error(err.message ?? t("common.error")),
    });
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">
            {t("owner.prompts.title")}
          </h1>
          <p className="mt-1 text-sm text-ink-muted">
            {t("owner.prompts.subtitle")}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="rounded-control bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-2"
        >
          {t("owner.prompts.btn_new")}
        </button>
      </div>

      {/* Filter row: search + category */}
      <div className="mt-4 flex flex-wrap gap-2">
        <input
          type="search"
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder={t("owner.prompts.search_placeholder")}
          className="min-w-[16rem] flex-1 rounded-control border border-border-soft bg-panel-2 px-3 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:border-accent focus:outline-none"
        />
        <select
          value={categorySlug}
          onChange={(e) => setCategorySlug(e.target.value)}
          className="rounded-control border border-border-soft bg-panel-2 px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
        >
          <option value="">{t("owner.prompts.filter_all_categories")}</option>
          {categories.map((c) => (
            <option key={c.id} value={c.slug}>
              {pickBilingual(c.name, locale) ?? c.slug}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3 text-xs text-ink-dim">
        {t("owner.prompts.loaded_count", {
          shown: items.length,
          defaultValue: `已加载 ${items.length} 条`,
        })}
      </div>

      <div className="mt-2 overflow-x-auto rounded-card border border-border-soft bg-panel">
        <table className="w-full text-sm">
          <thead className="border-b border-border-soft text-xs uppercase tracking-wider text-ink-muted">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">
                {t("owner.prompts.col_thumb")}
              </th>
              <th className="px-4 py-3 text-left font-semibold">
                {t("owner.prompts.col_title")}
              </th>
              <th className="px-4 py-3 text-left font-semibold">
                {t("owner.prompts.col_category")}
              </th>
              <th className="px-4 py-3 text-left font-semibold">
                {t("owner.prompts.col_contributor")}
              </th>
              <th className="px-4 py-3 text-right font-semibold">
                {t("owner.prompts.col_counts")}
              </th>
              <th className="px-4 py-3 text-left font-semibold">
                {t("owner.prompts.col_approved_at")}
              </th>
              <th className="px-4 py-3 text-right font-semibold">
                {t("owner.prompts.col_actions")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {listQ.isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-ink-muted">
                  {t("common.loading")}
                </td>
              </tr>
            )}
            {listQ.isError && !listQ.isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-danger">
                  {t("common.error_load")}
                </td>
              </tr>
            )}
            {!listQ.isLoading && !listQ.isError && items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-ink-muted">
                  {t("owner.prompts.no_prompts")}
                </td>
              </tr>
            )}
            {items.map((row) => (
              <PromptRow
                key={row.id}
                row={row}
                locale={locale}
                onEdit={() => setEditingId(row.id)}
                onDelete={() => onDelete(row)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {listQ.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => listQ.fetchNextPage()}
            disabled={listQ.isFetchingNextPage}
            className="rounded-pill border border-border-soft bg-surface px-5 py-2 text-sm text-ink-muted hover:enabled:text-ink disabled:opacity-40"
          >
            {listQ.isFetchingNextPage
              ? t("common.loading")
              : t("common.load_more")}
          </button>
        </div>
      )}

      {(creating || editingId !== null) && (
        <OwnerPromptFormModal
          editingId={editingId}
          onClose={() => {
            setCreating(false);
            setEditingId(null);
          }}
        />
      )}
    </div>
  );
}

// ── Row ─────────────────────────────────────────────────────────────────

function PromptRow({
  row,
  locale,
  onEdit,
  onDelete,
}: {
  row: OwnerPromptListItem;
  locale: Locale;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { map: r2Map } = useR2PoolMap();
  const title = pickBilingual(row.title, locale) ?? row.slug;
  const categoryName =
    pickBilingual(row.category.name, locale) ?? row.category.slug;
  const thumbUrl = row.primaryImage
    ? resolveImageUrl(
        {
          r2AccountId: row.primaryImage.r2AccountId,
          r2Key: row.primaryImage.r2Key,
          remoteUrl: row.primaryImage.remoteUrl,
        },
        r2Map,
      )
    : null;
  const approved = new Date(row.approvedAt).toLocaleDateString(
    locale === "zh" ? "zh-CN" : "en-US",
  );
  return (
    <tr className="hover:bg-bg-2">
      <td className="px-4 py-3">
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt=""
            className="h-10 w-10 rounded-control object-cover"
          />
        ) : (
          <div className="h-10 w-10 rounded-control bg-panel-2" />
        )}
      </td>
      <td className="px-4 py-3">
        <div className="text-sm font-medium text-ink">{title}</div>
        <div className="font-mono text-[11px] text-ink-muted">{row.slug}</div>
      </td>
      <td className="px-4 py-3">
        <span className="rounded-pill bg-accent-soft px-2 py-0.5 text-xs text-accent">
          {categoryName}
        </span>
      </td>
      <td className="px-4 py-3 text-xs text-ink-muted">
        {row.contributor?.name ?? "—"}
      </td>
      <td className="px-4 py-3 text-right text-xs text-ink-muted">
        {row.viewCount} / {row.likeCount} / {row.favoriteCount}
      </td>
      <td className="px-4 py-3 text-xs text-ink-muted">{approved}</td>
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
