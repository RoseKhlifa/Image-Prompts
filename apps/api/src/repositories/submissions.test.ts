import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, like, inArray } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  users,
  categories,
  submissions,
  tags,
  promptTags,
  prompts as promptsTable,
  notifications,
  auditLog,
} from "../db/schema/index.ts";
import {
  createSubmission,
  getSubmissionById,
  listForUser,
  listForAdmin,
  approveSubmission,
  rejectSubmission,
  AlreadyResolvedError,
} from "./submissions.ts";

const TEST_EMAIL_PREFIX = "subs-repo-test-";
const TEST_CATEGORY_SLUG_PREFIX = "task15-cat-";
const TEST_TAG_SLUG_PREFIX = "task16-tag-";
const TEST_PROMPT_SLUG_PREFIX = "task16-prompt-";

async function cleanup() {
  // 1. audit_log: actions used by approve/reject transactions
  await db.delete(auditLog).where(eq(auditLog.action, "submission.approve"));
  await db.delete(auditLog).where(eq(auditLog.action, "submission.reject"));

  // 2. Find test users
  const testUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${TEST_EMAIL_PREFIX}%@example.com`));
  const testUserIds = testUsers.map((u) => u.id);

  // 3. Notifications for test users (notifications.user_id cascades on delete, but
  //    explicit cleanup keeps the order safe even if the cascade rule changes.)
  if (testUserIds.length > 0) {
    await db.delete(notifications).where(inArray(notifications.userId, testUserIds));
  }

  // 4. Test submissions (must come BEFORE deleting prompts, because
  //    submissions.promoted_to has FK to prompts.id)
  if (testUserIds.length > 0) {
    await db.delete(submissions).where(inArray(submissions.contributorId, testUserIds));
  }

  // 5. Test prompts (created by approve transaction)
  const testPrompts = await db
    .select({ id: promptsTable.id })
    .from(promptsTable)
    .where(like(promptsTable.slug, `${TEST_PROMPT_SLUG_PREFIX}%`));
  const testPromptIds = testPrompts.map((p) => p.id);

  // 6. prompt_tags + prompts
  if (testPromptIds.length > 0) {
    await db.delete(promptTags).where(inArray(promptTags.promptId, testPromptIds));
    await db.delete(promptsTable).where(inArray(promptsTable.id, testPromptIds));
  }

  // 7. Test tags
  await db.delete(tags).where(like(tags.slug, `${TEST_TAG_SLUG_PREFIX}%`));

  // 8. Test users
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%@example.com`));

  // 9. Test categories (FK from submissions/prompts, so this happens last)
  await db.delete(categories).where(like(categories.slug, `${TEST_CATEGORY_SLUG_PREFIX}%`));
}

beforeEach(cleanup);
afterAll(cleanup);

let counter = 0;
async function makeUser(role: "user" | "admin" = "user") {
  counter += 1;
  const [u] = await db
    .insert(users)
    .values({ email: `${TEST_EMAIL_PREFIX}${counter}@example.com`, role })
    .returning();
  return u!;
}

async function makeCategory(label = "default") {
  counter += 1;
  const slug = `${TEST_CATEGORY_SLUG_PREFIX}${counter}-${label}`;
  const [c] = await db
    .insert(categories)
    .values({ slug, name: { zh: slug, en: slug } })
    .returning();
  return c!;
}

const img1 = {
  r2AccountId: "11111111-1111-1111-1111-111111111111",
  r2Key: "submissions/u/abc.jpg",
};

describe("createSubmission", () => {
  it("inserts with status='pending' and agreedGuidelinesVersion + jsonb shape", async () => {
    const u = await makeUser();
    const c = await makeCategory();
    const id = await createSubmission({
      contributorId: u.id,
      titleZh: "标题",
      titleEn: null,
      promptZh: "提示词",
      promptEn: null,
      negativePromptZh: null,
      negativePromptEn: null,
      notesZh: null,
      notesEn: null,
      aspectRatio: "1:1",
      categoryId: c.id,
      tagSlugs: ["a", "b"],
      images: [img1],
      agreedGuidelinesVersion: 1,
    });
    const [row] = await db.select().from(submissions).where(eq(submissions.id, id));
    expect(row!.status).toBe("pending");
    expect(row!.agreedGuidelinesVersion).toBe(1);
    expect(row!.imageKeys).toHaveLength(1);
    expect(row!.tagSlugs).toEqual(["a", "b"]);
    // jsonb shape:
    expect(row!.title).toEqual({ zh: "标题" });
    expect(row!.prompt).toEqual({ zh: "提示词" });
  });
});

