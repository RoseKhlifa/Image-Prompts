import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { apiFetch, type ApiError } from "../api";
import type { OwnerAnnouncement } from "./useOwnerAnnouncements";

/**
 * Public announcement read — shape mirrors the owner row (server uses the
 * same `rowToAnnouncement` mapper for both endpoints) but only currently
 * active rows are returned (filtered by repo via listActivePublic()).
 *
 * Mounted unauthenticated at /api/announcements so signed-out + banned
 * users still see banners (see server.ts wiring + announcements.ts route).
 */
export type PublicAnnouncement = OwnerAnnouncement;

/**
 * Banner feed for the AnnouncementsBanner. 60s staleTime keeps the request
 * volume sane while still surfacing newly-published announcements within a
 * minute of an owner write (which also invalidates this query key directly,
 * see useOwnerAnnouncements mutations).
 */
export type AnnouncementsResponse = {
  /** All active rows (banner + popup). Kept for back-compat with consumers
   *  that haven't migrated to the split view. */
  items: PublicAnnouncement[];
  /** At most one — server enforces "one banner at a time" by truncating the
   *  active banner list to the most-recently-started row. */
  banners: PublicAnnouncement[];
  /** All active popup announcements, queued. Client renders one at a time
   *  (modal), with per-id dismissal via localStorage. */
  popups: PublicAnnouncement[];
};

export function useAnnouncements(): UseQueryResult<
  AnnouncementsResponse,
  ApiError
> {
  return useQuery({
    queryKey: ["announcements"],
    queryFn: ({ signal }) =>
      apiFetch<AnnouncementsResponse>("/api/announcements", { signal }),
    staleTime: 60_000,
  });
}
