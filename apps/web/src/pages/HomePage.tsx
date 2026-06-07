import { useSearchParams } from "react-router";
import type { SortOption } from "@ip/shared";
import AppShell from "../components/layout/AppShell";
import Sidebar from "../components/layout/Sidebar";
import Hero from "../components/Hero";
import Toolbar from "../components/Toolbar";
import PromptCard from "../components/PromptCard";
import { CardGridSkeleton } from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import { usePromptList } from "../lib/hooks/usePromptList";
import Masonry, { type MasonryBreakpoint, type MasonryItem } from "../components/Masonry";

const SORT_VALUES: readonly SortOption[] = ["latest", "popular", "liked", "sent"];

function asSort(v: string | null): SortOption {
  return SORT_VALUES.includes(v as SortOption) ? (v as SortOption) : "latest";
}

// Breakpoints in MOST-SPECIFIC-FIRST order — first match wins.
const BREAKPOINTS: MasonryBreakpoint[] = [
  { minWidth: 1280, columns: 4 },
  { minWidth: 1024, columns: 3 },
  { minWidth: 640, columns: 2 },
  { minWidth: 0, columns: 1 },
];

export default function HomePage() {
  const [params, setParams] = useSearchParams();
  const sort = asSort(params.get("sort"));

  const list = usePromptList({ sort, page: 1, pageSize: 24 });

  function setSort(next: SortOption) {
    const updated = new URLSearchParams(params);
    updated.set("sort", next);
    setParams(updated);
  }

  return (
    <AppShell sidebar={<Sidebar />}>
      <Hero promptCount={list.data?.total ?? 0} />
      <Toolbar total={list.data?.total ?? 0} sort={sort} onSortChange={setSort} />
      {list.isLoading && <CardGridSkeleton count={12} />}
      {list.isError && (
        <ErrorState
          message={list.error instanceof Error ? list.error.message : undefined}
          onRetry={() => list.refetch()}
        />
      )}
      {!list.isLoading &&
        !list.isError &&
        list.data &&
        (list.data.items.length === 0 ? (
          <EmptyState />
        ) : (
          <Masonry
            items={list.data.items.map<MasonryItem>((p) => ({
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
        ))}
    </AppShell>
  );
}
