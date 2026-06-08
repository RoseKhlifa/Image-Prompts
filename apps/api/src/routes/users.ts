import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { zv } from "../lib/validate.ts";
import { softAuth, requireUserId } from "../middleware/auth.ts";
import {
  getUserPublic,
  getUserStats,
  listUserPrompts,
  listUserFavorites,
} from "../repositories/users-public.ts";

const app = new Hono();

const UuidParamSchema = z.object({ id: z.string().uuid() });
const ListQuerySchema = z.object({
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(24),
});

app.get("/:id", zv("param", UuidParamSchema), async (c) => {
  const u = await getUserPublic(c.req.valid("param").id);
  if (!u) throw new HTTPException(404, { message: "not_found" });
  return c.json(u);
});

app.get("/:id/stats", zv("param", UuidParamSchema), async (c) => {
  const u = await getUserPublic(c.req.valid("param").id);
  if (!u) throw new HTTPException(404, { message: "not_found" });
  const stats = await getUserStats(c.req.valid("param").id);
  return c.json(stats);
});

app.get(
  "/:id/prompts",
  zv("param", UuidParamSchema),
  zv("query", ListQuerySchema),
  async (c) => {
    const u = await getUserPublic(c.req.valid("param").id);
    if (!u) throw new HTTPException(404, { message: "not_found" });
    const r = await listUserPrompts(c.req.valid("param").id, {
      cursor: c.req.valid("query").cursor ?? null,
      limit: c.req.valid("query").limit,
    });
    return c.json(r);
  },
);

// Owner-only: returns favorites only when caller's session matches :id.
// softAuth populates c.var.authUser if signed in; requireUserId then throws
// 401 if no session, and we throw 403 if the session belongs to someone else.
app.get(
  "/:id/favorites",
  softAuth(),
  zv("param", UuidParamSchema),
  zv("query", ListQuerySchema),
  async (c) => {
    const callerId = requireUserId(c); // 401 if not signed in
    const targetId = c.req.valid("param").id;
    if (callerId !== targetId) {
      throw new HTTPException(403, { message: "forbidden" });
    }
    const r = await listUserFavorites(targetId, {
      cursor: c.req.valid("query").cursor ?? null,
      limit: c.req.valid("query").limit,
    });
    return c.json(r);
  },
);

export default app;
