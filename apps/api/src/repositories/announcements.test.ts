import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, inArray, like, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { users, announcements, auditLog } from "../db/schema/index.ts";
import {
  listAllForOwner,
  listActivePublic,
  getById,
  createAnnouncement,
  updateAnnouncement,
  softDeleteAnnouncement,
} from "./announcements.ts";

const TEST_EMAIL_PREFIX = "announce-repo-test-";
// Marker embedded in title.en so we can sweep just our test rows even if other
// tests / seeds run in parallel. listActivePublic() ignores it.
const TEST_TITLE_MARKER = "[announce-repo-test]";

async function cleanup() {
  // Order matters: audit_log.actor_id FK is NO ACTION (no cascade); we must
  // wipe audit rows referencing our test announcements + users before the row
  // deletes can succeed.
  // jsonb columns can't be used with LIKE directly — cast to text first.
  // title->>'en' extracts the en string from the JSONB doc; partial matches
  // catch every title our tests ever planted.
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

describe("createAnnouncement", () => {
  it("writes a row with all fields", async () => {
    const u = await makeUser();
    const startsAt = new Date("2026-06-01T00:00:00Z");
    const endsAt = new Date("2026-07-01T00:00:00Z");
    const created = await createAnnouncement({
      title: { zh: `中文标题 ${TEST_TITLE_MARKER}`, en: `Hello ${TEST_TITLE_MARKER}` },
      body: { zh: "中文正文", en: "English body" },
      severity: "warning",
      startsAt,
      endsAt,
      dismissible: false,
      createdBy: u.id,
    });
    expect(created.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(created.title).toEqual({
      zh: `中文标题 ${TEST_TITLE_MARKER}`,
      en: `Hello ${TEST_TITLE_MARKER}`,
    });
    expect(created.body).toEqual({ zh: "中文正文", en: "English body" });
    expect(created.severity).toBe("warning");
    expect(created.startsAt).toEqual(startsAt);
    expect(created.endsAt).toEqual(endsAt);
    expect(created.dismissible).toBe(false);
    expect(created.createdBy).toBe(u.id);
    expect(created.deletedAt).toBeNull();
    expect(created.updatedBy).toBeNull();
    expect(created.updatedAt).toBeInstanceOf(Date);
    expect(created.createdAt).toBeInstanceOf(Date);
  });

  it("defaults dismissible to true and endsAt to null when omitted", async () => {
    const u = await makeUser();
    const created = await createAnnouncement({
      title: { en: `Title ${TEST_TITLE_MARKER}` },
      body: { en: "Body" },
      severity: "info",
      startsAt: new Date("2026-06-01T00:00:00Z"),
      createdBy: u.id,
    });
    expect(created.dismissible).toBe(true);
    expect(created.endsAt).toBeNull();
  });
});

describe("getById", () => {
  it("returns the row when present", async () => {
    const u = await makeUser();
    const c = await createAnnouncement({
      title: { en: `Probe ${TEST_TITLE_MARKER}` },
      body: { en: "x" },
      severity: "info",
      startsAt: new Date("2026-06-01T00:00:00Z"),
      createdBy: u.id,
    });
    const r = await getById(c.id);
    expect(r).not.toBeNull();
    expect(r!.id).toBe(c.id);
    expect(r!.title).toEqual({ en: `Probe ${TEST_TITLE_MARKER}` });
  });

  it("returns null for unknown id", async () => {
    const r = await getById("00000000-0000-0000-0000-000000000000");
    expect(r).toBeNull();
  });
});

describe("listAllForOwner", () => {
  it("returns rows including soft-deleted, newest first", async () => {
    const u = await makeUser();
    const a = await createAnnouncement({
      title: { en: `A ${TEST_TITLE_MARKER}` },
      body: { en: "a" },
      severity: "info",
      startsAt: new Date("2026-06-01T00:00:00Z"),
      createdBy: u.id,
    });
    // Slight createdAt nudge so ordering is deterministic on coarse clocks.
    await db
      .update(announcements)
      .set({ createdAt: new Date(Date.now() - 5000) })
      .where(eq(announcements.id, a.id));
    const b = await createAnnouncement({
      title: { en: `B ${TEST_TITLE_MARKER}` },
      body: { en: "b" },
      severity: "info",
      startsAt: new Date("2026-06-01T00:00:00Z"),
      createdBy: u.id,
    });
    // soft delete b — should still show up in owner list.
    await softDeleteAnnouncement(b.id, u.id);
    const all = await listAllForOwner();
    const ours = all.filter((r) =>
      (r.title.en ?? "").includes(TEST_TITLE_MARKER),
    );
    expect(ours.length).toBe(2);
    // newest (b) first
    expect(ours[0]!.id).toBe(b.id);
    expect(ours[0]!.deletedAt).not.toBeNull();
    expect(ours[1]!.id).toBe(a.id);
  });
});

describe("listActivePublic", () => {
  it("excludes deleted + future + expired", async () => {
    const u = await makeUser();
    const now = Date.now();
    // active row — starts in the past, no end
    const active = await createAnnouncement({
      title: { en: `Active ${TEST_TITLE_MARKER}` },
      body: { en: "a" },
      severity: "info",
      startsAt: new Date(now - 1000 * 60 * 60),
      createdBy: u.id,
    });
    // future row — starts tomorrow
    const future = await createAnnouncement({
      title: { en: `Future ${TEST_TITLE_MARKER}` },
      body: { en: "f" },
      severity: "info",
      startsAt: new Date(now + 1000 * 60 * 60 * 24),
      createdBy: u.id,
    });
    // expired row — ended an hour ago
    const expired = await createAnnouncement({
      title: { en: `Expired ${TEST_TITLE_MARKER}` },
      body: { en: "e" },
      severity: "info",
      startsAt: new Date(now - 1000 * 60 * 60 * 2),
      endsAt: new Date(now - 1000 * 60 * 60),
      createdBy: u.id,
    });
    // deleted row — soft-deleted in the active window
    const deleted = await createAnnouncement({
      title: { en: `Deleted ${TEST_TITLE_MARKER}` },
      body: { en: "d" },
      severity: "info",
      startsAt: new Date(now - 1000 * 60 * 60),
      createdBy: u.id,
    });
    await softDeleteAnnouncement(deleted.id, u.id);

    const items = await listActivePublic();
    const ours = items.filter((r) =>
      (r.title.en ?? "").includes(TEST_TITLE_MARKER),
    );
    const ids = ours.map((r) => r.id);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(future.id);
    expect(ids).not.toContain(expired.id);
    expect(ids).not.toContain(deleted.id);
  });
});

describe("updateAnnouncement", () => {
  it("partial update sets only provided fields + updatedBy/updatedAt", async () => {
    const u = await makeUser();
    const updater = await makeUser();
    const c = await createAnnouncement({
      title: { en: `Orig ${TEST_TITLE_MARKER}` },
      body: { en: "orig" },
      severity: "info",
      startsAt: new Date("2026-06-01T00:00:00Z"),
      createdBy: u.id,
    });
    const updated = await updateAnnouncement(c.id, {
      severity: "critical",
      body: { en: "new body" },
      updatedBy: updater.id,
    });
    expect(updated).not.toBeNull();
    expect(updated!.severity).toBe("critical");
    expect(updated!.body).toEqual({ en: "new body" });
    // Title unchanged.
    expect(updated!.title).toEqual({ en: `Orig ${TEST_TITLE_MARKER}` });
    expect(updated!.updatedBy).toBe(updater.id);
    // updatedAt bumped past createdAt.
    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(
      c.updatedAt.getTime(),
    );
  });

  it("returns null for unknown id", async () => {
    const u = await makeUser();
    const r = await updateAnnouncement(
      "00000000-0000-0000-0000-000000000000",
      { severity: "warning", updatedBy: u.id },
    );
    expect(r).toBeNull();
  });
});

describe("softDeleteAnnouncement", () => {
  it("sets deletedAt + updatedBy + updatedAt", async () => {
    const u = await makeUser();
    const deleter = await makeUser();
    const c = await createAnnouncement({
      title: { en: `Del ${TEST_TITLE_MARKER}` },
      body: { en: "d" },
      severity: "info",
      startsAt: new Date("2026-06-01T00:00:00Z"),
      createdBy: u.id,
    });
    expect(c.deletedAt).toBeNull();
    await softDeleteAnnouncement(c.id, deleter.id);
    const r = await getById(c.id);
    expect(r).not.toBeNull();
    expect(r!.deletedAt).not.toBeNull();
    expect(r!.updatedBy).toBe(deleter.id);
    expect(r!.updatedAt.getTime()).toBeGreaterThanOrEqual(c.updatedAt.getTime());
  });
});
