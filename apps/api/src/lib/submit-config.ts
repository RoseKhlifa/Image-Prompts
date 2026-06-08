/**
 * M10a:动态加载 submit.* keys from site_settings table,带 60 秒内存缓存。
 *
 * Cache 策略:第一次 call 加载,后续 60s 内复用同一 snapshot;过期后下次
 * call 重新加载。Owner 通过 PUT /api/owner/settings/:key 改完后,路由层主动
 * 调 resetSubmitConfigCache() 让下一次 call 立即重读(不用等 60s)。
 *
 * 默认值用 FALLBACK 常量;DB 缺 key 时用 fallback(防御性,正常 seed 跑过
 * 后不会触发)。
 */
import { getSettingsByPrefix } from "../repositories/site-settings.ts";

export type SubmitConfig = {
  DAILY_LIMIT: number;
  DEMOTED_LIMIT: number;
  DEMOTE_THRESHOLD: number;
  MAX_IMAGES_PER_SUBMISSION: number;
  MIN_IMAGES_PER_SUBMISSION: number;
  MAX_IMAGE_SIZE_BYTES: number;
  ALLOWED_MIME: string[];
  MAX_TAGS: number;
  PRESIGN_TTL_SECONDS: number;
  GUIDELINES_VERSION: number;
  GUIDELINES_READ_SECONDS: number;
  DAILY_RESET_TIMEZONE: string;
  REJECT_REASON_MIN_CHARS: number;
  REJECT_REASON_MAX_CHARS: number;
};

const FALLBACK: SubmitConfig = {
  DAILY_LIMIT: 10,
  DEMOTED_LIMIT: 5,
  DEMOTE_THRESHOLD: 3,
  MAX_IMAGES_PER_SUBMISSION: 5,
  MIN_IMAGES_PER_SUBMISSION: 1,
  MAX_IMAGE_SIZE_BYTES: 10 * 1024 * 1024,
  ALLOWED_MIME: ["image/jpeg", "image/png", "image/webp"],
  MAX_TAGS: 6,
  PRESIGN_TTL_SECONDS: 15 * 60,
  GUIDELINES_VERSION: 1,
  GUIDELINES_READ_SECONDS: 5,
  DAILY_RESET_TIMEZONE: "Asia/Shanghai",
  REJECT_REASON_MIN_CHARS: 1,
  REJECT_REASON_MAX_CHARS: 500,
};

const CACHE_TTL_MS = 60_000;
let cached: { config: SubmitConfig; loadedAt: number } | null = null;

/**
 * Read submit.* keys from site_settings; merge over FALLBACK; cache 60s.
 *
 * Test code uses resetSubmitConfigCache() to start fresh between tests.
 */
export async function getSubmitConfig(): Promise<SubmitConfig> {
  const now = Date.now();
  if (cached && now - cached.loadedAt < CACHE_TTL_MS) return cached.config;
  const m = await getSettingsByPrefix("submit.");
  const config: SubmitConfig = {
    ...FALLBACK,
    DAILY_LIMIT: numFrom(m, "submit.daily_limit", FALLBACK.DAILY_LIMIT),
    DEMOTED_LIMIT: numFrom(m, "submit.demoted_daily_limit", FALLBACK.DEMOTED_LIMIT),
    DEMOTE_THRESHOLD: numFrom(m, "submit.demote_threshold", FALLBACK.DEMOTE_THRESHOLD),
    MAX_IMAGES_PER_SUBMISSION: numFrom(
      m,
      "submit.max_images_per_submission",
      FALLBACK.MAX_IMAGES_PER_SUBMISSION,
    ),
    MIN_IMAGES_PER_SUBMISSION: numFrom(
      m,
      "submit.min_images_per_submission",
      FALLBACK.MIN_IMAGES_PER_SUBMISSION,
    ),
    MAX_IMAGE_SIZE_BYTES: numFrom(
      m,
      "submit.max_image_size_bytes",
      FALLBACK.MAX_IMAGE_SIZE_BYTES,
    ),
    ALLOWED_MIME: arrFrom(m, "submit.allowed_mime", FALLBACK.ALLOWED_MIME),
    MAX_TAGS: numFrom(m, "submit.max_tags", FALLBACK.MAX_TAGS),
    PRESIGN_TTL_SECONDS: numFrom(
      m,
      "submit.presign_ttl_seconds",
      FALLBACK.PRESIGN_TTL_SECONDS,
    ),
    GUIDELINES_VERSION: numFrom(
      m,
      "submit.guidelines_version",
      FALLBACK.GUIDELINES_VERSION,
    ),
    DAILY_RESET_TIMEZONE: strFrom(
      m,
      "submit.daily_reset_timezone",
      FALLBACK.DAILY_RESET_TIMEZONE,
    ),
    REJECT_REASON_MIN_CHARS: numFrom(
      m,
      "submit.reject_reason_min_chars",
      FALLBACK.REJECT_REASON_MIN_CHARS,
    ),
    REJECT_REASON_MAX_CHARS: numFrom(
      m,
      "submit.reject_reason_max_chars",
      FALLBACK.REJECT_REASON_MAX_CHARS,
    ),
  };
  cached = { config, loadedAt: now };
  return config;
}

/** Test-only: wipe cache so next getSubmitConfig() re-reads DB. */
export function resetSubmitConfigCache(): void {
  cached = null;
}

function numFrom(m: Map<string, unknown>, k: string, fallback: number): number {
  const v = m.get(k);
  return typeof v === "number" ? v : fallback;
}
function strFrom(m: Map<string, unknown>, k: string, fallback: string): string {
  const v = m.get(k);
  return typeof v === "string" ? v : fallback;
}
function arrFrom<T>(m: Map<string, unknown>, k: string, fallback: T[]): T[] {
  const v = m.get(k);
  return Array.isArray(v) ? (v as T[]) : fallback;
}

/**
 * Compile-time MIME union (kept for backward compat in routes that still
 * narrow to the legacy three). Runtime validation should use
 * (await getSubmitConfig()).ALLOWED_MIME.includes(actualMime).
 */
export type AllowedMime = "image/jpeg" | "image/png" | "image/webp";
