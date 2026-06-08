import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db } from "../db/client.ts";
import { notifications, users } from "../db/schema/index.ts";
import {
  createNotification,
  listMyNotifications,
  countUnread,
  markRead,
  markAllRead,
} from "./notifications.ts";

const TEST_EMAIL_PREFIX = "notif-repo-test-";

beforeEach(async () => {
  // notifications cascade-delete with the user
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%@example.com`));
});

afterAll(async () => {
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%@example.com`));
});

let counter = 0;
async function makeUser() {
  counter += 1;
  const [u] = await db
    .insert(users)
    .values({ email: `${TEST_EMAIL_PREFIX}${counter}@example.com`, role: "user" })
    .returning();
  return u!;
}

const approvedPayload = (id: string) => ({
  submissionId: id,
  promptId: "p1",
  promptSlug: "p",
  titleZh: null,
  titleEn: null,
});

const rejectedPayload = (id: string, reason: string) => ({
  submissionId: id,
  reason,
  titleZh: null,
  titleEn: null,
});

describe("createNotification + listMyNotifications", () => {
  it("inserts and lists by user, newest first", async () => {
    const u = await makeUser();
    await createNotification({
      userId: u.id,
      type: "submission_approved",
      payload: approvedPayload("s1"),
    });
    await new Promise((r) => setTimeout(r, 5));
    await createNotification({
      userId: u.id,
      type: "submission_rejected",
      payload: rejectedPayload("s2", "n".repeat(10)),
    });
    const { items } = await listMyNotifications(u.id, {
      cursor: null,
      limit: 10,
      unreadOnly: false,
    });
    expect(items).toHaveLength(2);
    expect(items[0]!.type).toBe("submission_rejected");
    expect(items[1]!.type).toBe("submission_approved");
  });

  it("paginates with cursor", async () => {
    const u = await makeUser();
    for (let i = 0; i < 5; i++) {
      await createNotification({
        userId: u.id,
        type: "submission_approved",
        payload: approvedPayload(`s${i}`),
      });
      if (i < 4) await new Promise((r) => setTimeout(r, 2));
    }
    const page1 = await listMyNotifications(u.id, {
      cursor: null,
      limit: 2,
      unreadOnly: false,
    });
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = await listMyNotifications(u.id, {
      cursor: page1.nextCursor,
      limit: 2,
      unreadOnly: false,
    });
    expect(page2.items).toHaveLength(2);
    const ids1 = page1.items.map((i) => i.id);
    const ids2 = page2.items.map((i) => i.id);
    expect(ids1.some((id) => ids2.includes(id))).toBe(false);
  });

  it("filters to unread when unreadOnly=true", async () => {
    const u = await makeUser();
    const a = await createNotification({
      userId: u.id,
      type: "submission_approved",
      payload: approvedPayload("s1"),
    });
    await createNotification({
      userId: u.id,
      type: "submission_approved",
      payload: approvedPayload("s2"),
    });
    await markRead(a.id, u.id);
    const { items } = await listMyNotifications(u.id, {
      cursor: null,
      limit: 10,
      unreadOnly: true,
    });
    expect(items).toHaveLength(1);
  });
});

describe("countUnread", () => {
  it("returns only unread for the given user", async () => {
    const u1 = await makeUser();
    const u2 = await makeUser();
    await createNotification({
      userId: u1.id,
      type: "submission_approved",
      payload: approvedPayload("s1"),
    });
    await createNotification({
      userId: u1.id,
      type: "submission_rejected",
      payload: rejectedPayload("s2", "n".repeat(10)),
    });
    await createNotification({
      userId: u2.id,
      type: "submission_approved",
      payload: approvedPayload("s3"),
    });
    expect(await countUnread(u1.id)).toBe(2);
    expect(await countUnread(u2.id)).toBe(1);
  });

  it("returns 0 for a user with none", async () => {
    const u = await makeUser();
    expect(await countUnread(u.id)).toBe(0);
  });
});

