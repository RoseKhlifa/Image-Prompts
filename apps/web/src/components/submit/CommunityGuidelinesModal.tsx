import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAcceptGuidelines } from "../../lib/hooks/useAcceptGuidelines";

/**
 * Frontend-pinned guidelines version, mirrored in useCommunityGuidelinesGate.
 * Bump both together whenever the body text changes materially.
 */
const REQUIRED_VERSION = 1;
const READ_SECONDS = 5;

type Props = {
  open: boolean;
  /** User dismissed without accepting (cancel button or ESC). Parent typically
   *  closes the surrounding submit flow. */
  onCancel: () => void;
  /** User successfully accepted (mutation 200'd). Parent should only close THIS
   *  modal — the gate will re-check session and unlock the form. Distinct from
   *  onCancel so accepting doesn't cascade into closing the submit modal. */
  onAccepted: () => void;
};

/**
 * Modal that enforces a deliberate read pause + scroll + explicit checkbox
 * before the user can accept the community guidelines. On accept it PATCHes
 * /api/me/community-guidelines (via useAcceptGuidelines), then calls onAccepted;
 * cancel/ESC calls onCancel. The two callbacks are distinct so the parent can
 * differentiate "user agreed, keep the form open" from "user backed out".
 *
 * The read timer (READ_SECONDS) and IntersectionObserver-based scroll sentinel are both
 * gates on the checkbox — only when both are satisfied does the checkbox
 * become enabled, and only when the checkbox is checked does the "I agree"
 * button fire the mutation.
 */
export default function CommunityGuidelinesModal({ open, onCancel, onAccepted }: Props) {
  const { t } = useTranslation();
  const [secondsLeft, setSecondsLeft] = useState(READ_SECONDS);
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const accept = useAcceptGuidelines();

  // Reset state and start the read timer whenever the modal opens.
  useEffect(() => {
    if (!open) return;
    setSecondsLeft(READ_SECONDS);
    setScrolledToBottom(false);
    setAgreed(false);
    const id = setInterval(() => {
      setSecondsLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [open]);

  // Watch the sentinel at the bottom of the scrollable body. Once it scrolls
  // into view we permanently flag the user as having read to the end. The
  // observer is recreated whenever the modal re-opens (sentinel may remount).
  useEffect(() => {
    if (!open) return;
    const node = sentinelRef.current;
    if (!node) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setScrolledToBottom(true);
        }
      },
      { root: null, threshold: 0.1 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [open]);

  if (!open) return null;

  const canCheck = secondsLeft === 0 && scrolledToBottom;
  const canSubmit = canCheck && agreed && !accept.isPending;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <div className="max-h-[85vh] w-[680px] overflow-y-auto rounded-card border border-border-soft bg-panel p-6">
        <h2 className="mb-3 text-lg font-semibold text-ink">
          {t("guidelines.modal_title")}
        </h2>
        <div className="prose prose-sm whitespace-pre-wrap text-ink/80">
          {t("guidelines.body")}
        </div>
        <div ref={sentinelRef} className="mt-6 h-px" />
        {!scrolledToBottom && (
          <p className="mt-4 text-xs text-amber-600">
            {t("guidelines.scroll_hint")}
          </p>
        )}
        <label
          className={`mt-4 flex items-center gap-2 text-sm ${
            canCheck ? "text-ink" : "text-ink/40"
          }`}
        >
          <input
            type="checkbox"
            disabled={!canCheck}
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
          />
          {t("guidelines.agree_checkbox")}
        </label>
        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-card border border-border-soft px-3 py-1.5 text-sm"
          >
            {t("guidelines.cancel")}
          </button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() =>
              accept.mutate(REQUIRED_VERSION, { onSuccess: () => onAccepted() })
            }
            className="rounded-card bg-accent px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {secondsLeft > 0
              ? t("guidelines.wait_seconds", { n: secondsLeft })
              : t("guidelines.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
