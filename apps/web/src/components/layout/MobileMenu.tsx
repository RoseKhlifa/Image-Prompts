import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { Plus, X } from "lucide-react";
import { isLocale, type Locale } from "@ip/shared";
import { useUiStore } from "../../state/uiStore";
import { withLocale } from "../../lib/locale";
import BrowseTabs from "./BrowseTabs";
import { SidebarContent } from "./Sidebar";

/**
 * Slide-in drawer that surfaces everything the desktop layout hides below
 * the `md` breakpoint: search input, BrowseTabs, Submit CTA, categories,
 * tags and repo footer. Mounted unconditionally inside AppShell — the
 * `sidebarOpen` flag in uiStore toggles visibility, so we can render the
 * backdrop + panel with CSS transitions instead of mounting/unmounting.
 *
 * Auto-closes when:
 *   - the backdrop is tapped
 *   - the close button is pressed
 *   - ESC is pressed
 *   - any link inside the drawer is followed (passed as `onNavigate`)
 *   - the viewport crosses to `md` (handled by AppShell hiding the trigger)
 */
export default function MobileMenu() {
  const { t } = useTranslation();
  const open = useUiStore((s) => s.sidebarOpen);
  const closeSidebar = useUiStore((s) => s.closeSidebar);
  const openSubmitModal = useUiStore((s) => s.openSubmitModal);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [searchParams] = useSearchParams();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const [searchValue, setSearchValue] = useState(searchParams.get("q") ?? "");

  // Sync the input with the URL when navigating in/out of the drawer.
  useEffect(() => {
    setSearchValue(searchParams.get("q") ?? "");
  }, [searchParams]);

  // ESC to close.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeSidebar();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeSidebar]);

  // Lock body scroll while open so the page underneath doesn't ghost-scroll
  // when the user drags inside the drawer.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = searchValue.trim();
    const homePath = withLocale(locale, "/");
    const promptsPath = withLocale(locale, "/prompts");
    const isOnBrowsePage = pathname === homePath || pathname.startsWith(promptsPath);
    const targetPath = isOnBrowsePage ? pathname : homePath;
    const updated = new URLSearchParams(searchParams);
    if (trimmed) updated.set("q", trimmed);
    else updated.delete("q");
    const qs = updated.toString();
    navigate(qs ? `${targetPath}?${qs}` : targetPath);
    closeSidebar();
  }

  function openSubmitFromMenu() {
    closeSidebar();
    openSubmitModal();
  }

  const drawer = (
    <div
      aria-hidden={!open}
      className={[
        "fixed inset-0 z-40 md:hidden",
        open ? "pointer-events-auto" : "pointer-events-none",
      ].join(" ")}
    >
      {/* Backdrop. */}
      <button
        type="button"
        tabIndex={open ? 0 : -1}
        aria-label={t("common.close")}
        onClick={closeSidebar}
        className={[
          "absolute inset-0 h-full w-full bg-black/50 transition-opacity",
          open ? "opacity-100" : "opacity-0",
        ].join(" ")}
      />

      {/* Panel. */}
      <aside
        className={[
          "absolute inset-y-0 left-0 flex h-dvh w-[86%] max-w-[340px] flex-col border-r border-border-soft bg-panel-2 shadow-2xl transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
        role="dialog"
        aria-modal="true"
      >
        {/* Top bar: close button. */}
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border-soft px-4">
          <span className="text-sm font-semibold tracking-tight">Image-Prompts</span>
          <button
            type="button"
            onClick={closeSidebar}
            aria-label={t("common.close")}
            className="inline-flex h-9 w-9 items-center justify-center rounded-pill text-ink-muted hover:bg-surface hover:text-ink"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        {/* Scrollable body. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {/* Search. */}
          <div className="shrink-0 px-3 pt-3 pb-2">
            <form onSubmit={submitSearch}>
              <input
                type="search"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                placeholder={t("common.search_placeholder")}
                className="h-10 w-full rounded-pill border border-border-soft bg-surface px-4 text-sm text-ink placeholder:text-ink-dim focus:outline-none focus:ring-2 focus:ring-accent-soft"
              />
            </form>
          </div>

          {/* BrowseTabs. */}
          <div className="shrink-0 py-2">
            <BrowseTabs variant="drawer" onNavigate={closeSidebar} />
          </div>

          {/* Submit CTA. */}
          <div className="shrink-0 px-3 pb-2">
            <button
              type="button"
              onClick={openSubmitFromMenu}
              className="inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-pill bg-accent px-4 text-sm font-medium text-white hover:bg-accent-2"
            >
              <Plus size={16} aria-hidden />
              {t("nav.submit")}
            </button>
          </div>

          {/* Sidebar content (categories + tags + repo footer). The flex-1
              inner div needs to stay scrollable within this outer scroll
              container — it nests its own min-h-0 + overflow-y-auto. */}
          <div className="flex min-h-0 flex-1 flex-col border-t border-border-soft">
            <SidebarContent onNavigate={closeSidebar} />
          </div>
        </div>
      </aside>
    </div>
  );

  // Portal to body so the drawer can escape any z-index / overflow context
  // from the page it was triggered on (e.g. PromptDetailPage's sticky aside).
  if (typeof document === "undefined") return null;
  return createPortal(drawer, document.body);
}
