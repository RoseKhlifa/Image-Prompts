import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";

type Props = {
  value: string;
  onChange: (v: string) => void;
};

/**
 * Inline disclaimer + type-to-confirm field shown in the submit form when
 * the visitor selects the NSFW category. The parent owns the value/onChange
 * pair and disables its submit button until `value.trim() === t("nsfw.gate.confirm_phrase")`.
 */
export function NsfwSubmitAck({ value, onChange }: Props) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-rose-700/50 bg-rose-500/5 p-4">
      <div className="flex items-center gap-2 text-rose-300">
        <AlertTriangle size={16} aria-hidden />
        <span className="text-sm font-semibold">{t("nsfw.gate.title")}</span>
      </div>
      <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-zinc-300">
        {t("nsfw.submit.ack_body")}
      </p>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("nsfw.submit.ack_placeholder")}
        className="mt-3 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-rose-500 focus:outline-none"
      />
    </div>
  );
}
