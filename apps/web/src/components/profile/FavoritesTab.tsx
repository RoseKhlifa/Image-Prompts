import { useState } from "react";
import { useTranslation } from "react-i18next";
import PromptCard from "../PromptCard";
import Masonry, { type MasonryBreakpoint, type MasonryItem } from "../Masonry";
import { useMyFavorites } from "../../lib/hooks/useMyFavorites";
import { CardGridSkeleton } from "../Skeleton";

const BREAKPOINTS: MasonryBreakpoint[] = [
  { minWidth: 1280, columns: 4 },
  { minWidth: 1024, columns: 3 },
  { minWidth: 640, columns: 2 },
  { minWidth: 0, columns: 1 },
];

export default function FavoritesTab() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const query = useMyFavorites(page, 24);

  if (query.isLoading) return <CardGridSkeleton count={12} />;
  if (query.isError) {
    return <div className="py-12 text-center text-ink-dim">{t("common.error")}</div>;
  }
  if (!query.data || query.data.items.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-base font-medium text-ink">{t("profile.no_favorites")}</p>
        <p className="mt-2 text-[13px] text-ink-muted">{t("profile.no_favorites_hint")}</p>
      </div>
    );
  }

  const items: MasonryItem[] = query.data.items.map((p) => ({
    key: p.id,
    aspectRatio:
      p.primaryImage?.width && p.primaryImage?.height
        ? p.primaryImage.width / p.primaryImage.height
        : 1,
    node: <PromptCard prompt={p} />,
  }));

  const maxPage = Math.max(1, Math.ceil(query.data.total / query.data.pageSize));
  return (
    <div className="space-y-4">
      <Masonry items={items} breakpoints={BREAKPOINTS} gap={4} className="p-2" />
      <div className="flex items-center justify-center gap-2 py-4 text-[13px]">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
          className="rounded-pill border border-border-soft bg-surface px-4 py-1.5 text-ink-muted hover:enabled:text-ink disabled:opacity-40"
        >
          ← prev
        </button>
        <span className="px-2 text-ink-dim">
          {page} / {maxPage}
        </span>
        <button
          type="button"
          disabled={!query.data.hasMore}
          onClick={() => setPage((p) => p + 1)}
          className="rounded-pill border border-border-soft bg-surface px-4 py-1.5 text-ink-muted hover:enabled:text-ink disabled:opacity-40"
        >
          next →
        </button>
      </div>
    </div>
  );
}
