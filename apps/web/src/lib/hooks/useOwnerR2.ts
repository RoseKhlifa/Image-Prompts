import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api";

export type OwnerR2Account = {
  id: string;
  name: string;
  accountId: string;
  endpoint: string;
  bucket: string;
  publicUrl: string;
  priority: number;
  enabled: boolean;
  usedBytes: number | null;
  lastSyncedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
};

export function useOwnerR2Accounts() {
  return useQuery({
    queryKey: ["owner", "r2-accounts"],
    queryFn: () => apiFetch<{ items: OwnerR2Account[] }>("/api/owner/r2-accounts"),
    staleTime: 30_000,
  });
}
