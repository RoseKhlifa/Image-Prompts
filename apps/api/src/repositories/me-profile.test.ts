import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { db, pool } from "../db/client.ts";
import {
  users,
  categories,
  prompts,
  promptImages,
  promptTags,
  submissions,
  r2Accounts,
  auditLog,
  userPinnedPrompts,
} from "../db/schema/index.ts";
import { encryptSecret } from "../lib/crypto.ts";
import {
  PromptNotOwnedError,
  setMyPinnedPrompts,
  updateMyProfile,
} from "./me-profile.ts";

// Same tw43- isolation prefix discipline as the rest of the test suite. Every
// row we create wears it so the cleanup sweep can't accidentally touch dev /
// user data (圆滑's prompt etc.).
const TEST_PREFIX = "tw43-";
const TEST_R2_NAME = "tw43-r2";

beforeAll(() => {
  process.env.R2_ENCRYPTION_KEY ||=
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

async function cleanup() {
  const testCatIds = (
    await db
      .select({ id: categories.id })
      .from(categories)
      .where(like(categories.slug, `${TEST_PREFIX}%`))
  ).map((r) => r.id);
  const testUserIds = (
    await db
      .select({ id: users.id })
      .from(users)
      .where(like(users.email, `${TEST_PREFIX}%@example.com`))
  ).map((r) => r.id);
  const promptsByPrefix = (
    await db
      .select({ id: prompts.id })
      .from(prompts)
      .where(like(prompts.slug, `${TEST_PREFIX}%`))
  ).map((r) => r.id);
  const promptsByCat =
    testCatIds.length > 0
      ? (
          await db
            .select({ id: prompts.id })
            .from(prompts)
            .where(inArray(prompts.categoryId, testCatIds))
        ).map((r) => r.id)
      : [];
  const promptsByContrib =
    testUserIds.length > 0
      ? (
          await db
            .select({ id: prompts.id })
            .from(prompts)
            .where(inArray(prompts.contributorId, testUserIds))
        ).map((r) => r.id)
      : [];
  const testPromptIds = Array.from(
    new Set([...promptsByPrefix, ...promptsByCat, ...promptsByContrib]),
  );

  if (testUserIds.length > 0) {
    await db
      .delete(userPinnedPrompts)
      .where(inArray(userPinnedPrompts.userId, testUserIds));
  }
  if (testPromptIds.length > 0) {
    await db
      .delete(userPinnedPrompts)
      .where(inArray(userPinnedPrompts.promptId, testPromptIds));
    await db.delete(promptImages).where(inArray(promptImages.promptId, testPromptIds));
    await db.delete(promptTags).where(inArray(promptTags.promptId, testPromptIds));
    await db
      .update(submissions)
      .set({ promotedTo: null })
      .where(inArray(submissions.promotedTo, testPromptIds));
    await db.delete(prompts).where(inArray(prompts.id, testPromptIds));
  }
  if (testUserIds.length > 0) {
    await db
      .delete(submissions)
      .where(inArray(submissions.contributorId, testUserIds));
    await db.delete(auditLog).where(inArray(auditLog.actorId, testUserIds));
  }
  if (testCatIds.length > 0) {
    await db.delete(submissions).where(inArray(submissions.categoryId, testCatIds));
    await db.delete(categories).where(inArray(categories.id, testCatIds));
  }
  if (testUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, testUserIds));
  }
  await db.delete(r2Accounts).where(eq(r2Accounts.name, TEST_R2_NAME));
}

beforeEach(cleanup);
afterAll(async () => {
  await cleanup();
  await pool.end();
});

let counter = 0;
function uniq(suffix = "") {
  counter += 1;
  return `${TEST_PREFIX}${counter}-${Date.now()}${suffix}`;
}

