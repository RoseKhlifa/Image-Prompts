import { describe, it, expect } from "vitest";
import { resolveImageUrl, IMAGE_URL_PLACEHOLDER } from "./imageUrl";

const pool = new Map([
  ["acc-1", "https://cdn.example.com"],
  ["acc-2", "https://pub-xxx.r2.dev/"],
]);

describe("resolveImageUrl", () => {
  it("joins base + key", () => {
    expect(resolveImageUrl({ r2AccountId: "acc-1", r2Key: "p/x/0.webp" }, pool)).toBe(
      "https://cdn.example.com/p/x/0.webp",
    );
  });

  it("trims trailing slash from base and leading from key", () => {
    expect(resolveImageUrl({ r2AccountId: "acc-2", r2Key: "/p/y/0.webp" }, pool)).toBe(
      "https://pub-xxx.r2.dev/p/y/0.webp",
    );
  });

  it("returns placeholder when account is unknown", () => {
    expect(resolveImageUrl({ r2AccountId: "missing", r2Key: "p/z/0.webp" }, pool)).toBe(
      IMAGE_URL_PLACEHOLDER,
    );
  });

  it("returns placeholder when image is null", () => {
    expect(resolveImageUrl(null, pool)).toBe(IMAGE_URL_PLACEHOLDER);
  });
});
