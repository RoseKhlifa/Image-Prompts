import { describe, it, expect } from "vitest";
import { slugify, generateBase62Token } from "./slug.ts";

describe("slugify", () => {
  it("lowercases and replaces spaces", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("collapses runs of non-alphanumeric chars", () => {
    expect(slugify("foo  --  bar")).toBe("foo-bar");
    expect(slugify("foo & bar / baz")).toBe("foo-bar-baz");
  });

  it("strips leading and trailing hyphens", () => {
    expect(slugify("--hello--")).toBe("hello");
  });

  it("strips diacritics", () => {
    expect(slugify("Crème Brûlée")).toBe("creme-brulee");
  });

  it("drops non-ASCII (CJK) for slug-safety", () => {
    // CJK chars are not in [a-z0-9] so they become hyphens, then collapsed.
    expect(slugify("赛博朋克 cat")).toBe("cat");
    expect(slugify("cyberpunk 霓虹 cat")).toBe("cyberpunk-cat");
  });

  it("truncates to 80 chars", () => {
    const long = "a".repeat(200);
    expect(slugify(long)).toHaveLength(80);
  });
});

describe("generateBase62Token", () => {
  it("returns the requested length", () => {
    expect(generateBase62Token(8)).toHaveLength(8);
    expect(generateBase62Token(12)).toHaveLength(12);
  });

  it("only uses base62 alphabet", () => {
    const token = generateBase62Token(64);
    expect(token).toMatch(/^[0-9A-Za-z]+$/);
  });

  it("is unlikely to collide", () => {
    const set = new Set<string>();
    for (let i = 0; i < 5000; i++) set.add(generateBase62Token(8));
    expect(set.size).toBe(5000);
  });
});
