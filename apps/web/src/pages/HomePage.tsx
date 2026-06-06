import Masonry from "react-masonry-css";
import AppShell from "../components/layout/AppShell";
import Sidebar from "../components/layout/Sidebar";
import Hero from "../components/Hero";
import PromptCard from "../components/PromptCard";
import { CardGridSkeleton } from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import { usePromptList } from "../lib/hooks/usePromptList";

const BREAKPOINTS = {
  default: 4,
  1280: 4,
  1024: 3,
  768: 2,
  640: 2,
  0: 1,
};

export default function HomePage() {
  const list = usePromptList({ sort: "latest", page: 1, pageSize: 12 });

  return (
    <AppShell sidebar={<Sidebar />}>
      <Hero promptCount={list.data?.total ?? 0} />
      {list.isLoading && <CardGridSkeleton count={8} />}
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
            breakpointCols={BREAKPOINTS}
            className="flex gap-1 p-2"
            columnClassName="flex flex-col"
          >
            {list.data.items.map((p) => (
              <PromptCard key={p.id} prompt={p} />
            ))}
          </Masonry>
        ))}
    </AppShell>
  );
}
