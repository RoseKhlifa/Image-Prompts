import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { reports, prompts, users } from "../db/schema/index.ts";

export type ReportStatus = "open" | "reviewing" | "resolved" | "dismissed";

export const REPORT_REASONS = [
  "copyright",
  "nsfw_misclass",
  "illegal",
  "spam",
  "inappropriate",
  "other",
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export type ReportTargetType = "prompt"; // only prompts for v1; user/comment later

type CreateInput = {
  reporterId: string;
  targetType: ReportTargetType;
  targetId: string;
  reason: ReportReason;
  detail?: string;
};

/**
 * Public-facing create. Rate limit is enforced by a "one open report per
 * (reporter, target) pair" rule — if the same user reports the same prompt
 * twice while the first is still open, we return the existing row instead
 * of inserting. Once the moderator resolves the first, the user can file
 * a fresh one.
 */
export async function createReport(input: CreateInput) {
  // Dedup against the user's own currently-open report on this target.
  const [existing] = await db
    .select({ id: reports.id })
    .from(reports)
    .where(
      and(
        eq(reports.reporterId, input.reporterId),
        eq(reports.targetType, input.targetType),
        eq(reports.targetId, input.targetId),
        eq(reports.status, "open"),
      ),
    )
    .limit(1);
  if (existing) return { id: existing.id, deduped: true as const };

  const [row] = await db
    .insert(reports)
    .values({
      reporterId: input.reporterId,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
      detail: input.detail ?? null,
    })
    .returning({ id: reports.id });
  return { id: row!.id, deduped: false as const };
}

export type ReportRow = {
  id: string;
  reporter: { id: string; name: string | null; email: string | null } | null;
  targetType: string;
  targetId: string;
  reason: string;
  detail: string | null;
  status: ReportStatus;
  actionTaken: string | null;
  reviewer: { id: string; name: string | null } | null;
  reviewedAt: string | null;
  createdAt: string;
  // Resolved-target info (best-effort, NULL if the target row is gone or not
  // a recognized type). For prompts this is { slug, title }.
  target: { slug: string; title: { zh?: string; en?: string } | null } | null;
};

export async function listReports(opts: {
  status?: ReportStatus;
  page: number;
  pageSize: number;
}): Promise<{ items: ReportRow[]; total: number; hasMore: boolean }> {
  const conds = opts.status ? [eq(reports.status, opts.status)] : [];

  const reporterAlias = users; // standard users join
  const reviewerAlias = sql<string>``; // placeholder, we'll fetch reviewer in a second pass
  void reviewerAlias;

  const rows = await db
    .select({
      id: reports.id,
      reporterId: reports.reporterId,
      reporterName: reporterAlias.name,
      reporterEmail: reporterAlias.email,
      targetType: reports.targetType,
      targetId: reports.targetId,
      reason: reports.reason,
      detail: reports.detail,
      status: reports.status,
      actionTaken: reports.actionTaken,
      reviewedBy: reports.reviewedBy,
      reviewedAt: reports.reviewedAt,
      createdAt: reports.createdAt,
    })
    .from(reports)
    .leftJoin(reporterAlias, eq(reporterAlias.id, reports.reporterId))
    .where(conds.length > 0 ? and(...conds) : undefined)
    .orderBy(desc(reports.createdAt))
    .limit(opts.pageSize + 1)
    .offset((opts.page - 1) * opts.pageSize);

  const hasMore = rows.length > opts.pageSize;
  const items = rows.slice(0, opts.pageSize);

  // Best-effort target hydration (only prompt is implemented).
  const promptIds = items
    .filter((r) => r.targetType === "prompt")
    .map((r) => r.targetId);
  const promptMap = new Map<string, { slug: string; title: { zh?: string; en?: string } | null }>();
  if (promptIds.length > 0) {
    const found = await db
      .select({ id: prompts.id, slug: prompts.slug, title: prompts.title })
      .from(prompts)
      .where(sql`${prompts.id} = ANY(${promptIds}::uuid[])`);
    for (const p of found) {
      promptMap.set(p.id, { slug: p.slug, title: p.title as { zh?: string; en?: string } | null });
    }
  }

  // Reviewer hydration (one extra query — cheap, low cardinality usually).
  const reviewerIds = items.map((r) => r.reviewedBy).filter((x): x is string => x !== null);
  const reviewerMap = new Map<string, { id: string; name: string | null }>();
  if (reviewerIds.length > 0) {
    const found = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(sql`${users.id} = ANY(${reviewerIds}::uuid[])`);
    for (const u of found) reviewerMap.set(u.id, u);
  }

  // Count (cheap with the status index when filtering by status).
  const [c] = await db
    .select({ n: sql<number>`COUNT(*)::int` })
    .from(reports)
    .where(conds.length > 0 ? and(...conds) : undefined);

  const result: ReportRow[] = items.map((r) => ({
    id: r.id,
    reporter: r.reporterId
      ? { id: r.reporterId, name: r.reporterName, email: r.reporterEmail }
      : null,
    targetType: r.targetType,
    targetId: r.targetId,
    reason: r.reason,
    detail: r.detail,
    status: r.status as ReportStatus,
    actionTaken: r.actionTaken,
    reviewer: r.reviewedBy ? reviewerMap.get(r.reviewedBy) ?? null : null,
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    target:
      r.targetType === "prompt" ? promptMap.get(r.targetId) ?? null : null,
  }));

  return { items: result, total: c?.n ?? 0, hasMore };
}

export async function updateReportStatus(
  id: string,
  patch: {
    status: ReportStatus;
    reviewerId: string;
    actionTaken?: string;
  },
) {
  const [row] = await db
    .update(reports)
    .set({
      status: patch.status,
      reviewedBy: patch.reviewerId,
      reviewedAt: new Date(),
      actionTaken: patch.actionTaken ?? null,
    })
    .where(eq(reports.id, id))
    .returning({ id: reports.id });
  return row ?? null;
}

export async function getReportCountByStatus(): Promise<Record<ReportStatus, number>> {
  const rows = await db
    .select({ status: reports.status, n: sql<number>`COUNT(*)::int` })
    .from(reports)
    .groupBy(reports.status);
  const out: Record<ReportStatus, number> = {
    open: 0,
    reviewing: 0,
    resolved: 0,
    dismissed: 0,
  };
  for (const r of rows) out[r.status as ReportStatus] = r.n;
  return out;
}

// Used by the unused-import elision check — keeps `asc` in scope for ESLint.
void asc;
