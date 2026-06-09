import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { isLocale, type Locale, type SubmissionListItem } from "@ip/shared";
import { useR2PoolMap } from "../../lib/hooks/useR2Pool.ts";
import { resolveImageUrl } from "../../lib/imageUrl.ts";
import { withLocale } from "../../lib/locale.ts";

const BADGE_CLASS: Record<SubmissionListItem["status"], string> = {
  pending: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

export default function SubmissionCard({
  item,
  highlight,
}: {
  item: SubmissionListItem;
  highlight: boolean;
}) {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const { map } = useR2PoolMap();
  const title =
    (locale === "zh" ? item.titleZh ?? item.titleEn : item.titleEn ?? item.titleZh) ?? "(untitled)";
  const imgUrl = item.primaryImage
    ? resolveImageUrl(
        { r2AccountId: item.primaryImage.r2AccountId, r2Key: item.primaryImage.r2Key },
        map,
      )
    : null;

  return (
    <div
      className={`rounded-card border bg-panel p-3 ${
        highlight ? "border-accent ring-2 ring-accent/30" : "border-border-soft"
      }`}
      id={`submission-${item.id}`}
    >
      {imgUrl && <img src={imgUrl} alt="" className="mb-2 aspect-square w-full rounded object-cover" />}
      <div className="mb-1 flex items-center justify-between gap-1">
        <span className="line-clamp-1 text-sm font-medium text-ink">{title}</span>
        <div className="flex items-center gap-1">
          {item.originalPromptId && (
            <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
              {t("my_submissions.edit_badge")}
            </span>
          )}
          <span className={`rounded px-1.5 py-0.5 text-[10px] ${BADGE_CLASS[item.status]}`}>
            {t(`my_submissions.status_${item.status}`)}
          </span>
        </div>
      </div>
      {item.status === "rejected" && item.rejectReason && (
        <p className="text-xs text-ink/70">
          <span className="font-semibold">{t("my_submissions.reject_reason_label")}: </span>
          {item.rejectReason}
        </p>
      )}
      {item.status === "approved" && item.promotedTo && (
        <Link
          to={withLocale(locale, `/prompts/${item.promotedTo.slug}`)}
          className="text-xs text-accent hover:underline"
        >
          {t("my_submissions.view_prompt")} →
        </Link>
      )}
    </div>
  );
}
