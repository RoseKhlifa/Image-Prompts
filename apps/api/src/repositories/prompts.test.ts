import { describe, it, expect, afterAll } from "vitest";
import { pool } from "../db/client.ts";
import { listPrompts, getPromptBySlug } from "./prompts.ts";

describe("prompts repository (integration, requires seeded DB)", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("listPrompts returns seeded prompts on default query", async () => {
    const res = await listPrompts({ sort: "latest", page: 1, pageSize: 24 });
    expect(res.total).toBeGreaterThan(0);
    expect(res.items.length).toBeGreaterThan(0);
    expect(res.items[0]?.title).toBeDefined();
  });

  it("filters by category", async () => {
    const res = await listPrompts({ sort: "latest", page: 1, pageSize: 24, category: "landscape" });
    expect(res.items.every((i) => i.category.slug === "landscape")).toBe(true);
  });

  it("filters by tag", async () => {
    const res = await listPrompts({ sort: "latest", page: 1, pageSize: 24, tag: "cyberpunk" });
    expect(res.items.every((i) => i.tags.some((t) => t.slug === "cyberpunk"))).toBe(true);
  });

  it("returns empty for unknown category", async () => {
    const res = await listPrompts({
      sort: "latest",
      page: 1,
      pageSize: 24,
      category: "does-not-exist",
    });
    expect(res.total).toBe(0);
    expect(res.items).toEqual([]);
  });

  it("getPromptBySlug returns full detail", async () => {
    const detail = await getPromptBySlug("cyberpunk-neon-cat");
    expect(detail).not.toBeNull();
    expect(detail?.title.zh).toBe("赛博朋克霓虹猫");
    expect(detail?.title.en).toBe("Cyberpunk Neon Cat");
    expect(detail?.images.length).toBeGreaterThan(0);
    expect(detail?.tags.length).toBeGreaterThan(0);
  });

  it("getPromptBySlug returns null for missing", async () => {
    const detail = await getPromptBySlug("does-not-exist");
    expect(detail).toBeNull();
  });
});
