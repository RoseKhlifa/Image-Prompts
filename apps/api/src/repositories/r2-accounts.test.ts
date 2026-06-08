import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, like, or } from "drizzle-orm";
import { db } from "../db/client.ts";
import { r2Accounts } from "../db/schema/index.ts";
import { decryptSecret } from "../lib/crypto.ts";
import {
  createR2Account,
  updateR2Account,
  softDeleteR2Account,
  setUsageStats,
  getR2AccountForOwner,
} from "./r2-accounts.ts";

// Sweep every row planted by this test file. The test data is namespaced with
// the "tw31r-" prefix on both `name` and `accountId` so a single LIKE pair
// covers it. The real dev-primary row (name='dev-primary', points at the
// user's actual Cloudflare bucket) is never touched.
async function cleanup() {
  await db
    .delete(r2Accounts)
    .where(or(like(r2Accounts.name, "tw31r-%"), like(r2Accounts.accountId, "tw31r-%")));
}

beforeEach(cleanup);
afterAll(cleanup);

function makeInput(suffix: string) {
  return {
    name: `tw31r-${suffix}`,
    accountId: `tw31r-acc-${suffix}`,
    endpoint: `https://acc-${suffix}.r2.cloudflarestorage.com`,
    accessKeyId: `AKIA-test-${suffix}`,
    accessKeySecret: `plainsecret-${suffix}`,
    bucket: `tw31r-bucket-${suffix}`,
    publicUrl: `https://acc-${suffix}.r2.dev`,
  };
}

describe("createR2Account", () => {
  it("inserts row with encrypted secret", async () => {
    const { id } = await createR2Account(makeInput("A"));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const [row] = await db.select().from(r2Accounts).where(eq(r2Accounts.id, id));
    expect(row).toBeDefined();
    expect(row!.name).toBe("tw31r-A");
    expect(row!.accountId).toBe("tw31r-acc-A");
    expect(row!.endpoint).toBe("https://acc-A.r2.cloudflarestorage.com");
    expect(row!.accessKeyId).toBe("AKIA-test-A");
    expect(row!.bucket).toBe("tw31r-bucket-A");
    expect(row!.publicUrl).toBe("https://acc-A.r2.dev");
    // Stored ciphertext is NOT the plaintext.
    expect(row!.accessKeySecretEncrypted).not.toBe("plainsecret-A");
    expect(row!.accessKeySecretEncrypted.length).toBeGreaterThan(0);
    // Round-trip decrypts.
    expect(decryptSecret(row!.accessKeySecretEncrypted)).toBe("plainsecret-A");
  });

  it("defaults priority=100 and enabled=true when omitted", async () => {
    const { id } = await createR2Account(makeInput("B"));
    const [row] = await db.select().from(r2Accounts).where(eq(r2Accounts.id, id));
    expect(row!.priority).toBe(100);
    expect(row!.enabled).toBe(true);
    expect(row!.usedBytes).toBe(0);
    expect(row!.deletedAt).toBeNull();
    expect(row!.lastSyncedAt).toBeNull();
  });

  it("honours explicit priority and enabled=false", async () => {
    const { id } = await createR2Account({
      ...makeInput("C"),
      priority: 250,
      enabled: false,
    });
    const [row] = await db.select().from(r2Accounts).where(eq(r2Accounts.id, id));
    expect(row!.priority).toBe(250);
    expect(row!.enabled).toBe(false);
  });
});

