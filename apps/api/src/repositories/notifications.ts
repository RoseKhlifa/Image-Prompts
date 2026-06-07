import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { notifications } from "../db/schema/index.ts";
import type { NotificationPayload } from "../db/schema/notifications.ts";

type CreateInput = {
  userId: string;
  type: "submission_approved" | "submission_rejected";
  payload: NotificationPayload;
};

export async function createNotification(input: CreateInput) {
  const [row] = await db
    .insert(notifications)
    .values({ userId: input.userId, type: input.type, payload: input.payload })
    .returning();
  return row!;
}

type ListOpts = {
  cursor: string | null;
  limit: number;
  unreadOnly: boolean;
};

export async function listMyNotifications(userId: string, opts: ListOpts) {
  const conds = [eq(notifications.userId, userId)];
  if (opts.unreadOnly) conds.push(isNull(notifications.readAt));
  if (opts.cursor) {
    conds.push(lt(notifications.createdAt, new Date(opts.cursor)));
  }
  const rows = await db
    .select()
    .from(notifications)
    .where(and(...conds))
    .orderBy(desc(notifications.createdAt))
    .limit(opts.limit + 1);
  const items = rows.slice(0, opts.limit);
  const nextCursor =
    rows.length > opts.limit
      ? items[items.length - 1]!.createdAt.toISOString()
      : null;
  return {
    items: items.map((r) => ({
      id: r.id,
      type: r.type,
      payload: r.payload,
      readAt: r.readAt ? r.readAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    })),
    nextCursor,
  };
}

export async function countUnread(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

/** Returns true on success (row owned by user and not previously read). */
export async function markRead(notificationId: string, userId: string): Promise<boolean> {
  const result = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.id, notificationId),
        eq(notifications.userId, userId),
        isNull(notifications.readAt),
      ),
    );
  return (result.rowCount ?? 0) > 0;
}

/** Returns the number of rows touched (zero is fine, the call is idempotent). */
export async function markAllRead(userId: string): Promise<number> {
  const result = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return result.rowCount ?? 0;
}
