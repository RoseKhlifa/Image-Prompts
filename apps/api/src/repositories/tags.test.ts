import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { like } from "drizzle-orm";
import { db } from "../db/client.ts";
import { tags } from "../db/schema/index.ts";
import {
  searchTags,
  getTagsBySlugs,
  bumpUsage,
} from "./tags.ts";

const TEST_SLUG_PREFIX = "task11-test-";

beforeEach(async () => {
  await db.delete(tags).where(like(tags.slug, `${TEST_SLUG_PREFIX}%`));
});

afterAll(async () => {
  await db.delete(tags).where(like(tags.slug, `${TEST_SLUG_PREFIX}%`));
});

async function makeTag(label: string, usageCount = 0, name?: { zh?: string; en?: string }) {
  const slug = `${TEST_SLUG_PREFIX}${label}`;
  const [row] = await db
    .insert(tags)
    .values({ slug, name: name ?? { zh: slug, en: slug }, usageCount })
    .returning();
  return row!;
}

describe("searchTags", () => {
  it("returns top N test tags ordered by usageCount desc when q is the test prefix", async () => {
    // Use the prefix as the query so seed tags don't pollute results
    await makeTag("a", 5);
    await makeTag("b", 99);
    await makeTag("c", 30);
    const rows = await searchTags(TEST_SLUG_PREFIX, 2);
    // All three match the substring; top 2 by usageCount: b (99), c (30)
    expect(rows.map((r) => r.slug)).toEqual([
      `${TEST_SLUG_PREFIX}b`,
      `${TEST_SLUG_PREFIX}c`,
    ]);
  });

  it("filters by slug substring", async () => {
    await makeTag("portrait-male", 10);
    await makeTag("portrait-female", 30);
    await makeTag("landscape", 50);
    const rows = await searchTags(`${TEST_SLUG_PREFIX}portrait`, 10);
    expect(rows.map((r) => r.slug).sort()).toEqual([
      `${TEST_SLUG_PREFIX}portrait-female`,
      `${TEST_SLUG_PREFIX}portrait-male`,
    ]);
  });

  it("matches against bilingual name (zh)", async () => {
    await makeTag("nightcafe", 1, { zh: "夜咖啡", en: "Night Cafe" });
    const rows = await searchTags("夜", 10);
    expect(rows.map((r) => r.slug)).toContain(`${TEST_SLUG_PREFIX}nightcafe`);
  });

  it("respects the limit", async () => {
    for (let i = 0; i < 20; i++) {
      await makeTag(`t${i}`, i);
    }
    const rows = await searchTags(TEST_SLUG_PREFIX, 8);
    expect(rows).toHaveLength(8);
  });
});

describe("getTagsBySlugs", () => {
  it("returns a Map from slug → row for matching tags", async () => {
    await makeTag("a");
    await makeTag("b");
    const m = await getTagsBySlugs([
      `${TEST_SLUG_PREFIX}a`,
      `${TEST_SLUG_PREFIX}b`,
      `${TEST_SLUG_PREFIX}zzz`,
    ]);
    expect(m.size).toBe(2);
    expect(m.has(`${TEST_SLUG_PREFIX}a`)).toBe(true);
    expect(m.has(`${TEST_SLUG_PREFIX}b`)).toBe(true);
    expect(m.has(`${TEST_SLUG_PREFIX}zzz`)).toBe(false);
  });

  it("returns an empty Map for empty input", async () => {
    const m = await getTagsBySlugs([]);
    expect(m.size).toBe(0);
  });
});

describe("bumpUsage", () => {
  it("increments usageCount for each slug", async () => {
    const a = await makeTag("a", 0);
    const b = await makeTag("b", 10);
    const c = await makeTag("c", 5);
    await bumpUsage([
      `${TEST_SLUG_PREFIX}a`,
      `${TEST_SLUG_PREFIX}b`,
    ]);
    const rows = await db
      .select()
      .from(tags)
      .where(like(tags.slug, `${TEST_SLUG_PREFIX}%`));
    const map = Object.fromEntries(rows.map((r) => [r.slug, r.usageCount]));
    expect(map[`${TEST_SLUG_PREFIX}a`]).toBe(1);
    expect(map[`${TEST_SLUG_PREFIX}b`]).toBe(11);
    expect(map[`${TEST_SLUG_PREFIX}c`]).toBe(5);
  });

  it("noop for empty input", async () => {
    const t = await makeTag("a", 7);
    await bumpUsage([]);
    const [reread] = await db.select().from(tags).where(like(tags.slug, t.slug));
    expect(reread!.usageCount).toBe(7);
  });
});
