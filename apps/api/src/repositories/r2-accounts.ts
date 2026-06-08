import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.ts";
import { r2Accounts } from "../db/schema/index.ts";

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
