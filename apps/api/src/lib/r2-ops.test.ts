import { describe, it, expect, beforeEach, beforeAll } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  HeadObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { presignPut, headObject, copyObject, deleteObject } from "./r2-ops.ts";
import { clearR2ClientCache } from "./r2-client-cache.ts";
import { encryptSecret } from "./crypto.ts";

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
