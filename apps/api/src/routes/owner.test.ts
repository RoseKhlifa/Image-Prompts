import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { eq, inArray, like, and } from "drizzle-orm";
import { createServer } from "../server.ts";
import { db } from "../db/client.ts";
import { users, siteSettings, r2Accounts, auditLog } from "../db/schema/index.ts";
import { createTestSession } from "../auth/test-session.ts";
import { encryptSecret } from "../lib/crypto.ts";
import { resetSubmitConfigCache } from "../lib/submit-config.ts";

// Test isolation conventions follow admin.test.ts:
//  - Email prefix marks owned-by-test users so cleanup can sweep them safely.
//  - We restore the submit.daily_limit baseline (10) after each PUT test.
//  - process.env.OWNER_EMAILS is set so isOwnerEmail() picks our owner up.
const TEST_EMAIL_PREFIX = "owner-route-test-";
const TEST_R2_NAME = "owner-route-test-r2";

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
  // Sweep any test-owned users (they're created with the prefixed email).
  const testUserIds = (
    await db
      .select({ id: users.id })
      .from(users)
      .where(like(users.email, `${TEST_EMAIL_PREFIX}%@example.com`))
  ).map((u) => u.id);
  if (testUserIds.length > 0) {
    // Setting-rows with updated_by pointing at our test users would block the
    // user delete with FK 23503 — null them first.
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

beforeEach(async () => {
  await cleanup();
  await setupSeedR2();
  resetSubmitConfigCache();
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
