import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: errorCodeForStatus(err.status), message: err.message }, err.status);
  }
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.errors) {
      fields[issue.path.join(".") || "_root"] = issue.message;
    }
    // Surface the first issue's message at the top level so generic UI
    // handlers that read e.message see something useful instead of just
    // the HTTP status text ("Bad Request").
    const firstMessage = err.errors[0]?.message ?? "validation failed";
    return c.json({ error: "validation_error", message: firstMessage, fields }, 400);
  }
  // NSFW domain errors thrown as plain Error (see lib/nsfw.ts, repositories/imports.ts).
  // Map to 400 so the UI can show a localized message instead of "internal error".
  if (
    err instanceof Error &&
    (err.message === "nsfw_category_tags_locked" || err.message === "nsfw_import_forbidden")
  ) {
    return c.json({ error: err.message, message: err.message }, 400);
  }
  console.error("[server] unhandled error", err);
  return c.json({ error: "internal_error" }, 500);
};

function errorCodeForStatus(status: number): string {
  switch (status) {
    case 400:
      return "bad_request";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 410:
      return "gone";
    case 429:
      return "rate_limited";
    case 503:
      return "service_unavailable";
    default:
      return status >= 500 ? "internal_error" : "error";
  }
}
