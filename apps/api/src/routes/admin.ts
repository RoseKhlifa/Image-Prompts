import { Hono } from "hono";
import type { Context, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { getAuthUser } from "@hono/auth-js";
import { z } from "zod";
import { requireRole } from "../middleware/role.ts";
import { zv } from "../lib/validate.ts";
import {
  listForAdmin,
  getSubmissionById,
} from "../repositories/submissions.ts";

/**
 * Resolves the session user id, throwing 401 if absent. Not used in Task 22's
 * read-only list/detail endpoints (which only need the role check from
 * `requireRole`), but kept here because Tasks 23/24 (approve/reject) will need
 * it to log the actor on the audit-log row.
 */
export function _requireUserId(c: Context): string {
  const authUser = c.get("authUser") as
    | { session?: { user?: { id?: string; role?: string } } }
    | null
    | undefined;
  const id = authUser?.session?.user?.id;
  if (!id) throw new HTTPException(401, { message: "unauthenticated" });
  return id;
}

/**
 * Soft auth-population middleware. Populates `c.var.authUser` from the session
 * cookie if one exists, but does NOT throw 401 when no session is present.
 *
 * We deliberately avoid `verifyAuth()` here: it throws 401 on missing session,
 * but Task 9's contract for admin endpoints is to return 403 for BOTH
 * unauthenticated and unauthorised requests — so that the frontend can't tell
 * "you're not logged in" from "you're logged in but lack the role". `requireRole`
 * 403s when `authUser` is null or the role doesn't match.
 */
const softAuth: MiddlewareHandler = async (c, next) => {
  const authUser = await getAuthUser(c);
  if (authUser) c.set("authUser", authUser);
  await next();
};

const app = new Hono();

// All admin routes require admin or moderator role
app.use("*", softAuth, requireRole("admin", "moderator"));

const ListQuerySchema = z.object({
  status: z.enum(["pending", "approved", "rejected"]).optional(),
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

app.get(
  "/submissions",
  zv("query", ListQuerySchema),
  async (c) => {
    const q = c.req.valid("query");
    const r = await listForAdmin({
      cursor: q.cursor ?? null,
      limit: q.limit,
      status: q.status ?? null,
    });
    return c.json(r);
  },
);

const UuidParamSchema = z.object({ id: z.string().uuid() });

app.get(
  "/submissions/:id",
  zv("param", UuidParamSchema),
  async (c) => {
    const sub = await getSubmissionById(c.req.valid("param").id);
    if (!sub) throw new HTTPException(404, { message: "not_found" });
    return c.json(sub);
  },
);

export default app;
