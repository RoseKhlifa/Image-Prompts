import { describe, it, expect } from "vitest";
import { pickBilingual, hasLocale, hasAnyLanguage } from "./bilingual.ts";

describe("pickBilingual", () => {
  it("returns the requested locale when present", () => {
    expect(pickBilingual({ zh: "中文", en: "English" }, "zh")).toBe("中文");
    expect(pickBilingual({ zh: "中文", en: "English" }, "en")).toBe("English");
  });

  it("falls back to the other locale when requested is empty", () => {
    expect(pickBilingual({ en: "English" }, "zh")).toBe("English");
    expect(pickBilingual({ zh: "中文" }, "en")).toBe("中文");
  });

  it("treats whitespace-only as empty", () => {
    expect(pickBilingual({ zh: "   ", en: "English" }, "zh")).toBe("English");
  });

  it("returns null when both are missing", () => {
    expect(pickBilingual({}, "zh")).toBeNull();
    expect(pickBilingual(null, "zh")).toBeNull();
    expect(pickBilingual(undefined, "en")).toBeNull();
  });
});

describe("hasLocale", () => {
  it("is true when the locale is non-empty", () => {
    expect(hasLocale({ zh: "中文" }, "zh")).toBe(true);
    expect(hasLocale({ zh: "中文", en: "English" }, "en")).toBe(true);
  });

  it("is false when the locale is missing or whitespace", () => {
    expect(hasLocale({ en: "English" }, "zh")).toBe(false);
    expect(hasLocale({ zh: "   " }, "zh")).toBe(false);
    expect(hasLocale(null, "zh")).toBe(false);
  });
});

describe("hasAnyLanguage", () => {
  it("is true when at least one locale is non-empty", () => {
    expect(hasAnyLanguage({ zh: "中文" })).toBe(true);
    expect(hasAnyLanguage({ en: "English" })).toBe(true);
    expect(hasAnyLanguage({ zh: "中文", en: "English" })).toBe(true);
  });

  it("is false when both are missing or whitespace", () => {
    expect(hasAnyLanguage({})).toBe(false);
    expect(hasAnyLanguage({ zh: "  ", en: "" })).toBe(false);
    expect(hasAnyLanguage(null)).toBe(false);
  });
});
