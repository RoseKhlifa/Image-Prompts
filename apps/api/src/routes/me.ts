import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { verifyAuth } from "@hono/auth-js";
import { MyFavoritesQuerySchema } from "@ip/shared";
import { zv } from "../lib/validate.ts";
import { listMyFavorites } from "../repositories/interactions.ts";

const app = new Hono();

app.get("/favorites", verifyAuth(), zv("query", MyFavoritesQuerySchema), async (c) => {
  const authUser = c.get("authUser") as { session?: { user?: { id?: string } } } | undefined;
  const userId = authUser?.session?.user?.id;
  if (!userId) throw new HTTPException(401, { message: "unauthorized" });

  const { page, pageSize } = c.req.valid("query");
  const result = await listMyFavorites(userId, page, pageSize);
  return c.json(result);
});

export default app;
