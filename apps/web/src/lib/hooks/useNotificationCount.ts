import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router";
import { apiFetch } from "../api";
import { useSession } from "./useSession";

/**
 * Polls /api/me/notifications/count. Refetches on window focus and on every
 * route change (so the bell badge updates when the user navigates after an
 * approve/reject elsewhere). Disabled when no session.
 */
export function useNotificationCount() {
  const qc = useQueryClient();
  const location = useLocation();
  const session = useSession();
  const enabled = !!session.data;

  const result = useQuery({
    queryKey: ["me", "notifications", "count"],
    queryFn: ({ signal }) =>
      apiFetch<{ unread: number }>("/api/me/notifications/count", { signal }),
    enabled,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });

  useEffect(() => {
    if (enabled) qc.invalidateQueries({ queryKey: ["me", "notifications", "count"] });
  }, [enabled, location.pathname, qc]);

  return result;
}
