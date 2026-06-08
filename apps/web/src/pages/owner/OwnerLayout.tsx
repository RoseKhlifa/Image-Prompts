import { Outlet } from "react-router";
import OwnerSidebar from "../../components/owner/OwnerSidebar";
import OwnerTopbar from "../../components/owner/OwnerTopbar";

export default function OwnerLayout() {
  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100">
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
