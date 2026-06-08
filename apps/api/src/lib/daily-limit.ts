import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { users } from "../db/schema/index.ts";
import { getSubmitConfig } from "./submit-config.ts";
import { startOfTodayShanghai } from "./shanghai-date.ts";

export async function computeDailyLimit(user: { rejectedCount: number }): Promise<number> {
  const cfg = await getSubmitConfig();
  return user.rejectedCount >= cfg.DEMOTE_THRESHOLD ? cfg.DEMOTED_LIMIT : cfg.DAILY_LIMIT;
}

/**
 * Lazily reset users.dailySubmissionCount to 0 if the last reset was before
 * 00:00 Asia/Shanghai today. The conditional WHERE means concurrent callers
 * are race-safe: only one UPDATE will actually change the row.
 */
export async function resetDailyCountIfNeeded(userId: string): Promise<void> {
  const today = startOfTodayShanghai();
  await db
    .update(users)
    .set({ dailySubmissionCount: 0, dailySubmissionResetAt: new Date() })
    .where(
      and(
        eq(users.id, userId),
        or(isNull(users.dailySubmissionResetAt), lt(users.dailySubmissionResetAt, today)),
      ),
    );
}

/**
 * Atomic conditional increment. Returns true when the row was updated, i.e.
 * the user is still under the limit and the count was incremented. Returns
 * false when the row was NOT updated, i.e. limit reached.
 *
 * Use this in the create-submission handler so that two parallel requests
 * cannot both pass the cap. Presign does NOT call this — presign only reads.
 */
export async function incrementDailyCountIfUnderLimit(
  userId: string,
  limit: number,
): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE users
       SET daily_submission_count = daily_submission_count + 1
     WHERE id = ${userId}
       AND daily_submission_count < ${limit}
    RETURNING id
  `);
  return (result.rowCount ?? 0) === 1;
}
