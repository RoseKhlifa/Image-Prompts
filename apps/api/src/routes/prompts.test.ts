import { describe, it, expect, afterAll } from "vitest";
import { like } from "drizzle-orm";
import { db, pool } from "../db/client.ts";
import { users, sessions } from "../db/schema/auth.ts";
import { likes } from "../db/schema/interactions.ts";
import { prompts } from "../db/schema/prompts.ts";
import { createServer } from "../server.ts";
import { createTestSession } from "../auth/test-session.ts";

const app = createServer();

afterAll(async () => {
  await db.delete(likes);
  await db.delete(sessions);
  await db.delete(users).where(like(users.email, "test-%@example.com"));
  await pool.end();
});

describe("GET /api/prompts/:slug session-aware", () => {
  it("omits userLiked/userFavorited when unauthenticated", async () => {
    const [row] = await db.select({ slug: prompts.slug }).from(prompts).limit(1);
    const res = await app.request(`/api/prompts/${row!.slug}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect("userLiked" in body).toBe(false);
    expect("userFavorited" in body).toBe(false);
  });

  it("returns userLiked:true after the session user has liked the prompt", async () => {
    const sess = await createTestSession();
    const [row] = await db.select({ id: prompts.id, slug: prompts.slug }).from(prompts).limit(1);
    await db.insert(likes).values({ userId: sess.userId, promptId: row!.id }).onConflictDoNothing();

    const res = await app.request(`/api/prompts/${row!.slug}`, {
      headers: { Cookie: sess.cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userLiked).toBe(true);
    expect(body.userFavorited).toBe(false);

    await db.delete(likes);
  });
});
