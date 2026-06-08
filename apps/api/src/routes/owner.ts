import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { softAuth, requireUserId } from "../middleware/auth.ts";
import { banCheck } from "../middleware/ban-check.ts";
import { requireOwner } from "../middleware/owner.ts";
import { zv } from "../lib/validate.ts";
import { getOwnerDashboard } from "../repositories/owner-stats.ts";
import {
  listAllSettings,
  setSetting,
} from "../repositories/site-settings.ts";
import {
  listAllR2AccountsForOwner,
  getR2AccountForOwner,
} from "../repositories/r2-accounts.ts";
import {
  listUsers,
  getUserDetail,
  updateUserRole,
  banUser,
  unbanUser,
} from "../repositories/owner-users.ts";
import {
  recordAudit,
  listAudit,
  type AuditListFilters,
} from "../repositories/audit.ts";
import {
  listAllForOwner as listAllAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  softDeleteAnnouncement,
  type UpdateInput as AnnouncementUpdateInput,
} from "../repositories/announcements.ts";
import { resetSubmitConfigCache } from "../lib/submit-config.ts";

const app = new Hono();

// All /api/owner routes require admin role + OWNER_EMAILS whitelist.
// banCheck() runs between softAuth() and requireOwner() so a banned owner
// (in the unlikely case they nuked themselves) is locked out the same way.
app.use("*", softAuth(), banCheck(), requireOwner());

// ── Dashboard ────────────────────────────────────────────────────────────
app.get("/dashboard", async (c) => {
  const r = await getOwnerDashboard();
  return c.json(r);
});

// ── Site settings ────────────────────────────────────────────────────────
app.get("/settings", async (c) => {
  const rows = await listAllSettings();
  return c.json({ items: rows });
});

const SettingKeyParamSchema = z.object({ key: z.string().min(1).max(120) });
const SettingPutBodySchema = z.object({
  value: z.unknown(),
});

/**
 * Allow-list of writable setting keys. Adding a key here is an explicit
 * decision — random keys (e.g., experimental flags, leftover seed values)
 * shouldn't be silently mutated through the owner UI. M10b adds more.
 *
 * Count must match the 24 keys seeded in seed-data.ts DEMO_SITE_SETTINGS:
 *   - 13 submit.*
 *   - 1 community_guidelines.body
 *   - 1 view_count.dedup_hours
 *   - 7 translator.*
 *   - 2 site.*
 */
const WRITABLE_SETTING_KEYS = new Set<string>([
  "submit.daily_limit",
  "submit.demoted_daily_limit",
  "submit.demote_threshold",
  "submit.guidelines_version",
  "submit.max_images_per_submission",
  "submit.min_images_per_submission",
  "submit.max_image_size_bytes",
  "submit.allowed_mime",
  "submit.max_tags",
  "submit.presign_ttl_seconds",
  "submit.reject_reason_min_chars",
  "submit.reject_reason_max_chars",
  "submit.daily_reset_timezone",
  "community_guidelines.body",
  "view_count.dedup_hours",
  "translator.enabled",
  "translator.base_url",
  "translator.api_key",
  "translator.model",
  "translator.system_prompt",
  "translator.max_chars_per_request",
  "translator.rate_limit_per_user_hour",
  "site.maintenance_mode",
  "site.maintenance_message",
]);

app.put(
  "/settings/:key",
  zv("param", SettingKeyParamSchema),
  zv("json", SettingPutBodySchema),
  async (c) => {
    const { key } = c.req.valid("param");
    const { value } = c.req.valid("json");
    if (!WRITABLE_SETTING_KEYS.has(key)) {
      throw new HTTPException(400, { message: "key_not_writable" });
    }
    const ownerId = requireUserId(c);
    await setSetting(key, value, ownerId);
    // Invalidate the submit-config cache so the change is observable on the
    // next request without waiting up to 60s. Other prefixes (translator.*,
    // site.*) don't currently have a cache to invalidate.
    if (key.startsWith("submit.")) resetSubmitConfigCache();
    return c.json({ key, value });
  },
);

// ── R2 accounts (read-only in M10a) ──────────────────────────────────────
app.get("/r2-accounts", async (c) => {
  const items = await listAllR2AccountsForOwner();
  return c.json({ items });
});

const UuidParamSchema = z.object({ id: z.string().uuid() });
app.get("/r2-accounts/:id", zv("param", UuidParamSchema), async (c) => {
  const r = await getR2AccountForOwner(c.req.valid("param").id);
  if (!r) throw new HTTPException(404, { message: "not_found" });
  return c.json(r);
});

