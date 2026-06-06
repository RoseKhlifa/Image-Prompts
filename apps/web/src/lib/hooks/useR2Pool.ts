import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { R2PoolEntry } from "@ip/shared";
import { apiFetch } from "../api";

export function useR2PoolMap() {
  const query = useQuery<R2PoolEntry[]>({
    queryKey: ["r2-pool"],
    queryFn: ({ signal }) => apiFetch<R2PoolEntry[]>("/api/public/r2-pool", { signal }),
    staleTime: 60 * 60_000, // 1h — pool changes rarely; manual invalidate after admin edit
  });

  const map = useMemo(() => {
    const out = new Map<string, string>();
    for (const entry of query.data ?? []) out.set(entry.id, entry.publicUrl);
    return out;
  }, [query.data]);

  return { ...query, map };
}
