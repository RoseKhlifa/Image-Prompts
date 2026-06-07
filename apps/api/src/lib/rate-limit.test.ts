import { describe, it, expect } from "vitest";
import { createRateLimiter } from "./rate-limit.ts";

describe("createRateLimiter", () => {
  it("allows up to `limit` requests within window", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000 });
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("a")).toBe(false);
  });

  it("isolates keys", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("b")).toBe(true);
    expect(limiter.check("a")).toBe(false);
    expect(limiter.check("b")).toBe(false);
  });

  it("resets after window passes", () => {
    let now = 1_000_000;
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: 60_000,
      now: () => now,
    });
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("a")).toBe(false);
    now += 60_001;
    expect(limiter.check("a")).toBe(true);
  });

  it("evicts LRU when size exceeds maxKeys", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 2 });
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("b")).toBe(true);
    expect(limiter.check("c")).toBe(true); // evicts "a"
    expect(limiter.check("a")).toBe(true); // counts as fresh — "a" was evicted
  });
});
