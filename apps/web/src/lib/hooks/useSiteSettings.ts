import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../api";

export type SiteSetting = {
  key: string;
  value: unknown;
  description: string | null;
  updatedAt: string;
  updatedBy: string | null;
};

export function useSiteSettings() {
  return useQuery({
    queryKey: ["owner", "settings"],
    queryFn: () => apiFetch<{ items: SiteSetting[] }>("/api/owner/settings"),
    staleTime: 30_000,
  });
}

export function useUpdateSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { key: string; value: unknown }) => {
      return apiFetch<{ key: string; value: unknown }>(
        `/api/owner/settings/${encodeURIComponent(input.key)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ value: input.value }),
        },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["owner", "settings"] });
    },
  });
}
