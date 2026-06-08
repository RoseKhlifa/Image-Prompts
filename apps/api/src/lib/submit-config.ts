/**
 * M4 hard-coded limits & policy constants. M7 migrates these to the
 * site_settings table; for now the API + tests import this module directly.
 */
export const SUBMIT_CONFIG = {
  DAILY_LIMIT: 10,
  DEMOTED_LIMIT: 5,
  DEMOTE_THRESHOLD: 3,            // users.rejectedCount ≥ this → halved daily limit
  MAX_IMAGES_PER_SUBMISSION: 5,
  MIN_IMAGES_PER_SUBMISSION: 1,
  MAX_IMAGE_SIZE_BYTES: 10 * 1024 * 1024,
  ALLOWED_MIME: ["image/jpeg", "image/png", "image/webp"] as const,
  MAX_TAGS: 6,
  PRESIGN_TTL_SECONDS: 15 * 60,
  GUIDELINES_VERSION: 1,
  GUIDELINES_READ_SECONDS: 30,
  DAILY_RESET_TIMEZONE: "Asia/Shanghai",
  REJECT_REASON_MIN_CHARS: 1,
  REJECT_REASON_MAX_CHARS: 500,
} as const;

export type AllowedMime = (typeof SUBMIT_CONFIG.ALLOWED_MIME)[number];
