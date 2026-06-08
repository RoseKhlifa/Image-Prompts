import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, pool } from "../db/client.ts";
import { users, sessions } from "../db/schema/auth.ts";
import { likes, favorites, viewLog } from "../db/schema/interactions.ts";
import { prompts } from "../db/schema/prompts.ts";
import { notifications } from "../db/schema/notifications.ts";
import { createServer } from "../server.ts";
import { createTestSession } from "../auth/test-session.ts";

const app = createServer();

async function anyPromptId(): Promise<string> {
  const [row] = await db.select({ id: prompts.id }).from(prompts).limit(1);
  if (!row) throw new Error("seed missing");
  return row.id;
}

async function makeUser(input?: { name?: string }) {
  const email = `test-${randomUUID()}@example.com`;
  const [u] = await db
    .insert(users)
    .values({ email, name: input?.name ?? "Test User" })
    .returning();
  return u!;
}

// Borrow an existing seeded prompt's category so we don't need to seed one.
async function createTestPrompt(opts: { contributorId: string | null }): Promise<string> {
  const [seed] = await db.select({ categoryId: prompts.categoryId }).from(prompts).limit(1);
  if (!seed) throw new Error("seed missing");
  const slug = `interactions-test-${randomUUID()}`;
  const [row] = await db
    .insert(prompts)
    .values({
      slug,
      title: { zh: "测试", en: "Test" },
      prompt: { zh: "提示", en: "Prompt" },
      categoryId: seed.categoryId,
      contributorId: opts.contributorId,
    })
    .returning({ id: prompts.id });
  return row!.id;
}

async function cleanupTestPrompts() {
  await db.delete(prompts).where(like(prompts.slug, "interactions-test-%"));
}

beforeEach(async () => {
  await db.delete(viewLog);
  await db.delete(likes);
  await db.delete(favorites);
  // Notifications cascade-delete with the user, but we clear here for safety
  // across tests that share users with other suites.
  const testUserIds = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, "test-%@example.com"));
  if (testUserIds.length > 0) {
    await db.delete(notifications).where(
      inArray(
        notifications.userId,
        testUserIds.map((u) => u.id),
      ),
    );
  }
  await cleanupTestPrompts();
});

afterAll(async () => {
  await db.delete(viewLog);
  await db.delete(likes);
  await db.delete(favorites);
  await cleanupTestPrompts();
  await db.delete(sessions);
  await db.delete(users).where(like(users.email, "test-%@example.com"));
  await pool.end();
});

