import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Copy, Check } from "lucide-react";
import type { BilingualText } from "@ip/shared";

/**
 * Render a prompt/negative-prompt block. When BOTH zh and en versions
 * exist, show them stacked (zh first), each with its own copy button so
 * the visitor can grab whichever language they need without manually
 * switching the UI locale. When only one exists, render just that one
 * with the parent's `label` (the existing single-language behavior).
 *
 * The bilingual-paired keys (`common.prompt_zh` / `common.prompt_en` /
 * the negative pair) supply per-language titles.
 */
export default function PromptTextBlock({
  label,
  value,
  zhKey = "common.prompt_zh",
  enKey = "common.prompt_en",
}: {
  label: string;
  value: BilingualText | null;
  /** i18n key for the zh-only sub-heading when both languages exist. */
  zhKey?: string;
  /** i18n key for the en-only sub-heading when both languages exist. */
  enKey?: string;
}) {
  const { t } = useTranslation();
  const zh = value?.zh?.trim() ? value.zh : null;
  const en = value?.en?.trim() ? value.en : null;
  if (!zh && !en) return null;

  // Single-language: keep the legacy single-card render.
  if (!zh || !en) {
    return (
      <SingleBlock label={label} text={(zh ?? en) as string} />
    );
  }

  // Both present: two sub-blocks inside one card, zh first.
  return (
    <section className="rounded-card border border-border-soft bg-panel p-4">
      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-ink-dim">
        {label}
      </h2>
      <div className="space-y-4">
        <SubBlock label={t(zhKey)} text={zh} />
        <SubBlock label={t(enKey)} text={en} />
      </div>
    </section>
  );
}

function SingleBlock({ label, text }: { label: string; text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <section className="rounded-card border border-border-soft bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-ink-dim">
          {label}
        </h2>
        <CopyButton text={text} copied={copied} setCopied={setCopied} t={t} />
      </div>
      <div className="max-h-[60vh] overflow-y-auto pr-1">
        <p className="whitespace-pre-wrap font-mono text-[13px] leading-[1.7] text-ink">
          {text}
        </p>
      </div>
    </section>
  );
}

function SubBlock({ label, text }: { label: string; text: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-md border border-border-soft bg-surface/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-dim">
          {label}
        </span>
        <CopyButton text={text} copied={copied} setCopied={setCopied} t={t} />
      </div>
      <div className="max-h-[40vh] overflow-y-auto pr-1">
        <p className="whitespace-pre-wrap font-mono text-[12.5px] leading-[1.65] text-ink">
          {text}
        </p>
      </div>
    </div>
  );
}

function CopyButton({
  text,
  copied,
  setCopied,
  t,
}: {
  text: string;
  copied: boolean;
  setCopied: (v: boolean) => void;
  t: (k: string) => string;
}) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API blocked; fallback to legacy textarea.
      const ta = document.createElement("textarea");
      ta.value = text;
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
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1.5 rounded-pill border border-border-soft bg-surface px-3 py-1 text-[11px] text-ink-muted hover:text-ink"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {t("detail.copy_prompt")}
    </button>
  );
}
