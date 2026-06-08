import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { users } from "../db/schema/index.ts";

/**
 * Hard gate banned users out of every authenticated route. Runs AFTER
 * softAuth() / verifyAuth() populates c.var.authUser. When the user has
 * session.user.id AND `users.banned_at IS NOT NULL`, throw 403 with message
 * "banned". The web client should treat 403 banned as a forced sign-out
 * signal — banned users may still call /api/auth/* to sign out, but every
 * other authenticated surface is locked.
 *
 * Anonymous visitors (no authUser, or no user.id) pass through unchanged so
 * the middleware is safe to layer on routes that mix public + authenticated
 * handlers (e.g., /api/categories with optional ?scope=mine).
 */
export function banCheck(): MiddlewareHandler {
  return async (c, next) => {
    const authUser = c.get("authUser") as
      | { session?: { user?: { id?: string } } }
      | null
      | undefined;
    const userId = authUser?.session?.user?.id;
    if (!userId) {
      await next();
      return;
    }
    const [row] = await db
      .select({ bannedAt: users.bannedAt })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (row?.bannedAt) {
      throw new HTTPException(403, { message: "banned" });
    }
    await next();
  };
}
