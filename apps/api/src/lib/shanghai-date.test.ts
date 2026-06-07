import { describe, it, expect } from "vitest";
import { startOfTodayShanghai } from "./shanghai-date.ts";

describe("startOfTodayShanghai", () => {
  it("returns the 00:00:00 instant for the Asia/Shanghai date of 'now'", () => {
    // 2026-06-07T15:30:00Z is 2026-06-07T23:30:00+08:00 in Shanghai
    // → start of Shanghai day = 2026-06-07T00:00:00+08:00 = 2026-06-06T16:00:00Z
    const now = new Date("2026-06-07T15:30:00Z");
    const start = startOfTodayShanghai(now);
    expect(start.toISOString()).toBe("2026-06-06T16:00:00.000Z");
  });

  it("rolls forward at Shanghai midnight (UTC 16:00)", () => {
    // 2026-06-07T16:00:01Z = 2026-06-08T00:00:01+08:00 → start = 2026-06-07T16:00:00Z
    const now = new Date("2026-06-07T16:00:01Z");
    const start = startOfTodayShanghai(now);
    expect(start.toISOString()).toBe("2026-06-07T16:00:00.000Z");
  });

  it("handles a UTC date that is two calendar days behind Shanghai", () => {
    // 2026-01-01T17:00:00Z = 2026-01-02T01:00:00+08:00 → start = 2026-01-01T16:00:00Z
    const now = new Date("2026-01-01T17:00:00Z");
    const start = startOfTodayShanghai(now);
    expect(start.toISOString()).toBe("2026-01-01T16:00:00.000Z");
  });
});
