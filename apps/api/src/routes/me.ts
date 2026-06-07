import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { verifyAuth } from "@hono/auth-js";
import { z } from "zod";
import { CommunityGuidelinesAcceptSchema, MyFavoritesQuerySchema } from "@ip/shared";
import { zv } from "../lib/validate.ts";
import { requireUserId } from "../middleware/auth.ts";
import { listMyFavorites } from "../repositories/interactions.ts";
import { setCommunityGuidelinesVersion } from "../repositories/users.ts";
import { listForUser } from "../repositories/submissions.ts";
import {
  listMyNotifications,
  countUnread,
  markRead,
  markAllRead,
} from "../repositories/notifications.ts";

const SubmissionsQuerySchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const NotificationsQuerySchema = z.object({
  cursor: z.string().datetime().optional(),
  unread: z.union([z.literal("true"), z.literal("false")]).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const UuidParamSchema = z.object({ id: z.string().uuid() });

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

app.get(
  "/notifications",
  verifyAuth(),
  zv("query", NotificationsQuerySchema),
  async (c) => {
    const userId = requireUserId(c);
    const q = c.req.valid("query");
    const r = await listMyNotifications(userId, {
      cursor: q.cursor ?? null,
      limit: q.limit,
      unreadOnly: q.unread === "true",
    });
    return c.json(r);
  },
);

app.get("/notifications/count", verifyAuth(), async (c) => {
  const userId = requireUserId(c);
  const unread = await countUnread(userId);
  return c.json({ unread });
});

app.post(
  "/notifications/:id/read",
  verifyAuth(),
  zv("param", UuidParamSchema),
  async (c) => {
    const userId = requireUserId(c);
    const ok = await markRead(c.req.valid("param").id, userId);
    if (!ok) throw new HTTPException(404, { message: "not_found" });
    return c.json({ ok: true });
  },
);

app.post("/notifications/read-all", verifyAuth(), async (c) => {
  const userId = requireUserId(c);
  const updated = await markAllRead(userId);
  return c.json({ ok: true, updated });
});

export default app;
