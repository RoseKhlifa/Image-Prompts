import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { Plus } from "lucide-react";
import { isLocale, type Locale } from "@ip/shared";
import LangSwitcher from "../LangSwitcher";
import ThemeSwitcher from "../ThemeSwitcher";
import SignInButton from "../auth/SignInButton";
import ProfileMenu from "../auth/ProfileMenu";
import BrandLogo from "../BrandLogo";
import BrowseTabs from "./BrowseTabs";
import NotificationsBell from "../notifications/NotificationsBell";
import SubmitModal from "../submit/SubmitModal";
import { useSession } from "../../lib/hooks/useSession";
import { useStats } from "../../lib/hooks/useStats";
import { useUiStore } from "../../state/uiStore";
import { withLocale } from "../../lib/locale";

export default function AppShell({
  children,
  sidebar,
  topBar,
}: {
  children: ReactNode;
  sidebar?: ReactNode;
  /** Full-width strip rendered below the header, above the sidebar/main split.
   *  Used for Hero + BrowseTabs so they span the page. */
  topBar?: ReactNode;
}) {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const session = useSession();
  const stats = useStats();
  const publishedCount = stats.data?.publishedCount ?? 0;
  const openSubmitModal = useUiStore((s) => s.openSubmitModal);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const [searchValue, setSearchValue] = useState(searchParams.get("q") ?? "");

  // Pull external URL changes into the input (back/forward, link clicks).
  useEffect(() => {
    setSearchValue(searchParams.get("q") ?? "");
  }, [searchParams]);

  // Debounced live search: 300ms after the last keystroke, sync ?q= to the
  // URL. If user is on a browse page (/ or /prompts), update in place; else
  // jump to home so they see results. Skipping the navigate when value is
  // already in sync prevents a feedback loop with the URL→state effect above.
  useEffect(() => {
    const homePath = withLocale(locale, "/");
    const promptsPath = withLocale(locale, "/prompts");
    const isOnBrowsePage = pathname === homePath || pathname.startsWith(promptsPath);
    const targetPath = isOnBrowsePage ? pathname : homePath;
    const handler = setTimeout(() => {
      const trimmed = searchValue.trim();
      const currentQ = searchParams.get("q") ?? "";
      if (trimmed === currentQ && pathname === targetPath) return;
      const updated = new URLSearchParams(searchParams);
      if (trimmed) updated.set("q", trimmed);
      else updated.delete("q");
      const qs = updated.toString();
      navigate(qs ? `${targetPath}?${qs}` : targetPath);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchValue, searchParams, navigate, locale, pathname]);

  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-ink">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-border-soft bg-panel-2/85 px-5 py-3 backdrop-blur">
        <div className="flex items-center gap-6">
          <Link
            to={withLocale(locale, "/")}
            className="inline-flex items-center gap-2"
            aria-label="Image-Prompts"
          >
            <BrandLogo size={28} />
            <div className="flex flex-col leading-tight">
              <span className="text-base font-semibold tracking-tight">Image-Prompts</span>
              <span className="text-[10px] text-ink-muted">
                {t("home.published_subtitle", { formattedCount: publishedCount.toLocaleString() })}
              </span>
            </div>
          </Link>
          <BrowseTabs variant="header" />
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
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
      {topBar}
      <div className="flex flex-1">
        {sidebar}
        <main className="min-w-0 flex-1">{children}</main>
      </div>
      <SubmitModal />
    </div>
  );
}
