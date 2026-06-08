import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from "vitest";
import { eq, inArray, like, and, sql } from "drizzle-orm";
import { mockClient } from "aws-sdk-client-mock";
import { S3Client, HeadObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { createServer } from "../server.ts";
import { db } from "../db/client.ts";
import {
  users,
  siteSettings,
  r2Accounts,
  auditLog,
  announcements,
} from "../db/schema/index.ts";
import { createTestSession } from "../auth/test-session.ts";
import { encryptSecret, decryptSecret } from "../lib/crypto.ts";
import { resetSubmitConfigCache } from "../lib/submit-config.ts";
import { clearR2ClientCache } from "../lib/r2-client-cache.ts";

// Test isolation conventions follow admin.test.ts:
//  - Email prefix marks owned-by-test users so cleanup can sweep them safely.
//  - We restore the submit.daily_limit baseline (10) after each PUT test.
//  - process.env.OWNER_EMAILS is set so isOwnerEmail() picks our owner up.
const TEST_EMAIL_PREFIX = "owner-route-test-";
const TEST_R2_NAME = "owner-route-test-r2";
// M10b W3.2 CRUD tests seed r2_accounts rows with this prefix on `name`
// so cleanup() can sweep them via LIKE without touching dev-primary or
// the W3.1 repo-test rows ("tw31r-%").
const TEST_R2_CRUD_PREFIX = "tw32r-";
// Marker embedded in announcement title.en for test-row sweeping. Matches
// the same pattern repo/announcements.test.ts uses.
const TEST_ANN_MARKER = "[owner-route-ann-test]";

let origOwnerEmails: string | undefined;
let origR2Key: string | undefined;

beforeAll(() => {
  origR2Key = process.env.R2_ENCRYPTION_KEY;
  process.env.R2_ENCRYPTION_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  origOwnerEmails = process.env.OWNER_EMAILS;
});

afterAll(() => {
  if (origR2Key === undefined) delete process.env.R2_ENCRYPTION_KEY;
  else process.env.R2_ENCRYPTION_KEY = origR2Key;
  if (origOwnerEmails === undefined) delete process.env.OWNER_EMAILS;
  else process.env.OWNER_EMAILS = origOwnerEmails;
});

async function cleanup() {
  await db
    .delete(siteSettings)
    .where(eq(siteSettings.key, "owner.test.bogus_key"));
  // Reset the canonical baseline so cross-test mutations don't leak.
  await db
    .update(siteSettings)
    .set({ value: 10 as unknown as never })
    .where(eq(siteSettings.key, "submit.daily_limit"));
  await db.delete(r2Accounts).where(eq(r2Accounts.name, TEST_R2_NAME));
  // M10b W3.2 CRUD: sweep any rows the CRUD tests inserted (tw32r-* prefix on
  // `name`) AND their audit_log rows. The audit_log.target_id FK is NO ACTION,
  // so audit rows must be deleted before the parent r2_accounts row. The W3.1
  // repo tests use a different "tw31r-" prefix and have their own sweep.
  const crudR2Ids = (
    await db
      .select({ id: r2Accounts.id })
      .from(r2Accounts)
      .where(like(r2Accounts.name, `${TEST_R2_CRUD_PREFIX}%`))
  ).map((r) => r.id);
  if (crudR2Ids.length > 0) {
    await db
      .delete(auditLog)
      .where(
        and(
          eq(auditLog.targetType, "r2_account"),
          inArray(auditLog.targetId, crudR2Ids),
        ),
      );
    await db.delete(r2Accounts).where(inArray(r2Accounts.id, crudR2Ids));
  }
  // Wipe test-tagged announcements + their audit rows. We sweep on
  // title->>'en' LIKE %marker% because the announcement rows are seeded
  // through the POST endpoint and aren't tied to a specific test-user id.
  const annIds = (
    await db
      .select({ id: announcements.id })
      .from(announcements)
      .where(
        sql`${announcements.title}->>'en' LIKE ${"%" + TEST_ANN_MARKER + "%"}`,
      )
  ).map((r) => r.id);
  if (annIds.length > 0) {
    await db.delete(auditLog).where(inArray(auditLog.targetId, annIds));
    await db.delete(announcements).where(inArray(announcements.id, annIds));
  }
  // Sweep any test-owned users (they're created with the prefixed email).
  const testUserIds = (
    await db
      .select({ id: users.id })
      .from(users)
      .where(like(users.email, `${TEST_EMAIL_PREFIX}%@example.com`))
  ).map((u) => u.id);
  if (testUserIds.length > 0) {
    // Setting-rows with updated_by pointing at our test users would block the
    // user delete with FK 23503 — null them first. announcements.created_by /
    // updated_by point at test users too; the test announcements get wiped
    // above, but any stragglers (e.g., from older runs) would still block.
    await db
      .update(siteSettings)
      .set({ updatedBy: null })
      .where(inArray(siteSettings.updatedBy, testUserIds));
    // audit_log.actor_id FK is NO ACTION (no cascade) — must wipe rows referencing
    // our test owners before deleting them. We also target rows whose targetId
    // is one of our test users (the PATCH role-update tests write these).
    await db.delete(auditLog).where(inArray(auditLog.actorId, testUserIds));
    await db
      .delete(auditLog)
      .where(
        and(
          eq(auditLog.targetType, "user"),
          inArray(auditLog.targetId, testUserIds),
        ),
      );
  }
  await db
    .delete(users)
    .where(like(users.email, `${TEST_EMAIL_PREFIX}%@example.com`));
}

async function setupSeedR2() {
  // Need at least one r2_accounts row for the list/byId tests. Use a uniquely
  // named one so we don't disturb the seed pool. Inserted as `enabled: false`
  // to verify the owner endpoint surfaces disabled accounts.
  await db.insert(r2Accounts).values({
    name: TEST_R2_NAME,
    accountId: "owner-test-account",
    endpoint: "https://owner.test.r2.cloudflarestorage.com",
    accessKeyId: "K",
    accessKeySecretEncrypted: encryptSecret("s"),
    bucket: "owner-test-bucket",
    publicUrl: "https://owner.test.r2.dev",
    priority: 999,
    enabled: false,
  });
}

async function makeOwner() {
  const email = `${TEST_EMAIL_PREFIX}owner-${Math.random()
    .toString(36)
    .slice(2)}@example.com`;
  const sess = await createTestSession({ email });
  await db.update(users).set({ role: "admin" }).where(eq(users.id, sess.userId));
  // OWNER_EMAILS must include this email so isOwnerEmail() returns true.
  process.env.OWNER_EMAILS = email;
  return sess;
}

async function makeNonOwner(role: "user" | "moderator" | "admin" = "user") {
  const email = `${TEST_EMAIL_PREFIX}${role}-${Math.random()
    .toString(36)
    .slice(2)}@example.com`;
  const sess = await createTestSession({ email });
  await db.update(users).set({ role }).where(eq(users.id, sess.userId));
  return sess;
}

const app = createServer();

// aws-sdk-client-mock is used by the W3.3 tests below to drive r2-ops without
// reaching the network. It's reset per-test alongside the in-process S3 client
// cache so a previous test's mock state can't leak. The CRUD tests above don't
// touch S3 at all, so this is a passive setup for them.
const s3Mock = mockClient(S3Client);

beforeEach(async () => {
  await cleanup();
  await setupSeedR2();
  resetSubmitConfigCache();
  s3Mock.reset();
  clearR2ClientCache();
});

afterEach(cleanup);

describe("owner routes — auth gate", () => {
  it("dashboard 403 for non-owner", async () => {
    const sess = await makeNonOwner("user");
    const res = await app.request("/api/owner/dashboard", {
      headers: { Cookie: sess.cookie },
    });
    expect(res.status).toBe(403);
  });

  it("settings GET 403 for non-owner", async () => {
    const sess = await makeNonOwner("moderator");
    const res = await app.request("/api/owner/settings", {
      headers: { Cookie: sess.cookie },
    });
    expect(res.status).toBe(403);
  });

  it("settings PUT 403 for non-owner", async () => {
    const sess = await makeNonOwner("admin");
    const res = await app.request(
      "/api/owner/settings/submit.daily_limit",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: sess.cookie },
        body: JSON.stringify({ value: 99 }),
      },
    );
    // admin without OWNER_EMAILS membership still 403
    expect(res.status).toBe(403);
  });

  it("r2-accounts GET 403 for non-owner", async () => {
    const sess = await makeNonOwner("user");
    const res = await app.request("/api/owner/r2-accounts", {
      headers: { Cookie: sess.cookie },
    });
    expect(res.status).toBe(403);
  });
});

