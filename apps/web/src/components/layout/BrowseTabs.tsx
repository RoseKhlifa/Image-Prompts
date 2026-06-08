import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useParams } from "react-router";
import { isLocale, type Locale } from "@ip/shared";
import { withLocale } from "../../lib/locale";

type Tab = "gallery" | "favorites" | "mine" | "about";

// All tabs are visible regardless of auth state. Favorites/mine target pages
// render a sign-in CTA in their empty state when the visitor isn't logged in
// — no SignInModal popup, just an explanatory inline message.
const TABS: { key: Tab; labelKey: string }[] = [
  { key: "gallery", labelKey: "home.tab_gallery" },
  { key: "favorites", labelKey: "home.tab_favorites" },
  { key: "mine", labelKey: "home.tab_mine" },
  { key: "about", labelKey: "home.tab_about" },
];

type Props = {
  /** "header" = inline pills (sits in AppShell header next to the logo);
   *  "strip"  = full-width strip with bottom border (sits below header). */
  variant?: "header" | "strip";
};

/**
 * Shared browse tabs. Rendered globally in AppShell header (variant="header")
 * so the tab control is consistent on every page.
 *
 * Navigation rules:
 *   - gallery   → stay on current `/zh/prompts` if we're there; otherwise go to `/zh/`. Drops `?tab=`.
 *   - favorites → `/zh/?tab=favorites` (HomePage owns the data mode)
 *   - mine      → `/zh/?tab=mine`     (same)
 *   - about     → `/zh/about` (the dedicated route)
 *
 * Active state is derived from current pathname + ?tab=.
 */
export default function BrowseTabs({ variant = "strip" }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";

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

  if (variant === "header") {
    return (
      <nav role="tablist" className="hidden gap-1 text-[15px] md:flex">
        {TABS.map((tt) => (
          <button
            key={tt.key}
            type="button"
            role="tab"
            aria-selected={active === tt.key}
            onClick={() => go(tt.key)}
            className={`rounded-pill px-4 py-2 font-medium transition ${
              active === tt.key
                ? "bg-accent-soft text-accent"
                : "text-ink-muted hover:text-ink"
            }`}
          >
            {t(tt.labelKey)}
          </button>
        ))}
      </nav>
    );
  }

  return (
    <div role="tablist" className="flex gap-4 border-b border-border-soft px-6">
      {TABS.map((tt) => (
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
      ))}
    </div>
  );
}
