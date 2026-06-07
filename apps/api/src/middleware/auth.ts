import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { getAuthUser } from "@hono/auth-js";

/**
 * Like `verifyAuth()` but does NOT throw on missing session. Sets
 * `c.var.authUser` to the session object when one exists, leaves it absent
 * otherwise. Use this before `requireRole(...)` on admin routes so that
 * unauthenticated requests get a uniform 403 (matching role failures), not
 * a 401 that would let attackers distinguish "logged-in vs not".
 */
export function softAuth(): MiddlewareHandler {
  return async (c, next) => {
    const authUser = await getAuthUser(c);
    if (authUser) {
      c.set("authUser", authUser);
    }
    await next();
  };
}

/**
 * Extract the current user's id from the session that verifyAuth() or
 * softAuth() placed on the context. Throws 401 if absent — for endpoints
 * that require an authenticated user (use AFTER verifyAuth() typically).
 */
export function requireUserId(c: Context): string {
  const authUser = c.get("authUser") as
    | { session?: { user?: { id?: string } } }
    | null
    | undefined;
  const id = authUser?.session?.user?.id;
  if (!id) throw new HTTPException(401, { message: "unauthenticated" });
  return id;
}

/**
 * Extract the current user's role from the session. Returns undefined when
 * no session or no role on user.
 */
export function getRole(c: Context): string | undefined {
  const authUser = c.get("authUser") as
    | { session?: { user?: { role?: string } } }
    | null
    | undefined;
  return authUser?.session?.user?.role;
}
