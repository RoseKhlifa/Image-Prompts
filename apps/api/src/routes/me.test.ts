import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { like } from "drizzle-orm";
import { db, pool } from "../db/client.ts";
import { users, sessions } from "../db/schema/auth.ts";
import { favorites } from "../db/schema/interactions.ts";
import { prompts } from "../db/schema/prompts.ts";
import { createServer } from "../server.ts";
import { createTestSession } from "../auth/test-session.ts";

const app = createServer();

beforeEach(async () => {
  await db.delete(favorites);
});

afterAll(async () => {
  await db.delete(favorites);
  await db.delete(sessions);
  await db.delete(users).where(like(users.email, "test-%@example.com"));
  await pool.end();
});

describe("GET /api/me/favorites", () => {
  it("returns 401 when not logged in", async () => {
    const res = await app.request("/api/me/favorites");
    expect(res.status).toBe(401);
  });

  it("returns empty list for a user with no favorites", async () => {
    const sess = await createTestSession();
    const res = await app.request("/api/me/favorites", { headers: { Cookie: sess.cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });

  it("returns favorited prompts with userFavorited:true", async () => {
    const sess = await createTestSession();
    const [p] = await db.select({ id: prompts.id }).from(prompts).limit(1);
    await db.insert(favorites).values({ userId: sess.userId, promptId: p!.id });

    const res = await app.request("/api/me/favorites", { headers: { Cookie: sess.cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].userFavorited).toBe(true);
  });

  it("respects page/pageSize", async () => {
    const sess = await createTestSession();
    const rows = await db.select({ id: prompts.id }).from(prompts).limit(5);
    for (const r of rows) {
      await db.insert(favorites).values({ userId: sess.userId, promptId: r.id });
    }

    const res = await app.request("/api/me/favorites?page=1&pageSize=2", { headers: { Cookie: sess.cookie } });
    const body = await res.json();
    expect(body.items.length).toBe(2);
    expect(body.pageSize).toBe(2);
    expect(body.hasMore).toBe(true);
  });
});
