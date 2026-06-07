import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MoreHorizontal, Flag } from "lucide-react";
import { toast } from "../../lib/toast";

export default function MoreMenu(_props: { promptId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", onClickOutside);
      return () => document.removeEventListener("mousedown", onClickOutside);
    }
    return undefined;
  }, [open]);

  function handleReport() {
    // M5 placeholder — M7 will wire to ReportModal
    toast.info(t("detail.report_coming_soon"));
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border-soft bg-surface text-ink-muted hover:bg-panel-2 hover:text-ink"
      >
        <MoreHorizontal size={14} aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-40 rounded-card border border-border-soft bg-panel p-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={handleReport}
            className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-[12.5px] text-ink-muted hover:bg-panel-2 hover:text-ink"
          >
            <Flag size={12} aria-hidden />
            {t("detail.report")}
          </button>
        </div>
      )}
    </div>
  );
}
