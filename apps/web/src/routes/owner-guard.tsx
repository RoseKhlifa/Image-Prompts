import { Outlet } from "react-router";
import { useSession } from "../lib/hooks/useSession";
import ForbiddenPage from "../pages/owner/ForbiddenPage";

/**
 * Gate /:locale/rosekhlifa/* — only render children when the session's
 * isOwner derived flag is true. Loading state shows a minimal placeholder
 * (避免 flash of forbidden);hard 403 page shown on confirmed non-owner.
 *
 * This is UX gating only — the API still enforces server-side via
 * requireOwner. A user who hand-edits the SPA state would just hit 403s
 * from the network calls.
 */
export default function OwnerGuard() {
  const session = useSession();
  if (session.isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-zinc-950 text-zinc-400">
        …
      </div>
    );
  }
  const isOwner = (session.data?.user as { isOwner?: boolean } | undefined)?.isOwner ?? false;
  if (!isOwner) return <ForbiddenPage />;
  return <Outlet />;
}
