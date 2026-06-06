import { useTranslation } from "react-i18next";
import type { AspectRatio } from "@ip/shared";

export default function SuggestedParams({ aspect }: { aspect: AspectRatio | null }) {
  const { t } = useTranslation();
  return (
    <section className="rounded-card border border-border-soft bg-panel p-4">
      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-ink-dim">
        {t("detail.suggested_params")}
      </h2>
      <div className="grid grid-cols-2 gap-2 text-[12.5px]">
        <ParamCell label={t("detail.aspect_ratio")} value={aspect ?? "—"} />
        <ParamCell label="" value={aspect ? "—" : t("detail.no_suggestions")} />
      </div>
    </section>
  );
}

function ParamCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-surface px-3 py-2">
      {label && <div className="text-[11px] text-ink-dim">{label}</div>}
      <div className="font-medium text-ink">{value}</div>
    </div>
  );
}
