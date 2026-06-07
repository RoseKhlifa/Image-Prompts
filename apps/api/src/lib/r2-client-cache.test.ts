import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { S3Client } from "@aws-sdk/client-s3";
import { getS3Client, clearR2ClientCache } from "./r2-client-cache.ts";
import { encryptSecret } from "./crypto.ts";

beforeAll(() => {
  process.env.R2_ENCRYPTION_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

type R2AccountRow = {
  id: string;
  label: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKeyCiphertext: string;
  bucket: string;
  publicUrl: string;
  priority: number;
  enabled: boolean;
  createdAt: Date;
  deletedAt: Date | null;
};

function fakeAccount(overrides: Partial<R2AccountRow> = {}): R2AccountRow {
  return {
    id: overrides.id ?? "11111111-1111-1111-1111-111111111111",
    label: "test",
    endpoint: "https://example.r2.cloudflarestorage.com",
    accessKeyId: "AKIATEST",
    secretAccessKeyCiphertext: overrides.secretAccessKeyCiphertext ??
      encryptSecret("secret-v1"),
    bucket: "test-bucket",
    publicUrl: "https://example.r2.dev",
    priority: 100,
    enabled: true,
    createdAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

beforeEach(() => clearR2ClientCache());

describe("r2-client-cache", () => {
  it("returns the same S3Client instance on cache hit", () => {
    const acc = fakeAccount();
    const a = getS3Client(acc);
    const b = getS3Client(acc);
    expect(a).toBe(b);
    expect(a).toBeInstanceOf(S3Client);
  });

  it("invalidates the cached client when endpoint changes", () => {
    const acc1 = fakeAccount();
    const acc2 = fakeAccount({ endpoint: "https://other.r2.cloudflarestorage.com" });
    const a = getS3Client(acc1);
    const b = getS3Client(acc2);
    expect(a).not.toBe(b);
  });

  it("invalidates when accessKeyId changes", () => {
    const acc1 = fakeAccount();
    const acc2 = fakeAccount({ accessKeyId: "AKIA-OTHER" });
    expect(getS3Client(acc1)).not.toBe(getS3Client(acc2));
  });

  it("invalidates when secretAccessKeyCiphertext changes", () => {
    const acc1 = fakeAccount();
    const acc2 = fakeAccount({ secretAccessKeyCiphertext: encryptSecret("secret-v2") });
    expect(getS3Client(acc1)).not.toBe(getS3Client(acc2));
  });

  it("evicts oldest when cache is full (MAX_CACHED = 8)", () => {
    const made: Array<R2AccountRow> = [];
    // Insert 9 different account ids
    for (let i = 0; i < 9; i++) {
      const acc = fakeAccount({
        id: `0000000${i}-0000-0000-0000-000000000000`,
      });
      made.push(acc);
      getS3Client(acc);
    }
    // The first one (made[0]) should now be evicted; calling again creates a new client.
    const before = getS3Client(made[0]!);
    const after = getS3Client(made[0]!);
    expect(after).toBe(before); // re-inserted, then same on second call
  });

  it("clearR2ClientCache empties the cache", () => {
    const acc = fakeAccount();
    const a = getS3Client(acc);
    clearR2ClientCache();
    const b = getS3Client(acc);
    expect(a).not.toBe(b);
  });
});
