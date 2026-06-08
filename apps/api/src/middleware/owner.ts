import { HTTPException } from "hono/http-exception";
import type { MiddlewareHandler } from "hono";
import { isOwnerEmail } from "../auth/index.ts";

/**
 * Gate the handler to project owners only. Composed predicate:
 *   1. session.user.role === 'admin'
 *   2. session.user.email is in OWNER_EMAILS env (case-insensitive)
 *
 * Both must pass. Either failure → 403 (we don't distinguish to avoid
 * leaking which check failed). Must run AFTER softAuth() / authConfig
 * populates c.var.authUser.
 *
 * B-scheme: there is no 'owner' role enum value. Owner is admin + email.
 */
export function requireOwner(): MiddlewareHandler {
  return async (c, next) => {
    const authUser = c.get("authUser") as
      | { session?: { user?: { role?: string; email?: string | null } } }
      | null
      | undefined;
    const role = authUser?.session?.user?.role;
    const email = authUser?.session?.user?.email;
    if (role !== "admin" || !isOwnerEmail(email)) {
      throw new HTTPException(403, { message: "forbidden" });
    }
    await next();
  };
}
