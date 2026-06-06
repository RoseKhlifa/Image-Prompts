import { useState } from "react";
import { useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Copy, Check } from "lucide-react";
import { hasLocale, isLocale, pickBilingual, type BilingualText, type Locale } from "@ip/shared";

export default function PromptTextBlock({
  label,
  value,
}: {
  label: string;
  value: BilingualText | null;
}) {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const [copied, setCopied] = useState(false);

  const text = pickBilingual(value, locale);
  if (!text) return null;
  const hint = !hasLocale(value, locale)
    ? locale === "zh"
      ? t("common.no_zh_version")
      : t("common.no_en_version")
    : null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text!);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API blocked; fallback to legacy textarea
      const ta = document.createElement("textarea");
      ta.value = text!;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } finally {
        ta.remove();
      }
    }
  }

  return (
    <section className="rounded-card border border-border-soft bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-ink-dim">{label}</h2>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-pill border border-border-soft bg-surface px-3 py-1 text-[11px] text-ink-muted hover:text-ink"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {t("detail.copy_prompt")}
        </button>
      </div>
      <p className="whitespace-pre-wrap font-mono text-[13px] leading-[1.7] text-ink">{text}</p>
      {hint && <p className="mt-2 text-[11px] text-ink-dim">{hint}</p>}
    </section>
  );
}
