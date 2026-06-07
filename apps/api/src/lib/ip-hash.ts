import { createHash } from "node:crypto";

/**
 * Compute a salted 16-char hex hash of an IP address, suitable for use as
 * a privacy-preserving dedup key in view_log. The secret salts against
 * rainbow tables — different deployments produce different hashes for the
 * same IP. Restarting the API with a new secret rotates all hashes (and
 * effectively resets dedup buckets), which is acceptable.
 *
 * Returns null for empty/missing input so the caller can decide whether
 * to fall back to a different identifier or skip the view entirely. We
 * deliberately do NOT collapse all empty inputs into a single shared
 * bucket — that would let one bot fill a single row repeatedly while
 * blocking every other anonymous viewer.
 */
export function hashIp(ip: string | null | undefined, secret: string): string | null {
  if (!ip) return null;
  return createHash("sha256").update(ip).update(secret).digest("hex").slice(0, 16);
}
