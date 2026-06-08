import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "../db/client.ts";
import { users, auditLog } from "../db/schema/index.ts";
import { recordAudit, listAudit } from "./audit.ts";

const TEST_EMAIL_PREFIX = "audit-repo-test-";

beforeEach(async () => {
  // audit_log.actor_id has FK NO ACTION (no cascade), so delete audit rows
  // for our test actions before deleting the test users.
  await db.delete(auditLog).where(like(auditLog.action, `task14-test-%`));
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%@example.com`));
});

afterAll(async () => {
  // audit_log.actor_id has FK NO ACTION (no cascade), so delete audit rows
  // for our test actions before deleting the test users.
  await db.delete(auditLog).where(like(auditLog.action, `task14-test-%`));
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%@example.com`));
});

let counter = 0;
async function makeAdmin() {
  counter += 1;
  const [u] = await db
    .insert(users)
    .values({ email: `${TEST_EMAIL_PREFIX}${counter}@example.com`, role: "admin" })
    .returning();
  return u!;
}

describe("recordAudit", () => {
  it("inserts a row with all fields", async () => {
    const u = await makeAdmin();
    await recordAudit({
      actorId: u.id,
      action: "task14-test-submission.approve",
      targetType: "submission",
      targetId: "s-1",
      payload: { promptId: "p-1", hadEdits: false },
    });
    const rows = await db.select().from(auditLog).where(eq(auditLog.actorId, u.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe("task14-test-submission.approve");
    expect(rows[0]!.targetType).toBe("submission");
    expect(rows[0]!.targetId).toBe("s-1");
    expect(rows[0]!.payload).toMatchObject({ promptId: "p-1", hadEdits: false });
  });

  it("supports being called within a transaction", async () => {
    const u = await makeAdmin();
    await db.transaction(async (tx) => {
      await recordAudit({
        actorId: u.id,
        action: "task14-test-submission.reject",
        targetType: "submission",
        targetId: "s-2",
        payload: { reason: "x" },
        tx,
      });
    });
    const rows = await db.select().from(auditLog).where(eq(auditLog.actorId, u.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.action).toBe("task14-test-submission.reject");
  });
});

describe("listAudit", () => {
  it("returns rows in createdAt desc order with actor join", async () => {
    const u = await makeAdmin();
    await recordAudit({
      actorId: u.id,
      action: "task14-test-user.role.update",
      targetType: "user",
      targetId: "t-1",
      payload: { newRole: "moderator" },
    });
    await recordAudit({
      actorId: u.id,
      action: "task14-test-submission.approve",
      targetType: "submission",
      targetId: "s-1",
      payload: { promptId: "p-1" },
    });
    const r = await listAudit({ actionPrefix: "task14-test-" });
    expect(r.items.length).toBeGreaterThanOrEqual(2);
    // Most recent first — the second insert is the second action.
    expect(r.items[0]!.action).toBe("task14-test-submission.approve");
    expect(r.items[1]!.action).toBe("task14-test-user.role.update");
    // Actor join populated.
    expect(r.items[0]!.actorId).toBe(u.id);
    expect(r.items[0]!.actorEmail).toBe(u.email);
    // nextCursor shape: string or null.
    expect(r.nextCursor === null || typeof r.nextCursor === "string").toBe(true);
  });

  it("filters by actionPrefix", async () => {
    const u = await makeAdmin();
    await recordAudit({
      actorId: u.id,
      action: "task14-test-user.role.update",
      targetType: "user",
      targetId: "t-1",
      payload: {},
    });
    await recordAudit({
      actorId: u.id,
      action: "task14-test-submission.approve",
      targetType: "submission",
      targetId: "s-1",
      payload: {},
    });
    const r = await listAudit({ actionPrefix: "task14-test-user." });
    expect(r.items.length).toBe(1);
    expect(r.items[0]!.action).toBe("task14-test-user.role.update");
  });

  it("filters by actorId", async () => {
    const u1 = await makeAdmin();
    const u2 = await makeAdmin();
    await recordAudit({
      actorId: u1.id,
      action: "task14-test-a",
      targetType: "x",
      targetId: "1",
      payload: {},
    });
    await recordAudit({
      actorId: u2.id,
      action: "task14-test-b",
      targetType: "x",
      targetId: "2",
      payload: {},
    });
    const r = await listAudit({ actorId: u1.id, actionPrefix: "task14-test-" });
    expect(r.items.length).toBe(1);
    expect(r.items[0]!.actorId).toBe(u1.id);
    expect(r.items[0]!.action).toBe("task14-test-a");
  });

  it("filters by targetType", async () => {
    const u = await makeAdmin();
    await recordAudit({
      actorId: u.id,
      action: "task14-test-a",
      targetType: "user",
      targetId: "u-1",
      payload: {},
    });
    await recordAudit({
      actorId: u.id,
      action: "task14-test-b",
      targetType: "submission",
      targetId: "s-1",
      payload: {},
    });
    const r = await listAudit({ targetType: "user", actionPrefix: "task14-test-" });
    expect(r.items.length).toBe(1);
    expect(r.items[0]!.targetType).toBe("user");
  });

  it("limit=1 yields nextCursor and continues", async () => {
    const u = await makeAdmin();
    // Insert two rows with explicit created_at values so the keyset cursor
    // has a clean ordering even when the host clock is too coarse to
    // distinguish back-to-back inserts (defaultNow() can collapse both rows
    // onto the same timestamp when admin.test.ts is loaded first — slowing
    // the harness just enough to expose the collision).
    const now = Date.now();
    await db.insert(auditLog).values({
      actorId: u.id,
      action: "task14-test-a",
      targetType: "x",
      targetId: "1",
      payload: {},
      createdAt: new Date(now - 1000),
    });
    await db.insert(auditLog).values({
      actorId: u.id,
      action: "task14-test-b",
      targetType: "x",
      targetId: "2",
      payload: {},
      createdAt: new Date(now),
    });
    const page1 = await listAudit({ actionPrefix: "task14-test-", limit: 1 });
    expect(page1.items.length).toBe(1);
    expect(page1.items[0]!.action).toBe("task14-test-b");
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await listAudit({
      actionPrefix: "task14-test-",
      limit: 1,
      cursor: page1.nextCursor!,
    });
    expect(page2.items.length).toBe(1);
    expect(page2.items[0]!.action).toBe("task14-test-a");
    // Pages should not overlap.
    expect(page2.items[0]!.id).not.toBe(page1.items[0]!.id);
  });

  it("keyset cursor handles ties on createdAt by id", async () => {
    const u = await makeAdmin();
    // Both rows share the same createdAt — the cursor must use the id
    // tiebreaker to avoid skipping or duplicating either one across pages.
    const sameTime = new Date();
    await db.insert(auditLog).values({
      actorId: u.id,
      action: "task14-test-tie-a",
      targetType: "x",
      targetId: "1",
      payload: {},
      createdAt: sameTime,
    });
    await db.insert(auditLog).values({
      actorId: u.id,
      action: "task14-test-tie-b",
      targetType: "x",
      targetId: "2",
      payload: {},
      createdAt: sameTime,
    });
    const page1 = await listAudit({ actionPrefix: "task14-test-tie-", limit: 1 });
    expect(page1.items.length).toBe(1);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await listAudit({
      actionPrefix: "task14-test-tie-",
      limit: 1,
      cursor: page1.nextCursor!,
    });
    expect(page2.items.length).toBe(1);
    expect(page2.items[0]!.id).not.toBe(page1.items[0]!.id);
  });

  it("from / to range filter narrows results", async () => {
    const u = await makeAdmin();
    await recordAudit({
      actorId: u.id,
      action: "task14-test-old",
      targetType: "x",
      targetId: "1",
      payload: {},
    });
    // Bump the timestamp on the old row to be in the past so the range filter
    // can exclude it. Otherwise both rows share the same default createdAt.
    await db
      .update(auditLog)
      .set({ createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24) })
      .where(eq(auditLog.action, "task14-test-old"));
    await recordAudit({
      actorId: u.id,
      action: "task14-test-new",
      targetType: "x",
      targetId: "2",
      payload: {},
    });
    const from = new Date(Date.now() - 1000 * 60 * 60); // last hour
    const r = await listAudit({ actionPrefix: "task14-test-", from });
    expect(r.items.some((i) => i.action === "task14-test-new")).toBe(true);
    expect(r.items.some((i) => i.action === "task14-test-old")).toBe(false);
  });
});
