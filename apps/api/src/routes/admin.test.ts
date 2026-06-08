import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { eq, like, inArray } from "drizzle-orm";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  CopyObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { createServer } from "../server.ts";
import { db } from "../db/client.ts";
import {
  users,
  submissions,
  categories,
  r2Accounts,
  tags,
  prompts,
  promptImages,
  notifications,
  auditLog,
  promptTags,
} from "../db/schema/index.ts";
import { createTestSession } from "../auth/test-session.ts";
import { encryptSecret } from "../lib/crypto.ts";

beforeAll(() => {
  process.env.R2_ENCRYPTION_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

const TEST_EMAIL_PREFIX = "admin-route-test-";
const TEST_CATEGORY_SLUG_PREFIX = "admin-test-cat-";
const TEST_R2_NAME = "admin-test-r2";
const TEST_TAG_SLUG_PREFIX = "task23-tag-";
const TEST_PROMPT_SLUG_PREFIX = "task23-";

const img = { r2AccountId: "11111111-1111-1111-1111-111111111111", r2Key: "submissions/x/1.jpg" };

async function cleanup() {
  // Task 23 created prompts/prompt_images/prompt_tags/notifications/audit rows
  // that hold FKs to categories+users we're about to delete. Resolve those
  // chains FIRST so the categories+users deletes below don't 23503.
  const testPromptIds = (await db
    .select({ id: prompts.id })
    .from(prompts)
    .where(like(prompts.slug, `${TEST_PROMPT_SLUG_PREFIX}%`))
  ).map((p) => p.id);
  if (testPromptIds.length > 0) {
    await db.delete(promptTags).where(inArray(promptTags.promptId, testPromptIds));
    await db.delete(promptImages).where(inArray(promptImages.promptId, testPromptIds));
    // submissions.promotedTo FKs prompts; clear before deleting the prompt.
    await db
      .update(submissions)
      .set({ promotedTo: null })
      .where(inArray(submissions.promotedTo, testPromptIds));
    await db.delete(prompts).where(inArray(prompts.id, testPromptIds));
  }
  await db.delete(tags).where(like(tags.slug, `${TEST_TAG_SLUG_PREFIX}%`));
  await db.delete(auditLog).where(eq(auditLog.action, "submission.approve"));
  await db.delete(auditLog).where(eq(auditLog.action, "submission.reject"));

  // Delete submissions linked to our test categories FIRST (regardless of
  // contributor). Contributors created via createTestSession() use the default
  // `test-{uuid}@example.com` prefix and aren't covered by the
  // admin-route-test- email filter — but their submissions still hold FKs to
  // our test categories.
  const testCatIds = (await db
    .select({ id: categories.id })
    .from(categories)
    .where(like(categories.slug, `${TEST_CATEGORY_SLUG_PREFIX}%`))
  ).map((c) => c.id);
  if (testCatIds.length > 0) {
    await db.delete(submissions).where(inArray(submissions.categoryId, testCatIds));
  }
  // Also any submissions owned by admin-route-test-* users (admin/mod accounts)
  const testUserIds = (await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${TEST_EMAIL_PREFIX}%@example.com`))
  ).map((u) => u.id);
  if (testUserIds.length > 0) {
    await db.delete(submissions).where(inArray(submissions.contributorId, testUserIds));
  }
  // Notifications cascade-delete with users, but audit_log.actor_id does not
  // — purge audit rows actor'd by test users explicitly.
  if (testUserIds.length > 0) {
    await db.delete(auditLog).where(inArray(auditLog.actorId, testUserIds));
  }
  await db.delete(categories).where(like(categories.slug, `${TEST_CATEGORY_SLUG_PREFIX}%`));
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%@example.com`));
  // R2 row isolation: disable all, then either restore or insert our own
  await db.delete(r2Accounts).where(eq(r2Accounts.name, TEST_R2_NAME));
  await db.update(r2Accounts).set({ enabled: true });
}

async function seedR2() {
  await db.update(r2Accounts).set({ enabled: false });
  await db.insert(r2Accounts).values({
    name: TEST_R2_NAME,
    accountId: "test-account",
    endpoint: "https://test.r2.cloudflarestorage.com",
    accessKeyId: "K",
    accessKeySecretEncrypted: encryptSecret("s"),
    bucket: "test-bucket",
    publicUrl: "https://test.r2.dev",
    priority: 100,
    enabled: true,
  });
}

async function setup() {
  await cleanup();
  await seedR2();
  const [c] = await db.insert(categories).values({
    slug: `${TEST_CATEGORY_SLUG_PREFIX}c`,
    name: { zh: "c", en: "c" },
  }).returning();
  return c!;
}

async function makeUserWithRole(role: "user" | "moderator" | "admin", suffix = "") {
  const sess = await createTestSession({
    email: `${TEST_EMAIL_PREFIX}${role}${suffix}-${Math.random().toString(36).slice(2)}@example.com`,
  });
  await db.update(users).set({ role }).where(eq(users.id, sess.userId));
  return sess;
}

beforeEach(setup);
afterAll(cleanup);

// S3 stub: presigned PUT in submissions tests doesn't reach the network,
// and for approve tests we set per-test behavior on CopyObjectCommand /
// DeleteObjectCommand. The Task 22 list/detail tests don't touch S3.
const s3Mock = mockClient(S3Client);

const app = createServer();

describe("GET /api/admin/submissions", () => {
  it("rejects unauthenticated (403)", async () => {
    const res = await app.request("/api/admin/submissions");
    expect(res.status).toBe(403);
  });

  it("rejects role=user (403)", async () => {
    const sess = await makeUserWithRole("user");
    const res = await app.request("/api/admin/submissions", {
      headers: { Cookie: sess.cookie },
    });
    expect(res.status).toBe(403);
  });

  it("allows role=moderator and returns submissions", async () => {
    const c = await setup();
    const contrib = await createTestSession({
      email: `${TEST_EMAIL_PREFIX}contrib-${Math.random().toString(36).slice(2)}@example.com`,
    });
    const mod = await makeUserWithRole("moderator");
    await db.insert(submissions).values({
      contributorId: contrib.userId,
      title: { zh: "t" }, prompt: { zh: "p" },
      categoryId: c.id, imageKeys: [img], tagSlugs: [],
      agreedGuidelinesVersion: 1, status: "pending",
    });
    const res = await app.request("/api/admin/submissions?status=pending", {
      headers: { Cookie: mod.cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string; contributor: { email: string | null } }>; nextCursor: string | null };
    expect(body.items.length).toBeGreaterThanOrEqual(1);
    const ours = body.items.find((i) => i.contributor.email?.startsWith(TEST_EMAIL_PREFIX));
    expect(ours).toBeDefined();
  });

  it("admin GET /admin/submissions/:id returns full detail with contributor", async () => {
    const c = await setup();
    const contrib = await createTestSession({
      email: `${TEST_EMAIL_PREFIX}contrib-${Math.random().toString(36).slice(2)}@example.com`,
    });
    const a = await makeUserWithRole("admin");
    const [sub] = await db.insert(submissions).values({
      contributorId: contrib.userId,
      title: { zh: "t", en: "T" }, prompt: { zh: "p" },
      categoryId: c.id, imageKeys: [img], tagSlugs: [],
      agreedGuidelinesVersion: 1, status: "pending",
    }).returning();
    const res = await app.request(`/api/admin/submissions/${sub!.id}`, {
      headers: { Cookie: a.cookie },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      titleZh: string;
      titleEn: string;
      contributor: { email: string | null };
      images: Array<{ r2Key: string }>;
    };
    expect(body.id).toBe(sub!.id);
    expect(body.titleZh).toBe("t");
    expect(body.titleEn).toBe("T");
    expect(body.contributor.email).toContain(TEST_EMAIL_PREFIX);
    expect(body.images).toHaveLength(1);
  });

  it("returns 404 on unknown id", async () => {
    const a = await makeUserWithRole("admin");
    const res = await app.request("/api/admin/submissions/00000000-0000-0000-0000-000000000000", {
      headers: { Cookie: a.cookie },
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /api/admin/submissions/:id/approve", () => {
  // The module-level `beforeEach(setup)` already cleans + reseeds for each
  // test, including the Task 23 prompts/tags/audit additions in cleanup().
  // We just need to reset the S3 mock so per-test on(CopyObjectCommand)
  // expectations don't leak across tests.
  beforeEach(() => {
    s3Mock.reset();
  });

  async function seedApproveFixture(
    c: { id: string },
    overrides: { titleZh?: string; titleEn?: string; tagSlugs?: string[] } = {},
  ) {
    const contrib = await createTestSession({
      email: `${TEST_EMAIL_PREFIX}contrib-${Math.random().toString(36).slice(2)}@example.com`,
    });
    // The image's r2AccountId must match a real account, otherwise the
    // post-tx migration's accMap lookup fails. Use the test r2 account.
    const [acc] = await db.select().from(r2Accounts).where(eq(r2Accounts.name, TEST_R2_NAME));
    const fixtureImg = {
      r2AccountId: acc!.id,
      r2Key: `submissions/${contrib.userId}/abc.jpg`,
    };
    const title: { zh: string; en?: string } = {
      zh: overrides.titleZh ?? "task23-t",
    };
    if (overrides.titleEn !== undefined) title.en = overrides.titleEn;
    const [sub] = await db.insert(submissions).values({
      contributorId: contrib.userId,
      title,
      prompt: { zh: "p" },
      categoryId: c.id,
      imageKeys: [fixtureImg],
      tagSlugs: overrides.tagSlugs ?? [],
      agreedGuidelinesVersion: 1,
      status: "pending",
    }).returning();
    return { contrib, sub: sub! };
  }

  it("rejects moderator with non-empty edits (edits_require_admin)", async () => {
    const c = await setup();
    const mod = await makeUserWithRole("moderator");
    await db.insert(tags).values({ slug: `${TEST_TAG_SLUG_PREFIX}a`, name: { zh: "标a", en: "Tag A" } });
    const { sub } = await seedApproveFixture(c, { tagSlugs: [`${TEST_TAG_SLUG_PREFIX}a`] });
    s3Mock.on(CopyObjectCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});
    const res = await app.request(`/api/admin/submissions/${sub.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: mod.cookie },
      body: JSON.stringify({ edits: { titleZh: "改" } }),
    });
    expect(res.status).toBe(403);
  });

  it("moderator can approve with no edits", async () => {
    const c = await setup();
    const mod = await makeUserWithRole("moderator");
    await db.insert(tags).values({ slug: `${TEST_TAG_SLUG_PREFIX}a`, name: { zh: "标a", en: "Tag A" } });
    const { sub } = await seedApproveFixture(c, { tagSlugs: [`${TEST_TAG_SLUG_PREFIX}a`] });
    s3Mock.on(CopyObjectCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});
    const res = await app.request(`/api/admin/submissions/${sub.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: mod.cookie },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { promptId: string; slug: string };
    expect(body.promptId).toBeTruthy();
    expect(body.slug).toBeTruthy();
    const promptImg = await db
      .select()
      .from(promptImages)
      .where(eq(promptImages.promptId, body.promptId));
    expect(promptImg).toHaveLength(1);
    expect(promptImg[0]!.r2Key).toMatch(/^prompts\/.+\/0\.jpg$/);
  });

  it("admin can approve with edits", async () => {
    const c = await setup();
    const a = await makeUserWithRole("admin");
    await db.insert(tags).values({ slug: `${TEST_TAG_SLUG_PREFIX}a`, name: { zh: "标a", en: "Tag A" } });
    const { sub } = await seedApproveFixture(c, {
      titleZh: "task23-原",
      tagSlugs: [`${TEST_TAG_SLUG_PREFIX}a`],
    });
    s3Mock.on(CopyObjectCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});
    const res = await app.request(`/api/admin/submissions/${sub.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: a.cookie },
      body: JSON.stringify({ edits: { titleZh: "task23-新" } }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { promptId: string };
    const [p] = await db.select().from(prompts).where(eq(prompts.id, body.promptId));
    expect(p!.title).toMatchObject({ zh: "task23-新" });
  });

  it("returns 409 when submission already resolved", async () => {
    const c = await setup();
    const a = await makeUserWithRole("admin");
    const contrib = await createTestSession({
      email: `${TEST_EMAIL_PREFIX}contrib-${Math.random().toString(36).slice(2)}@example.com`,
    });
    const [acc] = await db.select().from(r2Accounts).where(eq(r2Accounts.name, TEST_R2_NAME));
    const [sub] = await db.insert(submissions).values({
      contributorId: contrib.userId,
      title: { zh: "task23-t" }, prompt: { zh: "p" },
      categoryId: c.id,
      imageKeys: [{ r2AccountId: acc!.id, r2Key: `submissions/${contrib.userId}/x.jpg` }],
      tagSlugs: [], agreedGuidelinesVersion: 1, status: "approved",
    }).returning();
    const res = await app.request(`/api/admin/submissions/${sub!.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: a.cookie },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(409);
  });
});

describe("POST /api/admin/submissions/:id/reject", () => {
  beforeEach(async () => {
    // setup() in the outer beforeEach already cleans + seeds R2 and category
    s3Mock.reset();
  });

  it("requires non-empty reason (400)", async () => {
    const c = await setup();
    const contrib = await createTestSession({ email: `${TEST_EMAIL_PREFIX}contrib-r-${Date.now()}@example.com` });
    const a = await makeUserWithRole("admin");
    const [sub] = await db.insert(submissions).values({
      contributorId: contrib.userId,
      title: { zh: "task24-t" }, prompt: { zh: "p" },
      categoryId: c.id, imageKeys: [img], tagSlugs: [],
      agreedGuidelinesVersion: 1, status: "pending",
    }).returning();
    const res = await app.request(`/api/admin/submissions/${sub!.id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: a.cookie },
      body: JSON.stringify({ reason: "   " }),
    });
    expect(res.status).toBe(400);
  });

  it("succeeds with valid reason — flips status, bumps rejectedCount, notifies", async () => {
    const c = await setup();
    const contrib = await createTestSession({ email: `${TEST_EMAIL_PREFIX}contrib-r-${Date.now()}@example.com` });
    const a = await makeUserWithRole("admin");
    const [sub] = await db.insert(submissions).values({
      contributorId: contrib.userId,
      title: { zh: "task24-标" }, prompt: { zh: "p" },
      categoryId: c.id, imageKeys: [img], tagSlugs: [],
      agreedGuidelinesVersion: 1, status: "pending",
    }).returning();
    s3Mock.on(DeleteObjectCommand).resolves({});
    const res = await app.request(`/api/admin/submissions/${sub!.id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: a.cookie },
      body: JSON.stringify({ reason: "违反社区准则的图片内容" }),
    });
    expect(res.status).toBe(200);
    const [reread] = await db.select().from(submissions).where(eq(submissions.id, sub!.id));
    expect(reread!.status).toBe("rejected");
    expect(reread!.rejectReason).toBe("违反社区准则的图片内容");
    const [contribAfter] = await db.select().from(users).where(eq(users.id, contrib.userId));
    expect(contribAfter!.rejectedCount).toBe(1);
    const notifs = await db.select().from(notifications).where(eq(notifications.userId, contrib.userId));
    expect(notifs).toHaveLength(1);
    expect(notifs[0]!.type).toBe("submission_rejected");
  });

  it("returns 409 when already resolved (not_pending)", async () => {
    const c = await setup();
    const contrib = await createTestSession({ email: `${TEST_EMAIL_PREFIX}contrib-r-${Date.now()}@example.com` });
    const a = await makeUserWithRole("admin");
    const [sub] = await db.insert(submissions).values({
      contributorId: contrib.userId,
      title: { zh: "task24-t" }, prompt: { zh: "p" },
      categoryId: c.id, imageKeys: [img], tagSlugs: [],
      agreedGuidelinesVersion: 1, status: "rejected", rejectReason: "x".repeat(10),
    }).returning();
    const res = await app.request(`/api/admin/submissions/${sub!.id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: a.cookie },
      body: JSON.stringify({ reason: "this is a valid reject reason" }),
    });
    expect(res.status).toBe(409);
  });

  it("moderator can reject (no admin-only restriction on reject)", async () => {
    const c = await setup();
    const contrib = await createTestSession({ email: `${TEST_EMAIL_PREFIX}contrib-r-${Date.now()}@example.com` });
    const mod = await makeUserWithRole("moderator");
    const [sub] = await db.insert(submissions).values({
      contributorId: contrib.userId,
      title: { zh: "task24-t" }, prompt: { zh: "p" },
      categoryId: c.id, imageKeys: [img], tagSlugs: [],
      agreedGuidelinesVersion: 1, status: "pending",
    }).returning();
    s3Mock.on(DeleteObjectCommand).resolves({});
    const res = await app.request(`/api/admin/submissions/${sub!.id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: mod.cookie },
      body: JSON.stringify({ reason: "moderator rejection reason" }),
    });
    expect(res.status).toBe(200);
  });
});
