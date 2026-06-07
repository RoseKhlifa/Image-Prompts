import { HTTPException } from "hono/http-exception";
import type { MiddlewareHandler } from "hono";

export type Role = "admin" | "moderator" | "user";

/**
 * Gate the handler to one of the listed roles. Must run AFTER verifyAuth() /
 * authConfig populates c.var.authUser, otherwise it sees no role and 403s.
 *
 * Throws 403 (not 401) for both missing session and wrong role — we don't
 * want to leak "you're logged in but not authorised" via different status
 * codes. The frontend opens SignInModal only on explicit 401 from the auth
 * layer.
 */
export function requireRole(...roles: ReadonlyArray<Role>): MiddlewareHandler {
  return async (c, next) => {
    const authUser = c.get("authUser") as
      | { session?: { user?: { role?: string } } }
      | null
      | undefined;
    const role = authUser?.session?.user?.role;
    if (!role || !roles.includes(role as Role)) {
      throw new HTTPException(403, { message: "forbidden" });
    }
    await next();
  };
}
