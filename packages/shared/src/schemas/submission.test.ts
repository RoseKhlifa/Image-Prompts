import { describe, it, expect } from "vitest";
import {
  SubmissionInputSchema,
  PresignRequestSchema,
  RejectInputSchema,
  ApproveInputSchema,
} from "./submission.ts";

const validImage = {
  r2AccountId: "11111111-1111-1111-1111-111111111111",
  r2Key: "submissions/u/abc.jpg",
};
const validCategoryId = "22222222-2222-2222-2222-222222222222";

describe("SubmissionInputSchema", () => {
  it("accepts a language-agnostic title + zh-only prompt", () => {
    const r = SubmissionInputSchema.safeParse({
      title: "我的标题",
      promptZh: "中文提示词",
      categoryId: validCategoryId,
      tagSlugs: [],
      images: [validImage],
    });
    expect(r.success).toBe(true);
  });

  it("accepts a title + en-only prompt", () => {
    const r = SubmissionInputSchema.safeParse({
      title: "My title",
      promptEn: "English prompt",
      categoryId: validCategoryId,
      tagSlugs: [],
      images: [validImage],
    });
    expect(r.success).toBe(true);
  });

  it("accepts a title + both prompt languages", () => {
    const r = SubmissionInputSchema.safeParse({
      title: "Title",
      promptZh: "中文",
      promptEn: "English",
      categoryId: validCategoryId,
      tagSlugs: [],
      images: [validImage],
    });
    expect(r.success).toBe(true);
  });

  it("rejects when title is missing", () => {
    const r = SubmissionInputSchema.safeParse({
      promptZh: "中文提示词",
      categoryId: validCategoryId,
      tagSlugs: [],
      images: [validImage],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toContain("title_required");
    }
  });

  it("rejects when title is whitespace only", () => {
    const r = SubmissionInputSchema.safeParse({
      title: "   ",
      promptZh: "中文",
      categoryId: validCategoryId,
      tagSlugs: [],
      images: [validImage],
    });
    expect(r.success).toBe(false);
  });

  it("rejects when both prompt languages are empty (prompt_required)", () => {
    const r = SubmissionInputSchema.safeParse({
      title: "Title",
      categoryId: validCategoryId,
      tagSlugs: [],
      images: [validImage],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(JSON.stringify(r.error.issues)).toContain("prompt_required");
    }
  });

  it("rejects > 6 tags", () => {
    const tags = Array.from({ length: 7 }, (_, i) => `tag-${i}`);
    const r = SubmissionInputSchema.safeParse({
      title: "x", promptZh: "y",
      categoryId: validCategoryId,
      tagSlugs: tags,
      images: [validImage],
    });
    expect(r.success).toBe(false);
  });

  it("rejects 0 images", () => {
    const r = SubmissionInputSchema.safeParse({
      title: "x", promptZh: "y",
      categoryId: validCategoryId,
      tagSlugs: [],
      images: [],
    });
    expect(r.success).toBe(false);
  });

  it("rejects > 5 images", () => {
    const r = SubmissionInputSchema.safeParse({
      title: "x", promptZh: "y",
      categoryId: validCategoryId,
      tagSlugs: [],
      images: Array.from({ length: 6 }, () => validImage),
    });
    expect(r.success).toBe(false);
  });

  it("rejects an r2Key that doesn't start with submissions/", () => {
    const r = SubmissionInputSchema.safeParse({
      title: "x", promptZh: "y",
      categoryId: validCategoryId,
      tagSlugs: [],
      images: [{ ...validImage, r2Key: "prompts/abc.jpg" }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects a tag slug with uppercase or space", () => {
    const r = SubmissionInputSchema.safeParse({
      title: "x", promptZh: "y",
      categoryId: validCategoryId,
      tagSlugs: ["Bad Slug"],
      images: [validImage],
    });
    expect(r.success).toBe(false);
  });
});

describe("PresignRequestSchema", () => {
  it("accepts a valid request", () => {
    const r = PresignRequestSchema.safeParse({
      filename: "photo.jpg",
      contentType: "image/jpeg",
      size: 1024 * 1024,
    });
    expect(r.success).toBe(true);
  });
  it("rejects unsupported MIME", () => {
    const r = PresignRequestSchema.safeParse({
      filename: "x.gif", contentType: "image/gif", size: 1,
    });
    expect(r.success).toBe(false);
  });
  it("rejects size > 10MB", () => {
    const r = PresignRequestSchema.safeParse({
      filename: "x.jpg", contentType: "image/jpeg", size: 11 * 1024 * 1024,
    });
    expect(r.success).toBe(false);
  });
  it("rejects non-positive size", () => {
    const r = PresignRequestSchema.safeParse({
      filename: "x.jpg", contentType: "image/jpeg", size: 0,
    });
    expect(r.success).toBe(false);
  });
});

describe("RejectInputSchema", () => {
  it("requires ≥ 1 char (rejects empty / whitespace-only)", () => {
    expect(RejectInputSchema.safeParse({ reason: "" }).success).toBe(false);
    expect(RejectInputSchema.safeParse({ reason: "   " }).success).toBe(false);
    expect(RejectInputSchema.safeParse({ reason: "x" }).success).toBe(true);
  });
  it("rejects > 500 chars", () => {
    expect(
      RejectInputSchema.safeParse({ reason: "x".repeat(501) }).success,
    ).toBe(false);
  });
});

describe("ApproveInputSchema", () => {
  it("accepts empty body (yes/no approve, no edits)", () => {
    expect(ApproveInputSchema.safeParse({}).success).toBe(true);
  });
  it("accepts partial edits", () => {
    expect(
      ApproveInputSchema.safeParse({
        edits: { titleZh: "新中文标题", tagSlugs: ["a", "b"] },
      }).success,
    ).toBe(true);
  });
});
