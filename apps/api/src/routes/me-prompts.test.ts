import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { eq, like, inArray } from "drizzle-orm";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { db, pool } from "../db/client.ts";
import { users, sessions } from "../db/schema/auth.ts";
import {
  categories,
  tags,
  r2Accounts,
  prompts as promptsTable,
  promptImages,
  promptTags,
  submissions,
  siteSettings,
  notifications,
  auditLog,
} from "../db/schema/index.ts";
import { createServer } from "../server.ts";
import { createTestSession } from "../auth/test-session.ts";
import { encryptSecret } from "../lib/crypto.ts";
import { clearR2ClientCache } from "../lib/r2-client-cache.ts";
import { resetSubmitConfigCache } from "../lib/submit-config.ts";

// Test isolation: tw42m- prefix per the test-isolation spec for Feature B
// user-edit / self-delete. We seed our own r2_accounts row + category + tags
// + prompt per test; cleanup() sweeps by these prefixes so nothing leaks.
const TEST_EMAIL_PREFIX = "me-prompts-test-";
const TEST_CATEGORY_PREFIX = "tw42m-cat-";
const TEST_TAG_PREFIX = "tw42m-tag-";
const TEST_PROMPT_PREFIX = "tw42m-prompt-";
const TEST_R2_NAME = "tw42m-r2";

