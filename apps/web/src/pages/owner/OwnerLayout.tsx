import { Outlet } from "react-router";
import OwnerSidebar from "../../components/owner/OwnerSidebar";
import OwnerTopbar from "../../components/owner/OwnerTopbar";

export default function OwnerLayout() {
  return (
    // `owner-theme` swaps Apple HIG palette → zinc/emerald via CSS vars
    // (see styles/tokens.css). Descendants consuming `bg-canvas / text-ink /
    // border-border-soft / bg-accent-soft` automatically render dark — which
    // lets us mount the existing AdminSubmissionList/Preview tree verbatim
    // under /rosekhlifa/submissions without per-component restyling.
    <div className="owner-theme min-h-dvh bg-zinc-950 text-zinc-100">
      <OwnerTopbar />
      <div className="flex">
        <OwnerSidebar />
        <main className="min-w-0 flex-1 px-6 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
