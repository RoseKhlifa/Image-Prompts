import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { categories } from "../db/schema/taxonomy.ts";
import { assertNsfwTagInvariant } from "./nsfw.ts";

describe("assertNsfwTagInvariant", () => {
  let nsfwId: string;
  let sfwId: string;

  beforeAll(async () => {
    await db.execute(sql`
      INSERT INTO categories (slug, name, description, "order")
      VALUES ('nsfw', '{"zh":"敏感内容","en":"NSFW"}'::jsonb, '{}'::jsonb, 9999)
      ON CONFLICT (slug) DO NOTHING;
    `);
    await db.execute(sql`
      INSERT INTO categories (slug, name, description, "order")
      VALUES ('tw48r-sfw', '{"zh":"测试","en":"Test"}'::jsonb, '{}'::jsonb, 0)
      ON CONFLICT (slug) DO NOTHING;
    `);
    const rows = await db
      .select({ id: categories.id, slug: categories.slug })
      .from(categories)
      .where(inArray(categories.slug, ["nsfw", "tw48r-sfw"]));
    nsfwId = rows.find((r) => r.slug === "nsfw")!.id;
    sfwId = rows.find((r) => r.slug === "tw48r-sfw")!.id;
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM categories WHERE slug = 'tw48r-sfw';`);
  });

  it("permits a non-NSFW category with arbitrary tags", async () => {
    await expect(
      assertNsfwTagInvariant(db, sfwId, ["any", "tags"]),
    ).resolves.toBeUndefined();
  });

  it("permits NSFW category when tags is exactly ['nsfw']", async () => {
    await expect(
      assertNsfwTagInvariant(db, nsfwId, ["nsfw"]),
    ).resolves.toBeUndefined();
  });

  it("permits NSFW category when tags is ['NSFW'] (case-insensitive)", async () => {
    await expect(
      assertNsfwTagInvariant(db, nsfwId, ["NSFW"]),
    ).resolves.toBeUndefined();
  });

  it("rejects NSFW category with extra tags", async () => {
    await expect(
      assertNsfwTagInvariant(db, nsfwId, ["nsfw", "extra"]),
    ).rejects.toThrow("nsfw_category_tags_locked");
  });

  it("rejects NSFW category with no nsfw tag", async () => {
    await expect(
      assertNsfwTagInvariant(db, nsfwId, ["other"]),
    ).rejects.toThrow("nsfw_category_tags_locked");
  });

  it("rejects NSFW category with empty tag list", async () => {
    await expect(
      assertNsfwTagInvariant(db, nsfwId, []),
    ).rejects.toThrow("nsfw_category_tags_locked");
  });
});
