import AppShell from "../components/layout/AppShell";
import Sidebar from "../components/layout/Sidebar";
import Hero from "../components/Hero";
import PromptCard from "../components/PromptCard";
import { CardGridSkeleton } from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import { usePromptList } from "../lib/hooks/usePromptList";

export default function HomePage() {
  const list = usePromptList({ sort: "latest", page: 1, pageSize: 12 });

  return (
    <AppShell sidebar={<Sidebar />}>
      <Hero promptCount={list.data?.total ?? 0} />
      {list.isLoading && <CardGridSkeleton count={8} />}
      {list.isError && (
        <ErrorState
          message={list.error instanceof Error ? list.error.message : "Error"}
          onRetry={() => list.refetch()}
        />
      )}
      {!list.isLoading &&
        !list.isError &&
        list.data &&
        (list.data.items.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {list.data.items.map((p) => (
              <PromptCard key={p.id} prompt={p} />
            ))}
          </div>
        ))}
    </AppShell>
  );
}
