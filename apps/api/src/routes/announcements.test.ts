import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { inArray, like, sql } from "drizzle-orm";
import { createServer } from "../server.ts";
import { db } from "../db/client.ts";
import { users, announcements, auditLog } from "../db/schema/index.ts";
import { createAnnouncement, softDeleteAnnouncement } from "../repositories/announcements.ts";

const TEST_EMAIL_PREFIX = "announce-public-route-test-";
const TEST_TITLE_MARKER = "[announce-public-route-test]";

async function cleanup() {
  const annIds = (
    await db
      .select({ id: announcements.id })
      .from(announcements)
      .where(
        sql`${announcements.title}->>'en' LIKE ${"%" + TEST_TITLE_MARKER + "%"}`,
      )
  ).map((r) => r.id);
  if (annIds.length > 0) {
    await db.delete(auditLog).where(inArray(auditLog.targetId, annIds));
    await db.delete(announcements).where(inArray(announcements.id, annIds));
  }
  const testUserIds = (
    await db
      .select({ id: users.id })
      .from(users)
      .where(like(users.email, `${TEST_EMAIL_PREFIX}%@example.com`))
  ).map((u) => u.id);
  if (testUserIds.length > 0) {
    await db.delete(auditLog).where(inArray(auditLog.actorId, testUserIds));
    await db
      .delete(users)
      .where(like(users.email, `${TEST_EMAIL_PREFIX}%@example.com`));
  }
}

const app = createServer();

beforeEach(cleanup);
afterAll(cleanup);

let counter = 0;
async function makeUser() {
  counter += 1;
  const [u] = await db
    .insert(users)
    .values({
      email: `${TEST_EMAIL_PREFIX}${counter}-${Date.now()}@example.com`,
      role: "admin",
    })
    .returning();
  return u!;
}

describe("GET /api/announcements (public)", () => {
  it("returns { items } of active rows only — anon visitor succeeds", async () => {
    const u = await makeUser();
    const now = Date.now();
    const active = await createAnnouncement({
      title: { en: `Active ${TEST_TITLE_MARKER}` },
      body: { en: "active body" },
      severity: "info",
      startsAt: new Date(now - 1000 * 60 * 60),
      createdBy: u.id,
    });
    // future: must NOT appear
    const future = await createAnnouncement({
      title: { en: `Future ${TEST_TITLE_MARKER}` },
      body: { en: "future" },
      severity: "info",
      startsAt: new Date(now + 1000 * 60 * 60 * 24),
      createdBy: u.id,
    });
    // expired: must NOT appear
    const expired = await createAnnouncement({
      title: { en: `Expired ${TEST_TITLE_MARKER}` },
      body: { en: "expired" },
      severity: "info",
      startsAt: new Date(now - 1000 * 60 * 60 * 2),
      endsAt: new Date(now - 1000 * 60 * 60),
      createdBy: u.id,
    });
    // deleted: must NOT appear
    const deleted = await createAnnouncement({
      title: { en: `Deleted ${TEST_TITLE_MARKER}` },
      body: { en: "deleted" },
      severity: "info",
      startsAt: new Date(now - 1000 * 60 * 60),
      createdBy: u.id,
    });
    await softDeleteAnnouncement(deleted.id, u.id);

    // Anonymous request — no Cookie header. Route must NOT be behind banCheck
    // or any auth gate, so this returns 200.
    const res = await app.request("/api/announcements");
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      items: Array<{ id: string; title: { en?: string }; severity: string }>;
    };
    expect(Array.isArray(j.items)).toBe(true);
    const ours = j.items.filter((r) =>
      (r.title.en ?? "").includes(TEST_TITLE_MARKER),
    );
    const ids = ours.map((r) => r.id);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(future.id);
    expect(ids).not.toContain(expired.id);
    expect(ids).not.toContain(deleted.id);
  });

  it("returns empty items when nothing active", async () => {
    const res = await app.request("/api/announcements");
    expect(res.status).toBe(200);
    const j = (await res.json()) as { items: unknown[] };
    expect(Array.isArray(j.items)).toBe(true);
    // We don't assert empty because other test/seed rows may exist — only
    // that none of ours appear.
    const ours = (j.items as Array<{ title: { en?: string } }>).filter((r) =>
      (r.title?.en ?? "").includes(TEST_TITLE_MARKER),
    );
    expect(ours).toHaveLength(0);
  });
});
