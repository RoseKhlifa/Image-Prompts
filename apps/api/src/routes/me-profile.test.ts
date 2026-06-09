import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { db, pool } from "../db/client.ts";
import {
  users,
  sessions,
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
import { createServer } from "../server.ts";
import { createTestSession } from "../auth/test-session.ts";

const app = createServer();
const TEST_PREFIX = "tw43r-"; // r suffix so it's distinct from the repo test
const TEST_R2_NAME = "tw43r-r2";

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
    await db.delete(sessions).where(inArray(sessions.userId, testUserIds));
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

async function sessionFor(user: { id: string; email: string }) {
  const s = await createTestSession({ email: user.email });
  if (s.userId !== user.id) throw new Error("sessionFor drift");
  return s;
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
      accountId: "tw43r-acct",
      endpoint: "https://tw43r.example.com",
      accessKeyId: "K",
      accessKeySecretEncrypted: encryptSecret("s"),
      bucket: "tw43r",
      publicUrl: "https://tw43r.example.com",
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
      prompt: { en: "hi" },
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

// ── PATCH /api/me/profile ────────────────────────────────────────────────

describe("PATCH /api/me/profile", () => {
  it("returns 401 for anonymous", async () => {
    const res = await app.request("/api/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bio: { zh: "hi" } }),
    });
    expect(res.status).toBe(401);
  });

  it("updates bio + social links for the signed-in user", async () => {
    const u = await makeUser("patch-happy");
    const s = await sessionFor(u);
    const res = await app.request("/api/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: s.cookie },
      body: JSON.stringify({
        bio: { zh: "你好", en: "Hi" },
        socialLinks: { github: "https://github.com/x" },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bio).toEqual({ zh: "你好", en: "Hi" });
    expect(body.socialLinks).toEqual({ github: "https://github.com/x" });

    // Audit row recorded.
    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.actorId, u.id));
    expect(audits.some((a) => a.action === "profile.update")).toBe(true);
  });

  it("rejects malformed URLs with 400", async () => {
    const u = await makeUser("patch-bad-url");
    const s = await sessionFor(u);
    const res = await app.request("/api/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: s.cookie },
      body: JSON.stringify({ socialLinks: { github: "not-a-url" } }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    // Field-keyed validation error from the zod error formatter.
    expect(body.error).toBe("validation_error");
    // Field path includes the slot name so the modal can highlight.
    const flatFields = JSON.stringify(body.fields ?? {});
    expect(flatFields).toContain("github");
  });

  it("rejects over-long bio with 400", async () => {
    const u = await makeUser("patch-long-bio");
    const s = await sessionFor(u);
    const tooLong = "a".repeat(501);
    const res = await app.request("/api/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: s.cookie },
      body: JSON.stringify({ bio: { en: tooLong } }),
    });
    expect(res.status).toBe(400);
  });

  it("accepts empty body and is a no-op", async () => {
    const u = await makeUser("patch-empty");
    const s = await sessionFor(u);
    const res = await app.request("/api/me/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: s.cookie },
      body: JSON.stringify({}),
    });
    // Empty patch still works; route audit records 'fields: []'.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bio).toBeNull();
    expect(body.socialLinks).toBeNull();
  });
});

// ── PUT /api/me/profile/pins ────────────────────────────────────────────

describe("PUT /api/me/profile/pins", () => {
  it("returns 401 for anonymous", async () => {
    const res = await app.request("/api/me/profile/pins", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ promptIds: [] }),
    });
    expect(res.status).toBe(401);
  });

  it("pins owned prompts and returns them ordered", async () => {
    const u = await makeUser("pin-ok");
    const s = await sessionFor(u);
    const cat = await makeCategory();
    const r2 = await makeR2();
    const a = await makePromptOwnedBy(u.id, cat.id, r2.id);
    const b = await makePromptOwnedBy(u.id, cat.id, r2.id);
    const res = await app.request("/api/me/profile/pins", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: s.cookie },
      body: JSON.stringify({ promptIds: [b.id, a.id] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pinnedPrompts.map((p: { id: string }) => p.id)).toEqual([
      b.id,
      a.id,
    ]);
  });

  it("rejects foreign-owned prompts with 400 not_owned:<id>", async () => {
    const me = await makeUser("pin-foreign-me");
    const other = await makeUser("pin-foreign-other");
    const s = await sessionFor(me);
    const cat = await makeCategory();
    const r2 = await makeR2();
    const otherPrompt = await makePromptOwnedBy(other.id, cat.id, r2.id);
    const res = await app.request("/api/me/profile/pins", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: s.cookie },
      body: JSON.stringify({ promptIds: [otherPrompt.id] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.message).toBe(`not_owned:${otherPrompt.id}`);
  });

  it("rejects >3 ids at validation layer", async () => {
    const u = await makeUser("pin-too-many");
    const s = await sessionFor(u);
    const cat = await makeCategory();
    const r2 = await makeR2();
    const a = await makePromptOwnedBy(u.id, cat.id, r2.id);
    const b = await makePromptOwnedBy(u.id, cat.id, r2.id);
    const c = await makePromptOwnedBy(u.id, cat.id, r2.id);
    const d = await makePromptOwnedBy(u.id, cat.id, r2.id);
    const res = await app.request("/api/me/profile/pins", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: s.cookie },
      body: JSON.stringify({ promptIds: [a.id, b.id, c.id, d.id] }),
    });
    expect(res.status).toBe(400);
  });

  it("clears pins when called with an empty array", async () => {
    const u = await makeUser("pin-clear");
    const s = await sessionFor(u);
    const cat = await makeCategory();
    const r2 = await makeR2();
    const p = await makePromptOwnedBy(u.id, cat.id, r2.id);
    // First set, then clear via the route.
    {
      const res = await app.request("/api/me/profile/pins", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: s.cookie },
        body: JSON.stringify({ promptIds: [p.id] }),
      });
      expect(res.status).toBe(200);
    }
    const res = await app.request("/api/me/profile/pins", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: s.cookie },
      body: JSON.stringify({ promptIds: [] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pinnedPrompts).toEqual([]);
    const rows = await db
      .select()
      .from(userPinnedPrompts)
      .where(eq(userPinnedPrompts.userId, u.id));
    expect(rows).toEqual([]);
  });

  it("records audit row profile.update_pins", async () => {
    const u = await makeUser("pin-audit");
    const s = await sessionFor(u);
    const cat = await makeCategory();
    const r2 = await makeR2();
    const p = await makePromptOwnedBy(u.id, cat.id, r2.id);
    const res = await app.request("/api/me/profile/pins", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: s.cookie },
      body: JSON.stringify({ promptIds: [p.id] }),
    });
    expect(res.status).toBe(200);
    const audits = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.actorId, u.id));
    expect(audits.some((a) => a.action === "profile.update_pins")).toBe(true);
  });
});
