import { z } from "zod";
import {
  ASPECT_RATIOS,
  SUBMISSION_STATUSES,
  USER_ROLES,
  REPORT_STATUSES,
  ANNOUNCEMENT_SEVERITIES,
  LOCALES,
  SORT_OPTIONS,
  THEME_MODES,
} from "../types/index.ts";

export const LocaleSchema = z.enum(LOCALES);
export const AspectRatioSchema = z.enum(ASPECT_RATIOS);
export const UserRoleSchema = z.enum(USER_ROLES);
export const SubmissionStatusSchema = z.enum(SUBMISSION_STATUSES);
export const ReportStatusSchema = z.enum(REPORT_STATUSES);
export const AnnouncementSeveritySchema = z.enum(ANNOUNCEMENT_SEVERITIES);
export const SortOptionSchema = z.enum(SORT_OPTIONS);
export const ThemeModeSchema = z.enum(THEME_MODES);

/**
 * A single bilingual leaf: trimmed string of at most 4000 chars, or absent.
 * Empty / whitespace-only inputs are normalized to absent so downstream
 * existence checks and the DB CHECK constraint agree on "no value".
 */
const TrimmedOptionalString = z
  .string()
  .trim()
  .max(4000)
  .transform((s) => (s.length === 0 ? undefined : s))
  .optional();

/**
 * Bilingual text where at least one of zh / en is a non-empty string after trimming.
 * Maximum length per language is 4000 chars to bound payload size.
 *
 * Empty / whitespace-only fields are normalized to absent (not "").
 */
export const BilingualTextSchema = z
  .object({
    zh: TrimmedOptionalString,
    en: TrimmedOptionalString,
  })
  .refine((v) => v.zh !== undefined || v.en !== undefined, {
    message: "at_least_one_language_required",
  });

/**
 * Optional bilingual text — both zh and en may be absent.
 * Used for negative_prompt and notes.
 *
 * Empty / whitespace-only fields are normalized to absent (not "").
 */
export const OptionalBilingualTextSchema = z.object({
  zh: TrimmedOptionalString,
  en: TrimmedOptionalString,
});

export const UuidSchema = z.string().uuid();
export const SlugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