async function makeUser(label: string) {
  const email = `${TEST_PREFIX}${label}-${counter}-${Date.now()}@example.com`;
  counter += 1;
  const [u] = await db.insert(users).values({ email }).returning();
  return u!;
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
  const [r] = await db
    .insert(r2Accounts)
    .values({
      name: TEST_R2_NAME,
      accountId: "tw43-account",
      endpoint: "https://tw43.example.com",
      accessKeyId: "K",
      accessKeySecretEncrypted: encryptSecret("s"),
      bucket: "tw43",
      publicUrl: "https://tw43.example.com",
      priority: 999,
      enabled: false,
    })
    .returning();
  return r!;
}

async function makePromptOwnedBy(userId: string, catId: string, r2Id: string) {
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

// ── updateMyProfile ──────────────────────────────────────────────────────

describe("updateMyProfile — bio", () => {
  it("sets both sides of the bio when supplied", async () => {
    const u = await makeUser("bio1");
    const r = await updateMyProfile(u.id, {
      bio: { zh: "你好世界", en: "Hello world" },
    });
    expect(r.bio).toEqual({ zh: "你好世界", en: "Hello world" });

    const [reread] = await db.select().from(users).where(eq(users.id, u.id));
    expect(reread!.bio).toEqual({ zh: "你好世界", en: "Hello world" });
  });

  it("clears one side when the empty string is sent; preserves the other", async () => {
    const u = await makeUser("bio2");
    await updateMyProfile(u.id, { bio: { zh: "中文版", en: "English ver" } });
    // Send empty zh; the en side should remain.
    const r = await updateMyProfile(u.id, { bio: { zh: "" } });
    expect(r.bio).toEqual({ en: "English ver" });
  });

  it("returns bio=null when both sides become empty", async () => {
    const u = await makeUser("bio3");
    await updateMyProfile(u.id, { bio: { zh: "x", en: "y" } });
    const r = await updateMyProfile(u.id, { bio: { zh: "", en: "" } });
    expect(r.bio).toBeNull();
  });

  it("leaves bio untouched when patch omits the key", async () => {
    const u = await makeUser("bio4");
    await updateMyProfile(u.id, { bio: { zh: "保留中" } });
    // Patching only socialLinks must not nuke bio.
    const r = await updateMyProfile(u.id, {
      socialLinks: { github: "https://github.com/x" },
    });
    expect(r.bio).toEqual({ zh: "保留中" });
    expect(r.socialLinks).toEqual({ github: "https://github.com/x" });
  });
});

describe("updateMyProfile — socialLinks", () => {
  it("sets multiple slots", async () => {
    const u = await makeUser("soc1");
    const r = await updateMyProfile(u.id, {
      socialLinks: {
        github: "https://github.com/x",
        twitter: "https://twitter.com/y",
      },
    });
    expect(r.socialLinks).toEqual({
      github: "https://github.com/x",
      twitter: "https://twitter.com/y",
    });
  });

  it("clears one slot with empty string; preserves others", async () => {
    const u = await makeUser("soc2");
    await updateMyProfile(u.id, {
      socialLinks: {
        github: "https://github.com/x",
        twitter: "https://twitter.com/y",
      },
    });
    const r = await updateMyProfile(u.id, { socialLinks: { github: "" } });
    expect(r.socialLinks).toEqual({ twitter: "https://twitter.com/y" });
  });

  it("returns socialLinks=null when all slots become empty", async () => {
    const u = await makeUser("soc3");
    await updateMyProfile(u.id, {
      socialLinks: { github: "https://github.com/x" },
    });
    const r = await updateMyProfile(u.id, { socialLinks: { github: "" } });
    expect(r.socialLinks).toBeNull();
  });
});

// ── setMyPinnedPrompts ───────────────────────────────────────────────────

describe("setMyPinnedPrompts", () => {
  it("pins owned prompts and returns them in order", async () => {
    const u = await makeUser("pin1");
    const cat = await makeCategory();
    const r2 = await makeR2();
    const p1 = await makePromptOwnedBy(u.id, cat.id, r2.id);
    const p2 = await makePromptOwnedBy(u.id, cat.id, r2.id);
    const p3 = await makePromptOwnedBy(u.id, cat.id, r2.id);
    const pinned = await setMyPinnedPrompts(u.id, [p3.id, p1.id, p2.id]);
    expect(pinned.map((p) => p.id)).toEqual([p3.id, p1.id, p2.id]);
  });

  it("rejects foreign-owned prompts with PromptNotOwnedError", async () => {
    const mine = await makeUser("pin-mine");
    const other = await makeUser("pin-other");
    const cat = await makeCategory();
    const r2 = await makeR2();
    const myPrompt = await makePromptOwnedBy(mine.id, cat.id, r2.id);
    const otherPrompt = await makePromptOwnedBy(other.id, cat.id, r2.id);
    await expect(
      setMyPinnedPrompts(mine.id, [myPrompt.id, otherPrompt.id]),
    ).rejects.toBeInstanceOf(PromptNotOwnedError);
  });

  it("clears all pins when called with an empty array", async () => {
    const u = await makeUser("pin-clear");
    const cat = await makeCategory();
    const r2 = await makeR2();
    const p1 = await makePromptOwnedBy(u.id, cat.id, r2.id);
    await setMyPinnedPrompts(u.id, [p1.id]);
    // Verify it landed.
    const beforeClear = await db
      .select()
      .from(userPinnedPrompts)
      .where(eq(userPinnedPrompts.userId, u.id));
    expect(beforeClear).toHaveLength(1);
    // Now clear.
    const pinned = await setMyPinnedPrompts(u.id, []);
    expect(pinned).toEqual([]);
    const afterClear = await db
      .select()
      .from(userPinnedPrompts)
      .where(eq(userPinnedPrompts.userId, u.id));
    expect(afterClear).toEqual([]);
  });

  it("re-orders existing pins on subsequent calls", async () => {
    const u = await makeUser("pin-reorder");
    const cat = await makeCategory();
    const r2 = await makeR2();
    const a = await makePromptOwnedBy(u.id, cat.id, r2.id);
    const b = await makePromptOwnedBy(u.id, cat.id, r2.id);
    const c = await makePromptOwnedBy(u.id, cat.id, r2.id);
    await setMyPinnedPrompts(u.id, [a.id, b.id, c.id]);
    const reordered = await setMyPinnedPrompts(u.id, [c.id, a.id, b.id]);
    expect(reordered.map((p) => p.id)).toEqual([c.id, a.id, b.id]);
    // Persisted state matches: order ASC gives the same sequence.
    const rows = await db
      .select()
      .from(userPinnedPrompts)
      .where(eq(userPinnedPrompts.userId, u.id));
    const byOrder = [...rows].sort((x, y) => x.order - y.order);
    expect(byOrder.map((r) => r.promptId)).toEqual([c.id, a.id, b.id]);
  });

  it("de-dupes input preserving first-seen order", async () => {
    const u = await makeUser("pin-dedupe");
    const cat = await makeCategory();
    const r2 = await makeR2();
    const a = await makePromptOwnedBy(u.id, cat.id, r2.id);
    const b = await makePromptOwnedBy(u.id, cat.id, r2.id);
    // Caller sends a dupe; expect the second occurrence to be dropped.
    const pinned = await setMyPinnedPrompts(u.id, [a.id, b.id, a.id]);
    expect(pinned.map((p) => p.id)).toEqual([a.id, b.id]);
  });

  it("returns pinnedPrompts with PromptSummary-shaped fields (category, primaryImage, contributor)", async () => {
    const u = await makeUser("pin-shape");
    const cat = await makeCategory();
    const r2 = await makeR2();
    const p = await makePromptOwnedBy(u.id, cat.id, r2.id);
    const pinned = await setMyPinnedPrompts(u.id, [p.id]);
    expect(pinned).toHaveLength(1);
    const item = pinned[0]!;
    expect(item.id).toBe(p.id);
    expect(item.category.id).toBe(cat.id);
    // Primary image exists because we inserted one in makePromptOwnedBy.
    expect(item.primaryImage).not.toBeNull();
    expect(item.primaryImage!.r2AccountId).toBe(r2.id);
    expect(item.contributor).not.toBeNull();
    expect(item.contributor!.id).toBe(u.id);
  });
});
