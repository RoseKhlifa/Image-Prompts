import { useEffect } from "react";
import { Outlet, useParams } from "react-router";
import { isLocale, type Locale } from "@ip/shared";
import { LOCALE_STORAGE_KEY } from "../lib/locale";
import { changeLanguage } from "../i18n/index";

/**
 * Parent route for all /:locale/... routes.
 * Validates the locale segment and keeps i18next + <html lang> in sync.
 */
export default function LocaleLayout() {
  const { locale } = useParams<{ locale: string }>();
  const safeLocale: Locale = isLocale(locale) ? locale : "zh";

  useEffect(() => {
    void changeLanguage(safeLocale);
    document.documentElement.lang = safeLocale === "zh" ? "zh-Hans" : "en";
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, safeLocale);
    } catch {
      // ignore
    }
  }, [safeLocale]);

  if (!isLocale(locale)) {
    // Unknown locale prefix → bounce to default
    return null; // a future <Navigate> would loop with LocaleRedirect; this branch normally never renders
  }

  return <Outlet />;
}