describe("owner routes — happy path", () => {
  it("dashboard 200 for owner with metrics shape", async () => {
    const owner = await makeOwner();
    const res = await app.request("/api/owner/dashboard", {
      headers: { Cookie: owner.cookie },
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { metrics: Record<string, number> };
    expect(typeof j.metrics.publishedPrompts).toBe("number");
    expect(typeof j.metrics.totalUsers).toBe("number");
  });

  it("settings GET 200 returns array of settings", async () => {
    const owner = await makeOwner();
    const res = await app.request("/api/owner/settings", {
      headers: { Cookie: owner.cookie },
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { items: Array<{ key: string }> };
    expect(Array.isArray(j.items)).toBe(true);
    const keys = j.items.map((i) => i.key);
    expect(keys).toContain("submit.daily_limit");
    expect(keys).toContain("translator.enabled");
  });

  it("settings PUT 200 updates value and returns new", async () => {
    const owner = await makeOwner();
    const res = await app.request(
      "/api/owner/settings/submit.daily_limit",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: owner.cookie },
        body: JSON.stringify({ value: 17 }),
      },
    );
    expect(res.status).toBe(200);
    const j = (await res.json()) as { key: string; value: number };
    expect(j.key).toBe("submit.daily_limit");
    expect(j.value).toBe(17);
    // Verify the row really changed in the DB (round-trip confirmation).
    const [row] = await db
      .select({ value: siteSettings.value })
      .from(siteSettings)
      .where(eq(siteSettings.key, "submit.daily_limit"));
    expect(row?.value).toBe(17);
  });

  it("settings PUT rejects unknown key with 400", async () => {
    const owner = await makeOwner();
    const res = await app.request(
      "/api/owner/settings/totally.bogus.key",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json", Cookie: owner.cookie },
        body: JSON.stringify({ value: 1 }),
      },
    );
    expect(res.status).toBe(400);
  });

  it("r2-accounts GET 200 returns list including disabled", async () => {
    const owner = await makeOwner();
    const res = await app.request("/api/owner/r2-accounts", {
      headers: { Cookie: owner.cookie },
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      items: Array<{ id: string; name: string; enabled: boolean }>;
    };
    expect(Array.isArray(j.items)).toBe(true);
    // Our test-seeded r2 account is enabled:false but MUST appear here.
    const ours = j.items.find((i) => i.name === TEST_R2_NAME);
    expect(ours).toBeDefined();
    expect(ours?.enabled).toBe(false);
  });

  it("r2-accounts GET :id 404 on unknown id", async () => {
    const owner = await makeOwner();
    const res = await app.request(
      "/api/owner/r2-accounts/00000000-0000-0000-0000-000000000000",
      { headers: { Cookie: owner.cookie } },
    );
    expect(res.status).toBe(404);
  });
});

// ── /api/owner/users ───────────────────────────────────────────────────────
//
// list/detail/PATCH role surface, gated by the same requireOwner() chain.
// Tests seed a temp non-owner user (the PATCH target) per-case so cleanup is
// deterministic; the helpers above already wipe by TEST_EMAIL_PREFIX.
describe("owner users — list & detail", () => {
  it("GET /users 403 for non-owner", async () => {
    const sess = await makeNonOwner("user");
    const res = await app.request("/api/owner/users", {
      headers: { Cookie: sess.cookie },
    });
    expect(res.status).toBe(403);
  });

  it("GET /users 200 returns { items, nextCursor } shape for owner", async () => {
    const owner = await makeOwner();
    // Seed at least one non-owner user so the list has predictable content.
    await makeNonOwner("user");
    const res = await app.request("/api/owner/users", {
      headers: { Cookie: owner.cookie },
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      items: Array<{ id: string; email: string; role: string }>;
      nextCursor: string | null;
    };
    expect(Array.isArray(j.items)).toBe(true);
    expect(j.items.length).toBeGreaterThan(0);
    // nextCursor is either a string or null — never undefined.
    expect(j.nextCursor === null || typeof j.nextCursor === "string").toBe(true);
    // Shape check on one row.
    const row = j.items[0]!;
    expect(typeof row.id).toBe("string");
    expect(typeof row.email).toBe("string");
    expect(typeof row.role).toBe("string");
  });

  it("GET /users?role=admin filters to admin role only", async () => {
    const owner = await makeOwner();
    // Seed a moderator and a regular user; only the owner (admin) should match.
    await makeNonOwner("moderator");
    await makeNonOwner("user");
    const res = await app.request("/api/owner/users?role=admin", {
      headers: { Cookie: owner.cookie },
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      items: Array<{ id: string; email: string; role: string }>;
    };
    // Every returned row must have role === 'admin'. We don't assert the exact
    // count because other admins may pre-exist in the DB — only that our
    // non-admin seeds were filtered out.
    expect(j.items.every((r) => r.role === "admin")).toBe(true);
    expect(j.items.find((r) => r.id === owner.userId)).toBeDefined();
  });

  it("GET /users/:id 404 for unknown uuid", async () => {
    const owner = await makeOwner();
    const res = await app.request(
      "/api/owner/users/00000000-0000-0000-0000-000000000000",
      { headers: { Cookie: owner.cookie } },
    );
    expect(res.status).toBe(404);
  });

  it("GET /users/:id 200 returns detail for existing user", async () => {
    const owner = await makeOwner();
    const target = await makeNonOwner("user");
    const res = await app.request(`/api/owner/users/${target.userId}`, {
      headers: { Cookie: owner.cookie },
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      id: string;
      email: string;
      role: string;
      recentSubmissions: unknown[];
    };
    expect(j.id).toBe(target.userId);
    expect(j.email).toBe(target.email);
    expect(j.role).toBe("user");
    expect(Array.isArray(j.recentSubmissions)).toBe(true);
  });
});

describe("owner users — PATCH role", () => {
  it("PATCH /users/:id 403 for non-owner", async () => {
    const sess = await makeNonOwner("admin");
    const target = await makeNonOwner("user");
    const res = await app.request(`/api/owner/users/${target.userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: sess.cookie },
      body: JSON.stringify({ role: "moderator" }),
    });
    // admin-not-owner is still 403 (matches the auth-gate convention used in
    // the settings PUT 403 test above).
    expect(res.status).toBe(403);
  });

  it("PATCH /users/:id 200 updates role and writes audit row", async () => {
    const owner = await makeOwner();
    const target = await makeNonOwner("user");
    const res = await app.request(`/api/owner/users/${target.userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({ role: "moderator" }),
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { id: string; role: string };
    expect(j.id).toBe(target.userId);
    expect(j.role).toBe("moderator");

    // DB confirmation — the row really changed.
    const [reread] = await db
      .select({ role: users.role })
      .from(users)
      .where(eq(users.id, target.userId));
    expect(reread?.role).toBe("moderator");

    // Audit row exists with the right action + target + payload.
    const auditRows = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "user.role.update"),
          eq(auditLog.targetId, target.userId),
        ),
      );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.actorId).toBe(owner.userId);
    expect(auditRows[0]!.targetType).toBe("user");
    expect(auditRows[0]!.payload).toMatchObject({ newRole: "moderator" });
  });

  it("PATCH /users/:id 400 for invalid role body", async () => {
    const owner = await makeOwner();
    const target = await makeNonOwner("user");
    const res = await app.request(`/api/owner/users/${target.userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({ role: "supreme-leader" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("owner users — POST /users/:id/ban", () => {
  it("POST /users/:id/ban 403 for non-owner", async () => {
    const sess = await makeNonOwner("admin");
    const target = await makeNonOwner("user");
    const res = await app.request(`/api/owner/users/${target.userId}/ban`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sess.cookie },
      body: JSON.stringify({ reason: "spam" }),
    });
    expect(res.status).toBe(403);
  });

  it("POST /users/:id/ban 200 updates DB + writes audit row", async () => {
    const owner = await makeOwner();
    const target = await makeNonOwner("user");
    const res = await app.request(`/api/owner/users/${target.userId}/ban`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({ reason: "repeated rule violations" }),
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { id: string; banned: boolean };
    expect(j.id).toBe(target.userId);
    expect(j.banned).toBe(true);

    const [reread] = await db
      .select({
        bannedAt: users.bannedAt,
        bannedReason: users.bannedReason,
      })
      .from(users)
      .where(eq(users.id, target.userId));
    expect(reread?.bannedAt).not.toBeNull();
    expect(reread?.bannedReason).toBe("repeated rule violations");

    const auditRows = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "user.ban"),
          eq(auditLog.targetId, target.userId),
        ),
      );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.actorId).toBe(owner.userId);
    expect(auditRows[0]!.targetType).toBe("user");
    expect(auditRows[0]!.payload).toMatchObject({
      reason: "repeated rule violations",
    });
  });

  it("POST /users/:id/ban 400 with empty reason", async () => {
    const owner = await makeOwner();
    const target = await makeNonOwner("user");
    const res = await app.request(`/api/owner/users/${target.userId}/ban`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({ reason: "" }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /users/:id/ban 400 with whitespace-only reason", async () => {
    const owner = await makeOwner();
    const target = await makeNonOwner("user");
    const res = await app.request(`/api/owner/users/${target.userId}/ban`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({ reason: "   " }),
    });
    expect(res.status).toBe(400);
  });
});

describe("owner users — POST /users/:id/unban", () => {
  it("POST /users/:id/unban 403 for non-owner", async () => {
    const sess = await makeNonOwner("admin");
    const target = await makeNonOwner("user");
    const res = await app.request(`/api/owner/users/${target.userId}/unban`, {
      method: "POST",
      headers: { Cookie: sess.cookie },
    });
    expect(res.status).toBe(403);
  });

  it("POST /users/:id/unban 200 clears DB + writes audit row", async () => {
    const owner = await makeOwner();
    const target = await makeNonOwner("user");
    // Seed the ban first via the ban endpoint so we exercise the full chain.
    await app.request(`/api/owner/users/${target.userId}/ban`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({ reason: "test" }),
    });

    const res = await app.request(`/api/owner/users/${target.userId}/unban`, {
      method: "POST",
      headers: { Cookie: owner.cookie },
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { id: string; banned: boolean };
    expect(j.id).toBe(target.userId);
    expect(j.banned).toBe(false);

    const [reread] = await db
      .select({
        bannedAt: users.bannedAt,
        bannedReason: users.bannedReason,
      })
      .from(users)
      .where(eq(users.id, target.userId));
    expect(reread?.bannedAt).toBeNull();
    expect(reread?.bannedReason).toBeNull();

    const auditRows = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "user.unban"),
          eq(auditLog.targetId, target.userId),
        ),
      );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.actorId).toBe(owner.userId);
    expect(auditRows[0]!.targetType).toBe("user");
  });
});

// ── /api/owner/audit ───────────────────────────────────────────────────────
//
// Read-only audit feed. We piggy-back on the PATCH role-update endpoint to
// seed predictable audit rows, then call /audit with filters. Cleanup is
// already wired in the top-level cleanup() (it sweeps audit rows whose
// actorId or targetId is in the test-user pool).
describe("owner audit feed", () => {
  it("GET /audit 403 for non-owner", async () => {
    const sess = await makeNonOwner("user");
    const res = await app.request("/api/owner/audit", {
      headers: { Cookie: sess.cookie },
    });
    expect(res.status).toBe(403);
  });

  it("GET /audit 200 returns { items, nextCursor } shape for owner", async () => {
    const owner = await makeOwner();
    // Seed at least one audit row via the role-update endpoint.
    const target = await makeNonOwner("user");
    await app.request(`/api/owner/users/${target.userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({ role: "moderator" }),
    });
    const res = await app.request("/api/owner/audit", {
      headers: { Cookie: owner.cookie },
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      items: Array<{
        id: string;
        actorId: string | null;
        action: string;
        targetType: string | null;
        targetId: string | null;
        payload: unknown;
        createdAt: string;
      }>;
      nextCursor: string | null;
    };
    expect(Array.isArray(j.items)).toBe(true);
    expect(j.items.length).toBeGreaterThan(0);
    expect(j.nextCursor === null || typeof j.nextCursor === "string").toBe(true);
    const row = j.items[0]!;
    expect(typeof row.id).toBe("string");
    expect(typeof row.action).toBe("string");
  });

  it("GET /audit?actionPrefix=user. filters", async () => {
    const owner = await makeOwner();
    const target = await makeNonOwner("user");
    // Write a known user.role.update via the patch endpoint.
    await app.request(`/api/owner/users/${target.userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({ role: "moderator" }),
    });
    const res = await app.request(
      "/api/owner/audit?actionPrefix=user.",
      { headers: { Cookie: owner.cookie } },
    );
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      items: Array<{ action: string }>;
    };
    expect(j.items.length).toBeGreaterThan(0);
    expect(j.items.every((r) => r.action.startsWith("user."))).toBe(true);
  });
});

// ── /api/owner/announcements (M10b W2.4) ─────────────────────────────────
//
// Owner CRUD surface for announcements. Public read is mounted separately
// at /api/announcements — those tests live in routes/announcements.test.ts.
// Each test seeds rows tagged with TEST_ANN_MARKER so cleanup() can sweep
// them by `title->>'en' LIKE %marker%` regardless of which owner planted
// them.
describe("owner announcements — auth gate", () => {
  it("GET /announcements 403 for non-owner", async () => {
    const sess = await makeNonOwner("admin");
    const res = await app.request("/api/owner/announcements", {
      headers: { Cookie: sess.cookie },
    });
    expect(res.status).toBe(403);
  });

  it("POST /announcements 403 for non-owner", async () => {
    const sess = await makeNonOwner("admin");
    const res = await app.request("/api/owner/announcements", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sess.cookie },
      body: JSON.stringify({
        title: { en: `x ${TEST_ANN_MARKER}` },
        body: { en: "y" },
        severity: "info",
        startsAt: new Date().toISOString(),
      }),
    });
    expect(res.status).toBe(403);
  });

  it("PATCH /announcements/:id 403 for non-owner", async () => {
    const sess = await makeNonOwner("admin");
    const res = await app.request(
      "/api/owner/announcements/00000000-0000-0000-0000-000000000000",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: sess.cookie },
        body: JSON.stringify({ severity: "warning" }),
      },
    );
    expect(res.status).toBe(403);
  });

  it("DELETE /announcements/:id 403 for non-owner", async () => {
    const sess = await makeNonOwner("admin");
    const res = await app.request(
      "/api/owner/announcements/00000000-0000-0000-0000-000000000000",
      {
        method: "DELETE",
        headers: { Cookie: sess.cookie },
      },
    );
    expect(res.status).toBe(403);
  });
});

describe("owner announcements — POST", () => {
  it("POST 201 creates row + writes audit", async () => {
    const owner = await makeOwner();
    const startsAt = new Date("2026-06-01T00:00:00Z").toISOString();
    const endsAt = new Date("2026-07-01T00:00:00Z").toISOString();
    const res = await app.request("/api/owner/announcements", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({
        title: { en: `Hello ${TEST_ANN_MARKER}`, zh: "你好" },
        body: { en: "body", zh: "正文" },
        severity: "warning",
        startsAt,
        endsAt,
        dismissible: false,
      }),
    });
    expect(res.status).toBe(201);
    const j = (await res.json()) as {
      id: string;
      title: { en?: string; zh?: string };
      severity: string;
      dismissible: boolean;
    };
    expect(j.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(j.title).toEqual({ en: `Hello ${TEST_ANN_MARKER}`, zh: "你好" });
    expect(j.severity).toBe("warning");
    expect(j.dismissible).toBe(false);

    // DB confirmation — row really exists with the right createdBy.
    const [row] = await db
      .select()
      .from(announcements)
      .where(eq(announcements.id, j.id));
    expect(row).toBeDefined();
    expect(row!.createdBy).toBe(owner.userId);

    // Audit row recorded the create.
    const auditRows = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "announcement.create"),
          eq(auditLog.targetId, j.id),
        ),
      );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.actorId).toBe(owner.userId);
    expect(auditRows[0]!.targetType).toBe("announcement");
    expect(auditRows[0]!.payload).toMatchObject({ severity: "warning" });
  });

  it("POST 400 when both title.zh and title.en are missing", async () => {
    const owner = await makeOwner();
    const res = await app.request("/api/owner/announcements", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({
        title: {},
        body: { en: "body" },
        severity: "info",
        startsAt: new Date().toISOString(),
      }),
    });
    expect(res.status).toBe(400);
  });

  it("POST 400 when both body.zh and body.en are missing", async () => {
    const owner = await makeOwner();
    const res = await app.request("/api/owner/announcements", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({
        title: { en: `x ${TEST_ANN_MARKER}` },
        body: {},
        severity: "info",
        startsAt: new Date().toISOString(),
      }),
    });
    expect(res.status).toBe(400);
  });

  it("POST 400 when severity is invalid", async () => {
    const owner = await makeOwner();
    const res = await app.request("/api/owner/announcements", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({
        title: { en: `x ${TEST_ANN_MARKER}` },
        body: { en: "y" },
        severity: "danger", // not in enum
        startsAt: new Date().toISOString(),
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe("owner announcements — GET list", () => {
  it("GET /announcements 200 returns items including soft-deleted", async () => {
    const owner = await makeOwner();
    // Seed one row, then soft-delete a second so both shapes are exercised.
    const a = await app.request("/api/owner/announcements", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({
        title: { en: `Live ${TEST_ANN_MARKER}` },
        body: { en: "x" },
        severity: "info",
        startsAt: new Date().toISOString(),
      }),
    });
    const aBody = (await a.json()) as { id: string };
    const b = await app.request("/api/owner/announcements", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({
        title: { en: `Tombstoned ${TEST_ANN_MARKER}` },
        body: { en: "y" },
        severity: "info",
        startsAt: new Date().toISOString(),
      }),
    });
    const bBody = (await b.json()) as { id: string };
    await app.request(`/api/owner/announcements/${bBody.id}`, {
      method: "DELETE",
      headers: { Cookie: owner.cookie },
    });

    const res = await app.request("/api/owner/announcements", {
      headers: { Cookie: owner.cookie },
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      items: Array<{ id: string; title: { en?: string }; deletedAt: string | null }>;
    };
    const ours = j.items.filter((r) =>
      (r.title.en ?? "").includes(TEST_ANN_MARKER),
    );
    expect(ours.map((r) => r.id)).toEqual(
      expect.arrayContaining([aBody.id, bBody.id]),
    );
    const tomb = ours.find((r) => r.id === bBody.id);
    expect(tomb?.deletedAt).not.toBeNull();
  });
});

describe("owner announcements — PATCH", () => {
  it("PATCH 200 partial + writes audit", async () => {
    const owner = await makeOwner();
    const created = await app.request("/api/owner/announcements", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({
        title: { en: `Orig ${TEST_ANN_MARKER}` },
        body: { en: "orig" },
        severity: "info",
        startsAt: new Date().toISOString(),
      }),
    });
    const { id } = (await created.json()) as { id: string };

    const res = await app.request(`/api/owner/announcements/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({
        severity: "critical",
        body: { en: "patched" },
      }),
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      id: string;
      severity: string;
      body: { en?: string };
      title: { en?: string };
      updatedBy: string;
    };
    expect(j.severity).toBe("critical");
    expect(j.body).toEqual({ en: "patched" });
    // Title untouched.
    expect(j.title).toEqual({ en: `Orig ${TEST_ANN_MARKER}` });
    expect(j.updatedBy).toBe(owner.userId);

    // Audit row.
    const auditRows = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "announcement.update"),
          eq(auditLog.targetId, id),
        ),
      );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.actorId).toBe(owner.userId);
    expect(auditRows[0]!.targetType).toBe("announcement");
  });

  it("PATCH 404 for unknown id", async () => {
    const owner = await makeOwner();
    const res = await app.request(
      "/api/owner/announcements/00000000-0000-0000-0000-000000000000",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: owner.cookie },
        body: JSON.stringify({ severity: "warning" }),
      },
    );
    expect(res.status).toBe(404);
  });
});

