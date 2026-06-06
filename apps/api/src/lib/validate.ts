import { zValidator } from "@hono/zod-validator";
import { ZodError, type ZodSchema } from "zod";

/**
 * Wrapper around @hono/zod-validator that re-throws validation failures as
 * ZodError so the global error handler middleware can format them per
 * @ip/shared.ErrorResponseSchema instead of zod-validator's default shape.
 */
export function zv<
  Target extends "query" | "json" | "param" | "form" | "header",
  S extends ZodSchema,
>(target: Target, schema: S) {
  return zValidator(target, schema, (result) => {
    if (!result.success) {
      throw new ZodError(result.error.issues);
    }
  });
}
