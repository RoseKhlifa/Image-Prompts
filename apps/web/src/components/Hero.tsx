import { Link, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { isLocale, type Locale } from "@ip/shared";
import { withLocale } from "../lib/locale";
import { useStats } from "../lib/hooks/useStats";

export default function Hero() {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const stats = useStats();
  const count = stats.data?.publishedCount ?? 0;

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border-soft px-6 py-7">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">{t("home.hero_title")}</h1>
        <p className="mt-1.5 text-[13.5px] text-ink-muted">
          {t("home.published_subtitle", { formattedCount: count.toLocaleString() })}
        </p>
      </div>
      <Link
        to={withLocale(locale, "/prompts")}
        className="whitespace-nowrap rounded-pill bg-accent px-4 py-2 text-[13px] font-medium text-white hover:bg-accent-2"
      >
        {t("home.start_browsing")}
      </Link>
    </div>
  );
}
