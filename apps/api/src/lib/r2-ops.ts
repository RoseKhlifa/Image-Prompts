import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type ListObjectsV2CommandOutput,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getS3Client, type R2AccountRow } from "./r2-client-cache.ts";
import { setUsageStats } from "../repositories/r2-accounts.ts";

export async function presignPut(args: {
  account: R2AccountRow;
  key: string;
  contentType: string;
  contentLength: number;
  ttlSeconds: number;
}): Promise<{ uploadUrl: string; expiresAt: Date }> {
  const client = getS3Client(args.account);
  const cmd = new PutObjectCommand({
    Bucket: args.account.bucket,
    Key: args.key,
    ContentType: args.contentType,
    ContentLength: args.contentLength,
  });
  const uploadUrl = await getSignedUrl(client, cmd, { expiresIn: args.ttlSeconds });
  return {
    uploadUrl,
    expiresAt: new Date(Date.now() + args.ttlSeconds * 1000),
  };
}

export async function headObject(
  account: R2AccountRow,
  key: string,
): Promise<{ contentLength: number; contentType: string } | null> {
  try {
    const r = await getS3Client(account).send(
      new HeadObjectCommand({ Bucket: account.bucket, Key: key }),
    );
    return {
      contentLength: r.ContentLength ?? 0,
      contentType: r.ContentType ?? "",
    };
  } catch (e: unknown) {
    if (
      e !== null &&
      typeof e === "object" &&
      "name" in e &&
      (e as { name: string }).name === "NotFound"
    ) {
      return null;
    }
    throw e;
  }
}

/**
 * Encode an R2 key for use as a CopySource. Slashes between path segments stay
 * literal (so submissions/u/abc.jpg → submissions/u/abc.jpg); special chars
 * inside each segment (spaces, etc.) get percent-encoded. This matches what
 * S3 accepts and is what most AWS SDK examples produce.
 */
function encodeCopySource(bucket: string, key: string): string {
  const encoded = key.split("/").map(encodeURIComponent).join("/");
  return `${bucket}/${encoded}`;
}

export async function copyObject(
  account: R2AccountRow,
  fromKey: string,
  toKey: string,
): Promise<void> {
  await getS3Client(account).send(
    new CopyObjectCommand({
      Bucket: account.bucket,
      CopySource: encodeCopySource(account.bucket, fromKey),
      Key: toKey,
    }),
  );
}

export async function deleteObject(account: R2AccountRow, key: string): Promise<void> {
  await getS3Client(account).send(
    new DeleteObjectCommand({ Bucket: account.bucket, Key: key }),
  );
}

// ── M10b W3.3: owner-only ops (test_connection, sync_usage) ───────────────

export type R2TestResult = {
  ok: boolean;
  status: number | null;
  latencyMs: number;
  error?: string;
};

/**
 * Probe an R2 account for reachability. We HEAD a guaranteed-not-to-exist key
 * (`__owner_test__/probe-<now>.txt`) and interpret the response:
 *
 *   200      — surprise hit on the probe key (still: bucket reachable). ok.
 *   404      — bucket reachable, object absent. Expected happy path. ok.
 *   401/403  — credentials wrong / insufficient, but the host + bucket DID
 *              answer. We surface ok:true because the connection itself
 *              works — the owner UI distinguishes via `status`.
 *   5xx      — server error. ok:false.
 *   no $metadata — pure network / DNS / TLS failure. ok:false, status:null.
 *
 * `latencyMs` is measured around the single HEAD round-trip so the owner UI
 * can show a wall-clock number. We deliberately do NOT use ListBuckets here:
 * R2 endpoints often scope auth per-bucket and ListBuckets would falsely
 * report 403 for a perfectly valid per-bucket key.
 */
export async function testConnection(account: R2AccountRow): Promise<R2TestResult> {
  const t0 = Date.now();
  try {
    await getS3Client(account).send(
      new HeadObjectCommand({
        Bucket: account.bucket,
        Key: `__owner_test__/probe-${Date.now()}.txt`,
      }),
    );
    return { ok: true, status: 200, latencyMs: Date.now() - t0 };
  } catch (e) {
    const err = e as {
      $metadata?: { httpStatusCode?: number };
      name?: string;
      message?: string;
    };
    const status = err.$metadata?.httpStatusCode ?? null;
    if (status !== null) {
      // Any HTTP response received = the host answered. Only 5xx counts as a
      // real reachability failure; 4xx means "we got there, object absent or
      // creds weak".
      return { ok: status < 500, status, latencyMs: Date.now() - t0 };
    }
    return {
      ok: false,
      status: null,
      latencyMs: Date.now() - t0,
      error: err.message ?? "network_error",
    };
  }
}

/**
 * Sum sizes of every object in the bucket via paginated ListObjectsV2. Each
 * page is the S3 max (1000 keys). Persists the total to r2_accounts.used_bytes
 * and stamps last_synced_at = now() via the repo. Returns the total + count.
 *
 * NOTE: this runs synchronously in the request — small accounts finish in
 * <2s, but a million-object bucket could take 30s+. The owner UI is expected
 * to show a spinner and disable the button while in flight (W3.4). We cap
 * pagination at 1000 pages (1M objects) so a pathological/recursive R2
 * response can't pin the request thread forever.
 */
export async function syncUsage(account: R2AccountRow & { id: string }): Promise<{
  usedBytes: number;
  objectCount: number;
}> {
  const client = getS3Client(account);
  let token: string | undefined = undefined;
  let total = 0;
  let count = 0;
  let pageGuard = 0;
  do {
    pageGuard++;
    if (pageGuard > 1000) break; // 1M-object hard ceiling
    const out: ListObjectsV2CommandOutput = await client.send(
      new ListObjectsV2Command({
        Bucket: account.bucket,
        ContinuationToken: token,
        MaxKeys: 1000,
      }),
    );
    for (const obj of out.Contents ?? []) {
      total += obj.Size ?? 0;
      count++;
    }
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);

  await setUsageStats(account.id, total);
  return { usedBytes: total, objectCount: count };
}
