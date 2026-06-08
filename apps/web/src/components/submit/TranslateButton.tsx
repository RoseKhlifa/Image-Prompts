import { useTranslation } from "react-i18next";
import { Languages, Loader2 } from "lucide-react";
import { useTranslate } from "../../lib/hooks/useTranslate";
import { toast } from "../../lib/toast";
import { ApiError } from "../../lib/api";

/**
 * M10b W4.3: AI translate pill that sits between the bilingual prompt
 * textareas in SubmissionForm. The user types a Chinese prompt → clicks
 * this → the English textarea is populated.
 *
 * Behaviour:
 *   - Disabled while the source textarea is empty/whitespace, or while a
 *     translation is in flight (m.isPending).
 *   - If the target textarea already has content, we window.confirm()
 *     before overwriting; if the user cancels we no-op (no mutation
 *     fires, so no rate-limit budget is spent).
 *   - On success we hand the translated text to onTranslated and show a
 *     success toast.
 *   - On error we look at ApiError.message — the route in W4.2 stuffs
 *     the translator code in there (translator_disabled, rate_limited,
 *     text_too_long:2000, upstream_error:500, ...). We strip the suffix
 *     after ":" and look up submit.translate_error_<base>; missing keys
 *     fall back to submit.translate_error_generic. Non-ApiError throws
 *     (which shouldn't happen with apiFetch, but is theoretically
 *     possible from network teardown) also fall back to the generic
 *     message.
 *
 * The visual is a small pill — see SubmissionForm for context. Theme
 * tokens only (border-soft / panel-2 / surface / ink), no hardcoded
 * zinc/emerald.
 */

type Props = {
  /** The source text to translate. Empty → button disabled. */
  sourceText: string;
  /** Source language (currently zh→en only). */
  fromLocale: "zh" | "en";
  /** Target language. */
  toLocale: "zh" | "en";
  /** Whether the target textarea already has content. Used to confirm overwrite. */
  targetHasContent: boolean;
  /** Called with the translated text once user confirms (or directly if target empty). */
  onTranslated: (text: string) => void;
};

export default function TranslateButton({
  sourceText,
  fromLocale,
  toLocale,
  targetHasContent,
  onTranslated,
}: Props) {
  const { t } = useTranslation();
  const m = useTranslate();
  const disabled = !sourceText.trim() || m.isPending;

  function go() {
    if (
      targetHasContent &&
      !window.confirm(t("submit.translate_confirm_overwrite"))
    ) {
      return;
    }
    m.mutate(
      { text: sourceText.trim(), fromLocale, toLocale },
      {
        onSuccess: (data) => {
          onTranslated(data.translated);
          toast.success(t("submit.translate_success"));
        },
        onError: (err) => {
          if (err instanceof ApiError) {
            // The server (apps/api/routes/translate.ts) puts the translator
            // code in HTTPException.message — apiFetch surfaces it as
            // ApiError.message. Strip any ":<suffix>" so e.g.
            // "text_too_long:2000" maps to translate_error_text_too_long.
            const base = (err.message ?? "").split(":")[0];
            const key = `submit.translate_error_${base}`;
            const msg = t(key, {
              defaultValue: t("submit.translate_error_generic"),
            });
            toast.error(msg);
            return;
          }
          toast.error(t("submit.translate_error_generic"));
        },
      },
    );
  }

  return (
    <div className="my-2 flex justify-center">
      <button
        type="button"
        onClick={go}
        disabled={disabled}
        className="inline-flex items-center gap-1.5 rounded-pill border border-border-soft bg-panel-2 px-3 py-1.5 text-xs text-ink-muted hover:bg-surface hover:text-ink disabled:opacity-40"
        aria-label={t("submit.translate_aria")}
      >
        {m.isPending ? (
          <Loader2 size={12} className="animate-spin" aria-hidden />
        ) : (
          <Languages size={12} aria-hidden />
        )}
        {m.isPending ? t("submit.translate_pending") : t("submit.translate_button")}
      </button>
    </div>
  );
}