describe("POST /api/prompts/:id/like", () => {
  it("returns 401 when no session", async () => {
    const id = await anyPromptId();
    const res = await app.request(`/api/prompts/${id}/like`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("returns 400 when id is not a UUID", async () => {
    const sess = await createTestSession();
    const res = await app.request("/api/prompts/not-a-uuid/like", {
      method: "POST",
      headers: { Cookie: sess.cookie },
    });
    expect(res.status).toBe(400);
  });

  it("returns 201 + liked:true + like_count on first like", async () => {
    const sess = await createTestSession();
    const id = await anyPromptId();
    const res = await app.request(`/api/prompts/${id}/like`, {
      method: "POST",
      headers: { Cookie: sess.cookie },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.liked).toBe(true);
    expect(typeof body.like_count).toBe("number");
  });

  it("returns 409 already_liked on double-like", async () => {
    const sess = await createTestSession();
    const id = await anyPromptId();
    await app.request(`/api/prompts/${id}/like`, {
      method: "POST",
      headers: { Cookie: sess.cookie },
    });
    const res = await app.request(`/api/prompts/${id}/like`, {
      method: "POST",
      headers: { Cookie: sess.cookie },
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("already_liked");
  });
});

describe("DELETE /api/prompts/:id/like", () => {
  it("returns 200 + liked:false after removing", async () => {
    const sess = await createTestSession();
    const id = await anyPromptId();
    await app.request(`/api/prompts/${id}/like`, {
      method: "POST",
      headers: { Cookie: sess.cookie },
    });
    const res = await app.request(`/api/prompts/${id}/like`, {
      method: "DELETE",
      headers: { Cookie: sess.cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.liked).toBe(false);
  });

  it("returns 404 like_not_found when not liked", async () => {
    const sess = await createTestSession();
    const id = await anyPromptId();
    const res = await app.request(`/api/prompts/${id}/like`, {
      method: "DELETE",
      headers: { Cookie: sess.cookie },
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("like_not_found");
  });
});

describe("POST /api/prompts/:id/favorite", () => {
  it("returns 201 + favorited:true on first favorite", async () => {
    const sess = await createTestSession();
    const id = await anyPromptId();
    const res = await app.request(`/api/prompts/${id}/favorite`, {
      method: "POST",
      headers: { Cookie: sess.cookie },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.favorited).toBe(true);
  });
});

describe("DELETE /api/prompts/:id/favorite", () => {
  it("returns favorited:false after removing", async () => {
    const sess = await createTestSession();
    const id = await anyPromptId();
    await app.request(`/api/prompts/${id}/favorite`, {
      method: "POST",
      headers: { Cookie: sess.cookie },
    });
    const res = await app.request(`/api/prompts/${id}/favorite`, {
      method: "DELETE",
      headers: { Cookie: sess.cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.favorited).toBe(false);
  });
});

describe("POST /api/prompts/:id/view", () => {
  it("returns 200 recorded:true for a fresh anonymous visit with XFF", async () => {
    const id = await anyPromptId();
    const res = await app.request(`/api/prompts/${id}/view`, {
      method: "POST",
      headers: { "X-Forwarded-For": "203.0.113.99" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recorded).toBe(true);
  });

  it("returns recorded:false on second visit from same IP same day", async () => {
    const id = await anyPromptId();
    const headers = { "X-Forwarded-For": "203.0.113.42" };
    await app.request(`/api/prompts/${id}/view`, { method: "POST", headers });
    const second = await app.request(`/api/prompts/${id}/view`, { method: "POST", headers });
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body.recorded).toBe(false);
  });

  it("returns recorded:false but does not error when no IP and no session", async () => {
    const id = await anyPromptId();
    const res = await app.request(`/api/prompts/${id}/view`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recorded).toBe(false);
  });

  it("records as logged-in user (not IP-based) when session is present", async () => {
    const sess = await createTestSession();
    const id = await anyPromptId();
    // First call from this user with no IP at all → must succeed via user_id
    const first = await app.request(`/api/prompts/${id}/view`, {
      method: "POST",
      headers: { Cookie: sess.cookie },
    });
    expect(first.status).toBe(200);
    const firstBody = await first.json();
    expect(firstBody.recorded).toBe(true);

    // Second call same user same day → dedup via user_id (no IP needed)
    const second = await app.request(`/api/prompts/${id}/view`, {
      method: "POST",
      headers: { Cookie: sess.cookie },
    });
    expect(second.status).toBe(200);
    const secondBody = await second.json();
    expect(secondBody.recorded).toBe(false);
  });
});

describe("POST /api/prompts/:id/like — notification side effect", () => {
  it("creates a notification for the prompt contributor on first like (different user)", async () => {
    const contributor = await makeUser();
    const promptId = await createTestPrompt({ contributorId: contributor.id });
    const actor = await makeUser({ name: "ActorName" });
    const session = await createTestSession({ email: actor.email });

    const res = await app.request(`/api/prompts/${promptId}/like`, {
      method: "POST",
      headers: { Cookie: session.cookie },
    });
    expect(res.status).toBe(201);

    const notifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, contributor.id));
    expect(notifs).toHaveLength(1);
    expect(notifs[0]!.type).toBe("prompt_liked");
    expect(notifs[0]!.aggregatedCount).toBe(1);
    expect((notifs[0]!.payload as { lastActorName: string }).lastActorName).toBe("ActorName");
  });

  it("does NOT create a notification when actor === contributor (liking own prompt)", async () => {
    const me = await makeUser();
    const promptId = await createTestPrompt({ contributorId: me.id });
    const session = await createTestSession({ email: me.email });

    const res = await app.request(`/api/prompts/${promptId}/like`, {
      method: "POST",
      headers: { Cookie: session.cookie },
    });
    expect(res.status).toBe(201);

    const notifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, me.id));
    expect(notifs).toHaveLength(0);
  });

  it("does NOT create a notification when prompt has no contributor (seeded source)", async () => {
    const promptId = await createTestPrompt({ contributorId: null });
    const actor = await makeUser({ name: "Solo" });
    const session = await createTestSession({ email: actor.email });

    const res = await app.request(`/api/prompts/${promptId}/like`, {
      method: "POST",
      headers: { Cookie: session.cookie },
    });
    expect(res.status).toBe(201);

    // No notifications anywhere (actor is the only test user we touched)
    const notifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, actor.id));
    expect(notifs).toHaveLength(0);
  });
});

describe("POST /api/prompts/:id/favorite — notification side effect", () => {
  it("creates a prompt_favorited notification for the contributor", async () => {
    const contributor = await makeUser();
    const promptId = await createTestPrompt({ contributorId: contributor.id });
    const actor = await makeUser({ name: "FavActor" });
    const session = await createTestSession({ email: actor.email });

    const res = await app.request(`/api/prompts/${promptId}/favorite`, {
      method: "POST",
      headers: { Cookie: session.cookie },
    });
    expect(res.status).toBe(201);

    const notifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, contributor.id));
    expect(notifs).toHaveLength(1);
    expect(notifs[0]!.type).toBe("prompt_favorited");
    expect(notifs[0]!.aggregatedCount).toBe(1);
    expect((notifs[0]!.payload as { lastActorName: string }).lastActorName).toBe("FavActor");
  });

  it("does NOT create a notification when actor === contributor (favoriting own prompt)", async () => {
    const me = await makeUser();
    const promptId = await createTestPrompt({ contributorId: me.id });
    const session = await createTestSession({ email: me.email });

    const res = await app.request(`/api/prompts/${promptId}/favorite`, {
      method: "POST",
      headers: { Cookie: session.cookie },
    });
    expect(res.status).toBe(201);

    const notifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, me.id));
    expect(notifs).toHaveLength(0);
  });
});
