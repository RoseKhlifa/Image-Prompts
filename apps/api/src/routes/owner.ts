import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
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
  getSetting,
} from "../repositories/site-settings.ts";
import {
  importCategoryJsonl,
  listRecentImports,
} from "../repositories/imports.ts";
import {
  listAllR2AccountsForOwner,
  getR2AccountForOwner,
  getR2AccountWithSecret,
  createR2Account,
  updateR2Account,
  softDeleteR2Account,
  type R2UpdateInput,
} from "../repositories/r2-accounts.ts";
import { testConnection, syncUsage } from "../lib/r2-ops.ts";
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
import {
  listCategoriesForOwner,
  createCategory,
  updateCategory,
  deleteCategory,
  listTagsForOwner,
  createTag,
  updateTag,
  deleteTag,
  type CategoryCreateInput,
  type CategoryUpdateInput,
  type TagCreateInput,
  type TagUpdateInput,
} from "../repositories/owner-taxonomy.ts";
import {
  listAllPromptsForOwner,
  getPromptForOwner,
  createPromptDirect,
  updatePromptForOwner,
  deletePromptForOwner,
  type OwnerPromptCreateInput,
  type OwnerPromptUpdatePatch,
} from "../repositories/owner-prompts.ts";
import { copyObject, deleteObject } from "../lib/r2-ops.ts";
import { buildPromptKey } from "../lib/r2-keys.ts";
import { db } from "../db/client.ts";
import { r2Accounts, promptImages } from "../db/schema/index.ts";
import { and, eq } from "drizzle-orm";
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
// `value` is jsonb NOT NULL in site_settings, so reject null/undefined at the
// route layer with a clear 400 instead of a downstream 23502 from Postgres.
// Empty string, 0, false, [], {} are all allowed (they're valid JSON).
const SettingPutBodySchema = z.object({
  value: z.unknown().refine((v) => v !== null && v !== undefined, {
    message: "value_required",
  }),
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
  "import.data_root",
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

// ── R2 accounts (M10b W3.2: full CRUD) ───────────────────────────────────
//
// Read paths come from M10a. POST / PATCH / DELETE land in W3.2 alongside the
// crypto-aware repo from W3.1: secrets arrive in plaintext on the request
// body, are encrypted at rest, and are NEVER echoed back in any response
// (cleartext lives in the request only). Every write records an audit row.
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

const R2CreateBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  accountId: z.string().trim().min(1).max(120),
  endpoint: z.string().url().max(400),
  accessKeyId: z.string().trim().min(1).max(200),
  // Plaintext on the wire; repo encrypts before insert. Length cap matches
  // R2 secret max (~80) plus generous slack so we never reject a real secret.
  accessKeySecret: z.string().min(1).max(400),
  bucket: z.string().trim().min(1).max(120),
  publicUrl: z.string().url().max(400),
  priority: z.number().int().min(0).max(1000).optional(),
  enabled: z.boolean().optional(),
});

const R2UpdateBodySchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  accountId: z.string().trim().min(1).max(120).optional(),
  endpoint: z.string().url().max(400).optional(),
  accessKeyId: z.string().trim().min(1).max(200).optional(),
  accessKeySecret: z.string().min(1).max(400).optional(),
  bucket: z.string().trim().min(1).max(120).optional(),
  publicUrl: z.string().url().max(400).optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  enabled: z.boolean().optional(),
});

