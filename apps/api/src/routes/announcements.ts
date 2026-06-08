import { Hono } from "hono";
import { listActivePublic } from "../repositories/announcements.ts";

/**
 * Public announcements feed.
 *
 * Mounted at /api/announcements without banCheck/auth — visitors (including
 * anon and signed-out) must be able to read the active banner set. Owner CRUD
 * lives under /api/owner/announcements behind the requireOwner() chain.
 *
 * The response shape is `{ items }` to match the rest of the public list
 * endpoints (categories, tags, prompts). listActivePublic() already filters
 * deleted + future + expired rows.
 */
const app = new Hono();

app.get("/", async (c) => {
  const rows = await listActivePublic();
  return c.json({ items: rows });
});

export default app;
