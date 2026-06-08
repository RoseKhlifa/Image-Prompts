import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { ArrowRight } from "lucide-react";
import { isLocale, type Locale } from "@ip/shared";
import { withLocale } from "../../lib/locale";

export default function SubmissionsBridgePage() {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  return (
    <div>
      <h1 className="text-2xl font-semibold">{t("owner.submissions.title")}</h1>
      <p className="mt-1 text-sm text-zinc-400">{t("owner.submissions.subtitle")}</p>
      <Link
        to={withLocale(locale, "/admin/submissions")}
        className="mt-6 inline-flex items-center gap-2 rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400"
      >
        {t("owner.submissions.go")}
        <ArrowRight size={16} aria-hidden />
      </Link>
    </div>
  );
}