app.post(
  "/r2-accounts",
  zv("json", R2CreateBodySchema),
  async (c) => {
    const ownerId = requireUserId(c);
    const input = c.req.valid("json");
    // exactOptionalPropertyTypes:true rejects `{ priority: undefined }` against
    // R2CreateInput's `priority?: number`. Only forward keys the caller set.
    const createInput: Parameters<typeof createR2Account>[0] = {
      name: input.name,
      accountId: input.accountId,
      endpoint: input.endpoint,
      accessKeyId: input.accessKeyId,
      accessKeySecret: input.accessKeySecret,
      bucket: input.bucket,
      publicUrl: input.publicUrl,
    };
    if (input.priority !== undefined) createInput.priority = input.priority;
    if (input.enabled !== undefined) createInput.enabled = input.enabled;
    const { id } = await createR2Account(createInput);
    await recordAudit({
      actorId: ownerId,
      action: "r2.create",
      targetType: "r2_account",
      targetId: id,
      payload: {
        name: input.name,
        bucket: input.bucket,
        enabled: input.enabled ?? true,
      },
    });
    // NEVER echo accessKeySecret back in the response — even though we just
    // received it. The request body is the only place it lives in cleartext;
    // at rest it's encrypted. JSON.stringify drops `undefined` keys, so this
    // returns the rest of the input without the secret.
    return c.json({ id, ...input, accessKeySecret: undefined }, 201);
  },
);

app.patch(
  "/r2-accounts/:id",
  zv("param", UuidParamSchema),
  zv("json", R2UpdateBodySchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const input = c.req.valid("json");
    const ownerId = requireUserId(c);
    // Strip undefined keys before forwarding. exactOptionalPropertyTypes:true
    // rejects `{ k: undefined }` against R2UpdateInput, so build the patch
    // key-by-key (same pattern as updateAnnouncement above).
    const cleaned: R2UpdateInput = {};
    if (input.name !== undefined) cleaned.name = input.name;
    if (input.accountId !== undefined) cleaned.accountId = input.accountId;
    if (input.endpoint !== undefined) cleaned.endpoint = input.endpoint;
    if (input.accessKeyId !== undefined) cleaned.accessKeyId = input.accessKeyId;
    if (input.accessKeySecret !== undefined)
      cleaned.accessKeySecret = input.accessKeySecret;
    if (input.bucket !== undefined) cleaned.bucket = input.bucket;
    if (input.publicUrl !== undefined) cleaned.publicUrl = input.publicUrl;
    if (input.priority !== undefined) cleaned.priority = input.priority;
    if (input.enabled !== undefined) cleaned.enabled = input.enabled;
    const ok = await updateR2Account(id, cleaned);
    if (!ok) throw new HTTPException(404, { message: "not_found" });
    await recordAudit({
      actorId: ownerId,
      action: "r2.update",
      targetType: "r2_account",
      targetId: id,
      // Log WHICH fields changed (audit trail), never the secret itself.
      payload: {
        fields: Object.keys(cleaned).filter((k) => k !== "accessKeySecret"),
      },
    });
    // Re-read via the owner projection (secret column already omitted there).
    const updated = await getR2AccountForOwner(id);
    return c.json(updated);
  },
);

app.delete(
  "/r2-accounts/:id",
  zv("param", UuidParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const ownerId = requireUserId(c);
    const ok = await softDeleteR2Account(id);
    if (!ok) throw new HTTPException(404, { message: "not_found" });
    await recordAudit({
      actorId: ownerId,
      action: "r2.delete",
      targetType: "r2_account",
      targetId: id,
      payload: {},
    });
    return c.json({ id, deleted: true });
  },
);

// ── R2 owner-only ops (M10b W3.3) ────────────────────────────────────────
//
// /test       — probe reachability via a single HEAD on a guaranteed-absent
//               key. Always returns 200 with a `{ ok, status, latencyMs }`
//               body (the UI distinguishes via the `ok` flag); 404 is reserved
//               for "no such r2_accounts row".
// /sync-usage — paginate ListObjectsV2 across the bucket, sum sizes, persist
//               used_bytes + last_synced_at, record an audit row. Synchronous
//               in-request (no background job); the W3.4 UI must show a
//               spinner while it runs.
//
// Both endpoints call getR2AccountWithSecret() (not getR2AccountForOwner)
// because they need the encrypted secret column to build an S3 client. The
// result is consumed in-process only — neither endpoint echoes the row back
// in its response body.
app.post(
  "/r2-accounts/:id/test",
  zv("param", UuidParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const account = await getR2AccountWithSecret(id);
    if (!account) throw new HTTPException(404, { message: "not_found" });
    const result = await testConnection(account);
    return c.json(result);
  },
);

