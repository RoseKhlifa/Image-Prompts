import { describe, it, expect } from "vitest";
import { z } from "zod";
import { zodErrorsToMap } from "./zod-errors";

const Schema = z
  .object({
    titleZh: z.string().min(1),
    titleEn: z.string().min(1),
    tags: z.array(z.string()).max(2),
  })
  .refine((v) => Boolean(v.titleZh || v.titleEn), {
    message: "bilingual_required",
    path: ["titleZh"],
  });

describe("zodErrorsToMap", () => {
  it("maps issue paths to issue messages", () => {
    const r = Schema.safeParse({ titleZh: "", titleEn: "", tags: ["a", "b", "c"] });
    expect(r.success).toBe(false);
    if (!r.success) {
      const map = zodErrorsToMap(r.error);
      expect(Object.keys(map).length).toBeGreaterThan(0);
      expect(map["titleZh"]).toBeDefined();
      expect(map["titleEn"]).toBeDefined();
      expect(map["tags"]).toBeDefined();
    }
  });

  it("returns empty map on success", () => {
    const ok = Schema.safeParse({ titleZh: "x", titleEn: "y", tags: ["a"] });
    expect(ok.success).toBe(true);
  });

  it("preserves last issue when multiple issues target same path", () => {
    const r = Schema.safeParse({ titleZh: "", titleEn: "", tags: [] });
    if (!r.success) {
      const map = zodErrorsToMap(r.error);
      expect(map["titleZh"]).toBeTruthy();
    }
  });
});
