import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import { X } from "lucide-react";
import { isLocale, type Locale } from "@ip/shared";
import CommunityGuidelinesGate from "./CommunityGuidelinesGate";
import SubmissionForm from "./SubmissionForm";
import SignInModal from "../auth/SignInModal";
import { useSession } from "../../lib/hooks/useSession";
import { useUiStore } from "../../state/uiStore";
import { withLocale } from "../../lib/locale";

/**
 * Global Submit modal mounted in AppShell. Driven by useUiStore. Reused from:
 *   - Header "+" Submit CTA (opens directly)
 *   - /:locale/submit deep-link (SubmitPage opens on mount + replaces URL)
 *
 * Two inner gates mirror the old SubmitPage:
 *   1. Sign-in modal — opens when session is null; canceling closes everything
 *      and routes home.
 *   2. CommunityGuidelinesGate — shows guidelines whenever accepted version
 *      lags the required one.
 */
export default function SubmitModal() {
  const { t } = useTranslation();
  const open = useUiStore((s) => s.submitModalOpen);
  const close = useUiStore((s) => s.closeSubmitModal);
  const session = useSession();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const navigate = useNavigate();

  // ESC closes the modal.
  useEffect(() => {
    if (!open) return;
    function k(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [open, close]);

  if (!open) return null;

  // Not authed: render ONLY the sign-in modal (no outer "投稿提示词" shell on top).
  // After successful sign-in, session.data flips → next render falls through to
  // the authed branch and shows the form. If user cancels sign-in, close the
  // SubmitModal state so we don't leave it dangling open.
  if (!session.isLoading && !session.data) {
    return (
      <SignInModal
        open={true}
        onClose={() => {
          // Snapshot of session right now; if still null, user cancelled.
          if (!session.data) {
            close();
            navigate(withLocale(locale, "/"));
          }
        }}
      />
    );
  }

  // Authed (or still loading): show the submit dialog.
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      onClick={close}
    >
      <div
        className="relative my-8 w-full max-w-3xl rounded-card border border-border-soft bg-panel p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={close}
          aria-label={t("common.close")}
          className="absolute right-3 top-3 rounded-full p-1 hover:bg-ink/5"
        >
          <X size={18} />
        </button>
        <h2 className="mb-4 text-lg font-semibold text-ink">{t("submit.page_title")}</h2>
        {session.data ? (
          <CommunityGuidelinesGate onCancel={close}>
            <SubmissionForm />
          </CommunityGuidelinesGate>
        ) : null}
      </div>
    </div>
  );
}