describe("owner announcements — DELETE", () => {
  it("DELETE 200 soft-deletes + writes audit", async () => {
    const owner = await makeOwner();
    const created = await app.request("/api/owner/announcements", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({
        title: { en: `ToDelete ${TEST_ANN_MARKER}` },
        body: { en: "x" },
        severity: "info",
        startsAt: new Date().toISOString(),
      }),
    });
    const { id } = (await created.json()) as { id: string };

    const res = await app.request(`/api/owner/announcements/${id}`, {
      method: "DELETE",
      headers: { Cookie: owner.cookie },
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { id: string; deleted: boolean };
    expect(j.id).toBe(id);
    expect(j.deleted).toBe(true);

    // DB confirmation — row still exists (soft delete only) and deletedAt set.
    const [row] = await db
      .select()
      .from(announcements)
      .where(eq(announcements.id, id));
    expect(row).toBeDefined();
    expect(row!.deletedAt).not.toBeNull();
    expect(row!.updatedBy).toBe(owner.userId);

    // Audit row.
    const auditRows = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "announcement.delete"),
          eq(auditLog.targetId, id),
        ),
      );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.actorId).toBe(owner.userId);
    expect(auditRows[0]!.targetType).toBe("announcement");
  });
});

// ── /api/owner/r2-accounts CRUD (M10b W3.2) ──────────────────────────────
//
// Plaintext `accessKeySecret` arrives on the request body for create/update,
// is encrypted at rest by the repo (W3.1 / lib/crypto), and MUST NEVER leak
// back in any response. Every write records an audit row whose payload notes
// the affected fields (or, for create/delete, just identifying metadata) but
// never the secret value itself.
//
// All seeded rows use the TEST_R2_CRUD_PREFIX ("tw32r-") on `name` so the
// top-level cleanup() sweeps them — including the audit_log rows their FK
// would otherwise pin. The W3.1 repo tests use a separate "tw31r-" prefix
// and the real dev-primary pool member is untouched.

