import { Link, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { isLocale, type Locale } from "@ip/shared";
import AppShell from "../components/layout/AppShell";
import { withLocale } from "../lib/locale";

export default function NotFoundPage() {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  return (
    <AppShell>
      <div className="mx-auto max-w-md px-6 py-24 text-center">
        <div className="text-[64px] font-semibold tracking-tight text-ink-dim">404</div>
        <h1 className="mt-2 text-[20px] font-semibold tracking-tight">
          {t("common.not_found_title")}
        </h1>
        <p className="mt-2 text-[13.5px] text-ink-muted">{t("common.not_found_body")}</p>
        <Link
          to={withLocale(locale, "/")}
          className="mt-6 inline-block rounded-pill bg-accent px-4 py-2 text-[13px] font-medium text-white hover:bg-accent-2"
        >
          {t("common.back_home")}
        </Link>
      </div>
    </AppShell>
  );
}
