import { useState } from "react";
import { useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { isLocale, type Locale, type AdminSubmissionListItem } from "@ip/shared";
import { useR2PoolMap } from "../../lib/hooks/useR2Pool.ts";
import { resolveImageUrl } from "../../lib/imageUrl.ts";

type Props = {
  item: AdminSubmissionListItem;
  selected: boolean;
  onSelect: () => void;
};

export default function AdminSubmissionRow({ item, selected, onSelect }: Props) {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const { map } = useR2PoolMap();
  // Per-row reveal state: NSFW thumbnails ship blurred and a click-to-reveal
  // overlay sits on top of the image. State is intentionally LOCAL so it
  // resets on page reload / status-tab switch — moderators opt in per row,
  // every time. The row's outer <button> handles selection; the reveal
  // overlay is a nested <button> that calls stopPropagation so revealing
  // does not also select the row.
  const [revealed, setRevealed] = useState(false);
  const title = (locale === "zh" ? item.titleZh ?? item.titleEn : item.titleEn ?? item.titleZh) ?? "(untitled)";
  const img = item.primaryImage
    ? resolveImageUrl(
        { r2AccountId: item.primaryImage.r2AccountId, r2Key: item.primaryImage.r2Key },
        map,
      )
    : null;
  const blurThumb = item.isNsfw && !revealed;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full gap-3 rounded-card border p-2 text-left transition ${
        selected ? "border-accent bg-accent/5" : "border-border-soft hover:border-accent/40"
      }`}
    >
      {img && (
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded">
          <img
            src={img}
            alt=""
            className={`h-16 w-16 object-cover ${blurThumb ? "scale-110 blur-lg" : ""}`}
          />
          {blurThumb && (
            // Reveal overlay: <div role="button"> rather than a nested
            // <button>, since the row's outer element is already a
            // <button> (invalid HTML to nest). Both click and Enter/Space
            // call stopPropagation so revealing does not also select the
            // row in the split-pane preview.
            <div
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                setRevealed(true);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.stopPropagation();
                  e.preventDefault();
                  setRevealed(true);
                }
              }}
              className="absolute inset-0 flex cursor-pointer items-center justify-center bg-zinc-950/40 text-[10px] font-semibold text-rose-200 hover:bg-zinc-950/30"
            >
              {t("admin.submissions.reveal_nsfw")}
            </div>
          )}
        </div>
      )}
      <div className="min-w-0">
        <div className="flex items-center gap-1">
          <span className="line-clamp-1 text-sm font-medium text-ink">{title}</span>
          {item.originalPromptId && (
            <span className="shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
              {t("admin.submissions.edit_badge")}
            </span>
          )}
        </div>
        <div className="text-xs text-ink/60">{item.contributor.email ?? item.contributor.id}</div>
        <div className="text-[11px] text-ink/50">
          {t("admin.submitted_at")}: {new Date(item.createdAt).toLocaleString()}
        </div>
      </div>
    </button>
  );
}
