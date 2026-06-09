import { Hono } from "hono";
import { listActivePublic } from "../repositories/announcements.ts";

/**
 * Public announcements feed.
 *
 * Mounted at /api/announcements without banCheck/auth — visitors (including
 * anon and signed-out) must be able to read the active set. Owner CRUD lives
 * under /api/owner/announcements behind the requireOwner() chain.
 *
 * Response shape:
 *   {
 *     items: [...],           // raw — all active rows (banner + popup), for tests + legacy callers
 *     banners: [singleton],   // at most 1 — UI shows only the most-recent active banner
 *     popups: [...],          // all active popups (queued + dismissed per id via localStorage)
 *   }
 *
 * The split is computed server-side so the client doesn't have to know about
 * the "only 1 banner at a time" rule. `banners` is at most one element
 * (the most recently started); the rest of the active banner queue is
 * simply elided from the client's view (they'll surface when the first
 * one expires or the owner deletes it).
 */
const app = new Hono();

app.get("/", async (c) => {
  const rows = await listActivePublic();
  const allBanners = rows.filter((r) => r.displayMode === "banner");
  const popups = rows.filter((r) => r.displayMode === "popup");
  const banners = allBanners.length > 0 ? [allBanners[0]!] : [];
  return c.json({ items: rows, banners, popups });
});

export default app;
