import { Link, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Heart, Send } from "lucide-react";
import { isLocale, pickBilingual, type Locale } from "@ip/shared";
import AppShell from "../components/layout/AppShell";
import { usePromptDetail } from "../lib/hooks/usePromptDetail";
import { withLocale } from "../lib/locale";
import Gallery from "../components/PromptDetail/Gallery";
import PromptTextBlock from "../components/PromptDetail/PromptTextBlock";
import SuggestedParams from "../components/PromptDetail/SuggestedParams";
import RelatedRow from "../components/PromptDetail/RelatedRow";
import { Skeleton } from "../components/Skeleton";

export default function PromptDetailPage() {
  const { t } = useTranslation();
  const { slug, locale: param } = useParams<{ slug: string; locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const detail = usePromptDetail(slug);

  if (detail.isLoading) {
    return (
      <AppShell>
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 p-6 lg:grid-cols-[1.4fr_1fr]">
          <Skeleton className="aspect-[3/2] w-full rounded-card" />
          <div className="space-y-4">
            <Skeleton className="h-7 w-3/4 rounded-md" />
            <Skeleton className="h-4 w-1/2 rounded-md" />
            <Skeleton className="h-24 w-full rounded-card" />
          </div>
        </div>
      </AppShell>
    );
  }

  if (detail.isError || !detail.data) {
    return (
      <AppShell>
        <div className="mx-auto max-w-2xl px-6 py-16 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">{t("common.not_found_title")}</h1>
          <p className="mt-2 text-ink-muted">{t("common.not_found_body")}</p>
          <Link
            to={withLocale(locale, "/prompts")}
            className="mt-6 inline-block rounded-pill bg-accent px-4 py-2 text-[13px] font-medium text-white"
          >
            {t("common.back_home")}
          </Link>
        </div>
      </AppShell>
    );
  }

  const d = detail.data;
  const title = pickBilingual(d.title, locale) ?? d.slug;

  return (
    <AppShell>
      <article className="w-full px-4 py-6 lg:px-6">
        {/* breadcrumb */}
        <nav aria-label="breadcrumb" className="mb-4 text-[12.5px] text-ink-dim">
          <Link to={withLocale(locale, "/prompts")} className="hover:text-ink">
            ← {t("nav.browse")}
          </Link>
          <span className="mx-2">·</span>
          <span>{pickBilingual(d.category.name, locale) ?? d.category.slug}</span>
        </nav>

        {/* main two-column grid; right column sticky */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_420px] xl:grid-cols-[minmax(0,1fr)_480px]">
          {/* LEFT column: gallery (includes its own multi-image thumb strip) */}
          <div className="min-w-0">
            <Gallery images={d.images} title={title} />
          </div>

          {/* RIGHT column: title, meta, CTAs, params, prompts */}
          <aside className="flex flex-col gap-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto lg:pr-1">
            <div>
              <h1 className="text-[24px] font-semibold leading-tight tracking-tight text-ink">
                {title}
              </h1>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px]">
                <Link
                  to={withLocale(locale, `/prompts?category=${d.category.slug}`)}
                  className="rounded-pill bg-accent-soft px-2.5 py-0.5 text-accent"
                >
                  📁 {pickBilingual(d.category.name, locale) ?? d.category.slug}
                </Link>
                {d.tags.map((tg) => (
                  <Link
                    key={tg.slug}
                    to={withLocale(locale, `/prompts?tag=${tg.slug}`)}
                    className="rounded-pill border border-border-soft bg-surface px-2.5 py-0.5 text-ink-muted hover:text-ink"
                  >
                    #{pickBilingual(tg.name, locale) ?? tg.slug}
                  </Link>
                ))}
              </div>
            </div>

            {/* Send to Studio CTA — M2 wires it. M1 button is disabled-but-visible placeholder. */}
            <button
              type="button"
              disabled
              title={t("detail.coming_in_m2")}
              className="inline-flex items-center justify-center gap-2 rounded-pill bg-accent px-4 py-2.5 text-[13px] font-medium text-white opacity-60"
            >
              <Send size={14} aria-hidden />
              {t("detail.send_to_studio")}
            </button>

            <div className="grid grid-cols-3 gap-2 text-[12.5px]">
              <button
                type="button"
                disabled
                title={t("detail.coming_in_m2")}
                className="rounded-pill border border-border-soft bg-surface px-3 py-2 text-ink-muted opacity-60"
              >
                {t("detail.copy_prompt")}
              </button>
              <button
                type="button"
                disabled
                title={t("detail.coming_in_m2")}
                className="inline-flex items-center justify-center gap-1.5 rounded-pill border border-border-soft bg-surface px-3 py-2 text-ink-muted opacity-60"
              >
                <Heart size={12} aria-hidden /> {t("detail.favorite")}
              </button>
              <button
                type="button"
                disabled
                title={t("detail.coming_in_m2")}
                className="rounded-pill border border-border-soft bg-surface px-3 py-2 text-ink-muted opacity-60"
              >
                {t("detail.more")}
              </button>
            </div>

            <SuggestedParams aspect={d.aspectRatio} />

            <PromptTextBlock label={t("detail.prompt")} value={d.prompt} />
            {d.negativePrompt && (
              <PromptTextBlock label={t("detail.negative_prompt")} value={d.negativePrompt} />
            )}
          </aside>
        </div>

        <RelatedRow items={d.related} />
      </article>
    </AppShell>
  );
}
