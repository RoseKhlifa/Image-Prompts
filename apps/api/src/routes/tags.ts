import { Hono } from "hono";
import { z } from "zod";
import { softAuth, requireUserId } from "../middleware/auth.ts";
import { banCheck } from "../middleware/ban-check.ts";
import { zv } from "../lib/validate.ts";
import { listTags, searchTags } from "../repositories/tags.ts";

const QuerySchema = z.object({
  q: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(8),
  scope: z.enum(["favorites", "mine"]).optional(),
  category: z.string().max(80).optional(),
});

const app = new Hono();

// softAuth so requireUserId works when scope is set; public reads (no scope)
// fall through. `scope`/`category` and `q` are mutually exclusive: a scoped
// or category-filtered request goes through `listTags` so counts reflect the
// active subset; the bare q-search path stays on `searchTags` (autocomplete).
app.get("/", softAuth(), banCheck(), zv("query", QuerySchema), async (c) => {
  const q = c.req.valid("query");
  if (q.scope) {
    const userId = requireUserId(c);
    const rows = await listTags(q.limit, { kind: q.scope, userId }, q.category);
    return c.json(rows);
  }
  if (q.category) {
    const rows = await listTags(q.limit, undefined, q.category);
    return c.json(rows);
  }
  const rows = await searchTags(q.q ?? "", q.limit);
  return c.json(rows);
});

export default app;
