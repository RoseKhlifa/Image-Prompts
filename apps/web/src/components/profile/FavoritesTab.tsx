import { useState } from "react";
import { useTranslation } from "react-i18next";
import PromptCard from "../PromptCard";
import Masonry, { buildMasonryItem, type MasonryBreakpoint } from "../Masonry";
import Pagination from "../Pagination";
import { useMyFavorites } from "../../lib/hooks/useMyFavorites";
import { useR2PoolMap } from "../../lib/hooks/useR2Pool";
import { CardGridSkeleton } from "../Skeleton";

const BREAKPOINTS: MasonryBreakpoint[] = [
  { minWidth: 1280, columns: 4 },
  { minWidth: 1024, columns: 3 },
  { minWidth: 0, columns: 2 },
];

export default function FavoritesTab() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const query = useMyFavorites(page, 24);
  const { map: r2Map } = useR2PoolMap();

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

  const items = query.data.items.map((p) =>
    buildMasonryItem(p, r2Map, <PromptCard prompt={p} />),
  );

  return (
    <div className="space-y-4">
      <Masonry items={items} breakpoints={BREAKPOINTS} gap={4} className="p-2" />
      <Pagination
        page={page}
        hasMore={query.data.hasMore}
        total={query.data.total}
        pageSize={query.data.pageSize}
        onChange={setPage}
      />
    </div>
  );
}
