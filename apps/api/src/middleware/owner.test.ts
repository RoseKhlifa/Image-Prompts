import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { requireOwner } from "./owner.ts";

function buildApp(authUser: unknown) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    (c as unknown as { set: (k: string, v: unknown) => void }).set("authUser", authUser);
    await next();
  });
  app.use("*", requireOwner());
  app.get("/", (c) => c.json({ ok: true }));
  return app;
}

describe("requireOwner middleware", () => {
  const origEnv = process.env.OWNER_EMAILS;
  beforeEach(() => {
    process.env.OWNER_EMAILS = "owner@example.com";
  });
  afterEach(() => {
    if (origEnv === undefined) {
      delete process.env.OWNER_EMAILS;
    } else {
      process.env.OWNER_EMAILS = origEnv;
    }
  });

  it("403 when no session", async () => {
    const app = buildApp(null);
    const res = await app.request("/");
    expect(res.status).toBe(403);
  });

  it("403 when role is user", async () => {
    const app = buildApp({
      session: { user: { role: "user", email: "owner@example.com" } },
    });
    const res = await app.request("/");
    expect(res.status).toBe(403);
  });

  it("403 when role is moderator", async () => {
    const app = buildApp({
      session: { user: { role: "moderator", email: "owner@example.com" } },
    });
    const res = await app.request("/");
    expect(res.status).toBe(403);
  });

  it("403 when role is admin but email not in OWNER_EMAILS", async () => {
    const app = buildApp({
      session: { user: { role: "admin", email: "notowner@example.com" } },
    });
    const res = await app.request("/");
    expect(res.status).toBe(403);
  });

  it("200 when role is admin and email in OWNER_EMAILS", async () => {
    const app = buildApp({
      session: { user: { role: "admin", email: "owner@example.com" } },
    });
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("matches email case-insensitively", async () => {
    const app = buildApp({
      session: { user: { role: "admin", email: "OWNER@example.com" } },
    });
    const res = await app.request("/");
    expect(res.status).toBe(200);
  });
});
