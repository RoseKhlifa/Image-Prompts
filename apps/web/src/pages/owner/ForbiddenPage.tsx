import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { isLocale, type Locale } from "@ip/shared";
import { withLocale } from "../../lib/locale";

export default function ForbiddenPage() {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  return (
    <div className="flex min-h-dvh items-center justify-center bg-zinc-950 text-zinc-100">
      <div className="text-center">
        <div className="text-6xl font-bold text-emerald-500">403</div>
        <div className="mt-4 text-xl">{t("owner.forbidden_title")}</div>
        <div className="mt-2 text-sm text-zinc-400">{t("owner.forbidden_body")}</div>
        <Link
          to={withLocale(locale, "/")}
          className="mt-6 inline-block rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400"
        >
          {t("owner.forbidden_back")}
        </Link>
      </div>
    </div>
  );
}
