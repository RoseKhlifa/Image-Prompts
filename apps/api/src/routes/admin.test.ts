import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { eq, like, inArray } from "drizzle-orm";
import { createServer } from "../server.ts";
import { db } from "../db/client.ts";
import {
  users,
  submissions,
  categories,
  r2Accounts,
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

const img = { r2AccountId: "11111111-1111-1111-1111-111111111111", r2Key: "submissions/x/1.jpg" };

async function cleanup() {
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
