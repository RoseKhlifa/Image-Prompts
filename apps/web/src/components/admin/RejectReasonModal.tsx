import { useState } from "react";
import { useTranslation } from "react-i18next";

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
  isSubmitting: boolean;
};

export default function RejectReasonModal({ open, onClose, onSubmit, isSubmitting }: Props) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  if (!open) return null;
  const ok = reason.trim().length >= 10 && reason.trim().length <= 500;
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
    >
      <div className="w-[480px] rounded-card border border-border-soft bg-panel p-5">
        <h3 className="mb-3 text-lg font-semibold text-ink">{t("admin.reject_modal_title")}</h3>
        <textarea
          rows={4}
          placeholder={t("admin.reject_reason_placeholder")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          className="block w-full rounded-card border border-border-soft bg-panel px-2 py-1.5 text-sm"
        />
        <p className="mt-1 text-xs text-ink/60">{reason.trim().length}/500</p>
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-card border border-border-soft px-3 py-1.5 text-sm"
          >
            {t("admin.cancel")}
          </button>
          <button
            type="button"
            disabled={!ok || isSubmitting}
            onClick={() => onSubmit(reason.trim())}
            className="rounded-card bg-red-500 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {t("admin.reject_confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
