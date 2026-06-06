import { useTranslation } from "react-i18next";

export default function ErrorState({
  message,
  onRetry,
}: {
  message?: string | undefined;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
      <p className="text-sm text-danger">{message ?? t("common.error")}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-pill border border-border-soft bg-surface px-4 py-1.5 text-xs text-ink-muted hover:text-ink"
        >
          {t("common.retry")}
        </button>
      )}
    </div>
  );
}
