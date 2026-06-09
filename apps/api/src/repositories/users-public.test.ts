import { describe, it, expect, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db, pool } from "../db/client.ts";
import { users } from "../db/schema/auth.ts";
import {
  prompts,
  promptImages,
  categories,
  userPinnedPrompts,
} from "../db/schema/index.ts";
import { r2Accounts } from "../db/schema/images.ts";
import { encryptSecret } from "../lib/crypto.ts";
import {
  getUserPublic,
  getUserStats,
  listUserPrompts,
  listUserFavorites,
} from "./users-public.ts";

const PREFIX = "users-public-test-";
const TEST_R2_NAME = "users-public-test-r2";

process.env.R2_ENCRYPTION_KEY ||=
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

afterAll(async () => {
  // Clean test users + cascade their data
  const ids = (
    await db.select({ id: users.id }).from(users).where(like(users.email, `${PREFIX}%`))
  ).map((r) => r.id);
  // delete prompts contributed by test users first (FK)
  for (const uid of ids) {
    const ps = (
      await db.select({ id: prompts.id }).from(prompts).where(eq(prompts.contributorId, uid))
    ).map((p) => p.id);
    for (const pid of ps) {
      await db.delete(userPinnedPrompts).where(eq(userPinnedPrompts.promptId, pid));
      await db.delete(promptImages).where(eq(promptImages.promptId, pid));
      await db.delete(prompts).where(eq(prompts.id, pid));
    }
    await db.delete(userPinnedPrompts).where(eq(userPinnedPrompts.userId, uid));
  }
  // also clean test categories
  await db.delete(categories).where(like(categories.slug, `${PREFIX}%`));
  await db.delete(users).where(like(users.email, `${PREFIX}%`));
  await db.delete(r2Accounts).where(eq(r2Accounts.name, TEST_R2_NAME));
  await pool.end();
});

async function makeUser(label: string) {
  const [u] = await db
    .insert(users)
    .values({
      email: `${PREFIX}${label}@example.com`,
      name: `Name-${label}`,
      image: null,
    })
    .returning();
  return u!;
}

let counter = 0;
function uniq(suffix = "") {
  counter += 1;
  return `${PREFIX}${counter}-${Date.now()}${suffix}`;
}

async function makeCategory() {
  const slug = uniq("-cat");
  const [c] = await db
    .insert(categories)
    .values({ slug, name: { zh: slug, en: slug } })
    .returning();
  return c!;
}

async function makeR2() {
  const existing = await db
    .select()
    .from(r2Accounts)
    .where(eq(r2Accounts.name, TEST_R2_NAME))
    .limit(1);
  if (existing[0]) return existing[0];
  const [r] = await db
    .insert(r2Accounts)
    .values({
      name: TEST_R2_NAME,
      accountId: "users-public-test-acct",
      endpoint: "https://users-public-test.example.com",
      accessKeyId: "K",
      accessKeySecretEncrypted: encryptSecret("s"),
      bucket: "users-public-test",
      publicUrl: "https://users-public-test.example.com",
      priority: 999,
      enabled: false,
    })
    .returning();
  return r!;
}

async function makePromptOwnedBy(
  userId: string,
  catId: string,
  r2Id: string,
) {
  const slug = uniq("-p");
  const [p] = await db
    .insert(prompts)
    .values({
      slug,
      title: { en: slug },
      prompt: { en: "hello" },
      categoryId: catId,
      contributorId: userId,
      source: "site",
    })
    .returning();
  await db.insert(promptImages).values({
    promptId: p!.id,
    r2AccountId: r2Id,
    r2Key: `submissions/owner/${slug}.jpg`,
    order: 0,
  });
  return p!;
}

describe("getUserPublic", () => {
  it("returns id/name/image/role/joinedAt without email", async () => {
    const u = await makeUser("get1");
    const got = await getUserPublic(u.id);
    expect(got).not.toBeNull();
    expect(got!.id).toBe(u.id);
    expect(got!.name).toBe(`Name-get1`);
    expect(got!.role).toBe("user");
    expect("email" in got!).toBe(false);
  });
  it("returns null for unknown id", async () => {
    const got = await getUserPublic("00000000-0000-0000-0000-000000000000");
    expect(got).toBeNull();
  });
  // ── M11 profile-enrich coverage ────────────────────────────────────────
  it("surfaces bio + socialLinks + empty pinnedPrompts by default", async () => {
    const u = await makeUser("get-default");
    const got = await getUserPublic(u.id);
    expect(got).not.toBeNull();
    expect(got!.bio).toBeNull();
    expect(got!.socialLinks).toBeNull();
    expect(got!.pinnedPrompts).toEqual([]);
  });

  it("returns bio + socialLinks + pinnedPrompts when set", async () => {
    const u = await makeUser("get-rich");
    const cat = await makeCategory();
    const r2 = await makeR2();
    const p1 = await makePromptOwnedBy(u.id, cat.id, r2.id);
    const p2 = await makePromptOwnedBy(u.id, cat.id, r2.id);
    // Manually wire up jsonb + pinned rows so this test stays pure repo-layer.
    await db
      .update(users)
      .set({
        bio: { zh: "我是测试用户", en: "I am test" },
        socialLinks: { github: "https://github.com/x", website: "https://x.dev" },
      })
      .where(eq(users.id, u.id));
    await db.insert(userPinnedPrompts).values([
      { userId: u.id, promptId: p1.id, order: 0 },
      { userId: u.id, promptId: p2.id, order: 1 },
    ]);

    const got = await getUserPublic(u.id);
    expect(got!.bio).toEqual({ zh: "我是测试用户", en: "I am test" });
    expect(got!.socialLinks).toEqual({
      github: "https://github.com/x",
      website: "https://x.dev",
    });
    // pinned ordered by .order ASC
    expect(got!.pinnedPrompts.map((p) => p.id)).toEqual([p1.id, p2.id]);
    // Each pinned item carries PromptSummary fields.
    expect(got!.pinnedPrompts[0]!.category.id).toBe(cat.id);
    expect(got!.pinnedPrompts[0]!.contributor!.id).toBe(u.id);
    expect(got!.pinnedPrompts[0]!.primaryImage).not.toBeNull();
  });
});

describe("getUserStats", () => {
  it("counts published prompts + sums view/like/favorite counters", async () => {
    const u = await makeUser("stats1");
    const stats = await getUserStats(u.id);
    expect(stats).toEqual({
      publishedCount: 0,
      totalViews: 0,
      totalLikes: 0,
      totalFavorites: 0,
    });
  });
});

describe("listUserPrompts", () => {
  it("returns only this user's published prompts ordered newest first", async () => {
    const u = await makeUser("list1");
    const r = await listUserPrompts(u.id, { cursor: null, limit: 10 });
    expect(r.items).toEqual([]);
    expect(r.nextCursor).toBeNull();
  });
});

describe("listUserFavorites", () => {
  it("returns empty for a user with no favorites", async () => {
    const u = await makeUser("fav1");
    const r = await listUserFavorites(u.id, { cursor: null, limit: 10 });
    expect(r.items).toEqual([]);
    expect(r.nextCursor).toBeNull();
  });
});
