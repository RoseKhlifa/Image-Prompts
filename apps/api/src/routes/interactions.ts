import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { verifyAuth } from "@hono/auth-js";
import { PromptIdParamSchema } from "@ip/shared";
import { zv } from "../lib/validate.ts";
import { createRateLimiter } from "../lib/rate-limit.ts";
import { hashIp } from "../lib/ip-hash.ts";
import { env } from "../env.ts";
import {
  toggleLike,
  toggleFavorite,
  recordView,
  AlreadyExistsError,
  NotFoundError,
} from "../repositories/interactions.ts";

const app = new Hono();

const toggleUserLimiter = createRateLimiter({ limit: 60, windowMs: 60_000 });
const toggleIpLimiter = createRateLimiter({ limit: 200, windowMs: 60_000 });
const viewIpLimiter = createRateLimiter({ limit: 120, windowMs: 60_000 });

function clientIp(c: { req: { header: (k: string) => string | undefined } }): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    "unknown"
  );
}

function requireUser(c: { get: (key: "authUser") => unknown }): string {
  const authUser = c.get("authUser") as { session?: { user?: { id?: string } } } | undefined;
  const id = authUser?.session?.user?.id;
  if (!id) throw new HTTPException(401, { message: "unauthorized" });
  return id;
}

app.post("/:id/like", verifyAuth(), zv("param", PromptIdParamSchema), async (c) => {
  const userId = requireUser(c);
  const ip = clientIp(c);
  if (!toggleUserLimiter.check(userId)) throw new HTTPException(429, { message: "rate_limit" });
  if (!toggleIpLimiter.check(ip)) throw new HTTPException(429, { message: "rate_limit" });
  const { id } = c.req.valid("param");
  try {
    const result = await toggleLike(userId, id, "add");
    return c.json({ liked: true, like_count: result.like_count }, 201);
  } catch (e) {
    if (e instanceof AlreadyExistsError) return c.json({ error: "already_liked" }, 409);
    throw e;
  }
});

app.delete("/:id/like", verifyAuth(), zv("param", PromptIdParamSchema), async (c) => {
  const userId = requireUser(c);
  const ip = clientIp(c);
  if (!toggleUserLimiter.check(userId)) throw new HTTPException(429, { message: "rate_limit" });
  if (!toggleIpLimiter.check(ip)) throw new HTTPException(429, { message: "rate_limit" });
  const { id } = c.req.valid("param");
  try {
    const result = await toggleLike(userId, id, "remove");
    return c.json({ liked: false, like_count: result.like_count }, 200);
  } catch (e) {
    if (e instanceof NotFoundError) return c.json({ error: "like_not_found" }, 404);
    throw e;
  }
});

app.post("/:id/favorite", verifyAuth(), zv("param", PromptIdParamSchema), async (c) => {
  const userId = requireUser(c);
  const ip = clientIp(c);
  if (!toggleUserLimiter.check(userId)) throw new HTTPException(429, { message: "rate_limit" });
  if (!toggleIpLimiter.check(ip)) throw new HTTPException(429, { message: "rate_limit" });
  const { id } = c.req.valid("param");
  try {
    const result = await toggleFavorite(userId, id, "add");
    return c.json({ favorited: true, favorite_count: result.favorite_count }, 201);
  } catch (e) {
    if (e instanceof AlreadyExistsError) return c.json({ error: "already_favorited" }, 409);
    throw e;
  }
});

app.delete("/:id/favorite", verifyAuth(), zv("param", PromptIdParamSchema), async (c) => {
  const userId = requireUser(c);
  const ip = clientIp(c);
  if (!toggleUserLimiter.check(userId)) throw new HTTPException(429, { message: "rate_limit" });
  if (!toggleIpLimiter.check(ip)) throw new HTTPException(429, { message: "rate_limit" });
  const { id } = c.req.valid("param");
  try {
    const result = await toggleFavorite(userId, id, "remove");
    return c.json({ favorited: false, favorite_count: result.favorite_count }, 200);
  } catch (e) {
    if (e instanceof NotFoundError) return c.json({ error: "favorite_not_found" }, 404);
    throw e;
  }
});

app.post("/:id/view", zv("param", PromptIdParamSchema), async (c) => {
  const ip = clientIp(c);
  if (!viewIpLimiter.check(ip)) {
    return c.json({ recorded: false }, 200);
  }
  const { id } = c.req.valid("param");
  const authUser = c.get("authUser") as { session?: { user?: { id?: string } } } | undefined;
  const userId = authUser?.session?.user?.id ?? null;
  const ipHash = userId ? null : hashIp(ip === "unknown" ? null : ip, env.AUTH_SECRET);

  try {
    const result = await recordView({ promptId: id, userId, ipHash });
    return c.json(result, 200);
  } catch (e) {
    console.warn("[views] recordView failed", e);
    return c.json({ recorded: false }, 200);
  }
});

export default app;
