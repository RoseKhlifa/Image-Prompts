import { eq, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { users } from "../db/schema/index.ts";

/**
 * The minimal slice of user state we need for submission/approval handlers.
 * Returning a slice instead of the whole row keeps memory + log noise down.
 */
export async function getUserForSubmission(userId: string) {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      communityGuidelinesVersion: users.communityGuidelinesVersion,
      dailySubmissionCount: users.dailySubmissionCount,
      dailySubmissionResetAt: users.dailySubmissionResetAt,
      rejectedCount: users.rejectedCount,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row ?? null;
}

export async function incrementRejectedCount(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ rejectedCount: sql`${users.rejectedCount} + 1` })
    .where(eq(users.id, userId));
}

export async function setCommunityGuidelinesVersion(
  userId: string,
  version: number,
): Promise<void> {
  await db
    .update(users)
    .set({ communityGuidelinesVersion: version })
    .where(eq(users.id, userId));
}

export async function setRole(
  userId: string,
  role: "user" | "moderator" | "admin",
): Promise<void> {
  await db.update(users).set({ role }).where(eq(users.id, userId));
}
