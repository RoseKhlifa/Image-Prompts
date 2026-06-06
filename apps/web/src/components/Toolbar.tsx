import { useTranslation } from "react-i18next";
import type { SortOption } from "@ip/shared";

const SORTS: SortOption[] = ["latest", "popular", "liked", "sent"];

export default function Toolbar({
  total,
  sort,
  onSortChange,
}: {
  total: number;
  sort: SortOption;
  onSortChange: (next: SortOption) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between border-b border-border-soft px-6 py-4">
      <div className="text-[13px] text-ink-muted">{t("list.total", { count: total })}</div>
      <div
        role="group"
        className="inline-flex rounded-pill border border-border-soft bg-surface p-0.5 text-xs"
      >
        {SORTS.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={s === sort}
            onClick={() => onSortChange(s)}
            className={[
              "rounded-pill px-3 py-1 transition-colors",
              s === sort ? "bg-accent text-white" : "text-ink-muted hover:text-ink",
            ].join(" ")}
          >
            {t(`list.sort_${s}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
