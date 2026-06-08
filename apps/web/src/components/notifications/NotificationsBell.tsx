import { useRef, useState, useEffect } from "react";
import { Bell } from "lucide-react";
import { useNotificationCount } from "../../lib/hooks/useNotificationCount.ts";
import NotificationsList from "./NotificationsList.tsx";

export default function NotificationsBell() {
  const count = useNotificationCount();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const unread = count.data?.unread ?? 0;

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-ink/5"
        aria-label="Notifications"
      >
        <Bell size={18} className="text-ink/80" aria-hidden />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-medium text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-50 w-72 rounded-card border border-border-soft bg-panel shadow-lg">
          <NotificationsList onItemNavigate={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
