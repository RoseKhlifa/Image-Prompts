import { S3Client } from "@aws-sdk/client-s3";
import { decryptSecret } from "./crypto.ts";

export type R2AccountRow = {
  id: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKeyCiphertext: string;
  bucket: string;
  publicUrl: string;
  // Additional columns from the table exist (label, priority, enabled, createdAt,
  // deletedAt) but the client cache only depends on these fields.
};

type CacheEntry = {
  client: S3Client;
  endpoint: string;
  accessKeyId: string;
  secretAccessKeyCiphertext: string;
};

const cache = new Map<string, CacheEntry>();
const MAX_CACHED = 8;

export function getS3Client(account: R2AccountRow): S3Client {
  const cached = cache.get(account.id);
  if (
    cached &&
    cached.endpoint === account.endpoint &&
    cached.accessKeyId === account.accessKeyId &&
    cached.secretAccessKeyCiphertext === account.secretAccessKeyCiphertext
  ) {
    return cached.client;
  }
  if (cached) {
    // stale — drop before we re-insert
    cache.delete(account.id);
  }
  if (cache.size >= MAX_CACHED) {
    // delete oldest insertion (Map iteration order is insertion order)
    const firstKey = cache.keys().next().value as string | undefined;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  const secret = decryptSecret(account.secretAccessKeyCiphertext);
  const client = new S3Client({
    region: "auto",
    endpoint: account.endpoint,
    credentials: {
      accessKeyId: account.accessKeyId,
      secretAccessKey: secret,
    },
    forcePathStyle: true,
  });
  cache.set(account.id, {
    client,
    endpoint: account.endpoint,
    accessKeyId: account.accessKeyId,
    secretAccessKeyCiphertext: account.secretAccessKeyCiphertext,
  });
  return client;
}

export function clearR2ClientCache(): void {
  cache.clear();
}
