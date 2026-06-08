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

type InteractionInput = {
  userId: string;          // contributor (recipient)
  type: "prompt_liked" | "prompt_favorited";
  promptId: string;
  promptSlug: string;
  titleZh: string | null;
  titleEn: string | null;
  actorId: string;
  actorName: string | null;
};

/**
 * Aggregated interaction notification.
 *
 * Strategy: within a single transaction, look up the most recent unread
 * notification matching (userId, groupKey) within the last hour. If found,
 * UPDATE aggregated_count + refresh payload's lastActor + bump createdAt
 * (which floats it to the top of the user's list). If not found, INSERT a
 * new row with aggregated_count = 1.
 *
 * `groupKey` is `<type-prefix>:<promptId>`. The `notifications_group_lookup_idx`
 * partial index covers the SELECT predicate exactly.
 *
 * `SELECT ... FOR UPDATE` prevents concurrent same-group inserts from
 * creating duplicate rows when two actors hit the like endpoint within ms.
 */
export async function createInteractionNotification(
  input: InteractionInput,
): Promise<{ created: boolean; aggregatedCount: number }> {
  const groupKey = `${input.type === "prompt_liked" ? "liked" : "favorited"}:${input.promptId}`;
  const payload = {
    promptId: input.promptId,
    promptSlug: input.promptSlug,
    titleZh: input.titleZh,
    titleEn: input.titleEn,
    lastActorId: input.actorId,
    lastActorName: input.actorName,
  };
  return await db.transaction(async (tx) => {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000);
    const [existing] = await tx
      .select({
        id: notifications.id,
        aggregatedCount: notifications.aggregatedCount,
      })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, input.userId),
          eq(notifications.groupKey, groupKey),
          isNull(notifications.readAt),
          sql`${notifications.createdAt} >= ${cutoff}`,
        ),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(1)
      .for("update");
    if (existing) {
      const newCount = existing.aggregatedCount + 1;
      await tx
        .update(notifications)
        .set({
          aggregatedCount: newCount,
          payload,
          createdAt: new Date(),
        })
        .where(eq(notifications.id, existing.id));
      return { created: false, aggregatedCount: newCount };
    }
    await tx.insert(notifications).values({
      userId: input.userId,
      type: input.type,
      payload,
      groupKey,
      aggregatedCount: 1,
    });
    return { created: true, aggregatedCount: 1 };
  });
}
