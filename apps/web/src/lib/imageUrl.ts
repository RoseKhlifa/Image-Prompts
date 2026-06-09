/**
 * Resolve a full image URL by joining the R2 account's public URL with the key.
 * Falls back to a placeholder if the account isn't in the pool map (e.g. disabled
 * after the image was uploaded, but spec says public_url remains valid as long as
 * the underlying bucket lives).
 *
 * Imported prompts (source='imported') carry a `remoteUrl` instead of an R2 ref;
 * this function short-circuits on that and returns the remote URL verbatim.
 */
const PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 9'%3E%3Crect width='16' height='9' fill='%232c2c2f'/%3E%3C/svg%3E";

export function resolveImageUrl(
  image:
    | {
        r2AccountId: string | null;
        r2Key: string | null;
        remoteUrl?: string | null;
      }
    | null
    | undefined,
  poolMap: Map<string, string>,
): string {
  if (!image) return PLACEHOLDER;
  // Imported prompts: short-circuit on remoteUrl. This wins even when stale
  // r2 cols are present (defensive — DB invariant says one xor the other).
  if (image.remoteUrl) return image.remoteUrl;
  // No remoteUrl AND either r2 col is null → no resolvable image.
  if (!image.r2AccountId || !image.r2Key) return "";
  const base = poolMap.get(image.r2AccountId);
  if (!base) return PLACEHOLDER;
  const trimmedBase = base.replace(/\/$/, "");
  const trimmedKey = image.r2Key.replace(/^\//, "");
  return `${trimmedBase}/${trimmedKey}`;
}

export const IMAGE_URL_PLACEHOLDER = PLACEHOLDER;
