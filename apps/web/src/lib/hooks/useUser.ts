import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api";

export type UserPublic = {
  id: string;
  name: string | null;
  image: string | null;
  role: "user" | "moderator" | "admin";
  joinedAt: string;
};

export function useUser(id: string | undefined) {
  return useQuery<UserPublic>({
    queryKey: ["user", id],
    queryFn: ({ signal }) => apiFetch<UserPublic>(`/api/users/${id}`, { signal }),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}
