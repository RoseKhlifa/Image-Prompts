import { Link, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { isLocale, pickBilingual, type Locale } from "@ip/shared";
import { withLocale } from "../../lib/locale";
import type { PromptDetailWithRelated } from "../../lib/hooks/usePromptDetail";

export default function RelatedRow({ items }: { items: PromptDetailWithRelated["related"] }) {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  if (items.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-ink-dim">
        {t("detail.related")}
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {items.map((r) => (
          <Link
            key={r.id}
            to={withLocale(locale, `/prompts/${r.slug}`)}
            className="block rounded-card border border-border-soft bg-panel p-3 hover:border-accent/40"
          >
            <div className="line-clamp-2 text-[12.5px] font-medium text-ink">
              {pickBilingual(r.title, locale) ?? r.slug}
            </div>
            <div className="mt-1 text-[11px] text-ink-dim">♡ {r.likeCount}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}
