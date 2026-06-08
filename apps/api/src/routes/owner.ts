import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { softAuth, requireUserId } from "../middleware/auth.ts";
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
import { resetSubmitConfigCache } from "../lib/submit-config.ts";

const app = new Hono();

// All /api/owner routes require admin role + OWNER_EMAILS whitelist.
app.use("*", softAuth(), requireOwner());

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

export default app;
