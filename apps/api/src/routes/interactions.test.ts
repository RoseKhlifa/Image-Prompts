import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { like } from "drizzle-orm";
import { db, pool } from "../db/client.ts";
import { users, sessions } from "../db/schema/auth.ts";
import { likes, favorites, viewLog } from "../db/schema/interactions.ts";
import { prompts } from "../db/schema/prompts.ts";
import { createServer } from "../server.ts";
import { createTestSession } from "../auth/test-session.ts";

const app = createServer();

async function anyPromptId(): Promise<string> {
  const [row] = await db.select({ id: prompts.id }).from(prompts).limit(1);
  if (!row) throw new Error("seed missing");
  return row.id;
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
    await app.request(`/api/prompts/${id}/like`, { method: "POST", headers: { Cookie: sess.cookie } });
    const res = await app.request(`/api/prompts/${id}/like`, { method: "POST", headers: { Cookie: sess.cookie } });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("already_liked");
  });
});

describe("DELETE /api/prompts/:id/like", () => {
  it("returns 200 + liked:false after removing", async () => {
    const sess = await createTestSession();
    const id = await anyPromptId();
    await app.request(`/api/prompts/${id}/like`, { method: "POST", headers: { Cookie: sess.cookie } });
    const res = await app.request(`/api/prompts/${id}/like`, { method: "DELETE", headers: { Cookie: sess.cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.liked).toBe(false);
  });

  it("returns 404 like_not_found when not liked", async () => {
    const sess = await createTestSession();
    const id = await anyPromptId();
    const res = await app.request(`/api/prompts/${id}/like`, { method: "DELETE", headers: { Cookie: sess.cookie } });
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
    await app.request(`/api/prompts/${id}/favorite`, { method: "POST", headers: { Cookie: sess.cookie } });
    const res = await app.request(`/api/prompts/${id}/favorite`, { method: "DELETE", headers: { Cookie: sess.cookie } });
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