app.post(
  "/r2-accounts/:id/sync-usage",
  zv("param", UuidParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const ownerId = requireUserId(c);
    const account = await getR2AccountWithSecret(id);
    if (!account) throw new HTTPException(404, { message: "not_found" });
    const result = await syncUsage(account);
    await recordAudit({
      actorId: ownerId,
      action: "r2.sync_usage",
      targetType: "r2_account",
      targetId: id,
      payload: {
        usedBytes: result.usedBytes,
        objectCount: result.objectCount,
      },
    });
    return c.json(result);
  },
);

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
  // Default to banner when caller omits it (back-compat with pre-0010 callers).
  displayMode: z.enum(["banner", "popup"]).optional(),
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
      ...(input.displayMode !== undefined
        ? { displayMode: input.displayMode }
        : {}),
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
    if (input.displayMode !== undefined)
      updateInput.displayMode = input.displayMode;
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

// ── Categories (Task 3) ───────────────────────────────────────────────────
//
// Owner CRUD over the categories table. Public reads stay at /api/categories
// (different repo, narrower projection). Slugs match the same a-z 0-9 + dash
// shape we use for tags + prompts so the URL surface stays uniform.
//
// Bilingual name is the same shape as announcements.title — refine() requires
// ≥1 language; we use compactBilingual() (already defined above) to strip
// undefined keys when forwarding zod-parsed bodies under
// exactOptionalPropertyTypes:true.
//
// Hard delete with usage protection — the repo returns a discriminated union
// (`ok | {in_use, count} | not_found`) which we map onto 200 / 409 / 404 with
// `in_use:N` as the error message so the UI can render the count.
const SlugSchema = z
  .string()
  .regex(/^[a-z0-9-]{1,40}$/, { message: "slug_invalid" });

const CategoryBodySchema = z.object({
  slug: SlugSchema,
  name: z
    .object({
      zh: z.string().max(60).optional(),
      en: z.string().max(60).optional(),
    })
    .refine((v) => Boolean(v.zh || v.en), { message: "name_required" }),
  description: z
    .object({
      zh: z.string().max(400).optional(),
      en: z.string().max(400).optional(),
    })
    .optional(),
  order: z.number().int().min(0).max(10_000).optional(),
});

const CategoryUpdateBodySchema = CategoryBodySchema.partial();

app.get("/categories", async (c) => {
  const items = await listCategoriesForOwner();
  return c.json({ items });
});

app.post("/categories", zv("json", CategoryBodySchema), async (c) => {
  const ownerId = requireUserId(c);
  const input = c.req.valid("json");
  const cleaned: CategoryCreateInput = {
    slug: input.slug,
    name: compactBilingual(input.name)!,
  };
  if (input.description !== undefined) {
    const desc = compactBilingual(input.description);
    if (desc !== undefined) cleaned.description = desc;
  }
  if (input.order !== undefined) cleaned.order = input.order;
  const created = await createCategory(cleaned);
  await recordAudit({
    actorId: ownerId,
    action: "category.create",
    targetType: "category",
    targetId: created.id,
    payload: { slug: created.slug },
  });
  return c.json(created, 201);
});

app.patch(
  "/categories/:id",
  zv("param", UuidParamSchema),
  zv("json", CategoryUpdateBodySchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const ownerId = requireUserId(c);
    const input = c.req.valid("json");
    const patch: CategoryUpdateInput = {};
    if (input.slug !== undefined) patch.slug = input.slug;
    if (input.name !== undefined) patch.name = compactBilingual(input.name)!;
    if (input.description !== undefined) {
      const desc = compactBilingual(input.description);
      if (desc !== undefined) patch.description = desc;
    }
    if (input.order !== undefined) patch.order = input.order;
    const updated = await updateCategory(id, patch);
    if (!updated) throw new HTTPException(404, { message: "not_found" });
    await recordAudit({
      actorId: ownerId,
      action: "category.update",
      targetType: "category",
      targetId: id,
      payload: {},
    });
    return c.json(updated);
  },
);

