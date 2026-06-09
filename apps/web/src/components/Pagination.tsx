import { useTranslation } from "react-i18next";

/**
 * Shared page-by-page navigator. Drives the URL ?page=N query param via
 * the `onChange` callback. Localized "Prev / Next" labels via i18n keys
 * `common.prev_page` and `common.next_page`. Used by HomePage,
 * PromptListPage, owner/PromptsPage, and anywhere else that paginates a
 * fixed-pageSize listing.
 */
export default function Pagination({
  page,
  hasMore,
  total,
  pageSize,
  onChange,
}: {
  page: number;
  hasMore: boolean;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
}) {
  const { t } = useTranslation();
  const maxPage = Math.max(1, Math.ceil(total / pageSize));
  // Hide entirely if there's nothing to paginate (single page of results).
  if (total <= pageSize && page <= 1) return null;
  return (
    <div className="flex items-center justify-center gap-2 border-t border-border-soft px-6 py-6 text-[13px]">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        className="rounded-pill border border-border-soft bg-surface px-4 py-1.5 text-ink-muted hover:enabled:text-ink disabled:opacity-40"
      >
        ← {t("common.prev_page")}
      </button>
      <span className="px-2 text-ink-dim">
        {page} / {maxPage}
      </span>
      <button
        type="button"
        disabled={!hasMore}
        onClick={() => onChange(page + 1)}
        className="rounded-pill border border-border-soft bg-surface px-4 py-1.5 text-ink-muted hover:enabled:text-ink disabled:opacity-40"
      >
        {t("common.next_page")} →
      </button>
    </div>
  );
}
