import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Hono } from "hono";
import { like, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { users } from "../db/schema/index.ts";
import { errorHandler } from "./error.ts";
import { banCheck } from "./ban-check.ts";

const TEST_EMAIL_PREFIX = "ban-check-mw-";

async function cleanup() {
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%@example.com`));
}

beforeEach(cleanup);
afterAll(cleanup);

let counter = 0;

async function makeUser(opts?: { banned?: boolean; reason?: string }) {
  counter += 1;
  const [row] = await db
    .insert(users)
    .values({
      email: `${TEST_EMAIL_PREFIX}${counter}@example.com`,
      name: `name-${counter}`,
      bannedAt: opts?.banned ? sql`now()` : null,
      bannedReason: opts?.banned ? (opts.reason ?? "test ban") : null,
    })
    .returning();
  return row!;
}

/**
 * Build a minimal Hono app with banCheck() installed. The shim middleware
 * stamps `authUser` onto the context the same shape softAuth() would produce,
 * so we can test banCheck in isolation without standing up the full
 * @hono/auth-js stack.
 */
function buildApp(authUser: unknown) {
  const app = new Hono();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    if (authUser !== undefined) {
      (c as unknown as { set: (k: string, v: unknown) => void }).set(
        "authUser",
        authUser,
      );
    }
    await next();
  });
  app.use("*", banCheck());
  app.get("/probe", (c) => c.json({ ok: true }));
  return app;
}

describe("banCheck middleware", () => {
  it("403 with banned message for a banned user", async () => {
    const u = await makeUser({ banned: true, reason: "spam" });
    const app = buildApp({ session: { user: { id: u.id } } });
    const res = await app.request("/probe");
    expect(res.status).toBe(403);
    const j = (await res.json()) as { error: string; message: string };
    expect(j.message).toBe("banned");
  });

  it("passes through for a non-banned signed-in user", async () => {
    const u = await makeUser({ banned: false });
    const app = buildApp({ session: { user: { id: u.id } } });
    const res = await app.request("/probe");
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok: boolean };
    expect(j.ok).toBe(true);
  });

  it("passes through anonymous (no authUser at all)", async () => {
    const app = buildApp(undefined);
    const res = await app.request("/probe");
    expect(res.status).toBe(200);
  });

  it("passes through when authUser is null", async () => {
    const app = buildApp(null);
    const res = await app.request("/probe");
    expect(res.status).toBe(200);
  });

  it("passes through when session has no user id (malformed session)", async () => {
    const app = buildApp({ session: {} });
    const res = await app.request("/probe");
    expect(res.status).toBe(200);
  });

  it("passes through when the user id does not exist in the DB", async () => {
    // No DB row → no banned_at to find → pass through.
    const app = buildApp({
      session: { user: { id: "00000000-0000-0000-0000-000000000000" } },
    });
    const res = await app.request("/probe");
    expect(res.status).toBe(200);
  });
});
