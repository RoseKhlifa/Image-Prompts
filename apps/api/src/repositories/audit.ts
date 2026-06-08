import { and, desc, eq, gte, like, lte, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { auditLog } from "../db/schema/index.ts";
import { users } from "../db/schema/auth.ts";

type RecordInput = {
  actorId: string;
  action: string;
  targetType: string;
  targetId: string;
  payload: Record<string, unknown>;
  /** Optional transaction handle so callers can chain audit with other ops. */
  tx?: Parameters<Parameters<typeof db.transaction>[0]>[0];
};

export async function recordAudit(input: RecordInput): Promise<void> {
  const conn = input.tx ?? db;
  await conn.insert(auditLog).values({
    actorId: input.actorId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId,
    payload: input.payload,
  });
}

// ── listAudit ──────────────────────────────────────────────────────────────
//
// Read-side query backing GET /api/owner/audit. Uses keyset pagination on
// (created_at desc, id desc) — same cursor pattern as owner-users so the UI
// can treat both feeds identically.

export type AuditListFilters = {
  actorId?: string;
  /** e.g. "user." matches "user.role.update" — appended to a LIKE %. */
  actionPrefix?: string;
  targetType?: string;
  from?: Date;
  to?: Date;
  /** base64 of `${createdAt.toISOString()}|${id}` for keyset pagination. */
  cursor?: string;
  /** Default 30, max 100. */
  limit?: number;
};

export type AuditRow = {
  id: string;
  // actorId/targetType are notNull on the column but typed nullable so we can
  // later relax the FK (e.g., system-generated audit rows). The LEFT JOIN
  // already nulls the joined name/email when the actor row is missing.
  actorId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  payload: unknown;
  createdAt: Date;
};

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

function clampLimit(limit?: number): number {
  if (!limit || limit <= 0) return DEFAULT_LIMIT;
  return Math.min(limit, MAX_LIMIT);
}

function encodeCursor(createdAt: Date, id: string): string {
  const raw = `${createdAt.toISOString()}|${id}`;
  return Buffer.from(raw, "utf8").toString("base64");
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const raw = Buffer.from(cursor, "base64").toString("utf8");
    const sep = raw.indexOf("|");
    if (sep === -1) return null;
    const iso = raw.slice(0, sep);
    const id = raw.slice(sep + 1);
    const date = new Date(iso);
    if (Number.isNaN(date.getTime()) || !id) return null;
    return { createdAt: date, id };
  } catch {
    return null;
  }
}

export async function listAudit(
  filters: AuditListFilters,
): Promise<{ items: AuditRow[]; nextCursor: string | null }> {
  const limit = clampLimit(filters.limit);
  const conditions = [];

  if (filters.actorId) {
    conditions.push(eq(auditLog.actorId, filters.actorId));
  }
  if (filters.actionPrefix) {
    conditions.push(like(auditLog.action, `${filters.actionPrefix}%`));
  }
  if (filters.targetType) {
    conditions.push(eq(auditLog.targetType, filters.targetType));
  }
  if (filters.from) {
    conditions.push(gte(auditLog.createdAt, filters.from));
  }
  if (filters.to) {
    conditions.push(lte(auditLog.createdAt, filters.to));
  }
  if (filters.cursor) {
    const decoded = decodeCursor(filters.cursor);
    if (decoded) {
      // Keyset pagination on (createdAt desc, id desc):
      //   (created_at < cursor.createdAt) OR (created_at = cursor.createdAt AND id < cursor.id)
      conditions.push(
        sql`(${auditLog.createdAt} < ${decoded.createdAt}
            OR (${auditLog.createdAt} = ${decoded.createdAt} AND ${auditLog.id} < ${decoded.id}))`,
      );
    }
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: auditLog.id,
      actorId: auditLog.actorId,
      actorName: users.name,
      actorEmail: users.email,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      payload: auditLog.payload,
      createdAt: auditLog.createdAt,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorId))
    .where(where)
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(limit + 1);

  const trimmed = rows.slice(0, limit);
  const items: AuditRow[] = trimmed.map((r) => ({
    id: r.id,
    actorId: r.actorId,
    actorName: r.actorName ?? null,
    actorEmail: r.actorEmail ?? null,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    payload: r.payload,
    createdAt: r.createdAt,
  }));

  const nextCursor =
    rows.length > limit
      ? encodeCursor(
          trimmed[trimmed.length - 1]!.createdAt,
          trimmed[trimmed.length - 1]!.id,
        )
      : null;

  return { items, nextCursor };
}