beforeAll(() => {
  process.env.R2_ENCRYPTION_KEY ||=
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

const s3Mock = mockClient(S3Client);
const app = createServer();

async function cleanup() {
  // Test user ids (purged later in afterAll). We need them now so cascading
  // submissions/notifications/audit can be cleared FIRST.
  const testUserIds = (
    await db
      .select({ id: users.id })
      .from(users)
      .where(like(users.email, `${TEST_EMAIL_PREFIX}%@example.com`))
  ).map((u) => u.id);

  if (testUserIds.length > 0) {
    await db.delete(notifications).where(inArray(notifications.userId, testUserIds));
    await db.delete(submissions).where(inArray(submissions.contributorId, testUserIds));
    await db.delete(auditLog).where(inArray(auditLog.actorId, testUserIds));
  }

  // Test prompts (by slug prefix) + their dependents.
  const testPromptIds = (
    await db
      .select({ id: promptsTable.id })
      .from(promptsTable)
      .where(like(promptsTable.slug, `${TEST_PROMPT_PREFIX}%`))
  ).map((p) => p.id);
  if (testPromptIds.length > 0) {
    await db
      .delete(promptImages)
      .where(inArray(promptImages.promptId, testPromptIds));
    await db
      .delete(promptTags)
      .where(inArray(promptTags.promptId, testPromptIds));
    await db
      .update(submissions)
      .set({ promotedTo: null, originalPromptId: null })
      .where(inArray(submissions.promotedTo, testPromptIds));
    await db
      .update(submissions)
      .set({ originalPromptId: null })
      .where(inArray(submissions.originalPromptId, testPromptIds));
    await db.delete(promptsTable).where(inArray(promptsTable.id, testPromptIds));
  }

  // Test categories + tags.
  const testCatIds = (
    await db
      .select({ id: categories.id })
      .from(categories)
      .where(like(categories.slug, `${TEST_CATEGORY_PREFIX}%`))
  ).map((r) => r.id);
  if (testCatIds.length > 0) {
    await db.delete(categories).where(inArray(categories.id, testCatIds));
  }
  await db.delete(tags).where(like(tags.slug, `${TEST_TAG_PREFIX}%`));

  // Test R2 row.
  await db.delete(r2Accounts).where(eq(r2Accounts.name, TEST_R2_NAME));

  // Reset daily_limit baseline so a prior test's leftover setting doesn't
  // collapse our daily quota for the next test.
  await db
    .update(siteSettings)
    .set({ value: 10 as unknown as never })
    .where(eq(siteSettings.key, "submit.daily_limit"));
}

beforeEach(async () => {
  await cleanup();
  resetSubmitConfigCache();
  clearR2ClientCache();
  s3Mock.reset();
});

afterAll(async () => {
  await cleanup();
  await db.delete(sessions);
  await db
    .delete(users)
    .where(like(users.email, `${TEST_EMAIL_PREFIX}%@example.com`));
  await pool.end();
});

let counter = 0;

async function makeUser(emailSuffix = "") {
  counter += 1;
  const email = `${TEST_EMAIL_PREFIX}${counter}-${Math.random().toString(36).slice(2)}${emailSuffix}@example.com`;
  return createTestSession({ email });
}

async function makeR2() {
  const [r] = await db
    .insert(r2Accounts)
    .values({
      name: TEST_R2_NAME,
      accountId: "tw42m-acc",
      endpoint: "https://tw42m.example.com",
      accessKeyId: "K",
      accessKeySecretEncrypted: encryptSecret("s"),
      bucket: "tw42m",
      publicUrl: "https://tw42m.example.com",
      priority: 999,
      enabled: false,
    })
    .returning();
  return r!;
}

async function makeCategory() {
  counter += 1;
  const slug = `${TEST_CATEGORY_PREFIX}${counter}`;
  const [c] = await db
    .insert(categories)
    .values({ slug, name: { zh: slug, en: slug } })
    .returning();
  return c!;
}

async function makePrompt(opts: {
  contributorId: string;
  categoryId: string;
  r2AccountId: string;
}): Promise<{ id: string; slug: string }> {
  counter += 1;
  const slug = `${TEST_PROMPT_PREFIX}${counter}-${Math.random().toString(36).slice(2)}`;
  const [p] = await db
    .insert(promptsTable)
    .values({
      slug,
      title: { en: `tw42m title ${counter}` },
      prompt: { en: "p" },
      categoryId: opts.categoryId,
      contributorId: opts.contributorId,
    })
    .returning({ id: promptsTable.id });
  await db.insert(promptImages).values({
    promptId: p!.id,
    r2AccountId: opts.r2AccountId,
    r2Key: `prompts/${p!.id}/0.jpg`,
    order: 0,
  });
  return { id: p!.id, slug };
}

// ── DELETE /api/me/prompts/:id ──────────────────────────────────────────

describe("DELETE /api/me/prompts/:id", () => {
  it("DELETE my own → 200, prompt gone, FK cleanup", async () => {
    const sess = await makeUser();
    const r2 = await makeR2();
    const cat = await makeCategory();
    const { id: promptId } = await makePrompt({
      contributorId: sess.userId,
      categoryId: cat.id,
      r2AccountId: r2.id,
    });
    s3Mock.on(DeleteObjectCommand).resolves({});

    const res = await app.request(`/api/me/prompts/${promptId}`, {
      method: "DELETE",
      headers: { Cookie: sess.cookie },
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { id: string; deleted: boolean };
    expect(j.deleted).toBe(true);

    // Prompt row gone, prompt_images cascaded.
    const rows = await db
      .select()
      .from(promptsTable)
      .where(eq(promptsTable.id, promptId));
    expect(rows).toHaveLength(0);
    const imgs = await db
      .select()
      .from(promptImages)
      .where(eq(promptImages.promptId, promptId));
    expect(imgs).toHaveLength(0);

    // Audit row recorded.
    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetId, promptId));
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits[0]!.action).toBe("prompt.self_delete");
  });

  it("DELETE someone else's → 403 not_owner", async () => {
    const owner = await makeUser("-owner");
    const other = await makeUser("-other");
    const r2 = await makeR2();
    const cat = await makeCategory();
    const { id: promptId } = await makePrompt({
      contributorId: owner.userId,
      categoryId: cat.id,
      r2AccountId: r2.id,
    });

    const res = await app.request(`/api/me/prompts/${promptId}`, {
      method: "DELETE",
      headers: { Cookie: other.cookie },
    });
    expect(res.status).toBe(403);
    // Row still exists.
    const rows = await db
      .select()
      .from(promptsTable)
      .where(eq(promptsTable.id, promptId));
    expect(rows).toHaveLength(1);
  });

  it("DELETE unauthenticated → 401", async () => {
    const r2 = await makeR2();
    const cat = await makeCategory();
    const owner = await makeUser();
    const { id: promptId } = await makePrompt({
      contributorId: owner.userId,
      categoryId: cat.id,
      r2AccountId: r2.id,
    });
    const res = await app.request(`/api/me/prompts/${promptId}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(401);
  });
});

// ── POST /api/me/prompts/:id/edit ───────────────────────────────────────

function makeEditBody(opts: {
  categoryId: string;
  r2AccountId: string;
  r2Key: string;
  title?: string;
}): Record<string, unknown> {
  return {
    title: opts.title ?? "tw42m edit title",
    promptZh: "edit prompt zh",
    promptEn: "edit prompt en",
    categoryId: opts.categoryId,
    tagSlugs: [],
    images: [{ r2AccountId: opts.r2AccountId, r2Key: opts.r2Key }],
  };
}

describe("POST /api/me/prompts/:id/edit", () => {
  it("POST /:id/edit my own → 200, submission row with originalPromptId", async () => {
    const sess = await makeUser();
    const r2 = await makeR2();
    const cat = await makeCategory();
    const { id: promptId } = await makePrompt({
      contributorId: sess.userId,
      categoryId: cat.id,
      r2AccountId: r2.id,
    });
    // User must have accepted the current guidelines version (default = 1).
    await db
      .update(users)
      .set({ communityGuidelinesVersion: 1 })
      .where(eq(users.id, sess.userId));
    // R2 HEAD must succeed with a reasonable size.
    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: 1024 });

    const submissionKey = `submissions/${sess.userId}/edit-${Date.now()}.jpg`;
    const res = await app.request(`/api/me/prompts/${promptId}/edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sess.cookie },
      body: JSON.stringify(
        makeEditBody({
          categoryId: cat.id,
          r2AccountId: r2.id,
          r2Key: submissionKey,
        }),
      ),
    });
    if (res.status !== 201) {
      console.log("body:", await res.text());
    }
    expect(res.status).toBe(201);
    const j = (await res.json()) as { submissionId: string; status: string };
    expect(typeof j.submissionId).toBe("string");
    expect(j.status).toBe("pending");

    const [sub] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.id, j.submissionId));
    expect(sub!.originalPromptId).toBe(promptId);
    expect(sub!.contributorId).toBe(sess.userId);
    expect(sub!.status).toBe("pending");

    // Audit row.
    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.targetId, j.submissionId));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe("prompt.self_edit_submitted");
  });

  it("POST /:id/edit someone else's → 403 not_owner", async () => {
    const owner = await makeUser("-owner");
    const other = await makeUser("-other");
    const r2 = await makeR2();
    const cat = await makeCategory();
    const { id: promptId } = await makePrompt({
      contributorId: owner.userId,
      categoryId: cat.id,
      r2AccountId: r2.id,
    });
    await db
      .update(users)
      .set({ communityGuidelinesVersion: 1 })
      .where(eq(users.id, other.userId));
    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: 1024 });
    const res = await app.request(`/api/me/prompts/${promptId}/edit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: other.cookie },
      body: JSON.stringify(
        makeEditBody({
          categoryId: cat.id,
          r2AccountId: r2.id,
          r2Key: `submissions/${other.userId}/x.jpg`,
        }),
      ),
    });
    expect(res.status).toBe(403);
  });

  it("POST /:id/edit non-existent → 404", async () => {
    const sess = await makeUser();
    const r2 = await makeR2();
    const cat = await makeCategory();
    await db
      .update(users)
      .set({ communityGuidelinesVersion: 1 })
      .where(eq(users.id, sess.userId));
    s3Mock.on(HeadObjectCommand).resolves({ ContentLength: 1024 });
    const res = await app.request(
      "/api/me/prompts/00000000-0000-0000-0000-000000000000/edit",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: sess.cookie },
        body: JSON.stringify(
          makeEditBody({
            categoryId: cat.id,
            r2AccountId: r2.id,
            r2Key: `submissions/${sess.userId}/x.jpg`,
          }),
        ),
      },
    );
    expect(res.status).toBe(404);
  });
});
