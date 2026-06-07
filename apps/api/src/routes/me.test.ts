import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db, pool } from "../db/client.ts";
import { users, sessions } from "../db/schema/auth.ts";
import { favorites } from "../db/schema/interactions.ts";
import { prompts } from "../db/schema/prompts.ts";
import { categories, submissions, notifications } from "../db/schema/index.ts";
import { createServer } from "../server.ts";
import { createTestSession } from "../auth/test-session.ts";

const app = createServer();

const TEST_EMAIL_PREFIX = "test-";
const TEST_CATEGORY_SLUG_PREFIX_TASK20 = "task20-cat-";

async function getTestUserIds(): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${TEST_EMAIL_PREFIX}%@example.com`));
  return rows.map((u) => u.id);
}

async function cleanupTask20() {
  const testUserIds = await getTestUserIds();
  for (const id of testUserIds) {
    await db.delete(submissions).where(eq(submissions.contributorId, id));
  }
  await db
    .delete(categories)
    .where(like(categories.slug, `${TEST_CATEGORY_SLUG_PREFIX_TASK20}%`));
}

async function cleanupTask21() {
  const testUserIds = await getTestUserIds();
  if (testUserIds.length > 0) {
    for (const id of testUserIds) {
      await db.delete(notifications).where(eq(notifications.userId, id));
    }
  }
}

async function seedCategory() {
  const [c] = await db
    .insert(categories)
    .values({
      slug: `${TEST_CATEGORY_SLUG_PREFIX_TASK20}c-${Math.random()
        .toString(36)
        .slice(2)}`,
      name: { zh: "c", en: "c" },
    })
    .returning();
  return c!;
}

const img = {
  r2AccountId: "11111111-1111-1111-1111-111111111111",
  r2Key: "submissions/u/x.jpg",
};

beforeEach(async () => {
  await db.delete(favorites);
});

afterAll(async () => {
  await db.delete(favorites);
  await cleanupTask21();
  await cleanupTask20();
  await db.delete(sessions);
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%@example.com`));
  await pool.end();
});

