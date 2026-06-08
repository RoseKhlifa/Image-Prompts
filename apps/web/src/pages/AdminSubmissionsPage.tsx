import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { isLocale, type Locale } from "@ip/shared";
import AppShell from "../components/layout/AppShell";
import AdminSubmissionList from "../components/admin/AdminSubmissionList";
import AdminSubmissionPreview from "../components/admin/AdminSubmissionPreview";
import { useSession } from "../lib/hooks/useSession";
import { withLocale } from "../lib/locale";

type Status = "pending" | "approved" | "rejected";

const STATUSES = ["pending", "approved", "rejected"] as const;

function isStatus(v: string | null): v is Status {
  return v === "pending" || v === "approved" || v === "rejected";
}

/**
 * /:locale/admin/submissions[/:id]
 *
 * Split-pane moderation page assembling Task 38 components. Status tabs control
 * the left-side list; clicking a row sets the optional `:id` segment which
 * drives the right-side preview/action bar. Resolving (approve/reject) clears
 * the id and returns to the list.
 *
 * Access: non-admin/moderator sessions are bounced to `/`. The redirect runs
 * in a useEffect so the initial render of an authed admin doesn't flash.
 */
export default function AdminSubmissionsPage() {
  const { t } = useTranslation();
  const session = useSession();
  const navigate = useNavigate();
  const { locale: param, id } = useParams<{ locale: string; id?: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const [params, setParams] = useSearchParams();
  const role = session.data?.user.role;

  useEffect(() => {
    if (session.isLoading) return;
    if (!session.data || !(role === "admin" || role === "moderator")) {
      navigate(withLocale(locale, "/"));
    }
  }, [session.isLoading, session.data, role, navigate, locale]);

  const status: Status = isStatus(params.get("status")) ? (params.get("status") as Status) : "pending";

  function setStatus(s: Status) {
    const next = new URLSearchParams(params);
    next.set("status", s);
    setParams(next, { replace: true });
  }

  function selectId(next: string) {
    navigate(withLocale(locale, `/admin/submissions/${next}?status=${status}`));
  }

  function onResolved() {
    navigate(withLocale(locale, `/admin/submissions?status=${status}`));
  }

  return (
    <AppShell>
      <div className="mx-auto max-w-7xl p-6">
        <h1 className="mb-4 text-2xl font-semibold text-ink">{t("admin.page_title")}</h1>
        <div className="mb-4 flex gap-2">
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`rounded-card border px-3 py-1.5 text-sm ${
                status === s
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-border-soft text-ink-muted hover:text-ink"
              }`}
            >
              {t(`admin.tab_${s}`)}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[40%_1fr]">
          <div>
            <AdminSubmissionList status={status} selectedId={id ?? null} onSelect={selectId} />
          </div>
          <div>
            <AdminSubmissionPreview id={id ?? null} onResolved={onResolved} />
          </div>
        </div>
      </div>
    </AppShell>
  );
}
