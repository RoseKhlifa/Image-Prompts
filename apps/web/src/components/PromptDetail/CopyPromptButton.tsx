import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { Copy, Check } from "lucide-react";
import { isLocale, pickBilingual, type Locale, type BilingualText } from "@ip/shared";
import { toast } from "../../lib/toast";

type Props = {
  prompt: BilingualText;
};

export default function CopyPromptButton({ prompt }: Props) {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    const text = pickBilingual(prompt, locale) ?? "";
    if (!text) {
      toast.error(t("detail.copy_failed"));
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      toast.success(t("detail.copied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("detail.copy_failed"));
    }
  }

  const Icon = copied ? Check : Copy;
  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center justify-center gap-1.5 rounded-pill border border-border-soft bg-surface px-3 py-2 text-[12.5px] text-ink-muted transition hover:bg-panel-2 hover:text-ink"
    >
      <Icon size={12} aria-hidden />
      {t("detail.copy_prompt")}
    </button>
  );
}
