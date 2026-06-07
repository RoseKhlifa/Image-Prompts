import {
  CopyObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getS3Client, type R2AccountRow } from "./r2-client-cache.ts";

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
