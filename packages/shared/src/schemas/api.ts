import { z } from "zod";
import {
  AspectRatioSchema,
  BilingualTextSchema,
  OptionalBilingualTextSchema,
  SlugSchema,
  SortOptionSchema,
  UuidSchema,
} from "./common.ts";
import { CategorySchema, PromptDetailSchema, PromptSummarySchema, TagSchema } from "./prompt.ts";

export const PromptListQuerySchema = z.object({
  category: SlugSchema.optional(),
  tag: SlugSchema.optional(),
  aspect: AspectRatioSchema.optional(),
  sort: SortOptionSchema.default("latest"),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
});

export const PaginatedSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    hasMore: z.boolean(),
  });

export const PromptListResponseSchema = PaginatedSchema(PromptSummarySchema);
export const PromptDetailResponseSchema = PromptDetailSchema;
export const CategoryListResponseSchema = z.array(CategorySchema);
export const TagListResponseSchema = z.array(TagSchema);

export const R2PoolEntrySchema = z.object({
  id: UuidSchema,
  publicUrl: z.string().url(),
});
export const R2PoolResponseSchema = z.array(R2PoolEntrySchema);

export const ErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  fields: z.record(z.string(), z.string()).optional(),
});

/**
 * Payload sent INSIDE an import token. Stored in DB as jsonb; returned as-is
 * to Image-Studio on token redeem.
 */
export const ImportTokenPayloadSchema = z.object({
  prompt: BilingualTextSchema,
  negative_prompt: OptionalBilingualTextSchema.optional(),
  aspect_ratio: AspectRatioSchema.optional(),
});
export type ImportTokenPayload = z.infer<typeof ImportTokenPayloadSchema>;

/**
 * POST /api/import-tokens request body. Same as payload + optional prompt_id
 * for send_count attribution.
 */
export const ImportTokenRequestSchema = ImportTokenPayloadSchema.extend({
  prompt_id: UuidSchema.optional(),
});
export type ImportTokenRequest = z.infer<typeof ImportTokenRequestSchema>;

/**
 * POST /api/import-tokens 201 response.
 */
export const ImportTokenResponseSchema = z.object({
  token: z.string().regex(/^[0-9A-Za-z]{8}$/),
  expires_at: z.string().datetime(),
});
export type ImportTokenResponse = z.infer<typeof ImportTokenResponseSchema>;
