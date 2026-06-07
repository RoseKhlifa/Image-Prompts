import { Hono } from "hono";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { verifyAuth } from "@hono/auth-js";
import { z } from "zod";
import { CommunityGuidelinesAcceptSchema, MyFavoritesQuerySchema } from "@ip/shared";
import { zv } from "../lib/validate.ts";
import { listMyFavorites } from "../repositories/interactions.ts";
import { setCommunityGuidelinesVersion } from "../repositories/users.ts";
import { listForUser } from "../repositories/submissions.ts";

function requireUserId(c: Context): string {
  const authUser = c.get("authUser") as
    | { session?: { user?: { id?: string } } }
    | null
    | undefined;
  const id = authUser?.session?.user?.id;
  if (!id) throw new HTTPException(401, { message: "unauthorized" });
  return id;
}

const SubmissionsQuerySchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const app = new Hono();

app.get("/favorites", verifyAuth(), zv("query", MyFavoritesQuerySchema), async (c) => {
  const userId = requireUserId(c);
  const { page, pageSize } = c.req.valid("query");
  const result = await listMyFavorites(userId, page, pageSize);
  return c.json(result);
});

app.patch(
  "/community-guidelines",
  verifyAuth(),
  zv("json", CommunityGuidelinesAcceptSchema),
  async (c) => {
    const userId = requireUserId(c);
    const { version } = c.req.valid("json");
    await setCommunityGuidelinesVersion(userId, version);
    return c.json({ ok: true });
  },
);

app.get(
  "/submissions",
  verifyAuth(),
  zv("query", SubmissionsQuerySchema),
  async (c) => {
    const userId = requireUserId(c);
    const q = c.req.valid("query");
    const r = await listForUser(userId, {
      cursor: q.cursor ?? null,
      limit: q.limit,
      status: q.status ?? null,
    });
    return c.json(r);
  },
);

export default app;
