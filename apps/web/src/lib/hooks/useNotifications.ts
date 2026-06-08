import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api";
import type { NotificationDTO } from "@ip/shared";
import { useSession } from "./useSession";

type Page = { items: NotificationDTO[]; nextCursor: string | null };

export function useNotifications(opts: { enabled?: boolean; unreadOnly?: boolean } = {}) {
  const session = useSession();
  const enabled = (opts.enabled ?? true) && !!session.data;
  return useQuery({
    queryKey: ["me", "notifications", { unread: opts.unreadOnly ?? false }],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams();
      if (opts.unreadOnly) params.set("unread", "true");
      return apiFetch<Page>(`/api/me/notifications?${params.toString()}`, { signal });
    },
    enabled,
  });
}
