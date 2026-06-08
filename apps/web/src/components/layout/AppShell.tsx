import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { Plus } from "lucide-react";
import { isLocale, type Locale } from "@ip/shared";
import LangSwitcher from "../LangSwitcher";
import ThemeSwitcher from "../ThemeSwitcher";
import SignInButton from "../auth/SignInButton";
import ProfileMenu from "../auth/ProfileMenu";
import BrandLogo from "../BrandLogo";
import NotificationsBell from "../notifications/NotificationsBell";
import SubmitModal from "../submit/SubmitModal";
import { useSession } from "../../lib/hooks/useSession";
import { useUiStore } from "../../state/uiStore";
import { withLocale } from "../../lib/locale";

export default function AppShell({
  children,
  sidebar,
}: {
  children: ReactNode;
  sidebar?: ReactNode;
}) {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const session = useSession();
  const openSubmitModal = useUiStore((s) => s.openSubmitModal);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [searchValue, setSearchValue] = useState(searchParams.get("q") ?? "");

  useEffect(() => {
    setSearchValue(searchParams.get("q") ?? "");
  }, [searchParams]);

  function submitSearch(value: string) {
    const trimmed = value.trim();
    const updated = new URLSearchParams(searchParams);
    if (trimmed) updated.set("q", trimmed);
    else updated.delete("q");
    navigate({ pathname: withLocale(locale, "/"), search: `?${updated.toString()}` });
  }

  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-ink">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-border-soft bg-panel-2/85 px-5 py-3 backdrop-blur">
        <div className="flex items-center gap-6">
          <Link
            to={withLocale(locale, "/")}
            className="inline-flex items-center gap-2"
            aria-label="Image-Prompts"
          >
            <BrandLogo size={22} />
            <span className="text-base font-semibold tracking-tight">Image-Prompts</span>
          </Link>
          <nav className="hidden gap-1 text-sm md:flex">
            <Link
              to={withLocale(locale, "/prompts")}
              className="rounded-pill px-3 py-1.5 text-ink-muted hover:text-ink"
            >
              {t("nav.browse")}
            </Link>
            <Link
              to={withLocale(locale, "/about")}
              className="rounded-pill px-3 py-1.5 text-ink-muted hover:text-ink"
            >
              {t("nav.about")}
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitSearch(searchValue);
            }}
            placeholder={t("common.search_placeholder")}
            className="hidden h-8 w-56 rounded-pill border border-border-soft bg-surface px-3 text-xs text-ink placeholder:text-ink-dim focus:outline-none focus:ring-2 focus:ring-accent-soft md:block"
          />
          <button
            type="button"
            onClick={openSubmitModal}
            className="hidden h-8 items-center gap-1 rounded-pill bg-accent px-3 text-xs font-medium text-white hover:bg-accent-2 md:inline-flex"
            aria-label={t("nav.submit")}
          >
            <Plus size={14} aria-hidden />
            {t("nav.submit")}
          </button>
          <ThemeSwitcher />
          <LangSwitcher />
          {session.data ? <NotificationsBell /> : null}
          {session.isLoading ? (
            <div className="h-7 w-7 animate-pulse rounded-full bg-panel" />
          ) : session.data ? (
            <ProfileMenu session={session.data} />
          ) : (
            <SignInButton />
          )}
        </div>
      </header>
      <div className="flex flex-1">
        {sidebar}
        <main className="min-w-0 flex-1">{children}</main>
      </div>
      <SubmitModal />
    </div>
  );
}
