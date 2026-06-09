import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";

type Props = {
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Full-viewport gate that hides the page body until the visitor types the
 * locale-specific confirmation phrase ("我已了解" / "I understand") exactly.
 *
 * Used by `PromptListPage` when `?category=nsfw`. Acknowledgment is recorded
 * in sessionStorage by the caller — the modal itself is stateless w.r.t. that.
 */
export function NsfwGateModal({ onConfirm, onCancel }: Props) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState("");
  const expected = t("nsfw.gate.confirm_phrase");
  const matches = typed.trim() === expected;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && matches) {
      e.preventDefault();
      onConfirm();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/85 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="nsfw-gate-title"
    >
      <div className="w-full max-w-md rounded-lg border border-rose-700 bg-zinc-900 p-6 shadow-2xl">
        <div className="flex items-center gap-2 text-rose-300">
          <AlertTriangle size={20} aria-hidden />
          <h2 id="nsfw-gate-title" className="text-lg font-semibold">
            {t("nsfw.gate.title")}
          </h2>
        </div>
        <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-zinc-200">
          {t("nsfw.gate.body")}
        </p>
        <input
          ref={inputRef}
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={handleKey}
          placeholder={t("nsfw.gate.confirm_placeholder")}
          className="mt-5 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-rose-500 focus:outline-none"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-200 hover:bg-zinc-700"
          >
            {t("nsfw.gate.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!matches}
            className="rounded-md bg-rose-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("nsfw.gate.enter")}
          </button>
        </div>
      </div>
    </div>
  );
}
