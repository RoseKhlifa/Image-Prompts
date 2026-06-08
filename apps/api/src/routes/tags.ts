import { Hono } from "hono";
import { z } from "zod";
import { softAuth, requireUserId } from "../middleware/auth.ts";
import { zv } from "../lib/validate.ts";
import { listTags, searchTags } from "../repositories/tags.ts";

const QuerySchema = z.object({
  q: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(8),
  scope: z.enum(["favorites", "mine"]).optional(),
});

const app = new Hono();

// softAuth so requireUserId works when scope is set; public reads (no scope)
// fall through. `scope` and `q` are mutually exclusive: scoped requests
// return tags from the user's data (favorites/mine) ordered by occurrence;
// non-scoped requests fall back to global searchTags (autocomplete + sidebar).
app.get("/", softAuth(), zv("query", QuerySchema), async (c) => {
  const q = c.req.valid("query");
  if (q.scope) {
    const userId = requireUserId(c);
    const rows = await listTags(q.limit, { kind: q.scope, userId });
    return c.json(rows);
  }
  const rows = await searchTags(q.q ?? "", q.limit);
  return c.json(rows);
});

export default app;