// ── Users (M10b W1) ──────────────────────────────────────────────────────
//
// list / detail / PATCH role. Role changes are the only write surface in this
// wave — ban + email edits arrive in a later M10b migration once the schema
// columns exist. Every successful PATCH writes an audit_log row so the owner
// audit feed has a record of role transitions.
const UsersListQuerySchema = z.object({
  q: z.string().max(200).optional(),
  role: z.enum(["user", "moderator", "admin"]).optional(),
  // The shape on the wire is string "true" / "false"; we map it to boolean
  // before handing off to listUsers(). Anything else fails validation.
  banned: z.enum(["true", "false"]).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

app.get("/users", zv("query", UsersListQuerySchema), async (c) => {
  const q = c.req.valid("query");
  // Build filters by spreading only the keys the client actually supplied.
  // `exactOptionalPropertyTypes: true` rejects `{ k: undefined }` against
  // Partial<{ k: T }>, so we must omit absent keys rather than set them to
  // undefined.
  const filters: Parameters<typeof listUsers>[0] = { limit: q.limit };
  if (q.q !== undefined) filters.q = q.q;
  if (q.role !== undefined) filters.role = q.role;
  if (q.banned !== undefined) filters.banned = q.banned === "true";
  if (q.cursor !== undefined) filters.cursor = q.cursor;
  const result = await listUsers(filters);
  return c.json(result);
});

app.get("/users/:id", zv("param", UuidParamSchema), async (c) => {
  const detail = await getUserDetail(c.req.valid("param").id);
  if (!detail) throw new HTTPException(404, { message: "not_found" });
  return c.json(detail);
});

const UserPatchBodySchema = z.object({
  role: z.enum(["user", "moderator", "admin"]),
});

app.patch(
  "/users/:id",
  zv("param", UuidParamSchema),
  zv("json", UserPatchBodySchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const { role } = c.req.valid("json");
    const ownerId = requireUserId(c);
    await updateUserRole(id, role);
    await recordAudit({
      actorId: ownerId,
      action: "user.role.update",
      targetType: "user",
      targetId: id,
      payload: { newRole: role },
    });
    return c.json({ id, role });
  },
);

// ── Ban / unban (M10b W2.2) ───────────────────────────────────────────────
//
// POST /users/:id/ban requires a non-empty reason (trimmed, ≤500 chars).
// Both endpoints write an audit row so the owner audit feed records who
// flipped the bit and why. banCheck() middleware (installed on every
// authenticated route except /api/auth/*) gates banned users out of the
// rest of the API on subsequent requests.
const BanBodySchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

app.post(
  "/users/:id/ban",
  zv("param", UuidParamSchema),
  zv("json", BanBodySchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const { reason } = c.req.valid("json");
    const ownerId = requireUserId(c);
    await banUser(id, reason);
    await recordAudit({
      actorId: ownerId,
      action: "user.ban",
      targetType: "user",
      targetId: id,
      payload: { reason },
    });
    return c.json({ id, banned: true });
  },
);

app.post(
  "/users/:id/unban",
  zv("param", UuidParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const ownerId = requireUserId(c);
    await unbanUser(id);
    await recordAudit({
      actorId: ownerId,
      action: "user.unban",
      targetType: "user",
      targetId: id,
      payload: {},
    });
    return c.json({ id, banned: false });
  },
);

// ── Audit feed (M10b W1.4) ───────────────────────────────────────────────
//
// Filterable / paginated read of audit_log with actor join. Keyset cursor
// shape matches /users (base64 of `${createdAt.toISOString()}|${id}`). The
// AuditPage UI in W1.5 binds to this endpoint.
const AuditQuerySchema = z.object({
  actorId: z.string().uuid().optional(),
  actionPrefix: z.string().max(80).optional(),
  targetType: z.string().max(40).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30).optional(),
});

app.get("/audit", zv("query", AuditQuerySchema), async (c) => {
  const q = c.req.valid("query");
  // Same `exactOptionalPropertyTypes` discipline as /users above — only set
  // keys the caller actually supplied.
  const filters: AuditListFilters = {};
  if (q.actorId !== undefined) filters.actorId = q.actorId;
  if (q.actionPrefix !== undefined) filters.actionPrefix = q.actionPrefix;
  if (q.targetType !== undefined) filters.targetType = q.targetType;
  if (q.from !== undefined) filters.from = new Date(q.from);
  if (q.to !== undefined) filters.to = new Date(q.to);
  if (q.cursor !== undefined) filters.cursor = q.cursor;
  if (q.limit !== undefined) filters.limit = q.limit;
  const result = await listAudit(filters);
  return c.json(result);
});

// ── Announcements (M10b W2.4) ─────────────────────────────────────────────
//
// Owner CRUD over the announcements table. The public read endpoint lives
// at /api/announcements (mounted directly on server.ts so it doesn't sit
// behind requireOwner/banCheck). Every write here records an audit row
// keyed on targetType="announcement" so the audit feed gives a paper trail.
//
// Bilingual title/body: at least one of { zh, en } must be present. We use
// a zod refine() rather than two separate fields because either language
// alone is a valid post (i18n-only banners). Length limits match the seeded
// translator caps — owners can paste longer text with no truncation, but
// the validator rejects the obviously-pathological case before it hits DB.
const AnnouncementBodySchema = z.object({
  title: z
    .object({
      zh: z.string().max(200).optional(),
      en: z.string().max(200).optional(),
    })
    .refine((v) => Boolean(v.zh || v.en), { message: "title_required" }),
  body: z
    .object({
      zh: z.string().max(4000).optional(),
      en: z.string().max(4000).optional(),
    })
    .refine((v) => Boolean(v.zh || v.en), { message: "body_required" }),
  severity: z.enum(["info", "warning", "critical"]),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime().optional(),
  dismissible: z.boolean().optional(),
});

// PATCH allows partial updates. zod's `.partial()` makes every field optional
// at the top level; the inner refine()s no longer trigger (they only run when
// the field is provided and is an object), so empty PATCHes are valid (they
// still bump updated_at/updated_by — see updateAnnouncement()).
const AnnouncementUpdateSchema = AnnouncementBodySchema.partial();

// zod `.optional()` emits `string | undefined` under exactOptionalPropertyTypes,
// but our schema's jsonb column types `{ zh?: string; en?: string }` (no
// `undefined` admitted). Strip `undefined` keys before forwarding.
function compactBilingual(
  v: { zh?: string | undefined; en?: string | undefined } | undefined,
): { zh?: string; en?: string } | undefined {
  if (v === undefined) return undefined;
  const out: { zh?: string; en?: string } = {};
  if (v.zh !== undefined) out.zh = v.zh;
  if (v.en !== undefined) out.en = v.en;
  return out;
}

app.get("/announcements", async (c) => {
  const rows = await listAllAnnouncements();
  return c.json({ items: rows });
});

app.post(
  "/announcements",
  zv("json", AnnouncementBodySchema),
  async (c) => {
    const ownerId = requireUserId(c);
    const input = c.req.valid("json");
    const created = await createAnnouncement({
      title: compactBilingual(input.title)!,
      body: compactBilingual(input.body)!,
      severity: input.severity,
      startsAt: new Date(input.startsAt),
      ...(input.endsAt !== undefined ? { endsAt: new Date(input.endsAt) } : {}),
      ...(input.dismissible !== undefined
        ? { dismissible: input.dismissible }
        : {}),
      createdBy: ownerId,
    });
    await recordAudit({
      actorId: ownerId,
      action: "announcement.create",
      targetType: "announcement",
      targetId: created.id,
      payload: { severity: created.severity },
    });
    return c.json(created, 201);
  },
);

app.patch(
  "/announcements/:id",
  zv("param", UuidParamSchema),
  zv("json", AnnouncementUpdateSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const input = c.req.valid("json");
    const ownerId = requireUserId(c);
    // Strict-optional safety: only carry through keys the caller supplied.
    // exactOptionalPropertyTypes: true rejects `{ k: undefined }` against
    // Partial<{ k: T }>, so we build the object key-by-key.
    const updateInput: AnnouncementUpdateInput = { updatedBy: ownerId };
    if (input.title !== undefined)
      updateInput.title = compactBilingual(input.title)!;
    if (input.body !== undefined)
      updateInput.body = compactBilingual(input.body)!;
    if (input.severity !== undefined) updateInput.severity = input.severity;
    if (input.startsAt !== undefined)
      updateInput.startsAt = new Date(input.startsAt);
    if (input.endsAt !== undefined) updateInput.endsAt = new Date(input.endsAt);
    if (input.dismissible !== undefined)
      updateInput.dismissible = input.dismissible;
    const updated = await updateAnnouncement(id, updateInput);
    if (!updated) throw new HTTPException(404, { message: "not_found" });
    await recordAudit({
      actorId: ownerId,
      action: "announcement.update",
      targetType: "announcement",
      targetId: id,
      payload: {},
    });
    return c.json(updated);
  },
);

app.delete(
  "/announcements/:id",
  zv("param", UuidParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const ownerId = requireUserId(c);
    await softDeleteAnnouncement(id, ownerId);
    await recordAudit({
      actorId: ownerId,
      action: "announcement.delete",
      targetType: "announcement",
      targetId: id,
      payload: {},
    });
    return c.json({ id, deleted: true });
  },
);

export default app;
