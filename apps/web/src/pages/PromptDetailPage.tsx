import { useEffect, useState, type CSSProperties } from "react";
import { Link, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { isLocale, pickBilingual, type Locale } from "@ip/shared";
import AppShell from "../components/layout/AppShell";
import { usePromptDetail } from "../lib/hooks/usePromptDetail";
import { useView } from "../lib/hooks/useView";
import { useUserStats } from "../lib/hooks/useUserStats";
import { withLocale } from "../lib/locale";
import Gallery from "../components/PromptDetail/Gallery";
import PromptTextBlock from "../components/PromptDetail/PromptTextBlock";
import SuggestedParams from "../components/PromptDetail/SuggestedParams";
import RelatedRow from "../components/PromptDetail/RelatedRow";
import SendToStudioButton from "../components/PromptDetail/SendToStudioButton";
import CopyPromptButton from "../components/PromptDetail/CopyPromptButton";
import LikeButton from "../components/PromptDetail/LikeButton";
import FavoriteButton from "../components/PromptDetail/FavoriteButton";
import MoreMenu from "../components/PromptDetail/MoreMenu";
import Avatar from "../components/Avatar";
import StatsCard from "../components/profile/StatsCard";
import { Skeleton } from "../components/Skeleton";

export default function PromptDetailPage() {
  const { t } = useTranslation();
  const { slug, locale: param } = useParams<{ slug: string; locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const detail = usePromptDetail(slug);
  useView(detail.data?.id);
  const contributor = detail.data?.contributor ?? null;
  const uploaderStats = useUserStats(contributor?.id);

  // Track gallery wrapper height so the right-column aside can cap its
  // max-height to the gallery's bottom edge — only on the lg+ two-column
  // layout. Without this, when the gallery is shorter than the aside
  // content (e.g. single landscape image), the grid row stretches to
  // the aside's height and the left column shows empty space below the
  // image. Updated via ResizeObserver so it reacts to image load + window
  // resize. The matchMedia gate prevents the cap from kicking in on
  // mobile where the aside is stacked below and shouldn't be height-
  // limited.
  const [galleryEl, setGalleryEl] = useState<HTMLDivElement | null>(null);
  const [galleryHeight, setGalleryHeight] = useState<number | null>(null);
  const [isLgUp, setIsLgUp] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setIsLgUp(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!galleryEl) {
      setGalleryHeight(null);
      return;
    }
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) setGalleryHeight(e.contentRect.height);
    });
    ro.observe(galleryEl);
    return () => ro.disconnect();
  }, [galleryEl]);

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
  const visibleTags = (d.tags ?? []).filter((tag) => tag.slug !== "nsfw");
  // Lock the aside's height to the gallery's, so the functional column's
  // bottom always sits flush with the image's bottom. When aside content
  // is taller, it overflows into the internal scroll; when shorter, the
  // box still fills down to gallery bottom (avoids the "aside ends mid-
  // gallery" look). Capped at viewport-6rem so a tall portrait doesn't
  // push the aside past the screen.
  const asideStyle: CSSProperties | undefined =
    isLgUp && galleryHeight !== null
      ? {
          minHeight: `min(${galleryHeight}px, calc(100vh - 6rem))`,
          maxHeight: `min(${galleryHeight}px, calc(100vh - 6rem))`,
        }
      : undefined;

  return (
    <AppShell>
      <article className="w-full px-4 py-6 lg:px-6">
        {/* breadcrumb — the ← link points at the prompt's own category page
            (the user's most likely back destination). A secondary `Browse`
            link goes to the unfiltered listing for explicit fallback. */}
        <nav aria-label="breadcrumb" className="mb-4 text-[12.5px] text-ink-dim">
          <Link
            to={withLocale(locale, `/prompts?category=${d.category.slug}`)}
            className="hover:text-ink"
          >
            ← {pickBilingual(d.category.name, locale) ?? d.category.slug}
          </Link>
          <span className="mx-2">·</span>
          <Link to={withLocale(locale, "/prompts")} className="hover:text-ink">
            {t("nav.browse")}
          </Link>
        </nav>

        {/* main two-column grid; right column sticky */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_420px] xl:grid-cols-[minmax(0,1fr)_480px]">
          {/* LEFT column: gallery (includes its own multi-image thumb strip).
              `lg:self-start` prevents the wrapper from stretching to the
              grid row height — without it, the ResizeObserver below would
              read the stretched wrapper (≈ aside content height) instead
              of the gallery's natural height, defeating the cap. */}
          <div ref={setGalleryEl} className="min-w-0 lg:self-start">
            <Gallery images={d.images} title={title} />
          </div>

          {/* RIGHT column: title, meta, CTAs, params, prompts.
              The inline `maxHeight` from `asideStyle` caps the aside to the
              gallery's bottom edge so they bottom-align — see the
              ResizeObserver in the component body. Falls back to the
              Tailwind `lg:max-h-[calc(100vh-6rem)]` class on first paint
              before the observer reports. */}
          <aside
            style={asideStyle}
            className="flex flex-col gap-4 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:self-start lg:overflow-y-auto lg:pr-1"
          >
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
                {d.category?.slug === "nsfw" && (
                  <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-rose-300">
                    {t("nsfw.badge")}
                  </span>
                )}
                {visibleTags.map((tg) => (
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

            {contributor && (
              <div className="flex items-center gap-3 border-y border-border-soft py-3">
                <Link
                  to={withLocale(locale, `/users/${contributor.id}`)}
                  className="flex items-center gap-2 hover:underline"
                >
                  <Avatar
                    id={contributor.id}
                    name={contributor.name}
                    src={contributor.avatarUrl}
                    size={32}
                  />
                  <span className="text-sm font-medium text-ink">
                    {contributor.name ?? t("common.anonymous")}
                  </span>
                </Link>
                {uploaderStats.data && (
                  <div className="ml-auto">
                    <StatsCard stats={uploaderStats.data} variant="compact" />
                  </div>
                )}
              </div>
            )}

            {/* Send to Studio CTA — M3 wires it to /api/import-tokens + scheme launch. */}
            <SendToStudioButton
              promptId={d.id}
              payload={{
                prompt: d.prompt,
                ...(d.negativePrompt ? { negative_prompt: d.negativePrompt } : {}),
                ...(d.aspectRatio ? { aspect_ratio: d.aspectRatio } : {}),
              }}
            />

            {/* Action row — three primary buttons share the bulk of the
                row; the MoreMenu kebab sits as a small trailing affordance
                on the same line. Avoids the standalone 4th row that the
                previous layout produced. */}
            <div className="flex items-center gap-2 text-[12.5px]">
              <div className="min-w-0 flex-1">
                <CopyPromptButton prompt={d.prompt} />
              </div>
              <div className="min-w-0 flex-1">
                <LikeButton
                  promptId={d.id}
                  initial={{ liked: d.userLiked ?? false, count: d.likeCount }}
                  variant="full"
                />
              </div>
              <div className="min-w-0 flex-1">
                <FavoriteButton promptId={d.id} initial={{ favorited: d.userFavorited ?? false }} />
              </div>
              <MoreMenu
                promptId={d.id}
                slug={d.slug}
                {...(d.title.zh !== undefined ? { titleZh: d.title.zh } : {})}
                {...(d.title.en !== undefined ? { titleEn: d.title.en } : {})}
                {...(d.contributor?.id !== undefined
                  ? { contributorId: d.contributor.id }
                  : {})}
              />
            </div>

            <SuggestedParams aspect={d.aspectRatio} />

            <PromptTextBlock label={t("detail.prompt")} value={d.prompt} />
            {d.negativePrompt && (
              <PromptTextBlock
                label={t("detail.negative_prompt")}
                value={d.negativePrompt}
                zhKey="common.negative_prompt_zh"
                enKey="common.negative_prompt_en"
              />
            )}

            {/* Subtle source-attribution footer for prompts whose original
                content came from elsewhere (the import pipeline). Not shown
                on user submissions. The about page carries the full credits. */}
            {d.sourceSite && (
              <p className="text-[11px] text-ink-dim">
                {t("detail.source_credit", { site: d.sourceSite })}
                {d.sourceUrl && (
                  <>
                    {" "}
                    <a
                      href={d.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline-offset-2 hover:underline"
                    >
                      {t("detail.source_link")}
                    </a>
                  </>
                )}
              </p>
            )}
          </aside>
        </div>

        <RelatedRow items={d.related} />
      </article>
    </AppShell>
  );
}
