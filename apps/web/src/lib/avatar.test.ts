import { describe, it, expect } from "vitest";
import { initialFromName, colorForId } from "./avatar";

describe("initialFromName", () => {
  it("returns first char uppercased", () => {
    expect(initialFromName("alice")).toBe("A");
    expect(initialFromName("张三")).toBe("张");
  });
  it("returns ? for null/empty", () => {
    expect(initialFromName(null)).toBe("?");
    expect(initialFromName("")).toBe("?");
  });
});

describe("colorForId", () => {
  it("is deterministic for same id", () => {
    expect(colorForId("abc")).toBe(colorForId("abc"));
  });
  it("returns a hex color", () => {
    const c = colorForId("xyz");
    expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
