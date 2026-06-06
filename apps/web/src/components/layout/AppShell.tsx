import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { isLocale, type Locale } from "@ip/shared";
import LangSwitcher from "../LangSwitcher";
import ThemeSwitcher from "../ThemeSwitcher";
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

  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-ink">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-border-soft bg-panel-2/85 px-5 py-3 backdrop-blur">
        <div className="flex items-center gap-6">
          <Link to={withLocale(locale, "/")} className="text-base font-semibold tracking-tight">
            Image-Prompts
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
            placeholder={t("common.search_placeholder")}
            className="hidden h-8 w-56 rounded-pill border border-border-soft bg-surface px-3 text-xs text-ink placeholder:text-ink-dim focus:outline-none focus:ring-2 focus:ring-accent-soft md:block"
          />
          <ThemeSwitcher />
          <LangSwitcher />
        </div>
      </header>
      <div className="flex flex-1">
        {sidebar}
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
