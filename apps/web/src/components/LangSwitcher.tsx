import { useNavigate, useLocation, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { isLocale, LOCALES, type Locale } from "@ip/shared";
import { stripLocale, withLocale } from "../lib/locale";

export default function LangSwitcher() {
  const { t } = useTranslation();
  const { locale: paramLocale } = useParams<{ locale: string }>();
  const current: Locale = isLocale(paramLocale) ? paramLocale : "zh";
  const navigate = useNavigate();
  const location = useLocation();

  function switchTo(target: Locale) {
    if (target === current) return;
    const rest = stripLocale(location.pathname);
    navigate(withLocale(target, rest) + location.search + location.hash, { replace: false });
  }

  // Mobile: single button labelled with the OTHER locale (the one you'd
  // switch into). Tapping flips between zh / en. With only two locales this
  // is unambiguous and the most compact possible control.
  const other: Locale = current === "zh" ? "en" : "zh";

  return (
    <>
      {/* Mobile: single toggle. */}
      <button
        type="button"
        onClick={() => switchTo(other)}
        aria-label={t("common.language")}
        className="inline-flex h-9 w-9 items-center justify-center rounded-pill border border-border-soft bg-surface text-xs font-medium text-ink-muted hover:text-ink md:hidden"
      >
        {other === "zh" ? "中" : "EN"}
      </button>

      {/* Desktop: full pair. */}
      <div
        role="group"
        aria-label={t("common.language")}
        className="hidden rounded-pill border border-border-soft bg-surface p-0.5 text-xs md:inline-flex"
      >
        {LOCALES.map((loc) => (
          <button
            key={loc}
            type="button"
            aria-pressed={loc === current}
            onClick={() => switchTo(loc)}
            className={[
              "rounded-pill px-3 py-1 transition-colors",
              loc === current ? "bg-accent text-white" : "text-ink-muted hover:text-ink",
            ].join(" ")}
          >
            {loc === "zh" ? "中" : "EN"}
          </button>
        ))}
      </div>
    </>
  );
}
