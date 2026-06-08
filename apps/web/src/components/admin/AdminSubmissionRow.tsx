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
  const title = (locale === "zh" ? item.titleZh ?? item.titleEn : item.titleEn ?? item.titleZh) ?? "(untitled)";
  const img = item.primaryImage
    ? resolveImageUrl(
        { r2AccountId: item.primaryImage.r2AccountId, r2Key: item.primaryImage.r2Key },
        map,
      )
    : null;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full gap-3 rounded-card border p-2 text-left transition ${
        selected ? "border-accent bg-accent/5" : "border-border-soft hover:border-accent/40"
      }`}
    >
      {img && <img src={img} alt="" className="h-16 w-16 rounded object-cover" />}
      <div className="min-w-0">
        <div className="line-clamp-1 text-sm font-medium text-ink">{title}</div>
        <div className="text-xs text-ink/60">{item.contributor.email ?? item.contributor.id}</div>
        <div className="text-[11px] text-ink/50">
          {t("admin.submitted_at")}: {new Date(item.createdAt).toLocaleString()}
        </div>
      </div>
    </button>
  );
}
