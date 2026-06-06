import { Link, useParams } from "react-router";
import { Heart } from "lucide-react";
import { isLocale, pickBilingual, type Locale, type PromptSummary } from "@ip/shared";
import { resolveImageUrl } from "../lib/imageUrl";
import { useR2PoolMap } from "../lib/hooks/useR2Pool";
import { withLocale } from "../lib/locale";

export default function PromptCard({ prompt }: { prompt: PromptSummary }) {
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const { map } = useR2PoolMap();
  const title = pickBilingual(prompt.title, locale) ?? prompt.slug;
  const imageUrl = resolveImageUrl(prompt.primaryImage, map);
  const aspect = prompt.aspectRatio ?? "4/5";
  const aspectStyle = aspect === "auto" ? "4 / 5" : aspect.replace(":", " / ");

  return (
    <Link
      to={withLocale(locale, `/prompts/${prompt.slug}`)}
      className="group flex flex-col overflow-hidden rounded-card border border-border-soft bg-panel transition-colors hover:border-accent/40"
    >
      <div className="relative w-full bg-surface" style={{ aspectRatio: aspectStyle }}>
        <img
          src={imageUrl}
          alt={title}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
          width={prompt.primaryImage?.width ?? undefined}
          height={prompt.primaryImage?.height ?? undefined}
        />
      </div>
      <div className="flex flex-col gap-1.5 p-3.5">
        <div className="line-clamp-1 text-[13.5px] font-medium tracking-tight text-ink">
          {title}
        </div>
        <div className="flex items-center justify-between text-[11.5px] text-ink-dim">
          <div className="line-clamp-1">
            {prompt.tags
              .slice(0, 3)
              .map((tg) => `#${pickBilingual(tg.name, locale) ?? tg.slug}`)
              .join(" · ")}
          </div>
          <span className="flex items-center gap-0.5 text-ink-muted">
            <Heart size={10} aria-hidden /> {prompt.likeCount}
          </span>
        </div>
      </div>
    </Link>
  );
}
