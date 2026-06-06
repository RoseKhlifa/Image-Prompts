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
import Masonry from "react-masonry-css";

const SORT_VALUES: readonly SortOption[] = ["latest", "popular", "liked", "sent"];

function asSort(v: string | null): SortOption {
  return SORT_VALUES.includes(v as SortOption) ? (v as SortOption) : "latest";
}

const BREAKPOINTS = {
  default: 4,
  1280: 4,
  1024: 3,
  768: 2,
  640: 2,
  0: 1,
};

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
      {!list.isLoading && !list.isError && list.data && (
        list.data.items.length === 0 ? (
          <EmptyState />
        ) : (
          <Masonry
            breakpointCols={BREAKPOINTS}
            className="flex gap-1 p-2"
            columnClassName="flex flex-col"
          >
            {list.data.items.map((p) => (
              <PromptCard key={p.id} prompt={p} />
            ))}
          </Masonry>
        )
      )}
    </AppShell>
  );
}
