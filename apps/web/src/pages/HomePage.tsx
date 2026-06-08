import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import type { SortOption, PromptSummary } from "@ip/shared";
import AppShell from "../components/layout/AppShell";
import Sidebar from "../components/layout/Sidebar";
import Hero from "../components/Hero";
import Toolbar from "../components/Toolbar";
import PromptCard from "../components/PromptCard";
import { CardGridSkeleton } from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import AboutPageContent from "./AboutPageContent";
import { usePromptList } from "../lib/hooks/usePromptList";
import { useSession } from "../lib/hooks/useSession";
import { useUserFavorites } from "../lib/hooks/useUserFavorites";
import { useUserPrompts } from "../lib/hooks/useUserPrompts";
import Masonry, { type MasonryBreakpoint, type MasonryItem } from "../components/Masonry";

type Tab = "gallery" | "favorites" | "mine" | "about";

const SORT_VALUES: readonly SortOption[] = ["latest", "popular", "liked", "sent"];
function asSort(v: string | null): SortOption {
  return SORT_VALUES.includes(v as SortOption) ? (v as SortOption) : "latest";
}
function asTab(v: string | null): Tab {
  if (v === "favorites" || v === "mine" || v === "about") return v;
  return "gallery";
}

const BREAKPOINTS: MasonryBreakpoint[] = [
  { minWidth: 1280, columns: 4 },
  { minWidth: 1024, columns: 3 },
  { minWidth: 640, columns: 2 },
  { minWidth: 0, columns: 1 },
];

type ListResult = { items: PromptSummary[]; total?: number };

export default function HomePage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const sort = asSort(params.get("sort"));
  const tab = asTab(params.get("tab"));
  const q = params.get("q") ?? undefined;
  const session = useSession();
  const userId = (session.data?.user as { id?: string } | undefined)?.id;

  const gallery = usePromptList({ sort, page: 1, pageSize: 24, q });
  const favorites = useUserFavorites(userId, tab === "favorites" && !!userId);
  const mine = useUserPrompts(tab === "mine" ? userId : undefined);

  function setTab(next: Tab) {
    const updated = new URLSearchParams(params);
    if (next === "gallery") updated.delete("tab");
    else updated.set("tab", next);
    setParams(updated);
  }
  function setSort(next: SortOption) {
    const updated = new URLSearchParams(params);
    updated.set("sort", next);
    setParams(updated);
  }

  const TABS: { key: Tab; labelKey: string; requiresAuth: boolean }[] = [
    { key: "gallery", labelKey: "home.tab_gallery", requiresAuth: false },
    { key: "favorites", labelKey: "home.tab_favorites", requiresAuth: true },
    { key: "mine", labelKey: "home.tab_mine", requiresAuth: true },
    { key: "about", labelKey: "home.tab_about", requiresAuth: false },
  ];

  function renderItems(data: ListResult | null) {
    if (!data || data.items.length === 0) return <EmptyState />;
    return (
      <Masonry
        items={data.items.map<MasonryItem>((p) => ({
          key: p.id,
          aspectRatio:
            p.primaryImage?.width && p.primaryImage?.height
              ? p.primaryImage.width / p.primaryImage.height
              : 1,
          node: <PromptCard prompt={p} />,
        }))}
        breakpoints={BREAKPOINTS}
        gap={4}
        className="p-2"
      />
    );
  }

  return (
    <AppShell sidebar={<Sidebar />}>
      <Hero />
      <div role="tablist" className="flex gap-4 border-b border-border-soft px-6">
        {TABS.map((tt) => {
          if (tt.requiresAuth && !userId) return null;
          return (
            <button
              key={tt.key}
              role="tab"
              aria-selected={tab === tt.key}
              onClick={() => setTab(tt.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition ${
                tab === tt.key
                  ? "border-accent text-ink"
                  : "border-transparent text-ink-muted hover:text-ink"
              }`}
            >
              {t(tt.labelKey)}
            </button>
          );
        })}
      </div>

      {tab === "gallery" && (
        <>
          <Toolbar total={gallery.data?.total ?? 0} sort={sort} onSortChange={setSort} />
          {gallery.isLoading && <CardGridSkeleton count={12} />}
          {gallery.isError && (
            <ErrorState
              message={gallery.error instanceof Error ? gallery.error.message : undefined}
              onRetry={() => gallery.refetch()}
            />
          )}
          {!gallery.isLoading && !gallery.isError && gallery.data && renderItems(gallery.data)}
        </>
      )}
      {tab === "favorites" &&
        (favorites.isLoading ? (
          <CardGridSkeleton count={6} />
        ) : (
          renderItems(favorites.data ?? null)
        ))}
      {tab === "mine" &&
        (mine.isLoading ? <CardGridSkeleton count={6} /> : renderItems(mine.data ?? null))}
      {tab === "about" && <AboutPageContent />}
    </AppShell>
  );
}
