import { useEffect, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Star } from "lucide-react";
import { useSession } from "../../lib/hooks/useSession";
import { useFavoriteMutation, type FavoriteState } from "../../lib/hooks/useFavoriteMutation";
import { ApiError } from "../../lib/api";
import { toast } from "../../lib/toast";
import SignInModal from "../auth/SignInModal";

type Props = {
  promptId: string;
  initial: FavoriteState;
};

const FAVORITE_YELLOW = "#ffcc00";

export default function FavoriteButton({ promptId, initial }: Props) {
  const { t } = useTranslation();
  const session = useSession();
  const isGuest = !session.isLoading && !session.data;
  const [state, setState] = useState<FavoriteState>(initial);
  const [signInOpen, setSignInOpen] = useState(false);

  useEffect(() => {
    setState(initial);
  }, [initial.favorited]);

  const mutation = useFavoriteMutation({
    promptId,
    onAuthRequired: () => {
      // Roll back optimistic state.
      setState((s) => ({ favorited: !s.favorited }));
      setSignInOpen(true);
    },
    onError: (err) => {
      // Roll back optimistic state.
      setState((s) => ({ favorited: !s.favorited }));
      if (err instanceof ApiError && err.status === 429) {
        toast.error(t("interactions.rate_limited"));
      } else {
        toast.error(t("interactions.generic_error"));
      }
    },
  });

  function handleClick(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (isGuest) {
      setSignInOpen(true);
      return;
    }
    if (mutation.isPending) return;
    const action = state.favorited ? "unfavorite" : "favorite";
    setState({ favorited: !state.favorited });
    mutation.mutate({ action });
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        aria-pressed={state.favorited}
        className={`inline-flex items-center justify-center gap-1.5 rounded-pill border px-3 py-2 text-[12.5px] transition ${
          state.favorited
            ? "border-yellow-300/40 bg-yellow-100/30 hover:bg-yellow-100/40"
            : "border-border-soft bg-surface text-ink-muted hover:bg-panel-2 hover:text-ink"
        }`}
        style={state.favorited ? { color: FAVORITE_YELLOW } : undefined}
      >
        <Star size={12} fill={state.favorited ? "currentColor" : "none"} aria-hidden />
        {t("detail.favorite")}
      </button>
      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
    </>
  );
}
