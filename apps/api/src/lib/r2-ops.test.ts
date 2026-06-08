import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  HeadObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import {
  presignPut,
  headObject,
  copyObject,
  deleteObject,
  testConnection,
  syncUsage,
} from "./r2-ops.ts";
import { clearR2ClientCache } from "./r2-client-cache.ts";
import { encryptSecret } from "./crypto.ts";
import * as r2Repo from "../repositories/r2-accounts.ts";

beforeAll(() => {
  process.env.R2_ENCRYPTION_KEY =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

function fakeAccount() {
  return {
    id: "acc-1",
    endpoint: "https://acc1.r2.cloudflarestorage.com",
    accessKeyId: "AKIA1",
    accessKeySecretEncrypted: encryptSecret("s1"),
    bucket: "test-bucket",
    publicUrl: "https://acc1.r2.dev",
  };
}

const s3Mock = mockClient(S3Client);

beforeEach(() => {
  s3Mock.reset();
  clearR2ClientCache();
});

describe("presignPut", () => {
  it("returns a URL containing the bucket + key + an expiry", async () => {
    const acc = fakeAccount();
    const { uploadUrl, expiresAt } = await presignPut({
      account: acc,
      key: "submissions/u/abc.jpg",
      contentType: "image/jpeg",
      contentLength: 1024,
      ttlSeconds: 60,
    });
    expect(uploadUrl).toContain("test-bucket");
    expect(uploadUrl).toContain("submissions/u/abc.jpg");
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 30_000);
  });
});

describe("headObject", () => {
  it("returns size + type for a present object", async () => {
    s3Mock.on(HeadObjectCommand).resolves({
      ContentLength: 4096,
      ContentType: "image/png",
    });
    const r = await headObject(fakeAccount(), "submissions/u/x.png");
    expect(r).toEqual({ contentLength: 4096, contentType: "image/png" });
  });

  it("returns null for a missing object (NotFound)", async () => {
    s3Mock.on(HeadObjectCommand).rejects(
      Object.assign(new Error("not found"), { name: "NotFound" }),
    );
    const r = await headObject(fakeAccount(), "submissions/u/missing.png");
    expect(r).toBeNull();
  });

  it("propagates other errors", async () => {
    s3Mock.on(HeadObjectCommand).rejects(new Error("AccessDenied"));
    await expect(
      headObject(fakeAccount(), "submissions/u/forbidden.png"),
    ).rejects.toThrow("AccessDenied");
  });
});

describe("copyObject", () => {
  it("sends CopyObjectCommand with URL-encoded CopySource", async () => {
    s3Mock.on(CopyObjectCommand).resolves({});
    await copyObject(fakeAccount(), "submissions/u/a b.png", "prompts/p/0.png");
    const calls = s3Mock.commandCalls(CopyObjectCommand);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args[0].input).toMatchObject({
      Bucket: "test-bucket",
      Key: "prompts/p/0.png",
      CopySource: expect.stringMatching(/^test-bucket\/submissions\/u\/a%20b\.png$/),
    });
  });
});

describe("deleteObject", () => {
  it("sends DeleteObjectCommand", async () => {
    s3Mock.on(DeleteObjectCommand).resolves({});
    await deleteObject(fakeAccount(), "submissions/u/x.png");
    expect(s3Mock.commandCalls(DeleteObjectCommand)).toHaveLength(1);
  });
});

