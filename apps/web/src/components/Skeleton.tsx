export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={["animate-pulse rounded-md bg-surface-2", className].join(" ")} />;
}

export function PromptCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-border-soft bg-panel p-3.5">
      <Skeleton className="aspect-[4/5] w-full rounded-md" />
      <Skeleton className="h-3 w-3/4" />
      <Skeleton className="h-2 w-1/2" />
    </div>
  );
}

export function CardGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <PromptCardSkeleton key={i} />
      ))}
    </div>
  );
}
