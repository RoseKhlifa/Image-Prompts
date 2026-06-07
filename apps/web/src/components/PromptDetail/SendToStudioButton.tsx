import { useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Send, Loader2 } from "lucide-react";
import type { ImportTokenPayload, ImportTokenResponse } from "@ip/shared";
import { useSession } from "../../lib/hooks/useSession";
import { apiFetch, ApiError } from "../../lib/api";
import { toast } from "../../lib/toast";
import StudioNotInstalledModal from "../modals/StudioNotInstalledModal";

type Props = {
  promptId: string;
  payload: ImportTokenPayload;
};

type State = "idle" | "creating" | "launching";

const VISIBILITY_CHECK_MS = 1500;

export default function SendToStudioButton({ promptId, payload }: Props) {
  const { t } = useTranslation();
  const session = useSession();
  const [state, setState] = useState<State>("idle");
  const [showFallback, setShowFallback] = useState(false);

  const isGuest = !session.isLoading && !session.data;
  const isBusy = state !== "idle";
  const disabled = session.isLoading || isGuest || isBusy;

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

  const title = isGuest ? t("auth.signin_required") : undefined;

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        title={title}
        onClick={handleClick}
        className="inline-flex items-center justify-center gap-2 rounded-pill bg-accent px-4 py-2.5 text-[13px] font-medium text-white transition disabled:opacity-50"
        style={{ minWidth: 160 } as CSSProperties}
      >
        {isBusy ? (
          <Loader2 size={14} className="animate-spin" aria-hidden />
        ) : (
          <Send size={14} aria-hidden />
        )}
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
