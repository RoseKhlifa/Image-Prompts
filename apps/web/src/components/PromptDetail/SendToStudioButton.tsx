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

// Bumped from 1500ms to 3000ms to give Windows browsers time to surface
// the "Open Image Studio?" confirmation dialog before we decide the launch
// failed. On macOS LaunchServices dispatches near-instantly; on Windows
// Chromium-based browsers add a noticeable round-trip.
const LAUNCH_DETECT_MS = 3000;

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

      // Multi-signal launch detection. Listening to visibilityState ALONE
      // false-positives on Windows: Chrome/Edge show an "Open Image Studio?"
      // confirmation dialog (browser stays foregrounded), and after the user
      // clicks Open, Image-Studio launches in the background per Windows
      // Foreground Lock — visibilityState never flips to "hidden", so the
      // 3s timer thinks the launch failed even when it succeeded.
      //
      // `blur` reliably fires when the confirmation dialog steals focus on
      // Windows; `visibilitychange` covers macOS where LaunchServices brings
      // the launched app to the foreground. Either signal counts as success.
      let launched = false;
      const markLaunched = () => { launched = true; };
      const onVisibility = () => {
        if (document.visibilityState === "hidden") markLaunched();
      };
      window.addEventListener("blur", markLaunched, { once: true });
      document.addEventListener("visibilitychange", onVisibility);

      window.location.href = `image-studio://import?token=${res.token}`;

      setTimeout(() => {
        window.removeEventListener("blur", markLaunched);
        document.removeEventListener("visibilitychange", onVisibility);
        if (!launched) setShowFallback(true);
        setState("idle");
      }, LAUNCH_DETECT_MS);
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
