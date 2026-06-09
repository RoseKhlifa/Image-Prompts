import { createHash } from "node:crypto";

/**
 * Generate a slug for an imported tag name. Accepts ASCII and CJK characters;
 * strips emoji and control codepoints; collapses whitespace + punctuation
 * runs to single dashes. Falls back to a deterministic short hash for
 * degenerate input (empty after stripping).
 *
 * Used only by the import path. The owner-tag CRUD slug regex is unchanged
 * (`^[a-z0-9-]{1,40}$`) so manually-created tags still look clean.
 */
export function tagSlugFromName(name: string): string {
  const lowered = name.toLowerCase();
  // Strip emoji (presentation forms) and format-control characters.
  // \p{Emoji_Presentation} covers the common emoji set; \p{Cf} catches
  // bidi marks and other invisibles.
  const stripped = lowered.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\p{Cf}]/gu, "");
  // Replace runs of whitespace + ASCII punctuation with a single dash.
  // U+00B7 (·) is added as a literal because it sits outside the ASCII-range
  // character classes used here (\xB7 is not in [!-/:-@[-`{-~]).
  const dashed = stripped.replace(/[\s!-/:-@[-`{-~·]+/g, "-");
  const trimmed = dashed.replace(/^-+|-+$/g, "");
  if (trimmed.length === 0) {
    const h = createHash("sha1").update(name).digest("hex").slice(0, 8);
    return `t-${h}`;
  }
  return trimmed;
}
