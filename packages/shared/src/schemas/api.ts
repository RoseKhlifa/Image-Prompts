import { z } from "zod";
import { AspectRatioSchema, SlugSchema, SortOptionSchema, UuidSchema } from "./common.ts";
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