app.delete(
  "/categories/:id",
  zv("param", UuidParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const ownerId = requireUserId(c);
    const result = await deleteCategory(id);
    if (result.ok === false && result.reason === "not_found") {
      throw new HTTPException(404, { message: "not_found" });
    }
    if (result.ok === false && result.reason === "in_use") {
      throw new HTTPException(409, { message: `in_use:${result.count}` });
    }
    await recordAudit({
      actorId: ownerId,
      action: "category.delete",
      targetType: "category",
      targetId: id,
      payload: {},
    });
    return c.json({ id, deleted: true });
  },
);

// ── Tags (Task 3) ─────────────────────────────────────────────────────────
//
// Same shape as the categories endpoints above. Tags have no description /
// order fields; the editable surface is slug + bilingual name only.
const TagBodySchema = z.object({
  slug: SlugSchema,
  name: z
    .object({
      zh: z.string().max(40).optional(),
      en: z.string().max(40).optional(),
    })
    .refine((v) => Boolean(v.zh || v.en), { message: "name_required" }),
});

const TagUpdateBodySchema = TagBodySchema.partial();

app.get("/tags", async (c) => {
  const items = await listTagsForOwner();
  return c.json({ items });
});

app.post("/tags", zv("json", TagBodySchema), async (c) => {
  const ownerId = requireUserId(c);
  const input = c.req.valid("json");
  const cleaned: TagCreateInput = {
    slug: input.slug,
    name: compactBilingual(input.name)!,
  };
  const created = await createTag(cleaned);
  await recordAudit({
    actorId: ownerId,
    action: "tag.create",
    targetType: "tag",
    targetId: created.id,
    payload: { slug: created.slug },
  });
  return c.json(created, 201);
});

app.patch(
  "/tags/:id",
  zv("param", UuidParamSchema),
  zv("json", TagUpdateBodySchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const ownerId = requireUserId(c);
    const input = c.req.valid("json");
    const patch: TagUpdateInput = {};
    if (input.slug !== undefined) patch.slug = input.slug;
    if (input.name !== undefined) patch.name = compactBilingual(input.name)!;
    const updated = await updateTag(id, patch);
    if (!updated) throw new HTTPException(404, { message: "not_found" });
    await recordAudit({
      actorId: ownerId,
      action: "tag.update",
      targetType: "tag",
      targetId: id,
      payload: {},
    });
    return c.json(updated);
  },
);

app.delete(
  "/tags/:id",
  zv("param", UuidParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const ownerId = requireUserId(c);
    const result = await deleteTag(id);
    if (result.ok === false && result.reason === "not_found") {
      throw new HTTPException(404, { message: "not_found" });
    }
    if (result.ok === false && result.reason === "in_use") {
      throw new HTTPException(409, { message: `in_use:${result.count}` });
    }
    await recordAudit({
      actorId: ownerId,
      action: "tag.delete",
      targetType: "tag",
      targetId: id,
      payload: {},
    });
    return c.json({ id, deleted: true });
  },
);

// ── Owner-side prompt management ─────────────────────────────────────────
//
// list / detail / direct-create / patch / delete the prompt rows directly,
// bypassing the submissions queue. The route layer:
//  - validates bodies with zod (bilingual fields require at least one side)
//  - migrates R2 keys out of submissions/ keyspace AFTER createPromptDirect
//    succeeds, matching the admin.ts approve flow's keyspace migration
//  - records audit rows for create/update/delete
//  - best-effort deletes R2 objects after delete (warnings only)
//
// Auth: requireOwner() at the top of the file already gates these.

