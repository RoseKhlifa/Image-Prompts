import { count, desc, eq, isNull, sum } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  prompts,
  users,
  submissions,
  likes,
  favorites,
  r2Accounts,
  auditLog,
} from "../db/schema/index.ts";

export type DashboardActivity = {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  payload: unknown;
  createdAt: Date;
};

export type DashboardMetrics = {
  publishedPrompts: number;
  totalUsers: number;
  pendingSubmissions: number;
  totalViews: number;
  totalLikes: number;
  totalFavorites: number;
  totalSubmissions: number;
  totalR2UsedBytes: number;
};

export type DashboardPayload = {
  metrics: DashboardMetrics;
  recentActivity: DashboardActivity[];
};

/**
 * One-shot dashboard read. Runs 8 small COUNT/SUM queries + 1 audit_log
 * SELECT in parallel. Each query is O(rows) with covering indexes, well
 * under 100ms total at MVP scale. If/when we have millions of rows, add
 * materialized counters or replace with cached snapshots — premature now.
 *
 * Schema notes:
 * - prompts table has no `status` / `deletedAt` columns; every row IS a
 *   published prompt (draft state lives in `submissions` until approved).
 *   So `publishedPrompts` is just COUNT(prompts) and totalViews sums all.
 * - r2Accounts.usedBytes is bigint(mode: number) — sum() with mapWith(Number)
 *   keeps it numeric on the way out.
 * - auditLog.actorId is NOT NULL in schema, but we LEFT JOIN users anyway
 *   so a future hard-deleted user row still leaves the audit entry visible.
 */
export async function getOwnerDashboard(): Promise<DashboardPayload> {
  const [
    [pubRow],
    [usersRow],
    [pendingRow],
    [viewsRow],
    [likesRow],
    [favsRow],
    [subsRow],
    [r2Row],
    activityRows,
  ] = await Promise.all([
    db.select({ n: count() }).from(prompts),
    db.select({ n: count() }).from(users),
    db
      .select({ n: count() })
      .from(submissions)
      .where(eq(submissions.status, "pending")),
    db.select({ s: sum(prompts.viewCount).mapWith(Number) }).from(prompts),
    db.select({ n: count() }).from(likes),
    db.select({ n: count() }).from(favorites),
    db.select({ n: count() }).from(submissions),
    db
      .select({ s: sum(r2Accounts.usedBytes).mapWith(Number) })
      .from(r2Accounts)
      .where(isNull(r2Accounts.deletedAt)),
    db
      .select({
        id: auditLog.id,
        actorId: auditLog.actorId,
        actorName: users.name,
        action: auditLog.action,
        targetType: auditLog.targetType,
        targetId: auditLog.targetId,
        payload: auditLog.payload,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorId))
      .orderBy(desc(auditLog.createdAt))
      .limit(20),
  ]);

  return {
    metrics: {
      publishedPrompts: Number(pubRow?.n ?? 0),
      totalUsers: Number(usersRow?.n ?? 0),
      pendingSubmissions: Number(pendingRow?.n ?? 0),
      totalViews: Number(viewsRow?.s ?? 0),
      totalLikes: Number(likesRow?.n ?? 0),
      totalFavorites: Number(favsRow?.n ?? 0),
      totalSubmissions: Number(subsRow?.n ?? 0),
      totalR2UsedBytes: Number(r2Row?.s ?? 0),
    },
    recentActivity: activityRows,
  };
}
