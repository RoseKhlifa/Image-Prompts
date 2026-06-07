import { apiFetch } from "./api";

export type LikeResponse = { liked: boolean; like_count: number };
export type FavoriteResponse = { favorited: boolean; favorite_count: number };
export type ViewAck = { recorded: boolean };

export function postLike(promptId: string): Promise<LikeResponse> {
  return apiFetch<LikeResponse>(`/api/prompts/${promptId}/like`, { method: "POST" });
}
export function deleteLike(promptId: string): Promise<LikeResponse> {
  return apiFetch<LikeResponse>(`/api/prompts/${promptId}/like`, { method: "DELETE" });
}

export function postFavorite(promptId: string): Promise<FavoriteResponse> {
  return apiFetch<FavoriteResponse>(`/api/prompts/${promptId}/favorite`, { method: "POST" });
}
export function deleteFavorite(promptId: string): Promise<FavoriteResponse> {
  return apiFetch<FavoriteResponse>(`/api/prompts/${promptId}/favorite`, { method: "DELETE" });
}

export function postView(promptId: string): Promise<ViewAck> {
  return apiFetch<ViewAck>(`/api/prompts/${promptId}/view`, { method: "POST" });
}
