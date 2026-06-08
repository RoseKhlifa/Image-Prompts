import { Hono } from "hono";
import { z } from "zod";
import { softAuth, requireUserId } from "../middleware/auth.ts";
import { zv } from "../lib/validate.ts";
import { listCategories } from "../repositories/categories.ts";

const QuerySchema = z.object({
  scope: z.enum(["favorites", "mine"]).optional(),
});

const app = new Hono();

// softAuth so requireUserId works when scope is set; public reads (no scope)
// fall through without needing a session.
app.get("/", softAuth(), zv("query", QuerySchema), async (c) => {
  const { scope } = c.req.valid("query");
  if (!scope) {
    return c.json(await listCategories());
  }
  const userId = requireUserId(c);
  const rows = await listCategories({ kind: scope, userId });
  return c.json(rows);
});

export default app;
