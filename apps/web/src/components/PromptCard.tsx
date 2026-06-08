import { Link, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { isLocale, pickBilingual, type Locale, type PromptSummary } from "@ip/shared";
import { resolveImageUrl } from "../lib/imageUrl";
import { useR2PoolMap } from "../lib/hooks/useR2Pool";
import { withLocale } from "../lib/locale";
import Avatar from "./Avatar";
import LikeButton from "./PromptDetail/LikeButton";

export default function PromptCard({ prompt }: { prompt: PromptSummary }) {
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const { map } = useR2PoolMap();
  const { t } = useTranslation();
  const title = pickBilingual(prompt.title, locale) ?? prompt.slug;
  const imageUrl = resolveImageUrl(prompt.primaryImage, map);

  return (
    <Link
      to={withLocale(locale, `/prompts/${prompt.slug}`)}
      className="group relative block overflow-hidden rounded-md border border-border-soft bg-panel transition-colors hover:border-accent/40"
    >
      <img
        src={imageUrl}
        alt={title}
        loading="lazy"
        className="block h-auto w-full"
        width={prompt.primaryImage?.width ?? undefined}
        height={prompt.primaryImage?.height ?? undefined}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100">
        <div className="flex items-center justify-between text-xs text-white">
          {prompt.contributor ? (
            <Link
              to={withLocale(locale, `/users/${prompt.contributor.id}`)}
              onClick={(e) => e.stopPropagation()}
              className="pointer-events-auto flex items-center gap-1.5 hover:underline"
            >
              <Avatar
                id={prompt.contributor.id}
                name={prompt.contributor.name}
                src={prompt.contributor.avatarUrl}
                size={24}
              />
              <span className="line-clamp-1">
                {prompt.contributor.name ?? t("common.anonymous")}
              </span>
            </Link>
          ) : (
            <div className="flex items-center gap-1.5">
              <Avatar id={null} name={null} src={null} size={24} />
              <span className="line-clamp-1">{t("common.anonymous")}</span>
            </div>
          )}
          <LikeButton
            promptId={prompt.id}
            initial={{ liked: prompt.userLiked ?? false, count: prompt.likeCount }}
            variant="compact"
          />
        </div>
        <div className="mt-1 line-clamp-1 text-sm font-medium text-white">{title}</div>
      </div>
    </Link>
  );
}
