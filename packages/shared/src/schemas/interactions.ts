import { z } from "zod";
import { UuidSchema } from "./common.ts";

/**
 * Server response for a successful toggle (POST or DELETE). Even DELETE
 * returns the body so the client can sync the count without a second
 * request.
 */
export const ToggleResultSchema = z.object({
  liked: z.boolean().optional(),       // present on like routes
  favorited: z.boolean().optional(),   // present on favorite routes
  like_count: z.number().int().nonnegative().optional(),
  favorite_count: z.number().int().nonnegative().optional(),
});
export type ToggleResult = z.infer<typeof ToggleResultSchema>;

export const ViewAckSchema = z.object({
  recorded: z.boolean(),
});
export type ViewAck = z.infer<typeof ViewAckSchema>;

export const MyFavoritesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(60).default(24),
});
export type MyFavoritesQuery = z.infer<typeof MyFavoritesQuerySchema>;

export const PromptIdParamSchema = z.object({
  id: UuidSchema,
});