const PromptListQuerySchema = z.object({
  q: z.string().max(200).optional(),
  categorySlug: z.string().max(80).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

const OwnerPromptImageSchema = z.object({
  r2AccountId: z.string().uuid(),
  r2Key: z.string().min(1).max(400),
  altText: z.string().max(500).optional(),
  width: z.number().int().min(1).max(20000).optional(),
  height: z.number().int().min(1).max(20000).optional(),
  lqip: z.string().max(2000).optional(),
});

// Create requires bilingual title+prompt (at least one language each), 1-10
// images, and 0-10 tags. The 10-tag cap is intentionally higher than the
// public submit.max_tags ceiling — owners can exceed user limits per spec.
const PromptCreateBodySchema = z.object({
  titleZh: z.string().max(200).optional(),
  titleEn: z.string().max(200).optional(),
  promptZh: z.string().max(8000).optional(),
  promptEn: z.string().max(8000).optional(),
  negativePromptZh: z.string().max(4000).optional(),
  negativePromptEn: z.string().max(4000).optional(),
  notesZh: z.string().max(4000).optional(),
  notesEn: z.string().max(4000).optional(),
  aspectRatio: z.string().max(20).optional(),
  categoryId: z.string().uuid(),
  tagSlugs: z.array(z.string().min(1).max(40)).max(10).default([]),
  images: z.array(OwnerPromptImageSchema).min(1).max(10),
})
  .refine((v) => Boolean(v.titleZh || v.titleEn), { message: "title_required" })
  .refine((v) => Boolean(v.promptZh || v.promptEn), { message: "prompt_required" });

// Update allows clearing optional fields via empty string + makes every key
// optional. We intentionally don't use `.partial()` on the refined schema
// because zod's refine() carries through; spell the partial out instead.
const PromptUpdateBodySchema = z.object({
  titleZh: z.string().max(200).optional(),
  titleEn: z.string().max(200).optional(),
  promptZh: z.string().max(8000).optional(),
  promptEn: z.string().max(8000).optional(),
  negativePromptZh: z.string().max(4000).optional(),
  negativePromptEn: z.string().max(4000).optional(),
  notesZh: z.string().max(4000).optional(),
  notesEn: z.string().max(4000).optional(),
  aspectRatio: z.string().max(20).optional(),
  categoryId: z.string().uuid().optional(),
  tagSlugs: z.array(z.string().min(1).max(40)).max(10).optional(),
  // Optional images array — same shape as create. When provided, the repo
  // diff-replaces (kept = `prompts/<id>/…`, new = `submissions/…`) and we
  // do the R2 copy + INSERT + cleanup post-tx below.
  images: z.array(OwnerPromptImageSchema).min(1).max(10).optional(),
});

app.get("/prompts", zv("query", PromptListQuerySchema), async (c) => {
  const q = c.req.valid("query");
  const filters: Parameters<typeof listAllPromptsForOwner>[0] = { limit: q.limit };
  if (q.q !== undefined) filters.q = q.q;
  if (q.categorySlug !== undefined) filters.categorySlug = q.categorySlug;
  if (q.cursor !== undefined) filters.cursor = q.cursor;
  const r = await listAllPromptsForOwner(filters);
  return c.json(r);
});

app.get("/prompts/:id", zv("param", UuidParamSchema), async (c) => {
  const r = await getPromptForOwner(c.req.valid("param").id);
  if (!r) throw new HTTPException(404, { message: "not_found" });
  return c.json(r);
});

app.post(
  "/prompts",
  zv("json", PromptCreateBodySchema),
  async (c) => {
    const ownerId = requireUserId(c);
    const input = c.req.valid("json");

    const createInput: OwnerPromptCreateInput = {
      titleZh: input.titleZh ?? null,
      titleEn: input.titleEn ?? null,
      promptZh: input.promptZh ?? null,
      promptEn: input.promptEn ?? null,
      negativePromptZh: input.negativePromptZh ?? null,
      negativePromptEn: input.negativePromptEn ?? null,
      notesZh: input.notesZh ?? null,
      notesEn: input.notesEn ?? null,
      aspectRatio: input.aspectRatio ?? null,
      categoryId: input.categoryId,
      tagSlugs: input.tagSlugs,
      images: input.images.map((img) => {
        const o: OwnerPromptCreateInput["images"][number] = {
          r2AccountId: img.r2AccountId,
          r2Key: img.r2Key,
        };
        if (img.altText !== undefined) o.altText = img.altText;
        if (img.width !== undefined) o.width = img.width;
        if (img.height !== undefined) o.height = img.height;
        if (img.lqip !== undefined) o.lqip = img.lqip;
        return o;
      }),
    };

    const { id: promptId, slug } = await createPromptDirect(createInput, ownerId);

    // Migrate any submissions/ keys into prompts/<promptId>/<idx>.<ext>.
    // Same shape as admin.ts approve: copyObject → UPDATE prompt_images →
    // best-effort deleteObject. If any image lives outside submissions/
    // (e.g., a key already in prompts/), we still recopy under the canonical
    // name to keep the prompt's keyspace clean.
    try {
      const accRows = await db.select().from(r2Accounts);
      const accMap = new Map(accRows.map((a) => [a.id, a]));
      for (const [idx, img] of input.images.entries()) {
        const account = accMap.get(img.r2AccountId);
        if (!account) throw new Error(`unknown account ${img.r2AccountId}`);
        const ext = img.r2Key.split(".").pop() ?? "jpg";
        const newKey = buildPromptKey(promptId, idx, ext);
        if (newKey === img.r2Key) continue;
        await copyObject(account, img.r2Key, newKey);
        // Update the prompt_images row to the new key (matched by promptId+order).
        await db
          .update(promptImages)
          .set({ r2Key: newKey })
          .where(
            and(eq(promptImages.promptId, promptId), eq(promptImages.order, idx)),
          );
        try {
          await deleteObject(account, img.r2Key);
        } catch (e) {
          console.warn("[owner.create_direct] delete original failed", img.r2Key, e);
        }
      }
    } catch (e) {
      console.error("[owner.create_direct] image migration failed", { promptId, e });
      throw new HTTPException(500, { message: "image_migration_failed" });
    }

    await recordAudit({
      actorId: ownerId,
      action: "prompt.create_direct",
      targetType: "prompt",
      targetId: promptId,
      payload: { slug },
    });
    return c.json({ id: promptId, slug }, 201);
  },
);

app.patch(
  "/prompts/:id",
  zv("param", UuidParamSchema),
  zv("json", PromptUpdateBodySchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const ownerId = requireUserId(c);
    const input = c.req.valid("json");

    // Strip undefined-valued keys before forwarding — same discipline as the
    // R2 / announcements PATCH endpoints above.
    const patch: OwnerPromptUpdatePatch = {};
    if (input.titleZh !== undefined) patch.titleZh = input.titleZh;
    if (input.titleEn !== undefined) patch.titleEn = input.titleEn;
    if (input.promptZh !== undefined) patch.promptZh = input.promptZh;
    if (input.promptEn !== undefined) patch.promptEn = input.promptEn;
    if (input.negativePromptZh !== undefined)
      patch.negativePromptZh = input.negativePromptZh;
    if (input.negativePromptEn !== undefined)
      patch.negativePromptEn = input.negativePromptEn;
    if (input.notesZh !== undefined) patch.notesZh = input.notesZh;
    if (input.notesEn !== undefined) patch.notesEn = input.notesEn;
    if (input.aspectRatio !== undefined) patch.aspectRatio = input.aspectRatio;
    if (input.categoryId !== undefined) patch.categoryId = input.categoryId;
    if (input.tagSlugs !== undefined) patch.tagSlugs = input.tagSlugs;
    if (input.images !== undefined) {
      patch.images = input.images.map((img) => {
        const o: NonNullable<OwnerPromptUpdatePatch["images"]>[number] = {
          r2AccountId: img.r2AccountId,
          r2Key: img.r2Key,
        };
        if (img.altText !== undefined) o.altText = img.altText;
        if (img.width !== undefined) o.width = img.width;
        if (img.height !== undefined) o.height = img.height;
        if (img.lqip !== undefined) o.lqip = img.lqip;
        return o;
      });
    }

    let result: Awaited<ReturnType<typeof updatePromptForOwner>>;
    try {
      result = await updatePromptForOwner(id, patch);
    } catch (e: unknown) {
      // categoryId FK violation (unknown category) surfaces as a postgres
      // error with code 23503 (foreign_key_violation). Pg's node driver
      // attaches `.code` on the error instance; drizzle preserves it.
      // We also walk `.cause` in case the error was wrapped, and match
      // English + Chinese FK-violation message variants for safety.
      const root = (e as { cause?: unknown })?.cause ?? e;
      const err = root as { code?: string; message?: string };
      const msg = err?.message ?? String(e);
      const looksLikeFkViolation =
        err?.code === "23503" ||
        msg.includes("23503") ||
        msg.toLowerCase().includes("foreign key") ||
        msg.includes("外键");
      if (looksLikeFkViolation) {
        throw new HTTPException(400, { message: "invalid_category" });
      }
      if (msg.startsWith("invalid_image_key")) {
        throw new HTTPException(400, { message: "invalid_image_key" });
      }
      throw e;
    }
    if (!result) throw new HTTPException(404, { message: "not_found" });

    // Post-tx R2 work for the image diff. Same shape as the direct-create
    // migration: copyObject submissions/* → prompts/<id>/<order>.<ext>,
    // INSERT a prompt_images row at that order, best-effort deleteObject
    // the original. Removed images are best-effort deleted (warnings only).
    if (patch.images !== undefined) {
      try {
        const accRows = await db.select().from(r2Accounts);
        const accMap = new Map(accRows.map((a) => [a.id, a]));
        for (const m of result.migrateKeys) {
          const account = accMap.get(m.r2AccountId);
          if (!account) throw new Error(`unknown account ${m.r2AccountId}`);
          const ext = m.r2Key.split(".").pop() ?? "jpg";
          const newKey = buildPromptKey(id, m.targetOrder, ext);
          await copyObject(account, m.r2Key, newKey);
          await db.insert(promptImages).values({
            promptId: id,
            r2AccountId: m.r2AccountId,
            r2Key: newKey,
            altText: m.altText,
            width: m.width,
            height: m.height,
            lqip: m.lqip,
            order: m.targetOrder,
          });
          try {
            await deleteObject(account, m.r2Key);
          } catch (e) {
            console.warn("[owner.update] delete original failed", m.r2Key, e);
          }
        }
        for (const r of result.removedKeys) {
          const account = accMap.get(r.r2AccountId);
          if (account) {
            try {
              await deleteObject(account, r.r2Key);
            } catch (e) {
              console.warn("[owner.update] R2 delete removed failed", r.r2Key, e);
            }
          }
        }
      } catch (e) {
        console.error("[owner.update] image migration failed", { id, e });
        throw new HTTPException(500, { message: "image_migration_failed" });
      }
    }

    // Re-read to pick up the newly-inserted prompt_image rows.
    const refreshed = patch.images !== undefined
      ? await getPromptForOwner(id)
      : result.detail;
    if (!refreshed) throw new HTTPException(404, { message: "not_found" });

    const hadEdits = Object.keys(patch).length > 0;
    await recordAudit({
      actorId: ownerId,
      action: "prompt.update",
      targetType: "prompt",
      targetId: id,
      payload: { slug: refreshed.slug, hadEdits },
    });
    return c.json(refreshed);
  },
);

app.delete(
  "/prompts/:id",
  zv("param", UuidParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");
    const ownerId = requireUserId(c);

    const result = await deletePromptForOwner(id);
    if (!result) throw new HTTPException(404, { message: "not_found" });

    // Best-effort R2 cleanup. A failed delete logs but does not fail the
    // request — bucket lifecycle eventually evicts orphans. Same posture as
    // admin.ts reject.
    try {
      const accRows = await db.select().from(r2Accounts);
      const accMap = new Map(accRows.map((a) => [a.id, a]));
      for (const img of result.imageKeys) {
        const account = accMap.get(img.r2AccountId);
        if (account) {
          try {
            await deleteObject(account, img.r2Key);
          } catch (e) {
            console.warn("[owner.delete] R2 delete failed", img.r2Key, e);
          }
        }
      }
    } catch (e) {
      console.warn("[owner.delete] R2 cleanup error", e);
    }

    await recordAudit({
      actorId: ownerId,
      action: "prompt.delete",
      targetType: "prompt",
      targetId: id,
      payload: { deletedImageCount: result.imageKeys.length },
    });
    return c.json({ id, deleted: true });
  },
);

// ── Imports (crawled-prompt ingestion) ───────────────────────────────────
//
// Three endpoints power the /rosekhlifa/import admin page:
//
//  - POST /imports        runs importCategoryJsonl synchronously + audit-logs
//  - GET  /imports        recent batch history (newest first, capped at 100)
//  - GET  /imports/manifest  reads manifest.json from import.data_root, returns
//                            the 16-category table data
//
// The actual JSONL streaming + DB writes live in repositories/imports.ts;
// these endpoints are just the request/response shell. requireOwner() at the
// top of this file gates every route here.

const ImportBodySchema = z.object({
  categorySlug: z.string().min(1).max(64),
  dryRun: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

const DEFAULT_IMPORT_ROOT = "G:\\promptsandimages";

type ManifestEntry = {
  slug: string;
  name: string;
  count: number;
  jsonl: string;
};

type Manifest = { categories: ManifestEntry[] };

async function readImportManifest(): Promise<{ dataRoot: string; manifest: Manifest }> {
  const dataRoot = (await getSetting("import.data_root")) ?? DEFAULT_IMPORT_ROOT;
  if (typeof dataRoot !== "string") {
    throw new HTTPException(500, { message: "invalid_data_root" });
  }
  const manifestPath = resolve(dataRoot, "exports/manifest.json");
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
    return { dataRoot, manifest };
  } catch (e) {
    throw new HTTPException(500, {
      message: `manifest_unreadable:${(e as Error).message}`,
    });
  }
}

app.post("/imports", zv("json", ImportBodySchema), async (c) => {
  const ownerId = requireUserId(c);
  const body = c.req.valid("json");

  const { dataRoot, manifest } = await readImportManifest();

  const entry = manifest.categories.find((m) => m.slug === body.categorySlug);
  if (!entry) {
    throw new HTTPException(400, { message: `unknown_category:${body.categorySlug}` });
  }
  const filePath = resolve(dataRoot, entry.jsonl);

  const result = await importCategoryJsonl({
    filePath,
    categorySlug: body.categorySlug,
    startedBy: ownerId,
    ...(body.dryRun !== undefined ? { dryRun: body.dryRun } : {}),
    ...(body.limit !== undefined ? { limit: body.limit } : {}),
  });

  await recordAudit({
    actorId: ownerId,
    action: body.dryRun ? "import.dry_run" : "import.run",
    targetType: "import_batch",
    targetId: result.batchId,
    payload: {
      categorySlug: body.categorySlug,
      total: result.total,
      inserted: result.inserted,
      skippedDuplicate: result.skippedDuplicate,
      failed: result.failed,
    },
  });

  return c.json(result);
});

app.get("/imports", async (c) => {
  const rawLimit = Number(c.req.query("limit") ?? "50");
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 50;
  const rows = await listRecentImports({ limit });
  return c.json({ items: rows });
});

app.get("/imports/manifest", async (c) => {
  const { dataRoot, manifest } = await readImportManifest();
  return c.json({
    dataRoot,
    categories: manifest.categories.map((m) => ({
      slug: m.slug,
      name: m.name,
      count: m.count,
      jsonl: m.jsonl,
    })),
  });
});

export default app;
