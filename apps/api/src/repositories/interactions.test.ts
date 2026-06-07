import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db, pool } from "../db/client.ts";
import { users } from "../db/schema/auth.ts";
import { prompts } from "../db/schema/index.ts";
import { likes, favorites, viewLog } from "../db/schema/interactions.ts";
import {
  toggleLike,
  toggleFavorite,
  recordView,
  listMyFavorites,
  AlreadyExistsError,
  NotFoundError,
} from "./interactions.ts";

async function ensureTestUser(email: string) {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing) return existing.id;
  const [row] = await db.insert(users).values({ email }).returning({ id: users.id });
  return row!.id;
}

async function anyPrompt() {
  const [row] = await db
    .select({
      id: prompts.id,
      likeCount: prompts.likeCount,
      favoriteCount: prompts.favoriteCount,
      viewCount: prompts.viewCount,
    })
    .from(prompts)
    .limit(1);
  if (!row) throw new Error("test fixture missing: run pnpm db:seed first");
  return row;
}

beforeEach(async () => {
  await db.delete(viewLog);
  await db.delete(likes);
  await db.delete(favorites);
});

afterAll(async () => {
  await db.delete(viewLog);
  await db.delete(likes);
  await db.delete(favorites);
  await db.delete(users).where(like(users.email, "interactions-test-%@example.com"));
  await pool.end();
});

describe("toggleLike", () => {
  it("inserts a like row and increments like_count atomically", async () => {
    const userId = await ensureTestUser("interactions-test-1@example.com");
    const p = await anyPrompt();
    const result = await toggleLike(userId, p.id, "add");
    expect(result.like_count).toBe(p.likeCount + 1);

    const [row] = await db.select().from(likes).where(eq(likes.userId, userId));
    expect(row).toBeDefined();
  });

  it("throws AlreadyExistsError on double-add", async () => {
    const userId = await ensureTestUser("interactions-test-2@example.com");
    const p = await anyPrompt();
    await toggleLike(userId, p.id, "add");
    await expect(toggleLike(userId, p.id, "add")).rejects.toBeInstanceOf(AlreadyExistsError);
  });

  it("removes a like row and decrements like_count", async () => {
    const userId = await ensureTestUser("interactions-test-3@example.com");
    const p = await anyPrompt();
    await toggleLike(userId, p.id, "add");
    const result = await toggleLike(userId, p.id, "remove");
    expect(result.like_count).toBe(p.likeCount);
  });

  it("throws NotFoundError on remove when not liked", async () => {
    const userId = await ensureTestUser("interactions-test-4@example.com");
    const p = await anyPrompt();
    await expect(toggleLike(userId, p.id, "remove")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("toggleFavorite", () => {
  it("inserts and increments", async () => {
    const userId = await ensureTestUser("interactions-test-5@example.com");
    const p = await anyPrompt();
    const result = await toggleFavorite(userId, p.id, "add");
    expect(result.favorite_count).toBe(p.favoriteCount + 1);
  });

  it("throws AlreadyExistsError on double-add", async () => {
    const userId = await ensureTestUser("interactions-test-6@example.com");
    const p = await anyPrompt();
    await toggleFavorite(userId, p.id, "add");
    await expect(toggleFavorite(userId, p.id, "add")).rejects.toBeInstanceOf(AlreadyExistsError);
  });

  it("throws NotFoundError on remove when not favorited", async () => {
    const userId = await ensureTestUser("interactions-test-7@example.com");
    const p = await anyPrompt();
    await expect(toggleFavorite(userId, p.id, "remove")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("recordView", () => {
  it("records a view and increments view_count on first sight", async () => {
    const userId = await ensureTestUser("interactions-test-8@example.com");
    const p = await anyPrompt();
    const result = await recordView({ promptId: p.id, userId, ipHash: null });
    expect(result.recorded).toBe(true);

    const [after] = await db
      .select({ viewCount: prompts.viewCount })
      .from(prompts)
      .where(eq(prompts.id, p.id));
    expect(after!.viewCount).toBe(p.viewCount + 1);
  });

  it("dedups repeat views from the same user on the same day", async () => {
    const userId = await ensureTestUser("interactions-test-9@example.com");
    const p = await anyPrompt();
    await recordView({ promptId: p.id, userId, ipHash: null });
    const second = await recordView({ promptId: p.id, userId, ipHash: null });
    expect(second.recorded).toBe(false);
  });

  it("treats guest (ipHash only) and user as separate buckets", async () => {
    const userId = await ensureTestUser("interactions-test-10@example.com");
    const p = await anyPrompt();
    const a = await recordView({ promptId: p.id, userId: null, ipHash: "abc1234567890def" });
    const b = await recordView({ promptId: p.id, userId, ipHash: null });
    expect(a.recorded).toBe(true);
    expect(b.recorded).toBe(true);
  });

  it("returns recorded:false when both userId and ipHash are null", async () => {
    const p = await anyPrompt();
    const result = await recordView({ promptId: p.id, userId: null, ipHash: null });
    expect(result.recorded).toBe(false);
  });
});

describe("listMyFavorites", () => {
  it("returns paginated favorites ordered by favorited-at desc", async () => {
    const userId = await ensureTestUser("interactions-test-11@example.com");
    const rows = await db.select({ id: prompts.id }).from(prompts).limit(3);
    for (const r of rows) await toggleFavorite(userId, r.id, "add");

    const result = await listMyFavorites(userId, 1, 10);
    expect(result.total).toBe(3);
    expect(result.items.length).toBe(3);
    for (const item of result.items) {
      expect(item.userFavorited).toBe(true);
    }
  });

  it("returns empty page when user has no favorites", async () => {
    const userId = await ensureTestUser("interactions-test-12@example.com");
    const result = await listMyFavorites(userId, 1, 10);
    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
  });
});
