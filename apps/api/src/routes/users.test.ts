import { describe, it, expect, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db, pool } from "../db/client.ts";
import { users, sessions } from "../db/schema/auth.ts";
import { userPinnedPrompts } from "../db/schema/index.ts";
import { createServer } from "../server.ts";
import { createTestSession } from "../auth/test-session.ts";

const app = createServer();
const PREFIX = "users-route-test-";

afterAll(async () => {
  // Find test users, cascade-clean sessions then users.
  const ids = (
    await db.select({ id: users.id }).from(users).where(like(users.email, `${PREFIX}%`))
  ).map((r) => r.id);
  if (ids.length > 0) {
    for (const id of ids) {
      await db.delete(userPinnedPrompts).where(eq(userPinnedPrompts.userId, id));
      await db.delete(sessions).where(eq(sessions.userId, id));
    }
  }
  await db.delete(users).where(like(users.email, `${PREFIX}%`));
  await pool.end();
});

async function makeUser(label: string) {
  const email = `${PREFIX}${label}@example.com`;
  const [u] = await db
    .insert(users)
    .values({ email, name: `Name-${label}` })
    .returning();
  return u!;
}

/**
 * Make a session bound to a user we already inserted. We can't pass the userId
 * directly to createTestSession (it looks up by email), but createTestSession's
 * upsert-by-email behavior means passing the same email re-uses our user row.
 */
async function sessionFor(user: { id: string; email: string }) {
  const session = await createTestSession({ email: user.email });
  // Sanity: shouldn't drift, but assert anyway since the rest of the test relies on it
  if (session.userId !== user.id) {
    throw new Error(
      `sessionFor: session.userId ${session.userId} != user.id ${user.id}`,
    );
  }
  return session;
}

describe("GET /api/users/:id", () => {
  it("returns public user info (no email)", async () => {
    const u = await makeUser("get1");
    const res = await app.request(`/api/users/${u.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(u.id);
    expect(body.email).toBeUndefined();
  });
  it("returns 404 for unknown id", async () => {
    const res = await app.request(`/api/users/00000000-0000-0000-0000-000000000000`);
    expect(res.status).toBe(404);
  });
  // M11 profile-enrich: getUserPublic now surfaces bio + socialLinks +
  // pinnedPrompts in the response shape. These two tests assert the keys
  // are present (frontend-facing contract) and default to null/empty.
  it("includes bio + socialLinks + pinnedPrompts keys with defaults", async () => {
    const u = await makeUser("get-enrich");
    const res = await app.request(`/api/users/${u.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bio).toBeNull();
    expect(body.socialLinks).toBeNull();
    expect(body.pinnedPrompts).toEqual([]);
  });
  it("surfaces bio + socialLinks when set on the user row", async () => {
    const u = await makeUser("get-enrich-set");
    await db
      .update(users)
      .set({
        bio: { en: "hi en" },
        socialLinks: { github: "https://github.com/y" },
      })
      .where(eq(users.id, u.id));
    const res = await app.request(`/api/users/${u.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bio).toEqual({ en: "hi en" });
    expect(body.socialLinks).toEqual({ github: "https://github.com/y" });
  });
});

describe("GET /api/users/:id/stats", () => {
  it("returns stats object", async () => {
    const u = await makeUser("stats1");
    const res = await app.request(`/api/users/${u.id}/stats`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      publishedCount: expect.any(Number),
      totalViews: expect.any(Number),
      totalLikes: expect.any(Number),
      totalFavorites: expect.any(Number),
    });
  });
});

describe("GET /api/users/:id/prompts", () => {
  it("returns items array (empty for fresh user)", async () => {
    const u = await makeUser("prompts1");
    const res = await app.request(`/api/users/${u.id}/prompts`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });
});

describe("GET /api/users/:id/favorites", () => {
  it("returns 401 for anonymous", async () => {
    const u = await makeUser("fav-anon");
    const res = await app.request(`/api/users/${u.id}/favorites`);
    expect(res.status).toBe(401);
  });
  it("returns 403 when caller is not the same user", async () => {
    const owner = await makeUser("fav-owner");
    const other = await makeUser("fav-other");
    const session = await sessionFor(other);
    const res = await app.request(`/api/users/${owner.id}/favorites`, {
      headers: { Cookie: session.cookie },
    });
    expect(res.status).toBe(403);
  });
  it("returns favorites for the owner", async () => {
    const u = await makeUser("fav-self");
    const session = await sessionFor(u);
    const res = await app.request(`/api/users/${u.id}/favorites`, {
      headers: { Cookie: session.cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toBeDefined();
  });
});
