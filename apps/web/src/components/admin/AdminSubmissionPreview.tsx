import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { isLocale, type Locale } from "@ip/shared";
import { useAdminSubmissionDetail } from "../../lib/hooks/useAdminSubmissionDetail.ts";
import { useR2PoolMap } from "../../lib/hooks/useR2Pool.ts";
import { resolveImageUrl } from "../../lib/imageUrl.ts";
import AdminActionBar from "./AdminActionBar.tsx";

type Props = { id: string | null; onResolved: () => void };

export default function AdminSubmissionPreview({ id, onResolved }: Props) {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const detail = useAdminSubmissionDetail(id);
  const { map } = useR2PoolMap();

  if (!id) return <p className="text-sm text-ink/60">{t("admin.empty_pending")}</p>;
  if (detail.isLoading) return <p className="text-sm text-ink/60">{t("common.loading")}</p>;
  const d = detail.data;
  if (!d) return <p className="text-sm text-ink/60">{t("common.error")}</p>;

  const title = (locale === "zh" ? d.titleZh ?? d.titleEn : d.titleEn ?? d.titleZh) ?? "(untitled)";
  const prompt = (locale === "zh" ? d.promptZh ?? d.promptEn : d.promptEn ?? d.promptZh) ?? "";

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
        {d.images.map((img, i) => (
          <img
            key={i}
            src={resolveImageUrl(
              { r2AccountId: img.r2AccountId, r2Key: img.r2Key },
              map,
            )}
            alt=""
            className="rounded object-cover"
          />
        ))}
      </div>
      <div>
        <h3 className="text-sm font-semibold text-ink">Prompt</h3>
        <pre className="whitespace-pre-wrap rounded bg-ink/5 p-2 text-xs">{prompt}</pre>
      </div>
      <div className="text-xs text-ink/60">
        {t("admin.contributor")}: {d.contributor.email ?? d.contributor.id}
      </div>
      {d.status === "pending" ? (
        <AdminActionBar submissionId={d.id} onResolved={onResolved} />
      ) : (
        <p className="text-sm text-ink/60">
          {t(`my_submissions.status_${d.status}`)}
          {d.rejectReason ? ` — ${d.rejectReason}` : ""}
        </p>
      )}
    </div>
  );
}
