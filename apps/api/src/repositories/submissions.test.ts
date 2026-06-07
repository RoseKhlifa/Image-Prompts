import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, like, inArray } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  users,
  categories,
  submissions,
} from "../db/schema/index.ts";
import {
  createSubmission,
  getSubmissionById,
  listForUser,
  listForAdmin,
} from "./submissions.ts";

const TEST_EMAIL_PREFIX = "subs-repo-test-";
const TEST_CATEGORY_SLUG_PREFIX = "task15-cat-";

async function cleanup() {
  // 1. Delete submissions belonging to test users
  const testUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${TEST_EMAIL_PREFIX}%@example.com`));
  if (testUsers.length > 0) {
    await db
      .delete(submissions)
      .where(inArray(submissions.contributorId, testUsers.map((u) => u.id)));
  }
  // 2. Delete test users
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%@example.com`));
  // 3. Delete test categories (FK from submissions, so do this after submissions deletion)
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
