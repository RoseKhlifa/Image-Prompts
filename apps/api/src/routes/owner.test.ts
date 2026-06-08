import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { eq, inArray, like } from "drizzle-orm";
import { createServer } from "../server.ts";
import { db } from "../db/client.ts";
import { users, siteSettings, r2Accounts } from "../db/schema/index.ts";
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