function makeCreateBody(suffix: string) {
  return {
    name: `${TEST_R2_CRUD_PREFIX}${suffix}`,
    accountId: `${TEST_R2_CRUD_PREFIX}acc-${suffix}`,
    endpoint: `https://${suffix}.test.r2.cloudflarestorage.com`,
    accessKeyId: `AKIA-route-${suffix}`,
    accessKeySecret: `plain-secret-${suffix}`,
    bucket: `${TEST_R2_CRUD_PREFIX}bucket-${suffix}`,
    publicUrl: `https://${suffix}.test.r2.dev`,
    priority: 250,
    enabled: true,
  };
}

describe("owner r2-accounts — POST", () => {
  it("POST 403 for non-owner", async () => {
    const sess = await makeNonOwner("admin");
    const res = await app.request("/api/owner/r2-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sess.cookie },
      body: JSON.stringify(makeCreateBody("forbidden")),
    });
    expect(res.status).toBe(403);
  });

  it("POST 201 inserts row with encrypted secret + audit + never echoes secret", async () => {
    const owner = await makeOwner();
    const body = makeCreateBody("create-A");
    const res = await app.request("/api/owner/r2-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(201);
    const j = (await res.json()) as Record<string, unknown>;
    expect(typeof j.id).toBe("string");
    expect(j.name).toBe(body.name);
    expect(j.bucket).toBe(body.bucket);
    // The plaintext secret MUST NOT appear anywhere in the response — neither
    // as `accessKeySecret` (the field name) nor as a stray string value.
    expect(j.accessKeySecret).toBeUndefined();
    expect(JSON.stringify(j)).not.toContain(body.accessKeySecret);

    // DB row exists and the ciphertext round-trips to the supplied plaintext.
    const [row] = await db
      .select()
      .from(r2Accounts)
      .where(eq(r2Accounts.id, j.id as string));
    expect(row).toBeDefined();
    expect(row!.accessKeySecretEncrypted).not.toBe(body.accessKeySecret);
    expect(decryptSecret(row!.accessKeySecretEncrypted)).toBe(
      body.accessKeySecret,
    );

    // Audit row recorded — payload notes name/bucket/enabled, NOT the secret.
    const auditRows = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "r2.create"),
          eq(auditLog.targetId, j.id as string),
        ),
      );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.actorId).toBe(owner.userId);
    expect(auditRows[0]!.targetType).toBe("r2_account");
    expect(auditRows[0]!.payload).toMatchObject({
      name: body.name,
      bucket: body.bucket,
      enabled: true,
    });
    expect(JSON.stringify(auditRows[0]!.payload)).not.toContain(
      body.accessKeySecret,
    );
  });

  it("POST 400 with invalid endpoint URL", async () => {
    const owner = await makeOwner();
    const body = { ...makeCreateBody("bad-url"), endpoint: "not-a-url" };
    const res = await app.request("/api/owner/r2-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(400);
  });

  it("POST 400 with empty bucket", async () => {
    const owner = await makeOwner();
    const body = { ...makeCreateBody("empty-bucket"), bucket: "" };
    const res = await app.request("/api/owner/r2-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify(body),
    });
    expect(res.status).toBe(400);
  });
});

