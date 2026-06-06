import type { BilingualText, Locale } from "../types/index.ts";

/**
 * Pick the text in the requested locale. If empty, fall back to the other.
 * Returns null only when both are empty (should be prevented by DB CHECK).
 */
export function pickBilingual(
  text: BilingualText | null | undefined,
  locale: Locale,
): string | null {
  if (!text) return null;
  const primary = text[locale];
  if (primary && primary.trim().length > 0) return primary;
  const otherLocale: Locale = locale === "zh" ? "en" : "zh";
  const fallback = text[otherLocale];
  if (fallback && fallback.trim().length > 0) return fallback;
  return null;
}

/**
 * True when the field has the requested locale populated.
 * Used to render a "no <lang> version, showing <other>" hint.
 */
export function hasLocale(text: BilingualText | null | undefined, locale: Locale): boolean {
  if (!text) return false;
  const value = text[locale];
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * True when at least one of zh / en is non-empty (validation rule).
 */
export function hasAnyLanguage(text: BilingualText | null | undefined): boolean {
  if (!text) return false;
  return hasLocale(text, "zh") || hasLocale(text, "en");
}
