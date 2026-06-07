import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { like } from "drizzle-orm";
import { createServer } from "../server.ts";
import { db } from "../db/client.ts";
import { tags } from "../db/schema/index.ts";

const TEST_SLUG_PREFIX = "task25-tags-route-";

const app = createServer();

beforeEach(async () => {
  await db.delete(tags).where(like(tags.slug, `${TEST_SLUG_PREFIX}%`));
});

afterAll(async () => {
  await db.delete(tags).where(like(tags.slug, `${TEST_SLUG_PREFIX}%`));
});

describe("GET /api/tags", () => {
  it("returns existing tags ordered by usageCount desc when no q", async () => {
    await db.insert(tags).values([
      { slug: `${TEST_SLUG_PREFIX}a`, name: { zh: "a", en: "a" }, usageCount: 1 },
      { slug: `${TEST_SLUG_PREFIX}b`, name: { zh: "b", en: "b" }, usageCount: 99 },
    ]);
    const res = await app.request(`/api/tags?q=${TEST_SLUG_PREFIX}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ slug: string; usageCount: number }>;
    // Our two tags should be at the top (by usageCount desc)
    expect(body.length).toBeGreaterThanOrEqual(2);
    const ours = body.filter((t) => t.slug.startsWith(TEST_SLUG_PREFIX));
    expect(ours[0]!.slug).toBe(`${TEST_SLUG_PREFIX}b`);
  });

  it("filters by q (slug substring or bilingual name)", async () => {
    await db.insert(tags).values([
      { slug: `${TEST_SLUG_PREFIX}portrait-male`, name: { zh: "男性肖像", en: "Male Portrait" }, usageCount: 1 },
      { slug: `${TEST_SLUG_PREFIX}portrait-female`, name: { zh: "女性肖像", en: "Female Portrait" }, usageCount: 2 },
      { slug: `${TEST_SLUG_PREFIX}landscape`, name: { zh: "风景", en: "Landscape" }, usageCount: 5 },
    ]);
    const res = await app.request(`/api/tags?q=${TEST_SLUG_PREFIX}portrait`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ slug: string }>;
    const ours = body.filter((t) => t.slug.startsWith(TEST_SLUG_PREFIX));
    expect(ours).toHaveLength(2);
    expect(new Set(ours.map((b) => b.slug))).toEqual(
      new Set([`${TEST_SLUG_PREFIX}portrait-male`, `${TEST_SLUG_PREFIX}portrait-female`]),
    );
  });

  it("respects ?limit=", async () => {
    await db.insert(tags).values(
      Array.from({ length: 12 }, (_, i) => ({
        slug: `${TEST_SLUG_PREFIX}t${i}`,
        name: { zh: `t${i}`, en: `t${i}` },
        usageCount: i,
      })),
    );
    const res = await app.request(`/api/tags?q=${TEST_SLUG_PREFIX}&limit=5`);
    const body = (await res.json()) as Array<{ slug: string }>;
    expect(body).toHaveLength(5);
  });

  it("rejects limit > 50 with 400", async () => {
    const res = await app.request("/api/tags?limit=999");
    expect(res.status).toBe(400);
  });
});
