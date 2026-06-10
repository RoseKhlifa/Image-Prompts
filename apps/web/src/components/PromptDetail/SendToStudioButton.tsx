import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Send, Loader2 } from "lucide-react";
import type { ImportTokenPayload, ImportTokenResponse } from "@ip/shared";
import { apiFetch, ApiError } from "../../lib/api";
import { toast } from "../../lib/toast";
import StudioNotInstalledModal from "../modals/StudioNotInstalledModal";

type Props = {
  promptId: string;
  payload: ImportTokenPayload;
};

type State = "idle" | "creating" | "launching";

const VISIBILITY_CHECK_MS = 1500;

// "Send to Image-Studio" — available to everyone (guests included) since
// the import-token endpoint accepts anonymous callers. Rate limits are
// keyed by IP for guests instead of by user-id, which the server handles.
export default function SendToStudioButton({ promptId, payload }: Props) {
  const { t } = useTranslation();
  const [state, setState] = useState<State>("idle");
  const [showFallback, setShowFallback] = useState(false);

  const isBusy = state !== "idle";
  const disabled = isBusy;

  async function handleClick() {
    if (disabled) return;
    setState("creating");
    try {
      const res = await apiFetch<ImportTokenResponse>("/api/import-tokens", {
        method: "POST",
        body: JSON.stringify({
          prompt: payload.prompt,
          ...(payload.negative_prompt ? { negative_prompt: payload.negative_prompt } : {}),
          ...(payload.aspect_ratio ? { aspect_ratio: payload.aspect_ratio } : {}),
          prompt_id: promptId,
        }),
      });
      setState("launching");
      window.location.href = `image-studio://import?token=${res.token}`;
      setTimeout(() => {
        if (document.visibilityState === "visible") setShowFallback(true);
        setState("idle");
      }, VISIBILITY_CHECK_MS);
    } catch (e) {
      setState("idle");
      if (e instanceof ApiError) {
        if (e.status === 401) toast.error(t("auth.session_expired"));
        else if (e.status === 429) toast.error(t("detail.rate_limited"));
        else toast.error(t("detail.send_failed"));
      } else {
        toast.error(t("detail.send_failed"));
      }
    }
  }

  const Icon = isBusy ? Loader2 : Send;

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={handleClick}
        className="inline-flex w-full items-center justify-center gap-2 rounded-card bg-accent px-5 py-2.5 text-[13px] font-medium text-white transition hover:bg-accent/90 disabled:opacity-50"
      >
        <Icon size={14} className={isBusy ? "animate-spin" : undefined} aria-hidden />
        {t("detail.send_to_studio")}
      </button>
      <StudioNotInstalledModal
        open={showFallback}
        onClose={() => setShowFallback(false)}
        prompt={payload.prompt}
      />
    </>
  );
}
