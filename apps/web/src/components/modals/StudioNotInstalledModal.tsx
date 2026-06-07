import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { isLocale, pickBilingual, type BilingualText, type Locale } from "@ip/shared";
import type { ImportTokenPayload } from "@ip/shared";
import Modal from "./Modal";

const RELEASES_URL = "https://github.com/RoseKhlifa/Image-Studio/releases";
export const SUPPRESS_KEY = "ip:studio_install_suppressed";

type Props = {
  open: boolean;
  onClose: () => void;
  prompt: ImportTokenPayload["prompt"];
};

export default function StudioNotInstalledModal({ open, onClose, prompt }: Props) {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");

  // If the user previously checked "don't ask again," skip rendering entirely.
  if (open && typeof window !== "undefined" && window.localStorage?.getItem(SUPPRESS_KEY) === "1") {
    queueMicrotask(onClose);
    return null;
  }

  async function handleCopy() {
    // ImportTokenPayload["prompt"] is the Zod-inferred shape with
    // {zh?: string | undefined; en?: string | undefined}; pickBilingual
    // expects BilingualText ({zh?: string; en?: string}). Structurally
    // equivalent under exactOptionalPropertyTypes, so narrow via cast.
    const text = pickBilingual(prompt as BilingualText, locale) ?? "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied("ok");
      setTimeout(() => setCopied("idle"), 2000);
    } catch {
      setCopied("fail");
      setTimeout(() => setCopied("idle"), 2000);
    }
  }

  function onSuppressChange(checked: boolean) {
    if (typeof window === "undefined") return;
    if (checked) window.localStorage.setItem(SUPPRESS_KEY, "1");
    else window.localStorage.removeItem(SUPPRESS_KEY);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("studio_modal.title")}
      closeLabel={t("studio_modal.close")}
    >
      <p className="text-[13px] leading-relaxed text-ink-muted">{t("studio_modal.body")}</p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <a
          href={RELEASES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex flex-1 items-center justify-center rounded-pill bg-accent px-4 py-2 text-[13px] font-medium text-white"
        >
          {t("studio_modal.download")}
        </a>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex flex-1 items-center justify-center rounded-pill border border-border-soft bg-surface px-4 py-2 text-[13px] font-medium text-ink hover:bg-panel-2"
        >
          {copied === "ok"
            ? t("studio_modal.copied")
            : copied === "fail"
              ? t("studio_modal.copy_failed")
              : t("studio_modal.copy_prompt")}
        </button>
      </div>
      <label className="mt-4 flex cursor-pointer items-center gap-2 text-[11.5px] text-ink-dim">
        <input
          type="checkbox"
          onChange={(e) => onSuppressChange(e.currentTarget.checked)}
          className="h-3.5 w-3.5 accent-accent"
        />
        {t("studio_modal.dont_ask_again")}
      </label>
    </Modal>
  );
}
