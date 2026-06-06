import { DEFAULT_LOCALE, LOCALES, type Locale, isLocale } from "@ip/shared";

export const LOCALE_STORAGE_KEY = "ip.locale";

/**
 * Resolve the user's preferred locale.
 * Priority: explicit URL path > localStorage > browser nav.languages > default.
 */
export function detectLocale(pathname: string): Locale {
  const fromPath = pathname.split("/").filter(Boolean)[0];
  if (isLocale(fromPath)) return fromPath;

  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // localStorage may be unavailable (SSR, embedded WebView restrictions). Fall through.
  }

  const nav = (typeof navigator !== "undefined" ? navigator.languages : []) ?? [];
  for (const lang of nav) {
    const base = lang.toLowerCase().split("-")[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

/**
 * Strip the leading locale segment from a path.
 * "/zh/prompts/foo" → "/prompts/foo"
 * "/en"             → "/"
 * "/about"          → "/about" (no locale prefix)
 */
export function stripLocale(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length > 0 && isLocale(segments[0])) {
    const rest = segments.slice(1).join("/");
    return "/" + rest;
  }
  return pathname.startsWith("/") ? pathname : "/" + pathname;
}

/**
 * Build a path with the given locale prefix.
 */
export function withLocale(locale: Locale, relativePath: string): string {
  const clean = relativePath.startsWith("/") ? relativePath : "/" + relativePath;
  // Avoid trailing slash for root
  const path = clean === "/" ? "" : clean;
  return `/${locale}${path}`;
}

export { LOCALES, DEFAULT_LOCALE };
export type { Locale };
