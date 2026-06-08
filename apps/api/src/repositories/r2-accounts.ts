import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { r2Accounts } from "../db/schema/index.ts";
import { encryptSecret } from "../lib/crypto.ts";

export async function listR2PoolPublic() {
  const rows = await db
    .select({
      id: r2Accounts.id,
      publicUrl: r2Accounts.publicUrl,
    })
    .from(r2Accounts)
    .where(and(eq(r2Accounts.enabled, true), isNull(r2Accounts.deletedAt)))
    .orderBy(asc(r2Accounts.createdAt));
  return rows;
}

/**
 * List ALL R2 accounts (including disabled + soft-deleted) for the owner UI.
 * Sorted by priority desc then createdAt desc so the most-recently-added
 * high-priority account floats to the top.
 *
 * Sensitive columns (`accessKeyId`, `accessKeySecretEncrypted`) are
 * deliberately omitted — the owner console reads usage stats only; rotating
 * secrets is a separate (M10b) flow.
 */
export async function listAllR2AccountsForOwner() {
  const rows = await db
    .select({
      id: r2Accounts.id,
      name: r2Accounts.name,
      accountId: r2Accounts.accountId,
      endpoint: r2Accounts.endpoint,
      bucket: r2Accounts.bucket,
      publicUrl: r2Accounts.publicUrl,
      priority: r2Accounts.priority,
      enabled: r2Accounts.enabled,
      usedBytes: r2Accounts.usedBytes,
      lastSyncedAt: r2Accounts.lastSyncedAt,
      deletedAt: r2Accounts.deletedAt,
      createdAt: r2Accounts.createdAt,
    })
    .from(r2Accounts)
    .orderBy(desc(r2Accounts.priority), desc(r2Accounts.createdAt));
  return rows;
}

/**
 * Read a single R2 account by id including its (encrypted) secret. Only the
 * owner-only ops (testConnection, syncUsage) need this — the lib functions
 * decrypt via the shared r2-client-cache helper. NEVER expose the result of
 * this query in a response body; the encrypted secret is for in-process use
 * only. The "regular" owner read endpoint must continue to call
 * getR2AccountForOwner (which omits the secret column).
 */
export async function getR2AccountWithSecret(id: string) {
  const [row] = await db
    .select({
      id: r2Accounts.id,
      name: r2Accounts.name,
      endpoint: r2Accounts.endpoint,
      bucket: r2Accounts.bucket,
      accessKeyId: r2Accounts.accessKeyId,
      accessKeySecretEncrypted: r2Accounts.accessKeySecretEncrypted,
      publicUrl: r2Accounts.publicUrl,
    })
    .from(r2Accounts)
    .where(eq(r2Accounts.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * Read a single R2 account by id for the owner UI. Same column projection as
 * listAllR2AccountsForOwner — secrets omitted. Returns null on miss.
 */
export async function getR2AccountForOwner(id: string) {
  const [row] = await db
    .select({
      id: r2Accounts.id,
      name: r2Accounts.name,
      accountId: r2Accounts.accountId,
      endpoint: r2Accounts.endpoint,
      bucket: r2Accounts.bucket,
      publicUrl: r2Accounts.publicUrl,
      priority: r2Accounts.priority,
      enabled: r2Accounts.enabled,
      usedBytes: r2Accounts.usedBytes,
      lastSyncedAt: r2Accounts.lastSyncedAt,
      deletedAt: r2Accounts.deletedAt,
      createdAt: r2Accounts.createdAt,
    })
    .from(r2Accounts)
    .where(eq(r2Accounts.id, id))
    .limit(1);
  return row ?? null;
}

// ---- M10b W3.1: CRUD + crypto ----------------------------------------------

export type R2CreateInput = {
  name: string;
  accountId: string;
  endpoint: string;
  accessKeyId: string;
  /** Plaintext secret — repo encrypts at rest via lib/crypto. */
  accessKeySecret: string;
  bucket: string;
  publicUrl: string;
  /** Defaults to 100 when omitted. */
  priority?: number;
  /** Defaults to true when omitted. */
  enabled?: boolean;
};

export type R2UpdateInput = Partial<Omit<R2CreateInput, "accessKeySecret">> & {
  /** When present, repo re-encrypts and overwrites the stored ciphertext. */
  accessKeySecret?: string;
};

/**
 * Insert a new r2_accounts row. The plaintext `accessKeySecret` is encrypted
 * (AES-256-GCM via lib/crypto) before insert; only the ciphertext touches the
 * database. Returns the new row's id.
 */
export async function createR2Account(input: R2CreateInput): Promise<{ id: string }> {
  const [row] = await db
    .insert(r2Accounts)
    .values({
      name: input.name,
      accountId: input.accountId,
      endpoint: input.endpoint,
      accessKeyId: input.accessKeyId,
      accessKeySecretEncrypted: encryptSecret(input.accessKeySecret),
      bucket: input.bucket,
      publicUrl: input.publicUrl,
      priority: input.priority ?? 100,
      enabled: input.enabled ?? true,
    })
    .returning({ id: r2Accounts.id });
  return { id: row!.id };
}

/**
 * Partial update of an r2_accounts row. Only fields explicitly set on `input`
 * are written; `accessKeySecret`, when provided, is re-encrypted and replaces
 * the existing ciphertext. updated_at is always bumped to now() so the row
 * carries a fresh audit timestamp.
 *
 * Returns true when a row was updated, false when the id was not found.
 */
export async function updateR2Account(id: string, input: R2UpdateInput): Promise<boolean> {
  // Always bump updated_at. sql`now()` is cast to never to satisfy drizzle's
  // Date-typed column on the SET clause (same pattern as site-settings.ts /
  // announcements.ts).
  const patch: Record<string, unknown> = { updatedAt: sql`now()` };
  if (input.name !== undefined) patch.name = input.name;
  if (input.accountId !== undefined) patch.accountId = input.accountId;
  if (input.endpoint !== undefined) patch.endpoint = input.endpoint;
  if (input.accessKeyId !== undefined) patch.accessKeyId = input.accessKeyId;
  if (input.bucket !== undefined) patch.bucket = input.bucket;
  if (input.publicUrl !== undefined) patch.publicUrl = input.publicUrl;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.accessKeySecret !== undefined) {
    patch.accessKeySecretEncrypted = encryptSecret(input.accessKeySecret);
  }

  const rows = await db
    .update(r2Accounts)
    .set(patch as Partial<typeof r2Accounts.$inferInsert>)
    .where(eq(r2Accounts.id, id))
    .returning({ id: r2Accounts.id });
  return rows.length > 0;
}

/**
 * Soft-delete: set deleted_at = now(). The row stays readable to the owner
 * (so the management UI can show tombstoned pool members) but listR2PoolPublic
 * filters it out, and any pick-an-active-account path will skip it.
 *
 * Returns true when a row was tombstoned, false when the id was not found.
 */
export async function softDeleteR2Account(id: string): Promise<boolean> {
  const rows = await db
    .update(r2Accounts)
    .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(r2Accounts.id, id))
    .returning({ id: r2Accounts.id });
  return rows.length > 0;
}

/**
 * Record the result of a usage-sync probe: overwrite used_bytes with the
 * authoritative count and stamp last_synced_at = now(). Called by the
 * background usage-sync op (W3.3); no-op on unknown id.
 */
export async function setUsageStats(id: string, usedBytes: number): Promise<void> {
  await db
    .update(r2Accounts)
    .set({
      usedBytes,
      lastSyncedAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(eq(r2Accounts.id, id));
}
