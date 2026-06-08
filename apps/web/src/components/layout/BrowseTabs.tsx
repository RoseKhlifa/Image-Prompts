import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useParams } from "react-router";
import { isLocale, type Locale } from "@ip/shared";
import { useSession } from "../../lib/hooks/useSession";
import { withLocale } from "../../lib/locale";

type Tab = "gallery" | "favorites" | "mine" | "about";

const TABS: { key: Tab; labelKey: string; needsAuth: boolean }[] = [
  { key: "gallery", labelKey: "home.tab_gallery", needsAuth: false },
  { key: "favorites", labelKey: "home.tab_favorites", needsAuth: true },
  { key: "mine", labelKey: "home.tab_mine", needsAuth: true },
  { key: "about", labelKey: "home.tab_about", needsAuth: false },
];

/**
 * Shared browse-tab strip. Rendered on HomePage, PromptListPage, AboutPage
 * so the tab control is consistent everywhere.
 *
 * Navigation rules:
 *   - gallery   → stay on current `/zh/prompts` if we're there; otherwise go to `/zh/`. Drops `?tab=`.
 *   - favorites → `/zh/?tab=favorites` (HomePage owns the data mode)
 *   - mine      → `/zh/?tab=mine`     (same)
 *   - about     → `/zh/about` (the dedicated route)
 *
 * Active state is derived from current pathname + ?tab=, so the visual
 * highlight stays in sync regardless of which page renders the strip.
 */
export default function BrowseTabs() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const session = useSession();
  const userId = (session.data?.user as { id?: string } | undefined)?.id;

  const params = new URLSearchParams(search);
  const tabParam = params.get("tab");
  const aboutPath = withLocale(locale, "/about");
  const isAbout = pathname === aboutPath || pathname === `${aboutPath}/`;
  const isPromptList = pathname.startsWith(withLocale(locale, "/prompts"));

  const active: Tab = isAbout
    ? "about"
    : tabParam === "favorites"
      ? "favorites"
      : tabParam === "mine"
        ? "mine"
        : "gallery";

  function go(key: Tab) {
    if (key === "about") {
      navigate(withLocale(locale, "/about"));
      return;
    }
    if (key === "gallery") {
      // Stay on /prompts if we're there; otherwise go home. Drop ?tab=.
      const target = isPromptList ? pathname : withLocale(locale, "/");
      const next = new URLSearchParams(search);
      next.delete("tab");
      const qs = next.toString();
      navigate(qs ? `${target}?${qs}` : target);
      return;
    }
    // favorites / mine — these data modes only live on HomePage.
    navigate(`${withLocale(locale, "/")}?tab=${key}`);
  }

  return (
    <div role="tablist" className="flex gap-4 border-b border-border-soft px-6">
      {TABS.map((tt) => {
        if (tt.needsAuth && !userId) return null;
        return (
          <button
            key={tt.key}
            type="button"
            role="tab"
            aria-selected={active === tt.key}
            onClick={() => go(tt.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition ${
              active === tt.key
                ? "border-accent text-ink"
                : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {t(tt.labelKey)}
          </button>
        );
      })}
    </div>
  );
}