// ── testConnection (M10b W3.3) ────────────────────────────────────────────
//
// testConnection HEADs a guaranteed-not-to-exist key. Any HTTP response —
// even a 404 / 403 — means we reached the bucket: credentials parsed and
// the host resolved, so the connection works. 5xx and pure network errors
// (no $metadata) signal genuine unreachability.
describe("testConnection", () => {
  it("returns { ok: true, status: 404 } when S3 says NotFound", async () => {
    s3Mock.on(HeadObjectCommand).rejects(
      Object.assign(new Error("Not Found"), {
        name: "NotFound",
        $metadata: { httpStatusCode: 404 },
      }),
    );
    const r = await testConnection(fakeAccount());
    expect(r.ok).toBe(true);
    expect(r.status).toBe(404);
    expect(typeof r.latencyMs).toBe("number");
    expect(r.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("returns { ok: true, status: 403 } when bucket rejects auth", async () => {
    s3Mock.on(HeadObjectCommand).rejects(
      Object.assign(new Error("Forbidden"), {
        name: "AccessDenied",
        $metadata: { httpStatusCode: 403 },
      }),
    );
    const r = await testConnection(fakeAccount());
    // 403 = bucket reachable, creds wrong/weak — still counts as "connected".
    expect(r.ok).toBe(true);
    expect(r.status).toBe(403);
  });

  it("returns { ok: false, status: 500 } on server error", async () => {
    s3Mock.on(HeadObjectCommand).rejects(
      Object.assign(new Error("ServiceUnavailable"), {
        name: "ServiceUnavailable",
        $metadata: { httpStatusCode: 503 },
      }),
    );
    const r = await testConnection(fakeAccount());
    expect(r.ok).toBe(false);
    expect(r.status).toBe(503);
  });

  it("returns { ok: false, status: null } on pure network error", async () => {
    // No $metadata → SDK never saw a response. Network refused / DNS failed.
    s3Mock.on(HeadObjectCommand).rejects(
      Object.assign(new Error("connect ECONNREFUSED"), { name: "Error" }),
    );
    const r = await testConnection(fakeAccount());
    expect(r.ok).toBe(false);
    expect(r.status).toBeNull();
    expect(r.error).toBeDefined();
  });

  it("returns { ok: true, status: 200 } on the surprise case where the probe key exists", async () => {
    // Pathological: the probe key actually returned 200. We treat that the
    // same as 404 — connection works.
    s3Mock.on(HeadObjectCommand).resolves({
      ContentLength: 0,
      ContentType: "text/plain",
    });
    const r = await testConnection(fakeAccount());
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
  });
});

// ── syncUsage (M10b W3.3) ─────────────────────────────────────────────────
//
// Paginated ListObjectsV2 sum-of-Size. Persists via repo.setUsageStats. The
// repo call is spied on (not stubbed) so we can assert it received the right
// args without poking the real DB.
describe("syncUsage", () => {
  it("sums sizes across paginated pages and writes to DB", async () => {
    // 3 pages: 2 + 2 + 1 objects = 5 total, sizes 100+200+300+400+500=1500.
    s3Mock
      .on(ListObjectsV2Command)
      .resolvesOnce({
        Contents: [
          { Key: "a", Size: 100 },
          { Key: "b", Size: 200 },
        ],
        IsTruncated: true,
        NextContinuationToken: "tok1",
      })
      .resolvesOnce({
        Contents: [
          { Key: "c", Size: 300 },
          { Key: "d", Size: 400 },
        ],
        IsTruncated: true,
        NextContinuationToken: "tok2",
      })
      .resolvesOnce({
        Contents: [{ Key: "e", Size: 500 }],
        IsTruncated: false,
      });

    const spy = vi
      .spyOn(r2Repo, "setUsageStats")
      .mockResolvedValue(undefined);
    try {
      const r = await syncUsage({ ...fakeAccount(), id: "acc-sync-1" });
      expect(r.usedBytes).toBe(1500);
      expect(r.objectCount).toBe(5);
      // 3 paginated calls; the second/third must carry the continuation token.
      const calls = s3Mock.commandCalls(ListObjectsV2Command);
      expect(calls).toHaveLength(3);
      expect(calls[0]!.args[0].input.ContinuationToken).toBeUndefined();
      expect(calls[1]!.args[0].input.ContinuationToken).toBe("tok1");
      expect(calls[2]!.args[0].input.ContinuationToken).toBe("tok2");
      // MaxKeys must be 1000 (S3 page max).
      for (const c of calls) {
        expect(c.args[0].input.MaxKeys).toBe(1000);
      }
      // Repo persisted total against the right account id.
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith("acc-sync-1", 1500);
    } finally {
      spy.mockRestore();
    }
  });

  it("handles an empty bucket (0 bytes, 0 objects, still persists)", async () => {
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [],
      IsTruncated: false,
    });
    const spy = vi
      .spyOn(r2Repo, "setUsageStats")
      .mockResolvedValue(undefined);
    try {
      const r = await syncUsage({ ...fakeAccount(), id: "acc-empty" });
      expect(r.usedBytes).toBe(0);
      expect(r.objectCount).toBe(0);
      expect(spy).toHaveBeenCalledWith("acc-empty", 0);
    } finally {
      spy.mockRestore();
    }
  });

  it("treats objects with missing Size as zero", async () => {
    // S3 always returns Size, but defensive coding — verify we don't crash.
    s3Mock.on(ListObjectsV2Command).resolves({
      Contents: [{ Key: "a" }, { Key: "b", Size: 7 }],
      IsTruncated: false,
    });
    const spy = vi
      .spyOn(r2Repo, "setUsageStats")
      .mockResolvedValue(undefined);
    try {
      const r = await syncUsage({ ...fakeAccount(), id: "acc-mixed" });
      expect(r.usedBytes).toBe(7);
      expect(r.objectCount).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });
});
