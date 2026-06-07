import { describe, it, expect, afterAll } from "vitest";
import { desc, eq, like } from "drizzle-orm";
import { db, pool } from "../db/client.ts";
import { users } from "../db/schema/auth.ts";
import { prompts } from "../db/schema/index.ts";
import { likes, favorites } from "../db/schema/interactions.ts";
import { listPrompts, getPromptBySlug } from "./prompts.ts";

async function ensureTestUser(email: string) {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing) return existing.id;
  const [row] = await db.insert(users).values({ email }).returning({ id: users.id });
  return row!.id;
}

async function latestPromptForTest() {
  // Use the prompt that listPrompts({ sort: "latest" }) would return first,
  // so our session-aware tests can find it on page 1.
  const [row] = await db
    .select({ id: prompts.id, slug: prompts.slug })
    .from(prompts)
    .orderBy(desc(prompts.approvedAt))
    .limit(1);
  if (!row) throw new Error("test fixture missing: run pnpm db:seed first");
  return row;
}

afterAll(async () => {
  // cleanup any leftover test users (CASCADE removes their likes/favorites)
  await db.delete(users).where(like(users.email, "prompts-session-test-%@example.com"));
  await pool.end();
});

describe("prompts repository (integration, requires seeded DB)", () => {
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

describe("listPrompts session-aware", () => {
  it("omits userLiked/userFavorited for anonymous queries", async () => {
    const result = await listPrompts({ sort: "latest", page: 1, pageSize: 24 });
    if (result.items.length > 0) {
      expect("userLiked" in result.items[0]!).toBe(false);
      expect("userFavorited" in result.items[0]!).toBe(false);
    }
  });

  it("returns userLiked:true on the prompts the user has liked", async () => {
    const userId = await ensureTestUser("prompts-session-test-1@example.com");
    const p = await latestPromptForTest();
    await db.insert(likes).values({ userId, promptId: p.id }).onConflictDoNothing();

    const result = await listPrompts({ sort: "latest", page: 1, pageSize: 24 }, userId);
    const item = result.items.find((i) => i.id === p.id);
    expect(item?.userLiked).toBe(true);
    expect(item?.userFavorited).toBe(false);

    await db.delete(likes).where(eq(likes.userId, userId));
  });
});

describe("getPromptBySlug session-aware", () => {
  it("omits userLiked/userFavorited for anonymous queries", async () => {
    const detail = await getPromptBySlug("cyberpunk-neon-cat");
    expect(detail).not.toBeNull();
    expect("userLiked" in detail!).toBe(false);
    expect("userFavorited" in detail!).toBe(false);
  });

  it("returns userFavorited:true when the user has favorited the prompt", async () => {
    const userId = await ensureTestUser("prompts-session-test-2@example.com");
    const p = await latestPromptForTest();
    await db.insert(favorites).values({ userId, promptId: p.id }).onConflictDoNothing();

    const detail = await getPromptBySlug(p.slug, userId);
    expect(detail?.userFavorited).toBe(true);
    expect(detail?.userLiked).toBe(false);

    await db.delete(favorites).where(eq(favorites.userId, userId));
  });
});
