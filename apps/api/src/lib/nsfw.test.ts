import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { categories } from "../db/schema/taxonomy.ts";
import { ensureNsfwTag } from "./nsfw.ts";

describe("ensureNsfwTag", () => {
  let nsfwId: string;
  let sfwId: string;

  beforeAll(async () => {
    await db.execute(sql`
      INSERT INTO categories (slug, name, description, "order")
      VALUES ('nsfw', '{"zh":"NSFW","en":"NSFW"}'::jsonb, '{}'::jsonb, 9999)
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

  it("returns input unchanged for a non-NSFW category", async () => {
    const result = await ensureNsfwTag(db, sfwId, ["any", "tags"]);
    expect(result).toEqual(["any", "tags"]);
  });

  it("returns input unchanged when nsfw is already present (exact)", async () => {
    const result = await ensureNsfwTag(db, nsfwId, ["nsfw"]);
    expect(result).toEqual(["nsfw"]);
  });

  it("returns input unchanged when NSFW (uppercase) is present", async () => {
    const result = await ensureNsfwTag(db, nsfwId, ["NSFW"]);
    expect(result).toEqual(["NSFW"]);
  });

  it("preserves additional tags alongside the nsfw marker", async () => {
    const result = await ensureNsfwTag(db, nsfwId, ["nsfw", "二次元", "真人"]);
    expect(result).toEqual(["nsfw", "二次元", "真人"]);
  });

  it("appends nsfw when missing in an NSFW prompt's tag list", async () => {
    const result = await ensureNsfwTag(db, nsfwId, ["二次元", "猎奇"]);
    expect(result).toEqual(["二次元", "猎奇", "nsfw"]);
  });

  it("appends nsfw when tag list is empty for an NSFW prompt", async () => {
    const result = await ensureNsfwTag(db, nsfwId, []);
    expect(result).toEqual(["nsfw"]);
  });
});