describe("updateR2Account", () => {
  it("partial update — change priority only, secret untouched", async () => {
    const { id } = await createR2Account(makeInput("D"));
    const before = await db.select().from(r2Accounts).where(eq(r2Accounts.id, id));
    const cipherBefore = before[0]!.accessKeySecretEncrypted;

    const ok = await updateR2Account(id, { priority: 50 });
    expect(ok).toBe(true);

    const [row] = await db.select().from(r2Accounts).where(eq(r2Accounts.id, id));
    expect(row!.priority).toBe(50);
    // Secret ciphertext byte-for-byte unchanged because we didn't re-encrypt.
    expect(row!.accessKeySecretEncrypted).toBe(cipherBefore);
    // Plaintext still round-trips to the original.
    expect(decryptSecret(row!.accessKeySecretEncrypted)).toBe("plainsecret-D");
  });

  it("re-encrypts when accessKeySecret provided", async () => {
    const { id } = await createR2Account(makeInput("E"));
    const before = await db.select().from(r2Accounts).where(eq(r2Accounts.id, id));
    const cipherBefore = before[0]!.accessKeySecretEncrypted;

    const ok = await updateR2Account(id, { accessKeySecret: "rotated-E" });
    expect(ok).toBe(true);

    const [row] = await db.select().from(r2Accounts).where(eq(r2Accounts.id, id));
    // New ciphertext != old (different IV + different plaintext).
    expect(row!.accessKeySecretEncrypted).not.toBe(cipherBefore);
    expect(row!.accessKeySecretEncrypted).not.toBe("rotated-E");
    // Round-trip yields the new plaintext.
    expect(decryptSecret(row!.accessKeySecretEncrypted)).toBe("rotated-E");
  });

  it("updates multiple non-secret fields together", async () => {
    const { id } = await createR2Account(makeInput("F"));
    const ok = await updateR2Account(id, {
      name: "tw31r-F-renamed",
      bucket: "tw31r-bucket-F2",
      publicUrl: "https://new-F.r2.dev",
      enabled: false,
    });
    expect(ok).toBe(true);

    const [row] = await db.select().from(r2Accounts).where(eq(r2Accounts.id, id));
    expect(row!.name).toBe("tw31r-F-renamed");
    expect(row!.bucket).toBe("tw31r-bucket-F2");
    expect(row!.publicUrl).toBe("https://new-F.r2.dev");
    expect(row!.enabled).toBe(false);
    // accountId unchanged.
    expect(row!.accountId).toBe("tw31r-acc-F");
  });

  it("bumps updatedAt", async () => {
    const { id } = await createR2Account(makeInput("G"));
    const before = await db.select().from(r2Accounts).where(eq(r2Accounts.id, id));
    const updatedAtBefore = before[0]!.updatedAt;

    // Nudge the row's updatedAt into the past so a coarse-resolution clock
    // can't accidentally tie. (Postgres timestamptz is microsecond, but the
    // wall-clock comparison below is what we care about.)
    await db
      .update(r2Accounts)
      .set({ updatedAt: new Date(Date.now() - 5000) })
      .where(eq(r2Accounts.id, id));

    const ok = await updateR2Account(id, { priority: 75 });
    expect(ok).toBe(true);

    const [row] = await db.select().from(r2Accounts).where(eq(r2Accounts.id, id));
    expect(row!.updatedAt.getTime()).toBeGreaterThan(updatedAtBefore.getTime() - 5000);
  });

  it("returns false for unknown id", async () => {
    const ok = await updateR2Account("00000000-0000-0000-0000-000000000000", { priority: 99 });
    expect(ok).toBe(false);
  });
});

describe("softDeleteR2Account", () => {
  it("sets deletedAt and the row is still discoverable to the owner repo", async () => {
    const { id } = await createR2Account(makeInput("H"));
    const ok = await softDeleteR2Account(id);
    expect(ok).toBe(true);

    const r = await getR2AccountForOwner(id);
    expect(r).not.toBeNull();
    expect(r!.deletedAt).not.toBeNull();
  });

  it("returns false for unknown id", async () => {
    const ok = await softDeleteR2Account("00000000-0000-0000-0000-000000000000");
    expect(ok).toBe(false);
  });
});

describe("setUsageStats", () => {
  it("updates usedBytes and lastSyncedAt", async () => {
    const { id } = await createR2Account(makeInput("I"));
    const before = await db.select().from(r2Accounts).where(eq(r2Accounts.id, id));
    expect(before[0]!.usedBytes).toBe(0);
    expect(before[0]!.lastSyncedAt).toBeNull();

    await setUsageStats(id, 1024 * 1024 * 42);

    const [row] = await db.select().from(r2Accounts).where(eq(r2Accounts.id, id));
    expect(row!.usedBytes).toBe(1024 * 1024 * 42);
    expect(row!.lastSyncedAt).not.toBeNull();
    // Synced timestamp is recent.
    const ageMs = Date.now() - row!.lastSyncedAt!.getTime();
    expect(ageMs).toBeLessThan(60_000);
  });

  it("is a no-op on unknown id (does not throw)", async () => {
    await expect(
      setUsageStats("00000000-0000-0000-0000-000000000000", 1234),
    ).resolves.toBeUndefined();
  });
});