describe("GET /api/me/favorites", () => {
  it("returns 401 when not logged in", async () => {
    const res = await app.request("/api/me/favorites");
    expect(res.status).toBe(401);
  });

  it("returns empty list for a user with no favorites", async () => {
    const sess = await createTestSession();
    const res = await app.request("/api/me/favorites", { headers: { Cookie: sess.cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });

  it("returns favorited prompts with userFavorited:true", async () => {
    const sess = await createTestSession();
    const [p] = await db.select({ id: prompts.id }).from(prompts).limit(1);
    await db.insert(favorites).values({ userId: sess.userId, promptId: p!.id });

    const res = await app.request("/api/me/favorites", { headers: { Cookie: sess.cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].userFavorited).toBe(true);
  });

  it("respects page/pageSize", async () => {
    const sess = await createTestSession();
    const rows = await db.select({ id: prompts.id }).from(prompts).limit(5);
    for (const r of rows) {
      await db.insert(favorites).values({ userId: sess.userId, promptId: r.id });
    }

    const res = await app.request("/api/me/favorites?page=1&pageSize=2", {
      headers: { Cookie: sess.cookie },
    });
    const body = await res.json();
    expect(body.items.length).toBe(2);
    expect(body.pageSize).toBe(2);
    expect(body.hasMore).toBe(true);
  });
});

describe("PATCH /api/me/community-guidelines", () => {
  beforeEach(cleanupTask20);

  it("requires auth (401)", async () => {
    const res = await app.request("/api/me/community-guidelines", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: 1 }),
    });
    expect(res.status).toBe(401);
  });

  it("updates the user's accepted version", async () => {
    const sess = await createTestSession();
    const res = await app.request("/api/me/community-guidelines", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: sess.cookie },
      body: JSON.stringify({ version: 1 }),
    });
    expect(res.status).toBe(200);
    const [r] = await db.select().from(users).where(eq(users.id, sess.userId));
    expect(r!.communityGuidelinesVersion).toBe(1);
  });

  it("rejects invalid body (400)", async () => {
    const sess = await createTestSession();
    const res = await app.request("/api/me/community-guidelines", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: sess.cookie },
      body: JSON.stringify({ version: 0 }),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/me/submissions", () => {
  beforeEach(cleanupTask20);

  it("requires auth (401)", async () => {
    const res = await app.request("/api/me/submissions");
    expect(res.status).toBe(401);
  });

  it("returns paginated list for the authenticated user", async () => {
    const sess = await createTestSession();
    const c = await seedCategory();
    for (let i = 0; i < 3; i++) {
      await db.insert(submissions).values({
        contributorId: sess.userId,
        title: { zh: `t${i}` },
        prompt: { zh: "p" },
        categoryId: c.id,
        imageKeys: [img],
        tagSlugs: [],
        agreedGuidelinesVersion: 1,
        status: "pending",
      });
      await new Promise((r) => setTimeout(r, 3));
    }
    const res = await app.request("/api/me/submissions", {
      headers: { Cookie: sess.cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ titleZh: string | null }>;
      nextCursor: string | null;
    };
    expect(body.items).toHaveLength(3);
    expect(body.items[0]!.titleZh).toBe("t2");
  });

  it("filters by status", async () => {
    const sess = await createTestSession();
    const c = await seedCategory();
    const [pending] = await db
      .insert(submissions)
      .values({
        contributorId: sess.userId,
        title: { zh: "p" },
        prompt: { zh: "p" },
        categoryId: c.id,
        imageKeys: [img],
        tagSlugs: [],
        agreedGuidelinesVersion: 1,
        status: "pending",
      })
      .returning();
    await db.insert(submissions).values({
      contributorId: sess.userId,
      title: { zh: "r" },
      prompt: { zh: "p" },
      categoryId: c.id,
      imageKeys: [img],
      tagSlugs: [],
      agreedGuidelinesVersion: 1,
      status: "rejected",
      rejectReason: "x".repeat(10),
    });
    const res = await app.request("/api/me/submissions?status=pending", {
      headers: { Cookie: sess.cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.id).toBe(pending!.id);
  });
});

describe("notifications endpoints", () => {
  beforeEach(cleanupTask21);

  it("GET /me/notifications/count requires auth (401)", async () => {
    const res = await app.request("/api/me/notifications/count");
    expect(res.status).toBe(401);
  });

  it("GET /me/notifications/count returns unread count", async () => {
    const sess = await createTestSession();
    await db.insert(notifications).values([
      {
        userId: sess.userId,
        type: "submission_approved",
        payload: {
          submissionId: "s1",
          promptId: "p",
          promptSlug: "p",
          titleZh: null,
          titleEn: null,
        },
      },
      {
        userId: sess.userId,
        type: "submission_approved",
        payload: {
          submissionId: "s2",
          promptId: "p",
          promptSlug: "p",
          titleZh: null,
          titleEn: null,
        },
      },
    ]);
    const res = await app.request("/api/me/notifications/count", {
      headers: { Cookie: sess.cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { unread: number };
    expect(body.unread).toBe(2);
  });

  it("GET /me/notifications returns rows newest first", async () => {
    const sess = await createTestSession();
    await db.insert(notifications).values({
      userId: sess.userId,
      type: "submission_approved",
      payload: {
        submissionId: "s1",
        promptId: "p",
        promptSlug: "p",
        titleZh: null,
        titleEn: null,
      },
    });
    await new Promise((r) => setTimeout(r, 5));
    await db.insert(notifications).values({
      userId: sess.userId,
      type: "submission_rejected",
      payload: {
        submissionId: "s2",
        reason: "x".repeat(10),
        titleZh: null,
        titleEn: null,
      },
    });
    const res = await app.request("/api/me/notifications", {
      headers: { Cookie: sess.cookie },
    });
    const body = (await res.json()) as { items: Array<{ type: string }> };
    expect(body.items).toHaveLength(2);
    expect(body.items[0]!.type).toBe("submission_rejected");
  });

  it("POST /me/notifications/:id/read marks the row", async () => {
    const sess = await createTestSession();
    const [n] = await db
      .insert(notifications)
      .values({
        userId: sess.userId,
        type: "submission_approved",
        payload: {
          submissionId: "s1",
          promptId: "p",
          promptSlug: "p",
          titleZh: null,
          titleEn: null,
        },
      })
      .returning();
    const res = await app.request(`/api/me/notifications/${n!.id}/read`, {
      method: "POST",
      headers: { Cookie: sess.cookie },
    });
    expect(res.status).toBe(200);
    const [reread] = await db
      .select()
      .from(notifications)
      .where(eq(notifications.id, n!.id));
    expect(reread!.readAt).not.toBeNull();
  });

  it("POST /me/notifications/read-all marks all unread", async () => {
    const sess = await createTestSession();
    for (let i = 0; i < 3; i++) {
      await db.insert(notifications).values({
        userId: sess.userId,
        type: "submission_approved",
        payload: {
          submissionId: `s${i}`,
          promptId: "p",
          promptSlug: "p",
          titleZh: null,
          titleEn: null,
        },
      });
    }
    const res = await app.request("/api/me/notifications/read-all", {
      method: "POST",
      headers: { Cookie: sess.cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { updated: number };
    expect(body.updated).toBe(3);
  });

  it("POST /me/notifications/:id/read returns 404 when not the owner", async () => {
    const sess1 = await createTestSession();
    const sess2 = await createTestSession();
    const [n] = await db
      .insert(notifications)
      .values({
        userId: sess1.userId,
        type: "submission_approved",
        payload: {
          submissionId: "s1",
          promptId: "p",
          promptSlug: "p",
          titleZh: null,
          titleEn: null,
        },
      })
      .returning();
    const res = await app.request(`/api/me/notifications/${n!.id}/read`, {
      method: "POST",
      headers: { Cookie: sess2.cookie }, // wrong session
    });
    expect(res.status).toBe(404);
  });
});
