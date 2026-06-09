import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { X } from "lucide-react";
import { isLocale, pickBilingual, type Locale } from "@ip/shared";
import {
  useAnnouncements,
  type PublicAnnouncement,
} from "../../lib/hooks/useAnnouncements";

const DISMISSED_PREFIX = "ip-announcement-dismissed:";

const SEVERITY_RANK: Record<PublicAnnouncement["severity"], number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

/**
 * Pop-up announcement queue. Renders the first un-dismissed `popup`-mode
 * announcement as a modal dialog over the page. After the user dismisses
 * it, the next un-dismissed popup pops up. When every active popup has
 * been seen, nothing renders.
 *
 * Mounted in AppShell next to AnnouncementsBanner — both consume the same
 * `useAnnouncements` query (server splits banner vs popup so the client
 * doesn't have to filter). Dismissed state is per-id localStorage,
 * cross-tab synced like the banner.
 *
 * UX:
 *   - z-50 modal overlay matching the SubmitModal style.
 *   - Click backdrop to dismiss (only when dismissible=true; otherwise the
 *     modal sticks until the time window expires or the owner clears it).
 *   - Escape key dismisses (also gated on dismissible).
 *   - Critical announcements with dismissible=false intentionally trap focus
 *     on the dialog — that's the point.
 *
 * Hidden during query loading/error to avoid flashes.
 */
export default function AnnouncementsPopup() {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";

  const q = useAnnouncements();
  const [dismissed, setDismissed] = useState<Set<string>>(() =>
    readDismissedFromStorage(),
  );

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === null || e.key.startsWith(DISMISSED_PREFIX)) {
        setDismissed(readDismissedFromStorage());
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  function dismiss(id: string) {
    try {
      localStorage.setItem(`${DISMISSED_PREFIX}${id}`, "1");
    } catch {
      /* ignore — popup resurfaces on next mount */
    }
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  // Compute active popup (first in severity-sorted queue minus dismissed).
  const active = q.data
    ? q.data.popups
        .filter((a) => !dismissed.has(a.id))
        .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])[0]
    : undefined;

  useEffect(() => {
    if (!active || !active.dismissible) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") dismiss(active!.id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active]);

  if (q.isLoading || q.isError || !q.data || !active) return null;

  const title = pickBilingual(active.title, locale);
  const body = pickBilingual(active.body, locale);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="announcement-popup-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-4 py-8"
      onClick={() => {
        if (active.dismissible) dismiss(active.id);
      }}
    >
      <div
        className={`relative w-full max-w-lg overflow-hidden rounded-card border bg-panel shadow-2xl ${borderFor(active.severity)}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`px-5 py-3 ${headerBgFor(active.severity)}`}>
          <h2
            id="announcement-popup-title"
            className="text-base font-semibold text-ink"
          >
            {title}
          </h2>
        </div>
        <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap px-5 py-4 text-sm text-ink-muted">
          {body}
        </div>
        {active.dismissible && (
          <button
            type="button"
            onClick={() => dismiss(active.id)}
            aria-label={t("announcements.popup_dismiss")}
            className="absolute right-3 top-3 rounded-control p-1 text-ink-muted hover:bg-black/10 hover:text-ink dark:hover:bg-white/10"
          >
            <X size={18} aria-hidden />
          </button>
        )}
        {active.dismissible && (
          <div className="border-t border-border-soft bg-panel-2 px-5 py-3 text-right">
            <button
              type="button"
              onClick={() => dismiss(active.id)}
              className="rounded-pill bg-accent px-4 py-1.5 text-xs font-medium text-white hover:bg-accent-2"
            >
              {t("announcements.popup_acknowledge")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function borderFor(severity: PublicAnnouncement["severity"]): string {
  switch (severity) {
    case "info":
      return "border-accent/40";
    case "warning":
      return "border-amber-500/40";
    case "critical":
      return "border-danger/40";
  }
}

function headerBgFor(severity: PublicAnnouncement["severity"]): string {
  switch (severity) {
    case "info":
      return "bg-accent-soft";
    case "warning":
      return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
    case "critical":
      return "bg-danger/15 text-danger";
  }
}

function readDismissedFromStorage(): Set<string> {
  const set = new Set<string>();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(DISMISSED_PREFIX)) {
        set.add(key.slice(DISMISSED_PREFIX.length));
      }
    }
  } catch {
    /* ignore */
  }
  return set;
}
