import { z } from "zod";
import { AspectRatioSchema } from "./common.ts";

export const TagSlugSchema = z
  .string()
  .regex(/^[a-z0-9-]+$/)
  .min(1)
  .max(40);

export const SubmissionImageInputSchema = z.object({
  r2AccountId: z.string().uuid(),
  r2Key: z.string().min(1).max(512).regex(/^submissions\//),
  altText: z.string().max(200).optional(),
});

export const SubmissionInputSchema = z
  .object({
    titleZh: z.string().trim().max(200).optional(),
    titleEn: z.string().trim().max(200).optional(),
    promptZh: z.string().trim().max(8000).optional(),
    promptEn: z.string().trim().max(8000).optional(),
    negativePromptZh: z.string().trim().max(2000).optional(),
    negativePromptEn: z.string().trim().max(2000).optional(),
    notesZh: z.string().trim().max(2000).optional(),
    notesEn: z.string().trim().max(2000).optional(),
    aspectRatio: AspectRatioSchema.optional(),
    categoryId: z.string().uuid(),
    tagSlugs: z.array(TagSlugSchema).max(6).default([]),
    images: z.array(SubmissionImageInputSchema).min(1).max(5),
  })
  .refine(
    (v) => Boolean((v.titleZh && v.promptZh) || (v.titleEn && v.promptEn)),
    { message: "bilingual_required", path: ["titleZh"] },
  );

export const PresignRequestSchema = z.object({
  filename: z.string().max(200),
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  size: z.number().int().positive().max(10 * 1024 * 1024),
});

export const PresignResponseSchema = z.object({
  r2AccountId: z.string().uuid(),
  r2Key: z.string(),
  uploadUrl: z.string().url(),
  expiresAt: z.string().datetime(),
});

export const RejectInputSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const ApproveInputSchema = z.object({
  edits: z
    .object({
      titleZh: z.string().max(200).optional(),
      titleEn: z.string().max(200).optional(),
      promptZh: z.string().max(8000).optional(),
      promptEn: z.string().max(8000).optional(),
      negativePromptZh: z.string().max(2000).optional(),
      negativePromptEn: z.string().max(2000).optional(),
      notesZh: z.string().max(2000).optional(),
      notesEn: z.string().max(2000).optional(),
      aspectRatio: AspectRatioSchema.optional(),
      categoryId: z.string().uuid().optional(),
      tagSlugs: z.array(TagSlugSchema).max(6).optional(),
    })
    .partial()
    .optional(),
});

export const CommunityGuidelinesAcceptSchema = z.object({
  version: z.number().int().min(1),
});

export const NotificationSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["submission_approved", "submission_rejected"]),
  payload: z.record(z.unknown()),
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

// Output DTOs

const PrimaryImageRefSchema = z
  .object({
    r2AccountId: z.string().uuid(),
    r2Key: z.string(),
  })
  .nullable();

export const SubmissionListItemSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["pending", "approved", "rejected"]),
  titleZh: z.string().nullable(),
  titleEn: z.string().nullable(),
  rejectReason: z.string().nullable(),
  primaryImage: PrimaryImageRefSchema,
  promotedTo: z
    .object({ promptId: z.string().uuid(), slug: z.string() })
    .nullable(),
  createdAt: z.string().datetime(),
  reviewedAt: z.string().datetime().nullable(),
});

export const AdminSubmissionListItemSchema = SubmissionListItemSchema.extend({
  contributor: z.object({
    id: z.string().uuid(),
    name: z.string().nullable(),
    email: z.string().nullable(),
    rejectedCount: z.number().int(),
  }),
});

export const AdminSubmissionDetailSchema = AdminSubmissionListItemSchema.extend({
  promptZh: z.string().nullable(),
  promptEn: z.string().nullable(),
  negativePromptZh: z.string().nullable(),
  negativePromptEn: z.string().nullable(),
  notesZh: z.string().nullable(),
  notesEn: z.string().nullable(),
  aspectRatio: AspectRatioSchema.nullable(),
  categoryId: z.string().uuid(),
  tagSlugs: z.array(z.string()),
  agreedGuidelinesVersion: z.number().int(),
  images: z.array(
    z.object({
      r2AccountId: z.string().uuid(),
      r2Key: z.string(),
      altText: z.string().nullable(),
    }),
  ),
});

export type SubmissionInput = z.infer<typeof SubmissionInputSchema>;
export type PresignRequest = z.infer<typeof PresignRequestSchema>;
export type PresignResponse = z.infer<typeof PresignResponseSchema>;
export type RejectInput = z.infer<typeof RejectInputSchema>;
export type ApproveInput = z.infer<typeof ApproveInputSchema>;
export type CommunityGuidelinesAccept = z.infer<typeof CommunityGuidelinesAcceptSchema>;
export type NotificationDTO = z.infer<typeof NotificationSchema>;
export type SubmissionListItem = z.infer<typeof SubmissionListItemSchema>;
export type AdminSubmissionListItem = z.infer<typeof AdminSubmissionListItemSchema>;
export type AdminSubmissionDetail = z.infer<typeof AdminSubmissionDetailSchema>;
// Note: AspectRatio/AspectRatioSchema is re-used from ./common.ts — no new export.
