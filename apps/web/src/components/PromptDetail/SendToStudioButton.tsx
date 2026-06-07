import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Send, Loader2, LogIn } from "lucide-react";
import type { ImportTokenPayload, ImportTokenResponse } from "@ip/shared";
import { useSession } from "../../lib/hooks/useSession";
import { apiFetch, ApiError } from "../../lib/api";
import { toast } from "../../lib/toast";
import StudioNotInstalledModal from "../modals/StudioNotInstalledModal";
import SignInModal from "../auth/SignInModal";

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
  const [showSignIn, setShowSignIn] = useState(false);

  const isGuest = !session.isLoading && !session.data;
  const isBusy = state !== "idle";
  // Only `creating`/`launching` and the brief session-loading window block clicks.
  // Guests get a live button that opens the SignInModal instead — no disabled state.
  const disabled = session.isLoading || isBusy;

  async function handleClick() {
    if (disabled) return;
    if (isGuest) {
      setShowSignIn(true);
      return;
    }
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
        className="inline-flex w-full flex-col items-center justify-center gap-0.5 rounded-card bg-accent px-5 py-2.5 text-white transition hover:bg-accent/90 disabled:opacity-50"
      >
        <span className="inline-flex items-center gap-2 text-[13px] font-medium">
          <Icon size={14} className={isBusy ? "animate-spin" : undefined} aria-hidden />
          {t("detail.send_to_studio")}
        </span>
        {isGuest && (
          <span className="inline-flex items-center gap-1 text-[11px] font-normal text-white/80">
            <LogIn size={10} aria-hidden />
            {t("detail.signin_to_use")}
          </span>
        )}
      </button>
      <StudioNotInstalledModal
        open={showFallback}
        onClose={() => setShowFallback(false)}
        prompt={payload.prompt}
      />
      <SignInModal open={showSignIn} onClose={() => setShowSignIn(false)} />
    </>
  );
}
