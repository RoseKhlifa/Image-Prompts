import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, like, inArray } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  users,
  categories,
  submissions,
  prompts as promptsTable,
} from "../db/schema/index.ts";
import {
  listUsers,
  getUserDetail,
  updateUserRole,
} from "./owner-users.ts";

const TEST_EMAIL_PREFIX = "tw1u-";
const TEST_CATEGORY_SLUG_PREFIX = "tw1u-cat-";
const TEST_PROMPT_SLUG_PREFIX = "tw1u-prompt-";

async function cleanup() {
  // Find test users
  const testUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(like(users.email, `${TEST_EMAIL_PREFIX}%@example.com`));
  const testUserIds = testUsers.map((u) => u.id);

  // Submissions linked to test users
  if (testUserIds.length > 0) {
    await db.delete(submissions).where(inArray(submissions.contributorId, testUserIds));
  }

  // Test prompts (by slug prefix) — may have contributorId pointing at test users
  await db.delete(promptsTable).where(like(promptsTable.slug, `${TEST_PROMPT_SLUG_PREFIX}%`));

  // Test users
  await db.delete(users).where(like(users.email, `${TEST_EMAIL_PREFIX}%@example.com`));

  // Test categories
  await db.delete(categories).where(like(categories.slug, `${TEST_CATEGORY_SLUG_PREFIX}%`));
}

beforeEach(cleanup);
afterAll(cleanup);

let counter = 0;

async function makeUser(opts?: {
  role?: "user" | "moderator" | "admin";
  name?: string | null;
  rejectedCount?: number;
  dailySubmissionCount?: number;
  communityGuidelinesVersion?: number;
}) {
  counter += 1;
  const [row] = await db
    .insert(users)
    .values({
      email: `${TEST_EMAIL_PREFIX}${counter}@example.com`,
      name: opts?.name ?? `name-${counter}`,
      role: opts?.role ?? "user",
      rejectedCount: opts?.rejectedCount ?? 0,
      dailySubmissionCount: opts?.dailySubmissionCount ?? 0,
      communityGuidelinesVersion: opts?.communityGuidelinesVersion ?? 0,
    })
    .returning();
  return row!;
}

async function makeCategory() {
  counter += 1;
  const slug = `${TEST_CATEGORY_SLUG_PREFIX}${counter}`;
  const [c] = await db
    .insert(categories)
    .values({ slug, name: { zh: slug, en: slug } })
    .returning();
  return c!;
}

async function makePrompt(contributorId: string, categoryId: string) {
  counter += 1;
  const slug = `${TEST_PROMPT_SLUG_PREFIX}${counter}`;
  const [p] = await db
    .insert(promptsTable)
    .values({
      slug,
      title: { en: slug },
      prompt: { en: "p" },
      categoryId,
      contributorId,
    })
    .returning();
  return p!;
}

async function makeSubmission(
  contributorId: string,
  categoryId: string,
  status: "pending" | "approved" | "rejected" = "pending",
  titleEn = "sub",
) {
  const [s] = await db
    .insert(submissions)
    .values({
      contributorId,
      categoryId,
      title: { en: titleEn },
      prompt: { en: "p" },
      imageKeys: [{ r2AccountId: "11111111-1111-1111-1111-111111111111", r2Key: "k" }],
      agreedGuidelinesVersion: 1,
      status,
    })
    .returning();
  return s!;
}

