import { useMemo } from "react";
import { useSearchParams } from "react-router";
import AppShell from "../components/layout/AppShell";
import Sidebar from "../components/layout/Sidebar";
import Toolbar from "../components/Toolbar";
import PromptCard from "../components/PromptCard";
import { CardGridSkeleton } from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import { usePromptList } from "../lib/hooks/usePromptList";
import type { SortOption, AspectRatio } from "@ip/shared";

const SORT_VALUES: readonly SortOption[] = ["latest", "popular", "liked", "sent"];
const ASPECT_VALUES: readonly AspectRatio[] = ["auto", "1:1", "3:2", "2:3", "16:9", "9:16"];

function asSort(v: string | null): SortOption {
  return SORT_VALUES.includes(v as SortOption) ? (v as SortOption) : "latest";
}

function asAspect(v: string | null): AspectRatio | undefined {
  return ASPECT_VALUES.includes(v as AspectRatio) ? (v as AspectRatio) : undefined;
}

export default function PromptListPage() {
  const [params, setParams] = useSearchParams();
  const category = params.get("category") ?? undefined;
  const tag = params.get("tag") ?? undefined;
  const aspect = asAspect(params.get("aspect"));
  const q = params.get("q") ?? undefined;
  const sort = asSort(params.get("sort"));
  const page = Number(params.get("page") ?? "1") || 1;

  const query = useMemo(
    () => ({ category, tag, aspect, q, sort, page, pageSize: 24 }),
    [category, tag, aspect, q, sort, page],
  );
  const list = usePromptList(query);

  function setSort(next: SortOption) {
    const updated = new URLSearchParams(params);
    updated.set("sort", next);
    updated.delete("page");
    setParams(updated);
  }

  function setPage(next: number) {
    const updated = new URLSearchParams(params);
    if (next <= 1) updated.delete("page");
    else updated.set("page", String(next));
    setParams(updated);
  }

  return (
    <AppShell sidebar={<Sidebar />}>
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
          <>
            <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {list.data.items.map((p) => (
                <PromptCard key={p.id} prompt={p} />
              ))}
            </div>
            <Pagination
              page={page}
              hasMore={list.data.hasMore}
              total={list.data.total}
              pageSize={list.data.pageSize}
              onChange={setPage}
            />
          </>
        ))}
    </AppShell>
  );
}

function Pagination({
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
  const maxPage = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-center gap-2 border-t border-border-soft px-6 py-6 text-[13px]">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        className="rounded-pill border border-border-soft bg-surface px-4 py-1.5 text-ink-muted hover:enabled:text-ink disabled:opacity-40"
      >
        ← prev
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
        next →
      </button>
    </div>
  );
}
