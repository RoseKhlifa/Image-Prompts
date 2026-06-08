import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  users,
  prompts as promptsTable,
  submissions,
} from "../db/schema/index.ts";

export type UsersListFilters = {
  /** ILIKE match against name, email, or id::text. */
  q?: string;
  role?: "user" | "moderator" | "admin";
  /**
   * true → banned_at IS NOT NULL; false → IS NULL; undefined → no filter.
   * NOTE: the banned_at column is not yet present on `users` — it lands in a
   * later M10b migration. Until then this filter is a no-op (we still accept
   * the value so callers don't change). See bannedAt in the SELECT below.
   */
  banned?: boolean;
  /** base64 of `${createdAt.toISOString()}|${id}` for keyset pagination. */
  cursor?: string;
  /** Default 30, max 100. */
  limit?: number;
};

export type UserListRow = {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  role: "user" | "moderator" | "admin";
  publishedPrompts: number;
  totalSubmissions: number;
  rejectedCount: number;
  /**
   * Always null for now — the banned_at column does not exist on `users` yet.
   * It is added in a follow-up M10b migration; once the column lands we'll
   * project `users.bannedAt` here.
   */
  bannedAt: Date | null;
  createdAt: Date;
};

export type UserDetail = UserListRow & {
  communityGuidelinesVersion: number;
  dailySubmissionCount: number;
  dailySubmissionResetAt: Date | null;
  recentSubmissions: Array<{
    id: string;
    status: "pending" | "approved" | "rejected";
    titleZh: string | null;
    titleEn: string | null;
    createdAt: Date;
  }>;
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

/**
 * Scalar correlated subqueries for the per-user prompt + submission counters.
 * Same pattern as listCategories — Postgres optimizes these as index scans on
 * `contributor_id` (which we index on prompts) and seq scans on the small
 * submissions table.
 */
const publishedPromptsSql = sql<number>`(
  SELECT count(*)::int
  FROM ${promptsTable}
  WHERE ${promptsTable}."contributor_id" = ${users}."id"
)`;

const totalSubmissionsSql = sql<number>`(
  SELECT count(*)::int
  FROM ${submissions}
  WHERE ${submissions}."contributor_id" = ${users}."id"
)`;

export async function listUsers(
  filters: UsersListFilters,
): Promise<{ items: UserListRow[]; nextCursor: string | null }> {
  const limit = clampLimit(filters.limit);

  const conditions = [];

  if (filters.q) {
    const pattern = `%${filters.q}%`;
    // ILIKE on name OR email OR id::text. COALESCE keeps NULL names matching.
    conditions.push(
      sql`(COALESCE(${users.name}, '') ILIKE ${pattern}
          OR ${users.email} ILIKE ${pattern}
          OR ${users.id}::text ILIKE ${pattern})`,
    );
  }

  if (filters.role) {
    conditions.push(eq(users.role, filters.role));
  }

  // banned filter is a no-op until the banned_at column ships (see type doc above).
  // Intentional: callers can pass it today, behavior will light up post-migration.

  if (filters.cursor) {
    const decoded = decodeCursor(filters.cursor);
    if (decoded) {
      // Keyset pagination on (createdAt desc, id desc):
      //   (created_at < cursor.createdAt) OR (created_at = cursor.createdAt AND id < cursor.id)
      conditions.push(
        sql`(${users.createdAt} < ${decoded.createdAt}
            OR (${users.createdAt} = ${decoded.createdAt} AND ${users.id} < ${decoded.id}))`,
      );
    }
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      image: users.image,
      role: users.role,
      publishedPrompts: publishedPromptsSql,
      totalSubmissions: totalSubmissionsSql,
      rejectedCount: users.rejectedCount,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt), desc(users.id))
    .limit(limit + 1);

  const trimmed = rows.slice(0, limit);
  const items: UserListRow[] = trimmed.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    image: r.image,
    role: r.role,
    publishedPrompts: Number(r.publishedPrompts ?? 0),
    totalSubmissions: Number(r.totalSubmissions ?? 0),
    rejectedCount: r.rejectedCount,
    // bannedAt hardcoded null — column not yet in schema (see type doc above).
    bannedAt: null,
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

export async function getUserDetail(id: string): Promise<UserDetail | null> {
  const [userRow, recentRows] = await Promise.all([
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        image: users.image,
        role: users.role,
        publishedPrompts: publishedPromptsSql,
        totalSubmissions: totalSubmissionsSql,
        rejectedCount: users.rejectedCount,
        createdAt: users.createdAt,
        communityGuidelinesVersion: users.communityGuidelinesVersion,
        dailySubmissionCount: users.dailySubmissionCount,
        dailySubmissionResetAt: users.dailySubmissionResetAt,
      })
      .from(users)
      .where(eq(users.id, id))
      .limit(1),
    db
      .select({
        id: submissions.id,
        status: submissions.status,
        title: submissions.title,
        createdAt: submissions.createdAt,
      })
      .from(submissions)
      .where(eq(submissions.contributorId, id))
      .orderBy(desc(submissions.createdAt))
      .limit(10),
  ]);

  const u = userRow[0];
  if (!u) return null;

  return {
    id: u.id,
    name: u.name,
    email: u.email,
    image: u.image,
    role: u.role,
    publishedPrompts: Number(u.publishedPrompts ?? 0),
    totalSubmissions: Number(u.totalSubmissions ?? 0),
    rejectedCount: u.rejectedCount,
    // bannedAt hardcoded null — see UserListRow.bannedAt note.
    bannedAt: null,
    createdAt: u.createdAt,
    communityGuidelinesVersion: u.communityGuidelinesVersion,
    dailySubmissionCount: u.dailySubmissionCount,
    dailySubmissionResetAt: u.dailySubmissionResetAt,
    recentSubmissions: recentRows.map((r) => {
      const title = (r.title ?? {}) as { zh?: string; en?: string };
      return {
        id: r.id,
        status: r.status,
        titleZh: title.zh ?? null,
        titleEn: title.en ?? null,
        createdAt: r.createdAt,
      };
    }),
  };
}

export async function updateUserRole(
  id: string,
  role: "user" | "moderator" | "admin",
): Promise<void> {
  await db.update(users).set({ role }).where(eq(users.id, id));
}