describe("markRead", () => {
  it("sets readAt when caller owns the row", async () => {
    const u = await makeUser();
    const n = await createNotification({
      userId: u.id,
      type: "submission_approved",
      payload: approvedPayload("s1"),
    });
    const ok = await markRead(n.id, u.id);
    expect(ok).toBe(true);
    expect(await countUnread(u.id)).toBe(0);
  });

  it("does not mark someone else's notification", async () => {
    const u1 = await makeUser();
    const u2 = await makeUser();
    const n = await createNotification({
      userId: u1.id,
      type: "submission_approved",
      payload: approvedPayload("s1"),
    });
    const ok = await markRead(n.id, u2.id);
    expect(ok).toBe(false);
    expect(await countUnread(u1.id)).toBe(1);
  });
});

describe("markAllRead", () => {
  it("marks every unread row for the user; returns the count touched", async () => {
    const u = await makeUser();
    for (let i = 0; i < 3; i++) {
      await createNotification({
        userId: u.id,
        type: "submission_approved",
        payload: approvedPayload(`s${i}`),
      });
    }
    const updated = await markAllRead(u.id);
    expect(updated).toBe(3);
    expect(await countUnread(u.id)).toBe(0);
    const again = await markAllRead(u.id);
    expect(again).toBe(0);
  });
});

import { createInteractionNotification } from "./notifications.ts";

describe("createInteractionNotification (hourly aggregate)", () => {
  it("INSERTs new row when no recent unread same-group exists", async () => {
    const u = await makeUser();
    const actor1 = await makeUser();
    const promptId = crypto.randomUUID();
    const result = await createInteractionNotification({
      userId: u.id,
      type: "prompt_liked",
      promptId,
      promptSlug: "x",
      titleZh: "T", titleEn: null,
      actorId: actor1.id,
      actorName: "A1",
    });
    expect(result.created).toBe(true);
    expect(result.aggregatedCount).toBe(1);
  });

  it("UPDATEs aggregated_count when same-group recent unread exists", async () => {
    const u = await makeUser();
    const actor1 = await makeUser();
    const actor2 = await makeUser();
    const promptId = crypto.randomUUID();
    await createInteractionNotification({
      userId: u.id, type: "prompt_liked", promptId, promptSlug: "x",
      titleZh: "T", titleEn: null, actorId: actor1.id, actorName: "A1",
    });
    const r2 = await createInteractionNotification({
      userId: u.id, type: "prompt_liked", promptId, promptSlug: "x",
      titleZh: "T", titleEn: null, actorId: actor2.id, actorName: "A2",
    });
    expect(r2.created).toBe(false);
    expect(r2.aggregatedCount).toBe(2);

    // Verify only 1 row exists in DB
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, u.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.aggregatedCount).toBe(2);
    // Payload's lastActor refreshed to the most recent actor
    expect((rows[0]!.payload as { lastActorName: string }).lastActorName).toBe("A2");
  });

  it("INSERTs new row when previous notification is already read", async () => {
    const u = await makeUser();
    const actor1 = await makeUser();
    const actor2 = await makeUser();
    const promptId = crypto.randomUUID();
    await createInteractionNotification({
      userId: u.id, type: "prompt_liked", promptId, promptSlug: "x",
      titleZh: "T", titleEn: null, actorId: actor1.id, actorName: "A1",
    });
    // Mark all read
    await db.update(notifications)
      .set({ readAt: new Date() })
      .where(eq(notifications.userId, u.id));
    const r2 = await createInteractionNotification({
      userId: u.id, type: "prompt_liked", promptId, promptSlug: "x",
      titleZh: "T", titleEn: null, actorId: actor2.id, actorName: "A2",
    });
    expect(r2.created).toBe(true);
    expect(r2.aggregatedCount).toBe(1);

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, u.id));
    expect(rows).toHaveLength(2);  // 1 read + 1 fresh
  });
});
