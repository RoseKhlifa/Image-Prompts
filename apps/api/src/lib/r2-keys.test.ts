import { describe, it, expect } from "vitest";
import { buildSubmissionKey, buildPromptKey, mimeToExt } from "./r2-keys.ts";

describe("mimeToExt", () => {
  it("maps jpeg/png/webp", () => {
    expect(mimeToExt("image/jpeg")).toBe("jpg");
    expect(mimeToExt("image/png")).toBe("png");
    expect(mimeToExt("image/webp")).toBe("webp");
  });
  it("throws on unsupported MIME", () => {
    expect(() => mimeToExt("image/gif")).toThrow();
  });
});

describe("buildSubmissionKey", () => {
  it("returns submissions/<userId>/<uuid>.<ext>", () => {
    const k = buildSubmissionKey("user-123", "jpg");
    expect(k).toMatch(/^submissions\/user-123\/[0-9a-f-]{36}\.jpg$/);
  });
  it("lowercases the extension", () => {
    const k = buildSubmissionKey("user-1", "JPG");
    expect(k.endsWith(".jpg")).toBe(true);
  });
});

describe("buildPromptKey", () => {
  it("returns prompts/<promptId>/<index>.<ext>", () => {
    expect(buildPromptKey("p-1", 0, "png")).toBe("prompts/p-1/0.png");
    expect(buildPromptKey("p-1", 3, "webp")).toBe("prompts/p-1/3.webp");
  });
});
