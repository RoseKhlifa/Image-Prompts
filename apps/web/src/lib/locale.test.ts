import { describe, it, expect, beforeEach } from "vitest";
import { detectLocale, stripLocale, withLocale, LOCALE_STORAGE_KEY } from "./locale";

describe("detectLocale", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("prefers locale from URL path", () => {
    expect(detectLocale("/zh/prompts")).toBe("zh");
    expect(detectLocale("/en/about")).toBe("en");
  });

  it("falls back to localStorage", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "en");
    expect(detectLocale("/")).toBe("en");
  });

  it("ignores invalid path segment", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "zh");
    expect(detectLocale("/garbage/path")).toBe("zh");
  });

  it("falls back to default when nothing matches", () => {
    expect(detectLocale("/")).toBe("zh");
  });
});

describe("stripLocale", () => {
  it("removes leading locale segment", () => {
    expect(stripLocale("/zh/prompts/foo")).toBe("/prompts/foo");
    expect(stripLocale("/en")).toBe("/");
  });

  it("leaves path unchanged when no locale prefix", () => {
    expect(stripLocale("/about")).toBe("/about");
    expect(stripLocale("/")).toBe("/");
  });
});

describe("withLocale", () => {
  it("prepends locale", () => {
    expect(withLocale("zh", "/prompts")).toBe("/zh/prompts");
    expect(withLocale("en", "about")).toBe("/en/about");
  });

  it("handles root path", () => {
    expect(withLocale("zh", "/")).toBe("/zh");
  });
});