describe("owner r2-accounts — PATCH", () => {
  it("PATCH 200 partial priority update + audit + secret untouched", async () => {
    const owner = await makeOwner();
    // Seed via the POST endpoint so the whole pipeline (validation + encrypt)
    // runs end-to-end and we capture the real id.
    const created = await app.request("/api/owner/r2-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify(makeCreateBody("patch-prio")),
    });
    const { id } = (await created.json()) as { id: string };
    const [before] = await db
      .select()
      .from(r2Accounts)
      .where(eq(r2Accounts.id, id));
    const cipherBefore = before!.accessKeySecretEncrypted;
    const nameBefore = before!.name;
    const bucketBefore = before!.bucket;

    const res = await app.request(`/api/owner/r2-accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({ priority: 17 }),
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { id: string; priority: number; name: string };
    expect(j.id).toBe(id);
    expect(j.priority).toBe(17);
    // Secret never appears in PATCH response either.
    expect((j as Record<string, unknown>).accessKeySecret).toBeUndefined();
    expect(JSON.stringify(j)).not.toContain("plain-secret-");

    // DB confirmation — priority changed; secret + other fields untouched.
    const [row] = await db
      .select()
      .from(r2Accounts)
      .where(eq(r2Accounts.id, id));
    expect(row!.priority).toBe(17);
    expect(row!.accessKeySecretEncrypted).toBe(cipherBefore);
    expect(row!.name).toBe(nameBefore);
    expect(row!.bucket).toBe(bucketBefore);
    // Round-trip still yields the original plaintext.
    expect(decryptSecret(row!.accessKeySecretEncrypted)).toBe(
      "plain-secret-patch-prio",
    );

    // Audit row: `fields` lists what changed, never the secret literal.
    const auditRows = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.action, "r2.update"), eq(auditLog.targetId, id)),
      );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.actorId).toBe(owner.userId);
    expect(auditRows[0]!.targetType).toBe("r2_account");
    expect(auditRows[0]!.payload).toMatchObject({ fields: ["priority"] });
  });

  it("PATCH 200 with accessKeySecret rotates ciphertext (audit omits secret)", async () => {
    const owner = await makeOwner();
    const created = await app.request("/api/owner/r2-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify(makeCreateBody("rotate-secret")),
    });
    const { id } = (await created.json()) as { id: string };
    const [before] = await db
      .select()
      .from(r2Accounts)
      .where(eq(r2Accounts.id, id));
    const cipherBefore = before!.accessKeySecretEncrypted;

    const newSecret = "rotated-secret-xyz";
    const res = await app.request(`/api/owner/r2-accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({ accessKeySecret: newSecret }),
    });
    expect(res.status).toBe(200);
    // Response body MUST NOT contain the new secret in any form.
    const raw = await res.text();
    expect(raw).not.toContain(newSecret);

    // Ciphertext changed and round-trips to the new plaintext.
    const [row] = await db
      .select()
      .from(r2Accounts)
      .where(eq(r2Accounts.id, id));
    expect(row!.accessKeySecretEncrypted).not.toBe(cipherBefore);
    expect(row!.accessKeySecretEncrypted).not.toBe(newSecret);
    expect(decryptSecret(row!.accessKeySecretEncrypted)).toBe(newSecret);

    // Audit row: `fields` should mention the rotation happened, but the
    // accessKeySecret value itself must not be present anywhere.
    const auditRows = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.action, "r2.update"), eq(auditLog.targetId, id)),
      );
    expect(auditRows).toHaveLength(1);
    const fields = (auditRows[0]!.payload as { fields: string[] }).fields;
    expect(fields).not.toContain("accessKeySecret");
    expect(JSON.stringify(auditRows[0]!.payload)).not.toContain(newSecret);
  });

  it("PATCH 404 for unknown id", async () => {
    const owner = await makeOwner();
    const res = await app.request(
      "/api/owner/r2-accounts/00000000-0000-0000-0000-000000000000",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: owner.cookie },
        body: JSON.stringify({ priority: 5 }),
      },
    );
    expect(res.status).toBe(404);
  });

  it("PATCH 400 with invalid endpoint URL", async () => {
    const owner = await makeOwner();
    const created = await app.request("/api/owner/r2-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify(makeCreateBody("patch-bad-url")),
    });
    const { id } = (await created.json()) as { id: string };
    const res = await app.request(`/api/owner/r2-accounts/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify({ endpoint: "totally not a url" }),
    });
    expect(res.status).toBe(400);
  });
});

describe("owner r2-accounts — DELETE", () => {
  it("DELETE 200 soft-deletes + writes audit", async () => {
    const owner = await makeOwner();
    const created = await app.request("/api/owner/r2-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify(makeCreateBody("delete-me")),
    });
    const { id } = (await created.json()) as { id: string };

    const res = await app.request(`/api/owner/r2-accounts/${id}`, {
      method: "DELETE",
      headers: { Cookie: owner.cookie },
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { id: string; deleted: boolean };
    expect(j.id).toBe(id);
    expect(j.deleted).toBe(true);

    // DB confirmation — row still exists (soft delete only) and deletedAt set.
    const [row] = await db
      .select()
      .from(r2Accounts)
      .where(eq(r2Accounts.id, id));
    expect(row).toBeDefined();
    expect(row!.deletedAt).not.toBeNull();

    const auditRows = await db
      .select()
      .from(auditLog)
      .where(
        and(eq(auditLog.action, "r2.delete"), eq(auditLog.targetId, id)),
      );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.actorId).toBe(owner.userId);
    expect(auditRows[0]!.targetType).toBe("r2_account");
  });

  it("DELETE 404 for unknown id", async () => {
    const owner = await makeOwner();
    const res = await app.request(
      "/api/owner/r2-accounts/00000000-0000-0000-0000-000000000000",
      { method: "DELETE", headers: { Cookie: owner.cookie } },
    );
    expect(res.status).toBe(404);
  });
});

// ── /api/owner/r2-accounts/:id/test (M10b W3.3) ──────────────────────────
//
// testConnection HEADs a non-existent probe key. We exercise the route end
// to end with the S3Client mocked at the SDK layer: the route invokes
// r2-ops.testConnection, which builds a real S3Client via the
// r2-client-cache (decrypting the secret with crypto), and the mock
// intercepts the HeadObjectCommand call. The route is auth-gated through
// the same requireOwner() chain as the CRUD endpoints.
describe("owner r2-accounts — POST /:id/test", () => {
  it("POST 403 for non-owner", async () => {
    const sess = await makeNonOwner("admin");
    // Seed a row so the 404 path doesn't pre-empt the 403 check.
    const created = await db
      .insert(r2Accounts)
      .values({
        name: `${TEST_R2_CRUD_PREFIX}test-403`,
        accountId: "t",
        endpoint: "https://t.r2.cloudflarestorage.com",
        accessKeyId: "K",
        accessKeySecretEncrypted: encryptSecret("s"),
        bucket: "b",
        publicUrl: "https://t.r2.dev",
      })
      .returning({ id: r2Accounts.id });
    const id = created[0]!.id;
    const res = await app.request(`/api/owner/r2-accounts/${id}/test`, {
      method: "POST",
      headers: { Cookie: sess.cookie },
    });
    expect(res.status).toBe(403);
  });

  it("POST 404 for unknown id", async () => {
    const owner = await makeOwner();
    const res = await app.request(
      "/api/owner/r2-accounts/00000000-0000-0000-0000-000000000000/test",
      { method: "POST", headers: { Cookie: owner.cookie } },
    );
    expect(res.status).toBe(404);
  });

  it("POST 200 returns { ok, status, latencyMs } shape on 404 probe response", async () => {
    const owner = await makeOwner();
    // Seed via the POST endpoint so the encrypted-secret round-trip works.
    const created = await app.request("/api/owner/r2-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify(makeCreateBody("test-200")),
    });
    const { id } = (await created.json()) as { id: string };
    s3Mock.on(HeadObjectCommand).rejects(
      Object.assign(new Error("Not Found"), {
        name: "NotFound",
        $metadata: { httpStatusCode: 404 },
      }),
    );

    const res = await app.request(`/api/owner/r2-accounts/${id}/test`, {
      method: "POST",
      headers: { Cookie: owner.cookie },
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      ok: boolean;
      status: number | null;
      latencyMs: number;
    };
    expect(j.ok).toBe(true);
    expect(j.status).toBe(404);
    expect(typeof j.latencyMs).toBe("number");
  });

  it("POST 200 returns { ok:false, status:503 } when S3 returns server error", async () => {
    const owner = await makeOwner();
    const created = await app.request("/api/owner/r2-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify(makeCreateBody("test-503")),
    });
    const { id } = (await created.json()) as { id: string };
    s3Mock.on(HeadObjectCommand).rejects(
      Object.assign(new Error("ServiceUnavailable"), {
        name: "ServiceUnavailable",
        $metadata: { httpStatusCode: 503 },
      }),
    );

    const res = await app.request(`/api/owner/r2-accounts/${id}/test`, {
      method: "POST",
      headers: { Cookie: owner.cookie },
    });
    // Endpoint always returns 200 with a result body; the `ok` flag carries
    // the verdict so the UI can show a contextual error.
    expect(res.status).toBe(200);
    const j = (await res.json()) as { ok: boolean; status: number | null };
    expect(j.ok).toBe(false);
    expect(j.status).toBe(503);
  });
});

// ── /api/owner/r2-accounts/:id/sync-usage (M10b W3.3) ────────────────────
//
// Full pipeline: route handler decrypts secret via the repo helper, runs
// paginated ListObjectsV2 against the mocked S3 client, persists totals via
// repo.setUsageStats, and records an audit row. We use mockedListObjects
// (set per-test) to drive the pagination + size math.
describe("owner r2-accounts — POST /:id/sync-usage", () => {
  it("POST 403 for non-owner", async () => {
    const sess = await makeNonOwner("admin");
    const created = await db
      .insert(r2Accounts)
      .values({
        name: `${TEST_R2_CRUD_PREFIX}sync-403`,
        accountId: "t",
        endpoint: "https://t.r2.cloudflarestorage.com",
        accessKeyId: "K",
        accessKeySecretEncrypted: encryptSecret("s"),
        bucket: "b",
        publicUrl: "https://t.r2.dev",
      })
      .returning({ id: r2Accounts.id });
    const id = created[0]!.id;
    const res = await app.request(
      `/api/owner/r2-accounts/${id}/sync-usage`,
      { method: "POST", headers: { Cookie: sess.cookie } },
    );
    expect(res.status).toBe(403);
  });

  it("POST 404 for unknown id", async () => {
    const owner = await makeOwner();
    const res = await app.request(
      "/api/owner/r2-accounts/00000000-0000-0000-0000-000000000000/sync-usage",
      { method: "POST", headers: { Cookie: owner.cookie } },
    );
    expect(res.status).toBe(404);
  });

  it("POST 200 sums sizes, persists used_bytes + last_synced_at, writes audit", async () => {
    const owner = await makeOwner();
    const created = await app.request("/api/owner/r2-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: owner.cookie },
      body: JSON.stringify(makeCreateBody("sync-200")),
    });
    const { id } = (await created.json()) as { id: string };

    // 2 paginated pages: 100 + 200 + 50 = 350 bytes, 3 objects.
    s3Mock
      .on(ListObjectsV2Command)
      .resolvesOnce({
        Contents: [
          { Key: "a", Size: 100 },
          { Key: "b", Size: 200 },
        ],
        IsTruncated: true,
        NextContinuationToken: "next1",
      })
      .resolvesOnce({
        Contents: [{ Key: "c", Size: 50 }],
        IsTruncated: false,
      });

    const res = await app.request(
      `/api/owner/r2-accounts/${id}/sync-usage`,
      { method: "POST", headers: { Cookie: owner.cookie } },
    );
    expect(res.status).toBe(200);
    const j = (await res.json()) as { usedBytes: number; objectCount: number };
    expect(j.usedBytes).toBe(350);
    expect(j.objectCount).toBe(3);

    // DB confirmation: used_bytes + last_synced_at really got written.
    const [row] = await db
      .select({
        usedBytes: r2Accounts.usedBytes,
        lastSyncedAt: r2Accounts.lastSyncedAt,
      })
      .from(r2Accounts)
      .where(eq(r2Accounts.id, id));
    expect(row!.usedBytes).toBe(350);
    expect(row!.lastSyncedAt).not.toBeNull();

    // Audit row.
    const auditRows = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "r2.sync_usage"),
          eq(auditLog.targetId, id),
        ),
      );
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.actorId).toBe(owner.userId);
    expect(auditRows[0]!.targetType).toBe("r2_account");
    expect(auditRows[0]!.payload).toMatchObject({
      usedBytes: 350,
      objectCount: 3,
    });
  });
});
