import { describe, it, expect } from "vitest";
import {
  ImportTokenPayloadSchema,
  ImportTokenRequestSchema,
  ImportTokenResponseSchema,
} from "./api.ts";

describe("ImportTokenPayloadSchema", () => {
  it("accepts a Chinese-only prompt", () => {
    const r = ImportTokenPayloadSchema.safeParse({ prompt: { zh: "雨夜街道" } });
    expect(r.success).toBe(true);
  });

  it("accepts an English-only prompt", () => {
    const r = ImportTokenPayloadSchema.safeParse({ prompt: { en: "rainy street" } });
    expect(r.success).toBe(true);
  });

  it("rejects empty prompt", () => {
    const r = ImportTokenPayloadSchema.safeParse({ prompt: { zh: "", en: "" } });
    expect(r.success).toBe(false);
  });

  it("accepts optional negative_prompt and aspect_ratio", () => {
    const r = ImportTokenPayloadSchema.safeParse({
      prompt: { en: "x" },
      negative_prompt: { en: "blurry" },
      aspect_ratio: "16:9",
    });
    expect(r.success).toBe(true);
  });

  it("rejects invalid aspect_ratio", () => {
    const r = ImportTokenPayloadSchema.safeParse({
      prompt: { en: "x" },
      aspect_ratio: "5:4",
    });
    expect(r.success).toBe(false);
  });
});

describe("ImportTokenRequestSchema", () => {
  it("accepts optional prompt_id as UUID", () => {
    const r = ImportTokenRequestSchema.safeParse({
      prompt: { en: "x" },
      prompt_id: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(r.success).toBe(true);
  });

  it("rejects non-UUID prompt_id", () => {
    const r = ImportTokenRequestSchema.safeParse({
      prompt: { en: "x" },
      prompt_id: "not-a-uuid",
    });
    expect(r.success).toBe(false);
  });
});

describe("ImportTokenResponseSchema", () => {
  it("accepts an 8-char base62 token + ISO 8601 expires_at", () => {
    const r = ImportTokenResponseSchema.safeParse({
      token: "Ab3Cd4Ef",
      expires_at: "2026-06-08T00:00:00.000Z",
    });
    expect(r.success).toBe(true);
  });

  it("rejects 7-char token", () => {
    const r = ImportTokenResponseSchema.safeParse({
      token: "Ab3Cd4E",
      expires_at: "2026-06-08T00:00:00.000Z",
    });
    expect(r.success).toBe(false);
  });

  it("rejects token with hyphen", () => {
    const r = ImportTokenResponseSchema.safeParse({
      token: "Ab3-Cd4E",
      expires_at: "2026-06-08T00:00:00.000Z",
    });
    expect(r.success).toBe(false);
  });
});
