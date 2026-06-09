import { and, desc, eq, isNull, lte, or, gt, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { announcements } from "../db/schema/index.ts";

export type Severity = "info" | "warning" | "critical";
export type DisplayMode = "banner" | "popup";

// `zh` / `en` are individually optional; the route layer enforces that at
// least one is present. exactOptionalPropertyTypes means `?:` here does NOT
// admit `undefined` — callers must omit absent keys (the route layer takes
// care of that when forwarding zod-parsed bodies).
export type AnnouncementBilingual = { zh?: string; en?: string };

export type Announcement = {
  id: string;
  title: AnnouncementBilingual;
  body: AnnouncementBilingual;
  severity: Severity;
  displayMode: DisplayMode;
  startsAt: Date;
  endsAt: Date | null;
  dismissible: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
  updatedBy: string | null;
  deletedAt: Date | null;
};

export type CreateInput = {
  title: AnnouncementBilingual;
  body: AnnouncementBilingual;
  severity: Severity;
  displayMode?: DisplayMode;       // default "banner"
  startsAt: Date;
  endsAt?: Date;
  dismissible?: boolean;
  createdBy: string;
};

export type UpdateInput = Partial<Omit<CreateInput, "createdBy">> & {
  updatedBy: string;
};

type Row = typeof announcements.$inferSelect;

function rowToAnnouncement(r: Row): Announcement {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    severity: r.severity,
    displayMode: (r.displayMode === "popup" ? "popup" : "banner"),
    startsAt: r.startsAt,
    endsAt: r.endsAt,
    dismissible: r.dismissible,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    updatedBy: r.updatedBy,
    deletedAt: r.deletedAt,
  };
}

/**
 * Owner-facing list: every row, including soft-deleted, newest first.
 * Used by /api/owner/announcements to populate the management UI.
 */
export async function listAllForOwner(): Promise<Announcement[]> {
  const rows = await db
    .select()
    .from(announcements)
    .orderBy(desc(announcements.createdAt), desc(announcements.id));
  return rows.map(rowToAnnouncement);
}

export async function getById(id: string): Promise<Announcement | null> {
  const [row] = await db
    .select()
    .from(announcements)
    .where(eq(announcements.id, id))
    .limit(1);
  return row ? rowToAnnouncement(row) : null;
}

/**
 * Public list: rows currently within their active window and not soft-deleted.
 * Matches `announcements_active_idx` (partial index on starts_at, ends_at WHERE
 * deleted_at IS NULL).
 *
 *   deleted_at IS NULL
 *   AND starts_at <= now()
 *   AND (ends_at IS NULL OR ends_at > now())
 */
export async function listActivePublic(): Promise<Announcement[]> {
  const rows = await db
    .select()
    .from(announcements)
    .where(
      and(
        isNull(announcements.deletedAt),
        lte(announcements.startsAt, sql`now()`),
        or(isNull(announcements.endsAt), gt(announcements.endsAt, sql`now()`)),
      ),
    )
    .orderBy(desc(announcements.startsAt), desc(announcements.id));
  return rows.map(rowToAnnouncement);
}

export async function createAnnouncement(
  input: CreateInput,
): Promise<Announcement> {
  const [row] = await db
    .insert(announcements)
    .values({
      title: input.title,
      body: input.body,
      severity: input.severity,
      displayMode: input.displayMode ?? "banner",
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? null,
      dismissible: input.dismissible ?? true,
      createdBy: input.createdBy,
    })
    .returning();
  return rowToAnnouncement(row!);
}

export async function updateAnnouncement(
  id: string,
  input: UpdateInput,
): Promise<Announcement | null> {
  // Build the SET clause from only the keys the caller actually supplied.
  // We always bump updated_at + updated_by, even if no other field changed —
  // matches the "any owner write should be auditable" expectation.
  // sql`now()` is cast as never to satisfy drizzle's Date-typed column field
  // on the SET clause (this is the same pattern site-settings.ts uses).
  const patch: Record<string, unknown> = {
    updatedAt: sql`now()`,
    updatedBy: input.updatedBy,
  };
  if (input.title !== undefined) patch.title = input.title;
  if (input.body !== undefined) patch.body = input.body;
  if (input.severity !== undefined) patch.severity = input.severity;
  if (input.startsAt !== undefined) patch.startsAt = input.startsAt;
  if (input.endsAt !== undefined) patch.endsAt = input.endsAt;
  if (input.dismissible !== undefined) patch.dismissible = input.dismissible;
  if (input.displayMode !== undefined) patch.displayMode = input.displayMode;

  const [row] = await db
    .update(announcements)
    .set(patch as Partial<typeof announcements.$inferInsert>)
    .where(eq(announcements.id, id))
    .returning();
  return row ? rowToAnnouncement(row) : null;
}

/**
 * Soft-delete: sets deleted_at = now(). Also bumps updated_at + updated_by
 * so the row's audit trail captures who tombstoned it.
 */
export async function softDeleteAnnouncement(
  id: string,
  byUserId: string,
): Promise<void> {
  await db
    .update(announcements)
    .set({
      deletedAt: sql`now()`,
      updatedAt: sql`now()`,
      updatedBy: byUserId,
    })
    .where(eq(announcements.id, id));
}
