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
    return c.json({ error: "validation_error", fields }, 400);
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
