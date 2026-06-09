import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { isLocale, pickBilingual, type Locale } from "@ip/shared";
import { ExternalLink } from "lucide-react";
import {
  useOwnerReports,
  useUpdateReport,
  type OwnerReportRow,
  type ReportStatus,
} from "../../lib/hooks/useReports";
import { withLocale } from "../../lib/locale";
import { toast } from "../../lib/toast";

/**
 * /:locale/rosekhlifa/reports — moderation queue for user-filed reports.
 *
 * Default tab is "open" (the work). Status tabs:
 *   open      — fresh, not yet looked at
 *   reviewing — the moderator started checking, needs more info / follow up
 *   resolved  — action taken (text recorded in actionTaken column)
 *   dismissed — invalid / not-actionable
 *
 * One action affordance per row (dropdown with the three target statuses
 * the row can transition into). An optional `actionTaken` field is
 * prompted via window.prompt for now — when we add comments/full review
 * surface later it'll move into a proper modal.
 */
const STATUSES: ReportStatus[] = ["open", "reviewing", "resolved", "dismissed"];

export default function ReportsPage() {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";

  const [status, setStatus] = useState<ReportStatus>("open");
  const [page, setPage] = useState(1);

  const listQ = useOwnerReports({ status, page });
  const updateMut = useUpdateReport();

  function handleTransition(row: OwnerReportRow, next: ReportStatus) {
    const note =
      next === "resolved" || next === "dismissed"
        ? window.prompt(t("owner.reports.action_prompt"))
        : null;
    if ((next === "resolved" || next === "dismissed") && note === null) return;
    updateMut.mutate(
      {
        id: row.id,
        status: next,
        ...(note ? { actionTaken: note } : {}),
      },
      {
        onSuccess: () => toast.success(t("owner.reports.updated")),
        onError: (err) => toast.error(err.message ?? t("common.error")),
      },
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">
            {t("owner.reports.title")}
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            {t("owner.reports.subtitle")}
          </p>
        </div>
      </div>

      {/* Status tabs */}
      <div className="mt-5 flex flex-wrap gap-1.5 border-b border-zinc-800">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => {
              setStatus(s);
              setPage(1);
            }}
            className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${
              status === s
                ? "border-emerald-400 text-emerald-300"
                : "border-transparent text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {t(`owner.reports.status.${s}`)}
          </button>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-800 text-xs uppercase tracking-wider text-zinc-500">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">
                {t("owner.reports.col_created")}
              </th>
              <th className="px-4 py-3 text-left font-semibold">
                {t("owner.reports.col_reporter")}
              </th>
              <th className="px-4 py-3 text-left font-semibold">
                {t("owner.reports.col_target")}
              </th>
              <th className="px-4 py-3 text-left font-semibold">
                {t("owner.reports.col_reason")}
              </th>
              <th className="px-4 py-3 text-left font-semibold">
                {t("owner.reports.col_detail")}
              </th>
              <th className="px-4 py-3 text-right font-semibold">
                {t("owner.reports.col_actions")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {listQ.isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-zinc-500">
                  {t("common.loading")}
                </td>
              </tr>
            )}
            {!listQ.isLoading &&
              !listQ.isError &&
              (listQ.data?.items.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-zinc-500">
                    {t("owner.reports.empty")}
                  </td>
                </tr>
              )}
            {listQ.data?.items.map((r) => {
              const title =
                r.target?.title
                  ? pickBilingual(r.target.title, locale) ?? r.target.slug
                  : r.target?.slug ?? `(${t("owner.reports.target_missing")})`;
              return (
                <tr key={r.id} className="hover:bg-zinc-900/60">
                  <td className="px-4 py-3 align-top font-mono text-xs text-zinc-400">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-3 align-top text-xs">
                    {r.reporter ? (
                      <div>
                        <div className="text-zinc-200">
                          {r.reporter.name ?? "—"}
                        </div>
                        <div className="font-mono text-[10px] text-zinc-500">
                          {r.reporter.email}
                        </div>
                      </div>
                    ) : (
                      <span className="text-zinc-500">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top text-xs">
                    {r.target?.slug ? (
                      <Link
                        to={withLocale(locale, `/prompts/${r.target.slug}`)}
                        target="_blank"
                        className="inline-flex items-center gap-1 text-zinc-200 hover:text-accent"
                      >
                        <span className="line-clamp-2">{title}</span>
                        <ExternalLink size={10} className="shrink-0" />
                      </Link>
                    ) : (
                      <span className="text-zinc-500 line-through">
                        {r.targetId.slice(0, 8)}…
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top text-xs">
                    <span className="rounded-full bg-zinc-800 px-2 py-0.5 text-zinc-300">
                      {t(`report.reason.${r.reason}`, { defaultValue: r.reason })}
                    </span>
                  </td>
                  <td className="max-w-[260px] px-4 py-3 align-top text-xs text-zinc-400">
                    {r.detail ? (
                      <span className="line-clamp-3 whitespace-pre-wrap">
                        {r.detail}
                      </span>
                    ) : (
                      <span className="text-zinc-600">—</span>
                    )}
                    {r.actionTaken && (
                      <div className="mt-1.5 rounded border-l-2 border-emerald-500/40 bg-emerald-500/5 px-2 py-1 text-[11px] text-emerald-300">
                        ✓ {r.actionTaken}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 align-top text-right">
                    <div className="flex flex-col gap-1.5">
                      {STATUSES.filter((s) => s !== r.status).map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => handleTransition(r, s)}
                          disabled={updateMut.isPending}
                          className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
                            s === "resolved"
                              ? "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
                              : s === "dismissed"
                                ? "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
                                : s === "reviewing"
                                  ? "bg-amber-500/15 text-amber-300 hover:bg-amber-500/25"
                                  : "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
                          } disabled:opacity-40`}
                        >
                          → {t(`owner.reports.status.${s}`)}
                        </button>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Footer: page nav */}
      <div className="mt-4 flex items-center justify-between text-xs text-zinc-500">
        <span>
          {t("owner.reports.total", {
            n: listQ.data?.total ?? 0,
            defaultValue: `共 ${listQ.data?.total ?? 0} 条`,
          })}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
          >
            ← {t("common.prev_page")}
          </button>
          <span className="font-mono text-xs text-zinc-400">{page}</span>
          <button
            type="button"
            onClick={() => setPage((p) => p + 1)}
            disabled={!listQ.data?.hasMore}
            className="rounded-md border border-zinc-700 bg-zinc-900 px-3 py-1 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
          >
            {t("common.next_page")} →
          </button>
        </div>
      </div>
    </div>
  );
}
