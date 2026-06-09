import { describe, it, expect } from "vitest";
import { tagSlugFromName } from "./tag-slug.ts";

describe("tagSlugFromName", () => {
  it("keeps Chinese characters as-is and lowercases ASCII", () => {
    expect(tagSlugFromName("摄影写真")).toBe("摄影写真");
    expect(tagSlugFromName("Realistic")).toBe("realistic");
    expect(tagSlugFromName("AI绘画")).toBe("ai绘画");
  });

  it("strips emoji prefixes and collapses spaces / punctuation to dashes", () => {
    expect(tagSlugFromName("🔥 Qwen · 爆款海报")).toBe("qwen-爆款海报");
    expect(tagSlugFromName("品牌及视觉设计")).toBe("品牌及视觉设计");
    expect(tagSlugFromName("Hello World")).toBe("hello-world");
  });

  it("falls back to t-<sha1[:8]> for degenerate input", () => {
    expect(tagSlugFromName("")).toMatch(/^t-[0-9a-f]{8}$/);
    expect(tagSlugFromName("   ")).toMatch(/^t-[0-9a-f]{8}$/);
    expect(tagSlugFromName("🔥🔥🔥")).toMatch(/^t-[0-9a-f]{8}$/);
  });

  it("is deterministic across runs", () => {
    const a = tagSlugFromName("Realistic");
    const b = tagSlugFromName("Realistic");
    expect(a).toBe(b);
  });

  it("trims leading and trailing dashes", () => {
    expect(tagSlugFromName("---hello---")).toBe("hello");
    expect(tagSlugFromName(".clean.")).toBe("clean");
  });
});
