import { useTranslation } from "react-i18next";
import { Link, useLocation, useParams } from "react-router";
import { isLocale, type Locale } from "@ip/shared";
import { withLocale } from "../../lib/locale";

const SEGMENT_LABELS: Record<string, string> = {
  rosekhlifa: "owner.nav.root",
  config: "owner.nav.config",
  r2: "owner.nav.r2",
  submissions: "owner.nav.submissions",
};

export default function OwnerTopbar() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";

  // /zh/rosekhlifa/config → ["rosekhlifa", "config"]
  const segments = pathname
    .replace(`/${locale}`, "")
    .split("/")
    .filter(Boolean);

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-zinc-800 bg-zinc-950/95 px-6 backdrop-blur">
      <nav className="flex items-center gap-2 text-sm text-zinc-400">
        {segments.map((s, i) => {
          const labelKey = SEGMENT_LABELS[s];
          const label = labelKey ? t(labelKey) : s;
          const isLast = i === segments.length - 1;
          if (isLast) return <span key={s} className="text-zinc-100">{label}</span>;
          return (
            <span key={s} className="flex items-center gap-2">
              <Link
                to={withLocale(locale, "/rosekhlifa")}
                className="hover:text-zinc-200"
              >
                {label}
              </Link>
              <span className="text-zinc-600">/</span>
            </span>
          );
        })}
      </nav>
      <div className="flex items-center gap-3">
        <span className="rounded-md bg-emerald-500/15 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-400">
          OWNER
        </span>
        <Link
          to={withLocale(locale, "/")}
          className="text-sm text-zinc-400 hover:text-zinc-200"
        >
          ← {t("owner.nav.back_to_site")}
        </Link>
      </div>
    </header>
  );
}
