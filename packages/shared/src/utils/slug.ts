/**
 * Produce a URL-safe slug. Lowercases, replaces non-alphanumeric runs with single hyphens,
 * trims leading/trailing hyphens, truncates to 80 chars.
 *
 * Note: callers are expected to dedupe against the prompts.slug uniqueness constraint
 * (e.g. by appending -2 / -3 on conflict).
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Generate a short random base62 token used by import_tokens.
 * 8 chars × log2(62) ≈ 47.6 bits — collision-free for our scale.
 */
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function generateBase62Token(length = 8): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) {
    out += BASE62.charAt(byte % 62);
  }
  return out;
}
