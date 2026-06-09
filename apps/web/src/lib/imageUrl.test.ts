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

  it("returns the remote URL when remoteUrl is set", () => {
    const url = resolveImageUrl(
      { r2AccountId: null, r2Key: null, remoteUrl: "https://cdn.example.com/a.jpg" },
      new Map(),
    );
    expect(url).toBe("https://cdn.example.com/a.jpg");
  });

  it("prefers remoteUrl over a stale R2 pair (defensive)", () => {
    const url = resolveImageUrl(
      {
        r2AccountId: "00000000-0000-0000-0000-000000000001",
        r2Key: "prompts/foo.jpg",
        remoteUrl: "https://cdn.example.com/b.jpg",
      },
      new Map(),
    );
    expect(url).toBe("https://cdn.example.com/b.jpg");
  });
});
