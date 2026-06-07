import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import { useEffect } from "react";
import { isLocale, type Locale } from "@ip/shared";
import AppShell from "../components/layout/AppShell";
import AvatarBadge from "../components/auth/AvatarBadge";
import { useSession, useInvalidateSession } from "../lib/hooks/useSession";
import { signOut } from "../lib/auth";
import { toast } from "../lib/toast";
import { withLocale } from "../lib/locale";

export default function ProfilePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const session = useSession();
  const invalidate = useInvalidateSession();

  // Redirect guests home.
  useEffect(() => {
    if (!session.isLoading && !session.data) {
      navigate(withLocale(locale, "/"), { replace: true });
    }
  }, [session.isLoading, session.data, navigate, locale]);

  async function handleSignOut() {
    await signOut();
    await invalidate();
    toast.info(t("auth.sign_out"));
    navigate(withLocale(locale, "/"), { replace: true });
  }

  if (session.isLoading || !session.data) {
    return (
      <AppShell>
        <div className="mx-auto max-w-md px-6 py-12 text-center text-ink-dim">
          {t("common.loading")}
        </div>
      </AppShell>
    );
  }

  const u = session.data.user;

  return (
    <AppShell>
      <article className="mx-auto w-full max-w-md px-6 py-12">
        <h1 className="mb-6 text-xl font-semibold tracking-tight">{t("profile.page_title")}</h1>
        <div className="flex flex-col items-center gap-4 rounded-card border border-border-soft bg-panel p-8">
          <AvatarBadge src={u.image} name={u.name} email={u.email} size={72} />
          {u.name && <div className="text-base font-medium">{u.name}</div>}
          <div className="text-[13px] text-ink-muted">{u.email}</div>
          <button
            type="button"
            onClick={handleSignOut}
            className="mt-4 rounded-pill border border-border-soft bg-surface px-5 py-2 text-[13px] font-medium text-ink hover:bg-panel-2"
          >
            {t("profile.sign_out_button")}
          </button>
        </div>
      </article>
    </AppShell>
  );
}
