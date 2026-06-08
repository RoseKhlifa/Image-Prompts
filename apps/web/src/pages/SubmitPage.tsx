import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import { isLocale, type Locale } from "@ip/shared";
import AppShell from "../components/layout/AppShell";
import CommunityGuidelinesGate from "../components/submit/CommunityGuidelinesGate";
import SubmissionForm from "../components/submit/SubmissionForm";
import SignInModal from "../components/auth/SignInModal";
import { useSession } from "../lib/hooks/useSession";
import { withLocale } from "../lib/locale";

/**
 * /:locale/submit. Two gates wrap the form:
 *   1. Sign-in modal — opens automatically when the session is null after
 *      loading; if the user dismisses without signing in we bounce home.
 *   2. CommunityGuidelinesGate — shows the guidelines modal whenever the
 *      authenticated user's accepted version is < the current required.
 *
 * The SubmissionForm itself only renders for authed users; the gate handles
 * the rest. We keep both gates in this page (rather than inside the form) so
 * the form stays a pure, testable rendering of the schema's shape.
 */
export default function SubmitPage() {
  const { t } = useTranslation();
  const session = useSession();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const navigate = useNavigate();
  const [showSignIn, setShowSignIn] = useState(false);

  useEffect(() => {
    if (!session.isLoading && !session.data) setShowSignIn(true);
  }, [session.isLoading, session.data]);

  return (
    <AppShell>
      <article className="mx-auto w-full max-w-3xl px-6 py-8">
        <h1 className="mb-6 text-2xl font-semibold text-ink">
          {t("submit.page_title")}
        </h1>
        {session.data ? (
          <CommunityGuidelinesGate
            onCancel={() => navigate(withLocale(locale, "/"))}
          >
            <SubmissionForm />
          </CommunityGuidelinesGate>
        ) : null}
        <SignInModal
          open={showSignIn}
          onClose={() => {
            setShowSignIn(false);
            if (!session.data) navigate(withLocale(locale, "/"));
          }}
        />
      </article>
    </AppShell>
  );
}