describe("listUsers", () => {
  it("returns rows in createdAt desc order with the documented shape", async () => {
    const u1 = await makeUser();
    await new Promise((r) => setTimeout(r, 5));
    const u2 = await makeUser();

    const { items } = await listUsers({});
    // Filter to just our test users so the assertion isn't polluted by pre-existing rows
    const ours = items.filter((i) => i.id === u1.id || i.id === u2.id);
    expect(ours).toHaveLength(2);
    // newest first
    expect(ours[0]!.id).toBe(u2.id);
    expect(ours[1]!.id).toBe(u1.id);
    // shape
    const row = ours[0]!;
    expect(typeof row.email).toBe("string");
    expect(row.role).toBe("user");
    expect(typeof row.publishedPrompts).toBe("number");
    expect(typeof row.totalSubmissions).toBe("number");
    expect(typeof row.rejectedCount).toBe("number");
    expect(row.bannedAt).toBeNull();
    expect(row.createdAt instanceof Date).toBe(true);
  });

  it("filters by partial email match via q", async () => {
    const u1 = await makeUser({ name: "Alice Wonder" });
    await makeUser({ name: "Bob Builder" });

    // Match by part of test email prefix + counter
    const emailFragment = u1.email.split("@")[0]!;
    const { items } = await listUsers({ q: emailFragment });
    expect(items.find((i) => i.id === u1.id)).toBeDefined();
  });

  it("filters by partial name match via q (case-insensitive)", async () => {
    const u1 = await makeUser({ name: "AliceWonder" });
    await makeUser({ name: "Bob Builder" });

    const { items } = await listUsers({ q: "alicewonder" });
    const found = items.find((i) => i.id === u1.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe("AliceWonder");
  });

  it("filters by role", async () => {
    const admin = await makeUser({ role: "admin" });
    const mod = await makeUser({ role: "moderator" });
    const plain = await makeUser({ role: "user" });

    const { items } = await listUsers({ role: "admin" });
    const ours = items.filter((i) =>
      [admin.id, mod.id, plain.id].includes(i.id),
    );
    expect(ours).toHaveLength(1);
    expect(ours[0]!.id).toBe(admin.id);
  });

  it("paginates with limit + cursor", async () => {
    const u1 = await makeUser();
    await new Promise((r) => setTimeout(r, 5));
    const u2 = await makeUser();
    await new Promise((r) => setTimeout(r, 5));
    const u3 = await makeUser();

    // Restrict the search to our test users so other DB rows do not crowd us out.
    const { items: page1, nextCursor } = await listUsers({
      q: TEST_EMAIL_PREFIX,
      limit: 1,
    });
    expect(page1).toHaveLength(1);
    expect(page1[0]!.id).toBe(u3.id);
    expect(nextCursor).not.toBeNull();

    const { items: page2 } = await listUsers({
      q: TEST_EMAIL_PREFIX,
      limit: 1,
      cursor: nextCursor!,
    });
    expect(page2).toHaveLength(1);
    expect(page2[0]!.id).toBe(u2.id);

    const { items: page3, nextCursor: lastCursor } = await listUsers({
      q: TEST_EMAIL_PREFIX,
      limit: 1,
      cursor: (await listUsers({ q: TEST_EMAIL_PREFIX, limit: 2 })).nextCursor!,
    });
    expect(page3).toHaveLength(1);
    expect(page3[0]!.id).toBe(u1.id);
    expect(lastCursor).toBeNull();
  });

  it("counts publishedPrompts and totalSubmissions per user", async () => {
    const u = await makeUser();
    const c = await makeCategory();
    await makePrompt(u.id, c.id);
    await makePrompt(u.id, c.id);
    await makeSubmission(u.id, c.id, "pending");
    await makeSubmission(u.id, c.id, "approved");
    await makeSubmission(u.id, c.id, "rejected");

    const { items } = await listUsers({ q: u.email.split("@")[0]! });
    const found = items.find((i) => i.id === u.id);
    expect(found).toBeDefined();
    expect(found!.publishedPrompts).toBe(2);
    expect(found!.totalSubmissions).toBe(3);
  });
});

describe("getUserDetail", () => {
  it("returns null for an unknown id", async () => {
    const r = await getUserDetail("00000000-0000-0000-0000-000000000000");
    expect(r).toBeNull();
  });

  it("returns user + stats + recent submissions (up to 10)", async () => {
    const u = await makeUser({ communityGuidelinesVersion: 3, rejectedCount: 1 });
    const c = await makeCategory();
    await makePrompt(u.id, c.id);
    // 12 submissions — only newest 10 should come back
    for (let i = 0; i < 12; i++) {
      await makeSubmission(u.id, c.id, "pending", `sub-${i}`);
      await new Promise((r) => setTimeout(r, 2));
    }

    const r = await getUserDetail(u.id);
    expect(r).not.toBeNull();
    expect(r!.id).toBe(u.id);
    expect(r!.email).toBe(u.email);
    expect(r!.communityGuidelinesVersion).toBe(3);
    expect(r!.rejectedCount).toBe(1);
    expect(r!.publishedPrompts).toBe(1);
    expect(r!.totalSubmissions).toBe(12);
    expect(r!.bannedAt).toBeNull();
    expect(r!.recentSubmissions).toHaveLength(10);
    // newest first
    expect(r!.recentSubmissions[0]!.titleEn).toBe("sub-11");
    expect(r!.recentSubmissions[9]!.titleEn).toBe("sub-2");
    // status shape
    expect(r!.recentSubmissions[0]!.status).toBe("pending");
    expect(r!.recentSubmissions[0]!.createdAt instanceof Date).toBe(true);
  });

  it("returns zero counts for a user with no prompts or submissions", async () => {
    const u = await makeUser();
    const r = await getUserDetail(u.id);
    expect(r).not.toBeNull();
    expect(r!.publishedPrompts).toBe(0);
    expect(r!.totalSubmissions).toBe(0);
    expect(r!.recentSubmissions).toEqual([]);
  });
});

describe("updateUserRole", () => {
  it("updates the role field", async () => {
    const u = await makeUser({ role: "user" });
    await updateUserRole(u.id, "moderator");
    const [reread] = await db.select().from(users).where(eq(users.id, u.id));
    expect(reread!.role).toBe("moderator");

    await updateUserRole(u.id, "admin");
    const [reread2] = await db.select().from(users).where(eq(users.id, u.id));
    expect(reread2!.role).toBe("admin");
  });
});
