import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { Menu, Plus } from "lucide-react";
import { isLocale, type Locale } from "@ip/shared";
import LangSwitcher from "../LangSwitcher";
import ThemeSwitcher from "../ThemeSwitcher";
import SignInButton from "../auth/SignInButton";
import ProfileMenu from "../auth/ProfileMenu";
import BrandLogo from "../BrandLogo";
import BrowseTabs from "./BrowseTabs";
import MobileMenu from "./MobileMenu";
import AnnouncementsBanner from "./AnnouncementsBanner";
import AnnouncementsPopup from "./AnnouncementsPopup";
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
  const openSidebar = useUiStore((s) => s.openSidebar);
  const closeSidebar = useUiStore((s) => s.closeSidebar);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const [searchValue, setSearchValue] = useState(searchParams.get("q") ?? "");

  // Drawer is mobile-only; if the viewport crosses to `md` while it's open,
  // close it so the user doesn't see a stuck-open state if they shrink it
  // back to mobile later.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 768px)");
    const sync = () => {
      if (mq.matches) closeSidebar();
    };
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [closeSidebar]);

  // Pull external URL changes into the input (back/forward, link clicks).
  useEffect(() => {
    setSearchValue(searchParams.get("q") ?? "");
  }, [searchParams]);

  // Debounced live search: 300ms after the last keystroke, sync ?q= to the
  // URL. If user is on a browse page (/ or /prompts), update in place; else
  // (e.g. typing a fresh query while on /profile or /users/:id) jump home so
  // they see results.
  //
  // Critical: only navigate when the user actually changed the query. The
  // earlier `trimmed === currentQ && pathname === targetPath` check looked
  // sufficient but bounced anyone visiting a non-browse page with no query
  // back to home — because targetPath collapses to homePath off the browse
  // pages, so pathname always disagreed even when the search input was
  // empty. That manifested as a "page flashes then disappears" bug on
  // /profile, /admin/submissions, /users/:id, etc.
  useEffect(() => {
    const homePath = withLocale(locale, "/");
    const promptsPath = withLocale(locale, "/prompts");
    const isOnBrowsePage = pathname === homePath || pathname.startsWith(promptsPath);
    const targetPath = isOnBrowsePage ? pathname : homePath;
    const handler = setTimeout(() => {
      const trimmed = searchValue.trim();
      const currentQ = searchParams.get("q") ?? "";
      // Nothing changed about the query — stay put, even if pathname differs
      // from targetPath (we're not auto-redirecting users who happen to be
      // on a non-browse page with an empty search box).
      if (trimmed === currentQ) return;
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
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-2 border-b border-border-soft bg-panel-2/85 px-3 backdrop-blur md:gap-4 md:px-6">
        <div className="flex min-w-0 items-center gap-2 md:gap-6">
          {/* Mobile hamburger — exposes the drawer that hosts search,
              BrowseTabs, Submit, and the categories/tags sidebar. */}
          <button
            type="button"
            onClick={openSidebar}
            aria-label={t("common.open_menu")}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-pill text-ink-muted hover:bg-surface hover:text-ink md:hidden"
          >
            <Menu size={20} aria-hidden />
          </button>
          <Link
            to={withLocale(locale, "/")}
            className="inline-flex min-w-0 items-center gap-2.5"
            aria-label="Image-Prompts"
          >
            <BrandLogo size={32} />
            <div className="flex min-w-0 flex-col leading-tight">
              <span className="truncate text-base font-semibold tracking-tight md:text-lg">
                Image-Prompts
              </span>
              {/* Subtitle eats two precious lines on mobile — desktop only. */}
              <span className="hidden text-[11px] text-ink-muted md:inline">
                {t("home.published_subtitle", { formattedCount: publishedCount.toLocaleString() })}
              </span>
            </div>
          </Link>
          <BrowseTabs variant="header" />
        </div>
        <div className="flex items-center gap-2.5">
          <input
            type="search"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder={t("common.search_placeholder")}
            className="hidden h-9 w-64 rounded-pill border border-border-soft bg-surface px-3.5 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:ring-2 focus:ring-accent-soft md:block"
          />
          <button
            type="button"
            onClick={openSubmitModal}
            className="hidden h-9 items-center gap-1.5 rounded-pill bg-accent px-3.5 text-sm font-medium text-white hover:bg-accent-2 md:inline-flex"
            aria-label={t("nav.submit")}
          >
            <Plus size={16} aria-hidden />
            {t("nav.submit")}
          </button>
          <ThemeSwitcher />
          <LangSwitcher />
          {session.data ? <NotificationsBell /> : null}
          {session.isLoading ? (
            <div className="h-8 w-8 animate-pulse rounded-full bg-panel" />
          ) : session.data ? (
            <ProfileMenu session={session.data} />
          ) : (
            <SignInButton />
          )}
        </div>
      </header>
      <AnnouncementsBanner />
      <AnnouncementsPopup />
      {topBar}
      <div className="flex flex-1">
        {sidebar}
        <main className="min-w-0 flex-1">{children}</main>
      </div>
      <SubmitModal />
      <MobileMenu />
    </div>
  );
}
