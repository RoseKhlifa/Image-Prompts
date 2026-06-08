import type { ZodError } from "zod";

/**
 * Flattens a ZodError into a flat map: `path.join('.')` → `issue.message`.
 *
 * When multiple issues target the same path, the LAST issue wins. This is
 * deliberate: refine() messages tend to be appended after primitive
 * validation issues, and we want the most specific (semantic) error to win.
 *
 * Top-level refine issues (path === []) are keyed as "" (empty string). The
 * caller can pick those up via `errors[""]` for a form-wide error toast.
 */
export function zodErrorsToMap(err: ZodError): Record<string, string> {
  const map: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".");
    map[key] = issue.message;
  }
  return map;
}
