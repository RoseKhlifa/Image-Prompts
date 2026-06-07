import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "../db/client.ts";
import { users } from "../db/schema/index.ts";
import { computeDailyLimit, resetDailyCountIfNeeded } from "./daily-limit.ts";

const TEST_EMAIL_PREFIX = "daily-limit-test-";

beforeEach(async () => {
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%@example.com`));
});

afterAll(async () => {
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%@example.com`));
});

let counter = 0;
async function makeUser(input: {
  rejectedCount?: number;
  dailySubmissionCount?: number;
  dailySubmissionResetAt?: Date | null;
}) {
  counter += 1;
  const [row] = await db
    .insert(users)
    .values({
      email: `${TEST_EMAIL_PREFIX}${counter}@example.com`,
      role: "user",
      rejectedCount: input.rejectedCount ?? 0,
      dailySubmissionCount: input.dailySubmissionCount ?? 0,
      dailySubmissionResetAt: input.dailySubmissionResetAt ?? null,
    })
    .returning();
  return row!;
}

describe("computeDailyLimit", () => {
  it("returns 10 when rejectedCount is below threshold", () => {
    expect(computeDailyLimit({ rejectedCount: 0 })).toBe(10);
    expect(computeDailyLimit({ rejectedCount: 2 })).toBe(10);
  });
  it("returns 5 when rejectedCount is at or above threshold", () => {
    expect(computeDailyLimit({ rejectedCount: 3 })).toBe(5);
    expect(computeDailyLimit({ rejectedCount: 100 })).toBe(5);
  });
});

describe("resetDailyCountIfNeeded", () => {
  it("resets count when dailySubmissionResetAt is null", async () => {
    const u = await makeUser({ dailySubmissionCount: 9, dailySubmissionResetAt: null });
    await resetDailyCountIfNeeded(u.id);
    const [after] = await db.select().from(users).where(eq(users.id, u.id));
    expect(after!.dailySubmissionCount).toBe(0);
    expect(after!.dailySubmissionResetAt).not.toBeNull();
  });

  it("resets when last reset was before the current Shanghai day", async () => {
    const oldDate = new Date("2020-01-01T00:00:00Z");
    const u = await makeUser({ dailySubmissionCount: 9, dailySubmissionResetAt: oldDate });
    await resetDailyCountIfNeeded(u.id);
    const [after] = await db.select().from(users).where(eq(users.id, u.id));
    expect(after!.dailySubmissionCount).toBe(0);
  });

  it("does NOT reset when dailySubmissionResetAt is already today (Shanghai)", async () => {
    // now is in the current Shanghai day by definition
    const u = await makeUser({ dailySubmissionCount: 7, dailySubmissionResetAt: new Date() });
    await resetDailyCountIfNeeded(u.id);
    const [after] = await db.select().from(users).where(eq(users.id, u.id));
    expect(after!.dailySubmissionCount).toBe(7);
  });
});
