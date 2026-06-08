import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "../db/client.ts";
import { users } from "../db/schema/index.ts";
import { computeDailyLimit, resetDailyCountIfNeeded } from "./daily-limit.ts";
import { incrementDailyCountIfUnderLimit } from "./daily-limit.ts";

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
  it("returns 10 when rejectedCount is below threshold", async () => {
    expect(await computeDailyLimit({ rejectedCount: 0 })).toBe(10);
    expect(await computeDailyLimit({ rejectedCount: 2 })).toBe(10);
  });
  it("returns 5 when rejectedCount is at or above threshold", async () => {
    expect(await computeDailyLimit({ rejectedCount: 3 })).toBe(5);
    expect(await computeDailyLimit({ rejectedCount: 100 })).toBe(5);
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

describe("incrementDailyCountIfUnderLimit", () => {
  it("increments the count and returns true when under limit", async () => {
    const u = await makeUser({ dailySubmissionCount: 0 });
    const ok = await incrementDailyCountIfUnderLimit(u.id, 10);
    expect(ok).toBe(true);
    const [after] = await db.select().from(users).where(eq(users.id, u.id));
    expect(after!.dailySubmissionCount).toBe(1);
  });

  it("returns false and does not change the count when at limit", async () => {
    const u = await makeUser({ dailySubmissionCount: 10 });
    const ok = await incrementDailyCountIfUnderLimit(u.id, 10);
    expect(ok).toBe(false);
    const [after] = await db.select().from(users).where(eq(users.id, u.id));
    expect(after!.dailySubmissionCount).toBe(10);
  });

  it("is atomic under concurrent callers (5 parallel against limit=3 → 3 true, 2 false, count=3)", async () => {
    const u = await makeUser({ dailySubmissionCount: 0 });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => incrementDailyCountIfUnderLimit(u.id, 3)),
    );
    const trues = results.filter((r) => r === true).length;
    const falses = results.filter((r) => r === false).length;
    expect(trues).toBe(3);
    expect(falses).toBe(2);
    const [after] = await db.select().from(users).where(eq(users.id, u.id));
    expect(after!.dailySubmissionCount).toBe(3);
  });
});
