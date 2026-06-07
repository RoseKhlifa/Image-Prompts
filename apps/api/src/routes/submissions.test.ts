import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { eq, inArray, like, notLike } from "drizzle-orm";
import { mockClient } from "aws-sdk-client-mock";
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";
import { db, pool } from "../db/client.ts";
import { users, sessions } from "../db/schema/auth.ts";
import { r2Accounts, categories, tags, submissions } from "../db/schema/index.ts";
import { createServer } from "../server.ts";
import { createTestSession } from "../auth/test-session.ts";
import { encryptSecret } from "../lib/crypto.ts";
import { clearR2ClientCache } from "../lib/r2-client-cache.ts";

const TEST_R2_NAME_PREFIX = "presign-test-r2-";
const TEST_CATEGORY_SLUG_PREFIX = "task19-cat-";
const TEST_TAG_SLUG_PREFIX = "task19-tag-";

beforeAll(() => {
  process.env.R2_ENCRYPTION_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

// Stub the S3Client SDK so presign signatures don't reach the network. The
// presigner only inspects the client's credentials/endpoint config to build a
// signed URL; it doesn't call .send(), so the mock is a passive no-op for
// presign — it just prevents any accidental network use elsewhere.
//
// For the /api/submissions create route, the mock IS active: each test sets
// behavior via s3Mock.on(HeadObjectCommand) before issuing the request.
const s3Mock = mockClient(S3Client);

async function seedTestR2Account() {
  // Disable any seeded r2 rows so pickWriteAccount returns ours
  await db
    .update(r2Accounts)
    .set({ enabled: false })
    .where(notLike(r2Accounts.name, `${TEST_R2_NAME_PREFIX}%`));
  // Clean any leftover test rows
  await db.delete(r2Accounts).where(like(r2Accounts.name, `${TEST_R2_NAME_PREFIX}%`));
  // Insert a fresh test row
  await db.insert(r2Accounts).values({
    name: `${TEST_R2_NAME_PREFIX}1`,
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

async function restoreR2Accounts() {
  await db.delete(r2Accounts).where(like(r2Accounts.name, `${TEST_R2_NAME_PREFIX}%`));
  await db
    .update(r2Accounts)
    .set({ enabled: true })
    .where(notLike(r2Accounts.name, `${TEST_R2_NAME_PREFIX}%`));
}

// Delete any submissions, then categories+tags created by the Task 19 tests.
// Submissions must be deleted FIRST because they have FK references to
// categories (and to users, which the outer afterAll will purge).
async function cleanupTask19Fixtures() {
  const testUserIds = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, "test-%@example.com"));
  if (testUserIds.length > 0) {
    await db
      .delete(submissions)
      .where(
        inArray(
          submissions.contributorId,
          testUserIds.map((u) => u.id),
        ),
      );
  }
  await db.delete(tags).where(like(tags.slug, `${TEST_TAG_SLUG_PREFIX}%`));
  await db
    .delete(categories)
    .where(like(categories.slug, `${TEST_CATEGORY_SLUG_PREFIX}%`));
}

beforeEach(async () => {
  await cleanupTask19Fixtures();
  await seedTestR2Account();
  clearR2ClientCache();
  s3Mock.reset();
});

afterAll(async () => {
  // Delete fixtures first so the outer user-delete doesn't fail on the
  // submissions FK.
  await cleanupTask19Fixtures();
  await restoreR2Accounts();
  await db.delete(sessions);
  await db.delete(users).where(like(users.email, "test-%@example.com"));
  await pool.end();
});

const app = createServer();

describe("POST /api/submissions/presign", () => {
  it("requires authentication (401)", async () => {
    const res = await app.request("/api/submissions/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "x.jpg", contentType: "image/jpeg", size: 1024 }),
    });
    expect(res.status).toBe(401);
  });

  it("returns presigned URL when authenticated and under daily limit", async () => {
    const sess = await createTestSession();
    const res = await app.request("/api/submissions/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sess.cookie },
      body: JSON.stringify({ filename: "x.jpg", contentType: "image/jpeg", size: 1024 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      r2AccountId: string;
      r2Key: string;
      uploadUrl: string;
      expiresAt: string;
    };
    expect(body.r2Key).toMatch(/^submissions\//);
    expect(body.uploadUrl.startsWith("https://")).toBe(true);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 60_000);
  });

  it("rejects unsupported MIME with 400", async () => {
    const sess = await createTestSession();
    const res = await app.request("/api/submissions/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sess.cookie },
      body: JSON.stringify({ filename: "x.gif", contentType: "image/gif", size: 1024 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 429 daily_limit_reached when count >= limit", async () => {
    const sess = await createTestSession();
    await db
      .update(users)
      .set({
        dailySubmissionCount: 10,
        dailySubmissionResetAt: new Date(),
      })
      .where(eq(users.id, sess.userId));
    const res = await app.request("/api/submissions/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sess.cookie },
      body: JSON.stringify({ filename: "x.jpg", contentType: "image/jpeg", size: 1024 }),
    });
    expect(res.status).toBe(429);
    const body = (await res.json()) as Record<string, unknown>;
    expect(JSON.stringify(body)).toContain("daily_limit_reached");
  });

  it("uses the demoted limit (5) when rejectedCount >= 3", async () => {
    const sess = await createTestSession();
    await db
      .update(users)
      .set({
        rejectedCount: 3,
        dailySubmissionCount: 5,
        dailySubmissionResetAt: new Date(),
      })
      .where(eq(users.id, sess.userId));
    const res = await app.request("/api/submissions/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sess.cookie },
      body: JSON.stringify({ filename: "x.jpg", contentType: "image/jpeg", size: 1024 }),
    });
    expect(res.status).toBe(429);
  });
});

// Helper that seeds one category + one tag fresh per test so the slug/id
// references are deterministic and isolated.
async function seedCategoryAndTag() {
  const [c] = await db
    .insert(categories)
    .values({
      slug: `${TEST_CATEGORY_SLUG_PREFIX}general`,
      name: { zh: "通用", en: "General" },
    })
    .returning();
  await db.insert(tags).values({
    slug: `${TEST_TAG_SLUG_PREFIX}a`,
    name: { zh: "标a", en: "Tag A" },
  });
  return { categoryId: c!.id, tagSlug: `${TEST_TAG_SLUG_PREFIX}a` };
}

async function getTestR2AccountId(): Promise<string> {
  const [acc] = await db
    .select()
    .from(r2Accounts)
    .where(eq(r2Accounts.name, `${TEST_R2_NAME_PREFIX}1`));
  return acc!.id;
}

describe("POST /api/submissions (create)", () => {
  it("requires authentication (401)", async () => {
    const res = await app.request("/api/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("returns 412 when guidelines not accepted", async () => {
    const sess = await createTestSession();
    const { categoryId, tagSlug } = await seedCategoryAndTag();
    const r2AccountId = await getTestR2AccountId();
    s3Mock
      .on(HeadObjectCommand)
      .resolves({ ContentLength: 1024, ContentType: "image/jpeg" });
    const res = await app.request("/api/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sess.cookie },
      body: JSON.stringify({
        titleZh: "标题",
        promptZh: "提示词",
        categoryId,
        tagSlugs: [tagSlug],
        images: [{ r2AccountId, r2Key: "submissions/x/y.jpg" }],
      }),
    });
    expect(res.status).toBe(412);
  });

  it("creates pending submission and bumps dailySubmissionCount", async () => {
    const sess = await createTestSession();
    await db
      .update(users)
      .set({ communityGuidelinesVersion: 1 })
      .where(eq(users.id, sess.userId));
    const { categoryId, tagSlug } = await seedCategoryAndTag();
    const r2AccountId = await getTestR2AccountId();
    s3Mock
      .on(HeadObjectCommand)
      .resolves({ ContentLength: 1024, ContentType: "image/jpeg" });
    const res = await app.request("/api/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sess.cookie },
      body: JSON.stringify({
        titleZh: "标题",
        promptZh: "提示词",
        categoryId,
        tagSlugs: [tagSlug],
        images: [{ r2AccountId, r2Key: "submissions/x/y.jpg" }],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; status: string };
    expect(body.status).toBe("pending");
    const [subRow] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.id, body.id));
    expect(subRow).toBeDefined();
    expect(subRow!.contributorId).toBe(sess.userId);
    const [reread] = await db.select().from(users).where(eq(users.id, sess.userId));
    expect(reread!.dailySubmissionCount).toBe(1);
  });

  it("returns 400 with unknown_tags when a slug isn't in tags table", async () => {
    const sess = await createTestSession();
    await db
      .update(users)
      .set({ communityGuidelinesVersion: 1 })
      .where(eq(users.id, sess.userId));
    const { categoryId, tagSlug } = await seedCategoryAndTag();
    const r2AccountId = await getTestR2AccountId();
    s3Mock
      .on(HeadObjectCommand)
      .resolves({ ContentLength: 1024, ContentType: "image/jpeg" });
    const res = await app.request("/api/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sess.cookie },
      body: JSON.stringify({
        titleZh: "x",
        promptZh: "y",
        categoryId,
        tagSlugs: [tagSlug, "task19-ghost-tag"],
        images: [{ r2AccountId, r2Key: "submissions/x/y.jpg" }],
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(JSON.stringify(body)).toContain("unknown_tags");
  });

  it("returns 400 image_missing when HEAD returns NotFound", async () => {
    const sess = await createTestSession();
    await db
      .update(users)
      .set({ communityGuidelinesVersion: 1 })
      .where(eq(users.id, sess.userId));
    const { categoryId, tagSlug } = await seedCategoryAndTag();
    const r2AccountId = await getTestR2AccountId();
    s3Mock
      .on(HeadObjectCommand)
      .rejects(Object.assign(new Error("not found"), { name: "NotFound" }));
    const res = await app.request("/api/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sess.cookie },
      body: JSON.stringify({
        titleZh: "x",
        promptZh: "y",
        categoryId,
        tagSlugs: [tagSlug],
        images: [{ r2AccountId, r2Key: "submissions/x/missing.jpg" }],
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(JSON.stringify(body)).toContain("image_missing");
  });
});
