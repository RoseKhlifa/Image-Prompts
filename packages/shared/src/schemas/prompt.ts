import { z } from "zod";
import {
  AspectRatioSchema,
  BilingualTextSchema,
  OptionalBilingualTextSchema,
  SlugSchema,
  UuidSchema,
} from "./common.ts";

export const CategorySchema = z.object({
  id: UuidSchema,
  slug: SlugSchema,
  name: BilingualTextSchema,
  order: z.number().int().default(0),
  promptCount: z.number().int().nonnegative().default(0),
});

export const TagSchema = z.object({
  id: UuidSchema,
  slug: SlugSchema,
  name: BilingualTextSchema,
  usageCount: z.number().int().nonnegative().default(0),
});

export const PromptImageSchema = z.object({
  id: UuidSchema,
  r2AccountId: UuidSchema,
  r2Key: z.string().min(1),
  order: z.number().int().default(0),
  altText: z.string().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  lqip: z.string().nullable(),
});

export const PromptSummarySchema = z.object({
  id: UuidSchema,
  slug: SlugSchema,
  title: BilingualTextSchema,
  category: z.object({
    id: UuidSchema,
    slug: SlugSchema,
    name: BilingualTextSchema,
  }),
  tags: z.array(z.object({ slug: SlugSchema, name: BilingualTextSchema })),
  aspectRatio: AspectRatioSchema.nullable(),
  primaryImage: PromptImageSchema.pick({
    r2AccountId: true,
    r2Key: true,
    width: true,
    height: true,
    lqip: true,
  }).nullable(),
  viewCount: z.number().int().nonnegative(),
  likeCount: z.number().int().nonnegative(),
  sendCount: z.number().int().nonnegative(),
  favoriteCount: z.number().int().nonnegative(),
  approvedAt: z.string(),
  // ★ M5: session-aware. Absent when the caller is anonymous; either field
  // present means the response was personalised for a logged-in viewer.
  userLiked: z.boolean().optional(),
  userFavorited: z.boolean().optional(),
  contributor: z
    .object({
      id: UuidSchema,
      name: z.string().nullable(),
      avatarUrl: z.string().nullable(),
    })
    .nullable(),
});

export const PromptDetailSchema = PromptSummarySchema.extend({
  prompt: BilingualTextSchema,
  negativePrompt: OptionalBilingualTextSchema.nullable(),
  notes: OptionalBilingualTextSchema.nullable(),
  contributor: z
    .object({
      id: UuidSchema,
      name: z.string().nullable(),
      avatarUrl: z.string().nullable(),
    })
    .nullable(),
  images: z.array(PromptImageSchema),
  source: z.enum(["site", "nanobanana_seed"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
