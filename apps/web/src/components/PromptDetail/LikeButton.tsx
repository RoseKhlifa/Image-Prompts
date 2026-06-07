import { useEffect, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Heart } from "lucide-react";
import { useSession } from "../../lib/hooks/useSession";
import { useLikeMutation, type LikeState } from "../../lib/hooks/useLikeMutation";
import { ApiError } from "../../lib/api";
import { toast } from "../../lib/toast";
import SignInModal from "../auth/SignInModal";

type Props = {
  promptId: string;
  initial: LikeState;
  /** "full" = pill button with label (detail page); "compact" = icon + count, no label (card hover). */
  variant?: "full" | "compact";
};

export default function LikeButton({ promptId, initial, variant = "full" }: Props) {
  const { t } = useTranslation();
  const session = useSession();
  const isGuest = !session.isLoading && !session.data;
  const [state, setState] = useState<LikeState>(initial);
  const [signInOpen, setSignInOpen] = useState(false);

  // Resync if parent passes fresh props (e.g. after invalidate).
  useEffect(() => {
    setState(initial);
  }, [initial.liked, initial.count]);

  const mutation = useLikeMutation({
    promptId,
    onAuthRequired: () => {
      // Roll back optimistic state, then open the modal.
      setState((s) => ({ liked: !s.liked, count: s.liked ? s.count - 1 : s.count + 1 }));
      setSignInOpen(true);
    },
    onError: (err) => {
      // Roll back optimistic state.
      setState((s) => ({ liked: !s.liked, count: s.liked ? s.count - 1 : s.count + 1 }));
      if (err instanceof ApiError && err.status === 429) {
        toast.error(t("interactions.rate_limited"));
      } else {
        toast.error(t("interactions.generic_error"));
      }
    },
  });

  useEffect(() => {
    if (mutation.data) {
      // Adopt server's authoritative count
      setState((s) => ({ liked: s.liked, count: mutation.data!.like_count }));
    }
  }, [mutation.data]);

  function handleClick(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();

    if (isGuest) {
      setSignInOpen(true);
      return;
    }
    if (mutation.isPending) return;

    const action = state.liked ? "unlike" : "like";
    const next: LikeState = {
      liked: !state.liked,
      count: state.liked ? state.count - 1 : state.count + 1,
    };
    setState(next);
    mutation.mutate({ action, previous: state });
  }

  if (variant === "compact") {
    return (
      <>
        <button
          type="button"
          onClick={handleClick}
          aria-label={state.liked ? t("interactions.unliked") : t("interactions.liked")}
          aria-pressed={state.liked}
          className={`pointer-events-auto inline-flex items-center gap-1 text-xs ${
            state.liked ? "text-danger" : "text-white/90"
          }`}
        >
          <Heart size={12} fill={state.liked ? "currentColor" : "none"} aria-hidden />
          {state.count}
        </button>
        <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        aria-pressed={state.liked}
        className={`inline-flex items-center justify-center gap-1.5 rounded-pill border px-3 py-2 text-[12.5px] transition ${
          state.liked
            ? "border-danger/40 bg-danger/10 text-danger"
            : "border-border-soft bg-surface text-ink-muted hover:bg-panel-2 hover:text-ink"
        }`}
      >
        <Heart size={12} fill={state.liked ? "currentColor" : "none"} aria-hidden />
        {state.count}
      </button>
      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
    </>
  );
}
