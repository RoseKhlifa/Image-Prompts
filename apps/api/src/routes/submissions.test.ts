import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { eq, like, notLike } from "drizzle-orm";
import { mockClient } from "aws-sdk-client-mock";
import { S3Client } from "@aws-sdk/client-s3";
import { db, pool } from "../db/client.ts";
import { users, sessions } from "../db/schema/auth.ts";
import { r2Accounts } from "../db/schema/index.ts";
import { createServer } from "../server.ts";
import { createTestSession } from "../auth/test-session.ts";
import { encryptSecret } from "../lib/crypto.ts";
import { clearR2ClientCache } from "../lib/r2-client-cache.ts";

const TEST_R2_NAME_PREFIX = "presign-test-r2-";

beforeAll(() => {
  process.env.R2_ENCRYPTION_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

// Stub the S3Client SDK so presign signatures don't reach the network. The
// presigner only inspects the client's credentials/endpoint config to build a
// signed URL; it doesn't call .send(), so the mock is a passive no-op for
// presign — it just prevents any accidental network use elsewhere.
const s3Mock = mockClient(S3Client);

async function seedTestR2Account() {
  // Disable any seeded r2 rows so pickWriteAccount returns ours
  await db
    .update(r2Accounts)
    .set({ enabled: false })
    .where(notLike(r2Accounts.name, `${TEST_R2_NAME_PREFIX}%`));
  // Clean any leftover test rows
  await db.delete(r2Accounts).where(like(r2Accounts.name, `${TEST_R2_NAME_PREFIX}%`));
  // Insert a fresh test row
  await db.insert(r2Accounts).values({
    name: `${TEST_R2_NAME_PREFIX}1`,
    accountId: "test-account",
    endpoint: "https://test.r2.cloudflarestorage.com",
    accessKeyId: "K",
    accessKeySecretEncrypted: encryptSecret("s"),
    bucket: "test-bucket",
    publicUrl: "https://test.r2.dev",
    priority: 100,
    enabled: true,
  });
}

async function restoreR2Accounts() {
  await db.delete(r2Accounts).where(like(r2Accounts.name, `${TEST_R2_NAME_PREFIX}%`));
  await db
    .update(r2Accounts)
    .set({ enabled: true })
    .where(notLike(r2Accounts.name, `${TEST_R2_NAME_PREFIX}%`));
}

beforeEach(async () => {
  await seedTestR2Account();
  clearR2ClientCache();
  s3Mock.reset();
});

afterAll(async () => {
  await restoreR2Accounts();
  await db.delete(sessions);
  await db.delete(users).where(like(users.email, "test-%@example.com"));
  await pool.end();
});

const app = createServer();

describe("POST /api/submissions/presign", () => {
  it("requires authentication (401)", async () => {
    const res = await app.request("/api/submissions/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: "x.jpg", contentType: "image/jpeg", size: 1024 }),
    });
    expect(res.status).toBe(401);
  });

  it("returns presigned URL when authenticated and under daily limit", async () => {
    const sess = await createTestSession();
    const res = await app.request("/api/submissions/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sess.cookie },
      body: JSON.stringify({ filename: "x.jpg", contentType: "image/jpeg", size: 1024 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      r2AccountId: string;
      r2Key: string;
      uploadUrl: string;
      expiresAt: string;
    };
    expect(body.r2Key).toMatch(/^submissions\//);
    expect(body.uploadUrl.startsWith("https://")).toBe(true);
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now() + 60_000);
  });

  it("rejects unsupported MIME with 400", async () => {
    const sess = await createTestSession();
    const res = await app.request("/api/submissions/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sess.cookie },
      body: JSON.stringify({ filename: "x.gif", contentType: "image/gif", size: 1024 }),
    });
    expect(res.status).toBe(400);
  });

  it("returns 429 daily_limit_reached when count >= limit", async () => {
    const sess = await createTestSession();
    await db
      .update(users)
      .set({
        dailySubmissionCount: 10,
        dailySubmissionResetAt: new Date(),
      })
      .where(eq(users.id, sess.userId));
    const res = await app.request("/api/submissions/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sess.cookie },
      body: JSON.stringify({ filename: "x.jpg", contentType: "image/jpeg", size: 1024 }),
    });
    expect(res.status).toBe(429);
    const body = (await res.json()) as Record<string, unknown>;
    expect(JSON.stringify(body)).toContain("daily_limit_reached");
  });

  it("uses the demoted limit (5) when rejectedCount >= 3", async () => {
    const sess = await createTestSession();
    await db
      .update(users)
      .set({
        rejectedCount: 3,
        dailySubmissionCount: 5,
        dailySubmissionResetAt: new Date(),
      })
      .where(eq(users.id, sess.userId));
    const res = await app.request("/api/submissions/presign", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sess.cookie },
      body: JSON.stringify({ filename: "x.jpg", contentType: "image/jpeg", size: 1024 }),
    });
    expect(res.status).toBe(429);
  });
});
