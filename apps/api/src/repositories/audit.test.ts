import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "../db/client.ts";
import { users, auditLog } from "../db/schema/index.ts";
import { recordAudit } from "./audit.ts";

const TEST_EMAIL_PREFIX = "audit-repo-test-";

beforeEach(async () => {
  // Delete audit rows for our test users first (they have FK to users)
  // We don't have a way to find by email directly, so delete by joining…
  // Simpler: cascade isn't enabled on audit_log.actor_id (it's NO ACTION),
  // so we have to delete audit rows manually before deleting users.
  await db.delete(auditLog).where(like(auditLog.action, `task14-test-%`));
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%@example.com`));
});

afterAll(async () => {
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
