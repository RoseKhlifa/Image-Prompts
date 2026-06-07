import { describe, it, expect, afterAll, beforeEach } from "vitest";
import { eq, like } from "drizzle-orm";
import { db, pool } from "../db/client.ts";
import { users, sessions } from "../db/schema/auth.ts";
import { importTokens } from "../db/schema/system.ts";
import { createServer } from "../server.ts";
import { createTestSession } from "../auth/test-session.ts";

const app = createServer();

beforeEach(async () => {
  await db.delete(importTokens);
});

afterAll(async () => {
  await db.delete(importTokens);
  await db.delete(sessions);
  await db.delete(users).where(like(users.email, "test-%@example.com"));
  await pool.end();
});

describe("POST /api/import-tokens", () => {
  it("returns 401 when no session cookie", async () => {
    const res = await app.request("/api/import-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: { en: "hello" } }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 201 + token + expires_at with valid session", async () => {
    const sess = await createTestSession();
    const res = await app.request("/api/import-tokens", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sess.cookie,
      },
      body: JSON.stringify({ prompt: { en: "test prompt" } }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token).toMatch(/^[0-9A-Za-z]{8}$/);
    expect(body.expires_at).toBeDefined();

    const [row] = await db.select().from(importTokens).where(eq(importTokens.token, body.token));
    expect(row).toBeDefined();
    expect(row!.userId).toBe(sess.userId);
  });

  it("returns 400 when prompt is empty in both languages", async () => {
    const sess = await createTestSession();
    const res = await app.request("/api/import-tokens", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sess.cookie,
      },
      body: JSON.stringify({ prompt: { zh: "", en: "" } }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 413 when payload exceeds 4 KB", async () => {
    const sess = await createTestSession();
    const huge = "x".repeat(5000);
    const res = await app.request("/api/import-tokens", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sess.cookie,
      },
      body: JSON.stringify({ prompt: { en: huge } }),
    });
    expect(res.status).toBe(413);
  });
});

describe("GET /api/import-tokens/:token", () => {
  it("returns 200 + payload on first redeem (with UA)", async () => {
    const sess = await createTestSession();
    const postRes = await app.request("/api/import-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sess.cookie },
      body: JSON.stringify({ prompt: { en: "redeem me" } }),
    });
    const { token } = await postRes.json();

    const getRes = await app.request(`/api/import-tokens/${token}`, {
      headers: { Authorization: "Image-Studio/0.1.0" },
    });
    expect(getRes.status).toBe(200);
    const body = await getRes.json();
    expect(body.prompt).toEqual({ en: "redeem me" });
  });

  it("returns 200 even without UA header (soft-check)", async () => {
    const sess = await createTestSession();
    const postRes = await app.request("/api/import-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sess.cookie },
      body: JSON.stringify({ prompt: { en: "no UA" } }),
    });
    const { token } = await postRes.json();

    const getRes = await app.request(`/api/import-tokens/${token}`);
    expect(getRes.status).toBe(200);
  });

  it("returns 410 token_used on second redeem", async () => {
    const sess = await createTestSession();
    const postRes = await app.request("/api/import-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sess.cookie },
      body: JSON.stringify({ prompt: { en: "second redeem" } }),
    });
    const { token } = await postRes.json();

    await app.request(`/api/import-tokens/${token}`);
    const second = await app.request(`/api/import-tokens/${token}`);
    expect(second.status).toBe(410);
    const body = await second.json();
    expect(body.error).toBe("token_used");
  });

  it("returns 410 token_expired for past expires_at", async () => {
    const sess = await createTestSession();
    const expiredToken = "ZZ888777";
    await db.insert(importTokens).values({
      token: expiredToken,
      userId: sess.userId,
      payload: { prompt: { en: "expired" } },
      expiresAt: new Date(Date.now() - 1000),
    });
    const res = await app.request(`/api/import-tokens/${expiredToken}`);
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toBe("token_expired");
  });

  it("returns 404 token_not_found for unknown token", async () => {
    const res = await app.request(`/api/import-tokens/00000000`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("token_not_found");
  });
});