describe("getSubmissionById", () => {
  it("returns null for unknown id", async () => {
    expect(await getSubmissionById("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("returns the row with contributor info joined", async () => {
    const u = await makeUser();
    const c = await makeCategory();
    const id = await createSubmission({
      contributorId: u.id,
      titleEn: "T",
      titleZh: null,
      promptEn: "P",
      promptZh: null,
      negativePromptZh: null,
      negativePromptEn: null,
      notesZh: null,
      notesEn: null,
      aspectRatio: null,
      categoryId: c.id,
      tagSlugs: [],
      images: [img1],
      agreedGuidelinesVersion: 1,
    });
    const got = await getSubmissionById(id);
    expect(got).not.toBeNull();
    expect(got!.id).toBe(id);
    expect(got!.titleEn).toBe("T");
    expect(got!.titleZh).toBeNull();
    expect(got!.contributor.email).toBe(u.email);
    expect(got!.contributor.rejectedCount).toBe(0);
  });
});

describe("listForUser", () => {
  it("returns only submissions belonging to the user, newest first", async () => {
    const u1 = await makeUser();
    const u2 = await makeUser();
    const c = await makeCategory();
    await createSubmission({
      contributorId: u1.id, titleZh: "u1-1", titleEn: null,
      promptZh: "p", promptEn: null, negativePromptZh: null, negativePromptEn: null,
      notesZh: null, notesEn: null, aspectRatio: null, categoryId: c.id,
      tagSlugs: [], images: [img1], agreedGuidelinesVersion: 1,
    });
    await new Promise((r) => setTimeout(r, 5));
    await createSubmission({
      contributorId: u1.id, titleZh: "u1-2", titleEn: null,
      promptZh: "p", promptEn: null, negativePromptZh: null, negativePromptEn: null,
      notesZh: null, notesEn: null, aspectRatio: null, categoryId: c.id,
      tagSlugs: [], images: [img1], agreedGuidelinesVersion: 1,
    });
    await createSubmission({
      contributorId: u2.id, titleZh: "u2-1", titleEn: null,
      promptZh: "p", promptEn: null, negativePromptZh: null, negativePromptEn: null,
      notesZh: null, notesEn: null, aspectRatio: null, categoryId: c.id,
      tagSlugs: [], images: [img1], agreedGuidelinesVersion: 1,
    });
    const { items } = await listForUser(u1.id, { cursor: null, limit: 10, status: null });
    expect(items).toHaveLength(2);
    expect(items[0]!.titleZh).toBe("u1-2");
    expect(items[1]!.titleZh).toBe("u1-1");
  });

  it("filters by status when provided", async () => {
    const u = await makeUser();
    const c = await makeCategory();
    const id = await createSubmission({
      contributorId: u.id, titleZh: "x", titleEn: null,
      promptZh: "x", promptEn: null, negativePromptZh: null, negativePromptEn: null,
      notesZh: null, notesEn: null, aspectRatio: null, categoryId: c.id,
      tagSlugs: [], images: [img1], agreedGuidelinesVersion: 1,
    });
    await db.update(submissions).set({ status: "rejected", rejectReason: "nope-12345" }).where(eq(submissions.id, id));
    const pending = await listForUser(u.id, { cursor: null, limit: 10, status: "pending" });
    expect(pending.items).toHaveLength(0);
    const rej = await listForUser(u.id, { cursor: null, limit: 10, status: "rejected" });
    expect(rej.items).toHaveLength(1);
    expect(rej.items[0]!.rejectReason).toBe("nope-12345");
  });
});

describe("listForAdmin", () => {
  it("returns submissions for the specified status, newest first, with contributor info", async () => {
    const u1 = await makeUser();
    const u2 = await makeUser();
    const c = await makeCategory();
    for (const u of [u1, u2]) {
      await createSubmission({
        contributorId: u.id, titleEn: "T", titleZh: null,
        promptEn: "P", promptZh: null, negativePromptZh: null, negativePromptEn: null,
        notesZh: null, notesEn: null, aspectRatio: null, categoryId: c.id,
        tagSlugs: [], images: [img1], agreedGuidelinesVersion: 1,
      });
    }
    const { items } = await listForAdmin({ cursor: null, limit: 10, status: "pending" });
    // The query is unscoped — assert OUR users' submissions are present (others may exist from seed/prior tests)
    const ourEmails = items.map((i) => i.contributor.email).filter(Boolean);
    expect(ourEmails).toEqual(expect.arrayContaining([u1.email, u2.email]));
  });
});

async function makeAdmin() {
  counter += 1;
  const [u] = await db.insert(users).values({
    email: `${TEST_EMAIL_PREFIX}admin-${counter}@example.com`,
    role: "admin",
  }).returning();
  return u!;
}

async function makeTag(label: string) {
  const slug = `${TEST_TAG_SLUG_PREFIX}${label}`;
  const [t] = await db.insert(tags).values({ slug, name: { zh: slug, en: slug } }).returning();
  return t!;
}

describe("approveSubmission (transaction)", () => {
  it("inserts prompt, updates submission, links tags, bumps usage, creates notification + audit", async () => {
    const u = await makeUser();
    const a = await makeAdmin();
    const c = await makeCategory("general");
    const tagA = await makeTag("a");
    const tagB = await makeTag("b");
    const subId = await createSubmission({
      contributorId: u.id,
      titleZh: `${TEST_PROMPT_SLUG_PREFIX}中文`,  // Title will become the slug; prefix it.
      titleEn: "English",
      promptZh: "中文 prompt",
      promptEn: "english prompt",
      negativePromptZh: null, negativePromptEn: null,
      notesZh: null, notesEn: null,
      aspectRatio: "1:1",
      categoryId: c.id,
      tagSlugs: [tagA.slug, tagB.slug],
      images: [img1],
      agreedGuidelinesVersion: 1,
    });

    const { promptId, slug } = await approveSubmission({
      submissionId: subId,
      actorId: a.id,
      actorRole: "admin",
      edits: {},
    });

    // prompts row exists
    const [p] = await db.select().from(promptsTable).where(eq(promptsTable.id, promptId));
    expect(p!.slug).toBe(slug);
    expect(p!.contributorId).toBe(u.id);
    expect(p!.title).toMatchObject({ zh: `${TEST_PROMPT_SLUG_PREFIX}中文`, en: "English" });
    expect(p!.categoryId).toBe(c.id);

    // prompt_tags has 2 links
    const links = await db.select().from(promptTags).where(eq(promptTags.promptId, promptId));
    expect(links).toHaveLength(2);

    // tags.usageCount bumped
    const tagRows = await db.select().from(tags).where(inArray(tags.slug, [tagA.slug, tagB.slug]));
    expect(tagRows.find((t) => t.slug === tagA.slug)!.usageCount).toBe(1);

    // submission flipped
    const [sub] = await db.select().from(submissions).where(eq(submissions.id, subId));
    expect(sub!.status).toBe("approved");
    expect(sub!.promotedTo).toBe(promptId);
    expect(sub!.reviewedBy).toBe(a.id);

    // notification created
    const notifs = await db.select().from(notifications).where(eq(notifications.userId, u.id));
    expect(notifs).toHaveLength(1);
    expect(notifs[0]!.type).toBe("submission_approved");

    // audit log
    const audits = await db.select().from(auditLog).where(eq(auditLog.targetId, subId));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe("submission.approve");
  });

  it("throws AlreadyResolvedError if status is not pending", async () => {
    const u = await makeUser();
    const a = await makeAdmin();
    const c = await makeCategory();
    const subId = await createSubmission({
      contributorId: u.id, titleZh: `${TEST_PROMPT_SLUG_PREFIX}x`, titleEn: null,
      promptZh: "x", promptEn: null,
      negativePromptZh: null, negativePromptEn: null,
      notesZh: null, notesEn: null,
      aspectRatio: null, categoryId: c.id,
      tagSlugs: [], images: [img1], agreedGuidelinesVersion: 1,
    });
    await db.update(submissions).set({ status: "approved" }).where(eq(submissions.id, subId));
    await expect(
      approveSubmission({
        submissionId: subId, actorId: a.id, actorRole: "admin", edits: {},
      }),
    ).rejects.toBeInstanceOf(AlreadyResolvedError);
  });

  it("applies edits on top of submission fields", async () => {
    const u = await makeUser();
    const a = await makeAdmin();
    const c1 = await makeCategory("c1");
    const c2 = await makeCategory("c2");
    const subId = await createSubmission({
      contributorId: u.id, titleZh: `${TEST_PROMPT_SLUG_PREFIX}原`, titleEn: null,
      promptZh: "原 prompt", promptEn: null,
      negativePromptZh: null, negativePromptEn: null,
      notesZh: null, notesEn: null,
      aspectRatio: null, categoryId: c1.id,
      tagSlugs: [], images: [img1], agreedGuidelinesVersion: 1,
    });
    const { promptId } = await approveSubmission({
      submissionId: subId, actorId: a.id, actorRole: "admin",
      edits: { titleZh: `${TEST_PROMPT_SLUG_PREFIX}新`, categoryId: c2.id },
    });
    const [p] = await db.select().from(promptsTable).where(eq(promptsTable.id, promptId));
    expect(p!.title).toMatchObject({ zh: `${TEST_PROMPT_SLUG_PREFIX}新` });
    expect(p!.categoryId).toBe(c2.id);
  });
});

describe("rejectSubmission (transaction)", () => {
  it("flips status, increments rejectedCount, creates notification + audit", async () => {
    const u = await makeUser();
    const a = await makeAdmin();
    const c = await makeCategory();
    const subId = await createSubmission({
      contributorId: u.id, titleZh: "x", titleEn: null,
      promptZh: "x", promptEn: null,
      negativePromptZh: null, negativePromptEn: null,
      notesZh: null, notesEn: null,
      aspectRatio: null, categoryId: c.id,
      tagSlugs: [], images: [img1], agreedGuidelinesVersion: 1,
    });
    await rejectSubmission({
      submissionId: subId,
      actorId: a.id,
      reason: "Bad content, fails guidelines",
    });
    const [sub] = await db.select().from(submissions).where(eq(submissions.id, subId));
    expect(sub!.status).toBe("rejected");
    expect(sub!.rejectReason).toBe("Bad content, fails guidelines");
    const [reread] = await db.select().from(users).where(eq(users.id, u.id));
    expect(reread!.rejectedCount).toBe(1);
    const notifs = await db.select().from(notifications).where(eq(notifications.userId, u.id));
    expect(notifs).toHaveLength(1);
    expect(notifs[0]!.type).toBe("submission_rejected");
    const audits = await db.select().from(auditLog).where(eq(auditLog.targetId, subId));
    expect(audits[0]!.action).toBe("submission.reject");
  });

  it("throws AlreadyResolvedError on non-pending", async () => {
    const u = await makeUser();
    const a = await makeAdmin();
    const c = await makeCategory();
    const subId = await createSubmission({
      contributorId: u.id, titleZh: "x", titleEn: null,
      promptZh: "x", promptEn: null,
      negativePromptZh: null, negativePromptEn: null,
      notesZh: null, notesEn: null,
      aspectRatio: null, categoryId: c.id,
      tagSlugs: [], images: [img1], agreedGuidelinesVersion: 1,
    });
    await db.update(submissions).set({ status: "rejected", rejectReason: "x" }).where(eq(submissions.id, subId));
    await expect(
      rejectSubmission({
        submissionId: subId, actorId: a.id, reason: "1234567890",
      }),
    ).rejects.toBeInstanceOf(AlreadyResolvedError);
  });
});
