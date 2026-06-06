import type { Locale } from "./locale.ts";

/**
 * Bilingual text. At least one of zh / en must be a non-empty string.
 * Enforced by Zod schema + Postgres CHECK constraint.
 */
export type BilingualText = {
  zh?: string;
  en?: string;
};

/**
 * Bilingual text without the "at least one language" invariant.
 * Both zh and en may be absent. Used for optional fields like
 * negative_prompt and notes.
 */
export type OptionalBilingualText = {
  zh?: string;
  en?: string;
};

export const ASPECT_RATIOS = ["auto", "1:1", "3:2", "2:3", "16:9", "9:16"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const USER_ROLES = ["user", "moderator", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const SUBMISSION_STATUSES = ["pending", "approved", "rejected"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const REPORT_STATUSES = ["open", "reviewing", "resolved", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const ANNOUNCEMENT_SEVERITIES = ["info", "warning", "critical"] as const;
export type AnnouncementSeverity = (typeof ANNOUNCEMENT_SEVERITIES)[number];

export const SORT_OPTIONS = ["latest", "popular", "liked", "sent"] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

export const THEME_MODES = ["light", "dark", "system"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export type PromptSummary = {
  id: string;
  slug: string;
  title: BilingualText;
  category: {
    id: string;
    slug: string;
    name: BilingualText;
  };
  tags: Array<{ slug: string; name: BilingualText }>;
  aspectRatio: AspectRatio | null;
  primaryImage: {
    r2AccountId: string;
    r2Key: string;
    width: number | null;
    height: number | null;
    lqip: string | null;
  } | null;
  viewCount: number;
  likeCount: number;
  sendCount: number;
  favoriteCount: number;
  approvedAt: string;
};

export type PromptDetail = PromptSummary & {
  prompt: BilingualText;
  negativePrompt: OptionalBilingualText | null;
  notes: OptionalBilingualText | null;
  contributor: {
    id: string;
    name: string | null;
    avatarUrl: string | null;
  } | null;
  images: Array<{
    id: string;
    r2AccountId: string;
    r2Key: string;
    order: number;
    altText: string | null;
    width: number | null;
    height: number | null;
    lqip: string | null;
  }>;
  source: "site" | "nanobanana_seed";
  createdAt: string;
  updatedAt: string;
};

export type R2PoolEntry = {
  id: string;
  publicUrl: string;
};

export type CategorySummary = {
  id: string;
  slug: string;
  name: BilingualText;
  order: number;
  promptCount: number;
};

export type TagSummary = {
  id: string;
  slug: string;
  name: BilingualText;
  usageCount: number;
};

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

export type { Locale };
