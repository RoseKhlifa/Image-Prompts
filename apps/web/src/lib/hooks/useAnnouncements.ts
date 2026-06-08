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
export function useAnnouncements(): UseQueryResult<
  { items: PublicAnnouncement[] },
  ApiError
> {
  return useQuery({
    queryKey: ["announcements"],
    queryFn: ({ signal }) =>
      apiFetch<{ items: PublicAnnouncement[] }>("/api/announcements", { signal }),
    staleTime: 60_000,
  });
}
