import { Link, useParams } from "react-router";
import { Heart } from "lucide-react";
import { useTranslation } from "react-i18next";
import { isLocale, pickBilingual, type Locale } from "@ip/shared";
import { withLocale } from "../../lib/locale";
import { resolveImageUrl } from "../../lib/imageUrl";
import { useR2PoolMap } from "../../lib/hooks/useR2Pool";
import type { PromptDetailWithRelated } from "../../lib/hooks/usePromptDetail";

export default function RelatedRow({ items }: { items: PromptDetailWithRelated["related"] }) {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const { map } = useR2PoolMap();
  if (items.length === 0) return null;

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-dim">
        {t("detail.related")}
      </h2>
      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 xl:grid-cols-12">
        {items.map((r) => {
          const title = pickBilingual(r.title, locale) ?? r.slug;
          const imageUrl = resolveImageUrl(r.primaryImage, map);
          return (
            <Link
              key={r.id}
              to={withLocale(locale, `/prompts/${r.slug}`)}
              title={title}
              className="group relative block overflow-hidden rounded-md border border-border-soft bg-panel transition-colors hover:border-accent/40"
            >
              <div className="relative aspect-square w-full overflow-hidden bg-surface">
                <img
                  src={imageUrl}
                  alt={title}
                  loading="lazy"
                  width={r.primaryImage?.width ?? undefined}
                  height={r.primaryImage?.height ?? undefined}
                  className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                />
                {r.likeCount > 0 && (
                  <span className="absolute right-1 top-1 flex items-center gap-0.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] text-white">
                    <Heart size={8} aria-hidden /> {r.likeCount}
                  </span>
                )}
              </div>
              <div className="line-clamp-1 px-1.5 py-1 text-[10.5px] text-ink">
                {title}
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
