/**
 * In-memory fixed-window rate limiter.
 *
 * Each key maintains a list of timestamps within `windowMs`. On `check`, old
 * entries are pruned; if the remaining count is < limit, allow + record; else
 * reject.
 *
 * Keys are evicted on LRU when size exceeds `maxKeys` (default 10k).
 * Single-instance only — for multi-instance, swap to Redis.
 */

export type RateLimiterOptions = {
  limit: number;
  windowMs: number;
  maxKeys?: number;
  now?: () => number;
};

export type RateLimiter = {
  check: (key: string) => boolean;
};

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const limit = opts.limit;
  const windowMs = opts.windowMs;
  const maxKeys = opts.maxKeys ?? 10_000;
  const now = opts.now ?? (() => Date.now());

  // Map insertion order = recency; we exploit Map's insertion-ordered iteration
  // to implement LRU: re-insert a key on access to move it to the tail.
  const buckets = new Map<string, number[]>();

  function evictIfNeeded() {
    while (buckets.size > maxKeys) {
      const oldestKey = buckets.keys().next().value;
      if (oldestKey === undefined) break;
      buckets.delete(oldestKey);
    }
  }

  function check(key: string): boolean {
    const t = now();
    const cutoff = t - windowMs;
    const list = buckets.get(key) ?? [];
    while (list.length > 0 && list[0]! < cutoff) {
      list.shift();
    }
    const allowed = list.length < limit;
    if (allowed) list.push(t);
    // Refresh LRU position: delete + set
    buckets.delete(key);
    buckets.set(key, list);
    evictIfNeeded();
    return allowed;
  }

  return { check };
}
