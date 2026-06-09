import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { Megaphone, X } from "lucide-react";
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
 * Site-wide banner stack. Mounted in AppShell right under the header, so
 * every page sees it before the sidebar/main flex. Inside AppShell scope,
 * not inside owner-theme — banners on /rosekhlifa should still look like
 * their counterparts on the public site (the operator notice landing on
 * the owner console isn't a separate channel).
 *
 * Reads dismissed state from localStorage keyed by id. We treat localStorage
 * as best-effort — incognito mode (write throws) just means the banner
 * reappears on next mount, which is fine for a low-friction signal.
 *
 * No portal — banner renders inline, so the document flow continues
 * smoothly into <main>. AppShell's header is sticky, so the banner sits
 * below the sticky chrome (it scrolls with the page) — that matches the
 * "informational, not urgent" model for site-wide announcements.
 *
 * The banner is intentionally hidden while the query is loading / errored
 * — flashing a banner that then disappears would be worse than no banner.
 */
export default function AnnouncementsBanner() {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";

  const q = useAnnouncements();

  // Local mirror of the dismissed set. Initialized lazily from localStorage
  // — useState's lazy initializer keeps the JSON parse off the hot path on
  // re-renders. Updates write back through `dismiss()` below.
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissedFromStorage());

  // Cross-tab sync: if the user dismisses an announcement in tab A, tab B
  // should hide it too on the next render. The storage event only fires
  // for keys changed in *other* tabs, so we don't loop.
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
      // ignore — banner just reappears next mount
    }
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  if (q.isLoading || q.isError || !q.data) return null;

  // Server already enforces "at most 1 banner" via the `banners` field; we
  // just filter dismissed. (`banners` is empty when no banner is active or
  // when the only active banner was dismissed by the user.)
  const visible = q.data.banners
    .filter((a) => !dismissed.has(a.id))
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);

  if (visible.length === 0) return null;

  return (
    <div className="border-b border-border-soft">
      {visible.map((a) => {
        const title = pickBilingual(a.title, locale);
        const body = pickBilingual(a.body, locale);
        return (
          <div
            key={a.id}
            role="status"
            className={`flex items-center gap-3 border-b border-border-soft px-6 py-2 text-sm last:border-b-0 ${bgFor(a.severity)}`}
          >
            <Megaphone size={16} aria-hidden className="shrink-0" />
            <div className="min-w-0 flex-1">
              {title && <strong className="font-semibold">{title}</strong>}
              {body && (
                <span className="ml-2 text-ink-muted">
                  {body.length > 240 ? `${body.slice(0, 240)}…` : body}
                </span>
              )}
            </div>
            {a.dismissible && (
              <button
                type="button"
                onClick={() => dismiss(a.id)}
                aria-label={t("announcements.banner_dismiss")}
                className="shrink-0 rounded-control p-1 hover:bg-black/10 dark:hover:bg-white/10"
              >
                <X size={16} aria-hidden />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Per-severity background + border. `bg-accent-soft` re-skins via tokens
 * (Apple HIG = blue; owner-theme = emerald — but the banner sits outside
 * the owner-theme scope in AppShell, so the user always sees the public
 * skin). Warning falls back to amber-500 since there's no --warning token.
 */
function bgFor(severity: PublicAnnouncement["severity"]): string {
  switch (severity) {
    case "info":
      return "bg-accent-soft text-accent border-accent-soft";
    case "warning":
      return "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300";
    case "critical":
      return "bg-danger/15 text-danger border-danger/30";
  }
}

/**
 * Read every `ip-announcement-dismissed:*` key into a Set of ids. Wrapped
 * in a try/catch because reading localStorage can throw inside cross-origin
 * iframes / strict storage policies.
 */
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
    // ignore — empty set means we just show every active banner
  }
  return set;
}
