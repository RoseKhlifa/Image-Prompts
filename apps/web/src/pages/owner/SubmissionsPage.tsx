import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { isLocale, type Locale } from "@ip/shared";
import AdminSubmissionList from "../../components/admin/AdminSubmissionList";
import AdminSubmissionPreview from "../../components/admin/AdminSubmissionPreview";
import { withLocale } from "../../lib/locale";

type Status = "pending" | "approved" | "rejected";

const STATUSES = ["pending", "approved", "rejected"] as const;

function isStatus(v: string | null): v is Status {
  return v === "pending" || v === "approved" || v === "rejected";
}

/**
 * /:locale/rosekhlifa/submissions[/:id]
 *
 * The submission queue, mounted inside OwnerLayout (whose root carries the
 * `owner-theme` class — see styles/tokens.css). The list, row, preview and
 * action-bar components consume Apple HIG tokens (bg-canvas / text-ink /
 * bg-accent-soft / border-border-soft), so they re-skin to zinc + emerald
 * automatically without any per-component edits.
 *
 * Auth is upstream: OwnerGuard rejects non-owners before this page mounts,
 * so no useEffect bounce here. The page mirrors the layout of the legacy
 * /admin/submissions (pending/approved/rejected tabs → split-pane list +
 * preview) — those routes still exist for non-owner admin/moderator users.
 */
export default function SubmissionsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { locale: param, id } = useParams<{ locale: string; id?: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const [params, setParams] = useSearchParams();
  const status: Status = isStatus(params.get("status"))
    ? (params.get("status") as Status)
    : "pending";

  function setStatus(s: Status) {
    const next = new URLSearchParams(params);
    next.set("status", s);
    setParams(next, { replace: true });
  }

  function selectId(next: string) {
    navigate(
      withLocale(locale, `/rosekhlifa/submissions/${next}?status=${status}`),
    );
  }

  function onResolved() {
    navigate(
      withLocale(locale, `/rosekhlifa/submissions?status=${status}`),
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">
        {t("owner.submissions.title")}
      </h1>
      <p className="mt-1 text-sm text-ink-muted">
        {t("owner.submissions.subtitle_queue")}
      </p>

      <div className="mt-5 flex gap-2">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={`rounded-card border px-3 py-1.5 text-sm transition ${
              status === s
                ? "border-accent bg-accent-soft text-accent"
                : "border-border-soft text-ink-muted hover:text-ink"
            }`}
          >
            {t(`admin.tab_${s}`)}
          </button>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-[40%_1fr]">
        <div>
          <AdminSubmissionList
            status={status}
            selectedId={id ?? null}
            onSelect={selectId}
          />
        </div>
        <div>
          <AdminSubmissionPreview id={id ?? null} onResolved={onResolved} />
        </div>
      </div>
    </div>
  );
}
