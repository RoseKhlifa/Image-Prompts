import { useMutation } from "@tanstack/react-query";
import { apiFetch, type ApiError } from "../api";

/**
 * M10b W4.3: client-side wrapper for POST /api/translate.
 *
 * Mirrors the server contract from W4.2:
 *   - body: { text, fromLocale, toLocale } where the locale pair must differ
 *   - 200: { translated: string }
 *   - error: HTTPException with the translator code in `message` (e.g.
 *     "translator_disabled", "text_too_long:2000", "rate_limited",
 *     "upstream_error:500"). apiFetch wraps this in ApiError, where
 *     err.message carries that translator code and err.code carries the
 *     status-derived code ("forbidden", "rate_limited", ...).
 *
 * Callers should distinguish errors via `err.message.split(":")[0]` rather
 * than `err.code` so they can show specific copy for translator_disabled vs.
 * translator_unconfigured (both 403/503 family, different UX).
 */
export type TranslateInput = {
  text: string;
  fromLocale: "zh" | "en";
  toLocale: "zh" | "en";
};

export function useTranslate() {
  return useMutation<{ translated: string }, ApiError, TranslateInput>({
    mutationFn: (input) =>
      apiFetch<{ translated: string }>("/api/translate", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  });
}
