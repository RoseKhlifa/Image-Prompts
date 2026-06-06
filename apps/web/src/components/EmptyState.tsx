import { useTranslation } from "react-i18next";

export default function EmptyState({ message }: { message?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
      <div className="mb-2 text-[42px]">·</div>
      <p className="text-sm text-ink-muted">{message ?? t("common.empty")}</p>
    </div>
  );
}
