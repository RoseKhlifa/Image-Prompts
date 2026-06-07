import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.ts";
import { r2Accounts } from "../db/schema/index.ts";

export class NoR2AccountError extends Error {
  constructor() {
    super("no enabled R2 account available");
    this.name = "NoR2AccountError";
  }
}

/**
 * Pick the R2 account to write new uploads to.
 *
 * Priority order:
 *   1. enabled = true
 *   2. deleted_at IS NULL
 *   3. ORDER BY priority DESC, created_at ASC
 *
 * Throws NoR2AccountError if no candidate exists.
 */
export async function pickWriteAccount() {
  const rows = await db
    .select()
    .from(r2Accounts)
    .where(and(eq(r2Accounts.enabled, true), isNull(r2Accounts.deletedAt)))
    .orderBy(desc(r2Accounts.priority), asc(r2Accounts.createdAt))
    .limit(1);
  if (rows.length === 0) throw new NoR2AccountError();
  return rows[0]!;
}
