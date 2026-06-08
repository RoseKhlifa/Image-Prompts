import { describe, it, expect, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db, pool } from "../db/client.ts";
import { users } from "../db/schema/auth.ts";
import { prompts, promptImages } from "../db/schema/index.ts";
import {
  getUserPublic,
  getUserStats,
  listUserPrompts,
  listUserFavorites,
} from "./users-public.ts";

const PREFIX = "users-public-test-";

afterAll(async () => {
  // Clean test users + cascade their data
  const ids = (
    await db.select({ id: users.id }).from(users).where(like(users.email, `${PREFIX}%`))
  ).map((r) => r.id);
  // delete prompts contributed by test users first (FK)
  for (const uid of ids) {
    const ps = (
      await db.select({ id: prompts.id }).from(prompts).where(eq(prompts.contributorId, uid))
    ).map((p) => p.id);
    for (const pid of ps) {
      await db.delete(promptImages).where(eq(promptImages.promptId, pid));
      await db.delete(prompts).where(eq(prompts.id, pid));
    }
  }
  await db.delete(users).where(like(users.email, `${PREFIX}%`));
  await pool.end();
});

async function makeUser(label: string) {
  const [u] = await db
    .insert(users)
    .values({
      email: `${PREFIX}${label}@example.com`,
      name: `Name-${label}`,
      image: null,
    })
    .returning();
  return u!;
}

describe("getUserPublic", () => {
  it("returns id/name/image/role/joinedAt without email", async () => {
    const u = await makeUser("get1");
    const got = await getUserPublic(u.id);
    expect(got).not.toBeNull();
    expect(got!.id).toBe(u.id);
    expect(got!.name).toBe(`Name-get1`);
    expect(got!.role).toBe("user");
    expect("email" in got!).toBe(false);
  });
  it("returns null for unknown id", async () => {
    const got = await getUserPublic("00000000-0000-0000-0000-000000000000");
    expect(got).toBeNull();
  });
});

describe("getUserStats", () => {
  it("counts published prompts + sums view/like/favorite counters", async () => {
    const u = await makeUser("stats1");
    const stats = await getUserStats(u.id);
    expect(stats).toEqual({
      publishedCount: 0,
      totalViews: 0,
      totalLikes: 0,
      totalFavorites: 0,
    });
  });
});

describe("listUserPrompts", () => {
  it("returns only this user's published prompts ordered newest first", async () => {
    const u = await makeUser("list1");
    const r = await listUserPrompts(u.id, { cursor: null, limit: 10 });
    expect(r.items).toEqual([]);
    expect(r.nextCursor).toBeNull();
  });
});

describe("listUserFavorites", () => {
  it("returns empty for a user with no favorites", async () => {
    const u = await makeUser("fav1");
    const r = await listUserFavorites(u.id, { cursor: null, limit: 10 });
    expect(r.items).toEqual([]);
    expect(r.nextCursor).toBeNull();
  });
});
