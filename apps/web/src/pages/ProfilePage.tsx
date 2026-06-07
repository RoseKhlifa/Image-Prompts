import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useEffect, type ReactNode } from "react";
import { isLocale, type Locale } from "@ip/shared";
import AppShell from "../components/layout/AppShell";
import ProfileInfoTab from "../components/profile/ProfileInfoTab";
import FavoritesTab from "../components/profile/FavoritesTab";
import { useSession } from "../lib/hooks/useSession";
import { withLocale } from "../lib/locale";

type TabKey = "profile" | "favorites";

function readTab(v: string | null): TabKey {
  return v === "favorites" ? "favorites" : "profile";
}

export default function ProfilePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const session = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = readTab(searchParams.get("tab"));

  useEffect(() => {
    if (!session.isLoading && !session.data) {
      navigate(withLocale(locale, "/"), { replace: true });
    }
  }, [session.isLoading, session.data, navigate, locale]);

  function setTab(next: TabKey) {
    const updated = new URLSearchParams(searchParams);
    if (next === "profile") updated.delete("tab");
    else updated.set("tab", "favorites");
    setSearchParams(updated);
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

  return (
    <AppShell>
      <article className="mx-auto w-full max-w-5xl px-6 py-8">
        <h1 className="mb-4 text-xl font-semibold tracking-tight">{t("profile.page_title")}</h1>

        <div role="tablist" className="mb-6 flex gap-4 border-b border-border-soft">
          <TabButton active={tab === "profile"} onClick={() => setTab("profile")}>
            {t("profile.tab_profile")}
          </TabButton>
          <TabButton active={tab === "favorites"} onClick={() => setTab("favorites")}>
            {t("profile.tab_favorites")}
          </TabButton>
        </div>

        {tab === "profile" ? <ProfileInfoTab session={session.data} /> : <FavoritesTab />}
      </article>
    </AppShell>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 pb-2 text-[13px] font-medium transition ${
        active ? "border-accent text-ink" : "border-transparent text-ink-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
