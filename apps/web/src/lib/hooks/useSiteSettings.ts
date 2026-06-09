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
      // Do NOT pass explicit Content-Type header here — apiFetch already
      // adds "Content-Type: application/json" when a body is present, and
      // passing a lowercase override creates duplicate header keys in the
      // plain-object headers init that browsers handle inconsistently.
      // The duplicate caused @hono/zod-validator to receive an empty body
      // (verified 2026-06-09 by manually parsing c.req.json() inline).
      return apiFetch<{ key: string; value: unknown }>(
        `/api/owner/settings/${encodeURIComponent(input.key)}`,
        {
          method: "PUT",
          body: JSON.stringify({ value: input.value }),
        },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["owner", "settings"] });
    },
  });
}
