import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, X } from "lucide-react";
import { useCreateReport, REPORT_REASONS, type ReportReason } from "../../lib/hooks/useReports";
import { toast } from "../../lib/toast";

type Props = {
  promptId: string;
  onClose: () => void;
};

/**
 * Lightweight modal triggered from MoreMenu → "Report". Captures a fixed-
 * enum reason + optional free-form detail (≤ 2000 chars). Repeat reports
 * by the same user on the same prompt are server-deduplicated, so the
 * visitor sees "already filed" rather than two pending rows in the
 * owner queue.
 */
export default function ReportModal({ promptId, onClose }: Props) {
  const { t } = useTranslation();
  const [reason, setReason] = useState<ReportReason>("inappropriate");
  const [detail, setDetail] = useState("");
  const mut = useCreateReport();

  function submit() {
    mut.mutate(
      {
        targetType: "prompt",
        targetId: promptId,
        reason,
        ...(detail.trim() ? { detail: detail.trim() } : {}),
      },
      {
        onSuccess: (data) => {
          if (data.deduped) {
            toast.info(t("report.already_filed"));
          } else {
            toast.success(t("report.submitted"));
          }
          onClose();
        },
        onError: (err) => {
          toast.error(err.message ?? t("common.error"));
        },
      },
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-md rounded-card border border-border-soft bg-panel p-5 shadow-2xl">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2 text-ink">
            <AlertTriangle size={18} className="text-amber-400" aria-hidden />
            <h2 className="text-[15px] font-semibold">{t("report.title")}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="rounded p-1 text-ink-dim hover:bg-surface hover:text-ink"
          >
            <X size={14} aria-hidden />
          </button>
        </div>

        <p className="mt-3 text-[12.5px] leading-relaxed text-ink-muted">
          {t("report.intro")}
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="text-[12px] font-semibold uppercase tracking-wider text-ink-dim">
              {t("report.reason_label")}
            </label>
            <div className="mt-2 space-y-1.5">
              {REPORT_REASONS.map((r) => (
                <label
                  key={r}
                  className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-[13px] transition-colors ${
                    reason === r
                      ? "border-accent bg-accent-soft text-ink"
                      : "border-border-soft bg-surface text-ink-muted hover:border-border"
                  }`}
                >
                  <input
                    type="radio"
                    name="report-reason"
                    value={r}
                    checked={reason === r}
                    onChange={() => setReason(r)}
                    className="mt-0.5 shrink-0"
                  />
                  <div className="min-w-0">
                    <div className="font-medium text-ink">
                      {t(`report.reason.${r}`)}
                    </div>
                    <div className="text-[11.5px] text-ink-dim">
                      {t(`report.reason_desc.${r}`)}
                    </div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label
              htmlFor="report-detail"
              className="text-[12px] font-semibold uppercase tracking-wider text-ink-dim"
            >
              {t("report.detail_label")}
            </label>
            <textarea
              id="report-detail"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder={t("report.detail_placeholder")}
              maxLength={2000}
              rows={4}
              className="mt-2 w-full rounded-md border border-border-soft bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-ink-dim focus:border-accent focus:outline-none"
            />
            <div className="mt-1 text-right text-[11px] text-ink-dim">
              {detail.length} / 2000
            </div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-zinc-800 px-3 py-1.5 text-[13px] font-medium text-zinc-200 hover:bg-zinc-700"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={mut.isPending}
            className="rounded-md bg-amber-500 px-3 py-1.5 text-[13px] font-medium text-zinc-950 hover:bg-amber-400 disabled:opacity-50"
          >
            {mut.isPending ? t("common.loading") : t("report.submit")}
          </button>
        </div>
      </div>
    </div>
  );
}
