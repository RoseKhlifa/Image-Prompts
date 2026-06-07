import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { like, notLike } from "drizzle-orm";
import { db } from "../db/client.ts";
import { r2Accounts } from "../db/schema/index.ts";
import { pickWriteAccount, NoR2AccountError } from "./r2-scheduler.ts";
import { encryptSecret } from "./crypto.ts";

const TEST_NAME_PREFIX = "r2-scheduler-test-";

beforeEach(async () => {
  process.env.R2_ENCRYPTION_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  // Only delete rows this test suite inserted (prefix-scoped). Seeded
  // r2_accounts rows referenced by prompt_images stay intact.
  await db.delete(r2Accounts).where(like(r2Accounts.name, `${TEST_NAME_PREFIX}%`));
  // Disable any non-test rows so pickWriteAccount tests see only our state.
  await db
    .update(r2Accounts)
    .set({ enabled: false })
    .where(notLike(r2Accounts.name, `${TEST_NAME_PREFIX}%`));
});

afterAll(async () => {
  // Restore non-test rows to enabled so subsequent test suites see the seed.
  await db
    .update(r2Accounts)
    .set({ enabled: true })
    .where(notLike(r2Accounts.name, `${TEST_NAME_PREFIX}%`));
  // And clean up our prefix rows.
  await db.delete(r2Accounts).where(like(r2Accounts.name, `${TEST_NAME_PREFIX}%`));
});

let counter = 0;
async function insertAcc(input: Partial<typeof r2Accounts.$inferInsert> = {}) {
  counter += 1;
  // Defensive against callers that try to bypass the prefix: strip any inbound
  // prefix and re-apply it.
  const inboundLabel = (input.name ?? "x").replace(TEST_NAME_PREFIX, "");
  const values = {
    accountId: "test-account",
    accessKeyId: "K",
    accessKeySecretEncrypted: encryptSecret("s"),
    bucket: "b",
    endpoint: "https://x.r2.cloudflarestorage.com",
    publicUrl: "https://x.r2.dev",
    priority: 0,
    enabled: true,
    ...input,
    // Force name to keep the prefix even if caller passed input.name.
    name: `${TEST_NAME_PREFIX}${counter}-${inboundLabel}`,
  };
  const [row] = await db.insert(r2Accounts).values(values).returning();
  return row!;
}

describe("pickWriteAccount", () => {
  it("throws NoR2AccountError when no enabled account exists", async () => {
    await expect(pickWriteAccount()).rejects.toBeInstanceOf(NoR2AccountError);
  });

  it("returns the highest-priority enabled non-deleted account", async () => {
    await insertAcc({ name: "low", priority: 1 });
    const high = await insertAcc({ name: "high", priority: 100 });
    await insertAcc({ name: "mid", priority: 50 });
    const picked = await pickWriteAccount();
    expect(picked.id).toBe(high.id);
  });

  it("ignores disabled accounts", async () => {
    await insertAcc({ name: "disabled", priority: 1000, enabled: false });
    const real = await insertAcc({ name: "ok", priority: 1 });
    const picked = await pickWriteAccount();
    expect(picked.id).toBe(real.id);
  });

  it("ignores soft-deleted accounts", async () => {
    await insertAcc({ name: "deleted", priority: 1000, deletedAt: new Date() });
    const real = await insertAcc({ name: "ok", priority: 1 });
    const picked = await pickWriteAccount();
    expect(picked.id).toBe(real.id);
  });

  it("breaks priority ties by earlier createdAt", async () => {
    const first = await insertAcc({ name: "a", priority: 10 });
    await new Promise((r) => setTimeout(r, 10));
    await insertAcc({ name: "b", priority: 10 });
    const picked = await pickWriteAccount();
    expect(picked.id).toBe(first.id);
  });
});
