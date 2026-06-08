import { useTranslation } from "react-i18next";
import { useOwnerDashboard } from "../../lib/hooks/useOwnerDashboard";

function fmtNumber(n: number): string {
  return n.toLocaleString();
}
function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const q = useOwnerDashboard();

  const cards: { key: string; label: string; value: string; tone?: "warn" }[] = [];
  if (q.data) {
    const m = q.data.metrics;
    cards.push(
      { key: "pub", label: t("owner.dashboard.published_prompts"), value: fmtNumber(m.publishedPrompts) },
      { key: "users", label: t("owner.dashboard.total_users"), value: fmtNumber(m.totalUsers) },
      m.pendingSubmissions > 0
        ? {
            key: "pending",
            label: t("owner.dashboard.pending_submissions"),
            value: fmtNumber(m.pendingSubmissions),
            tone: "warn" as const,
          }
        : {
            key: "pending",
            label: t("owner.dashboard.pending_submissions"),
            value: fmtNumber(m.pendingSubmissions),
          },
      { key: "views", label: t("owner.dashboard.total_views"), value: fmtNumber(m.totalViews) },
      { key: "likes", label: t("owner.dashboard.total_likes"), value: fmtNumber(m.totalLikes) },
      { key: "favs", label: t("owner.dashboard.total_favorites"), value: fmtNumber(m.totalFavorites) },
      { key: "subs", label: t("owner.dashboard.total_submissions"), value: fmtNumber(m.totalSubmissions) },
      { key: "r2", label: t("owner.dashboard.r2_used"), value: fmtBytes(m.totalR2UsedBytes) },
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">{t("owner.dashboard.title")}</h1>
      <p className="mt-1 text-sm text-zinc-400">{t("owner.dashboard.subtitle")}</p>

      {q.isLoading && <div className="mt-6 text-zinc-400">…</div>}
      {q.isError && <div className="mt-6 text-rose-400">{t("common.error_load")}</div>}

      {q.data && (
        <>
          <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            {cards.map((c) => (
              <div
                key={c.key}
                className="rounded-lg border border-zinc-800 bg-zinc-900 p-4"
              >
                <div className="text-xs uppercase tracking-wider text-zinc-500">
                  {c.label}
                </div>
                <div
                  className={`mt-2 text-2xl font-semibold ${
                    c.tone === "warn" ? "text-amber-400" : "text-zinc-100"
                  }`}
                >
                  {c.value}
                </div>
              </div>
            ))}
          </section>

          <section className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
              {t("owner.dashboard.recent_activity")}
            </h2>
            <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900">
              {q.data.recentActivity.length === 0 ? (
                <div className="px-4 py-6 text-sm text-zinc-500">
                  {t("owner.dashboard.no_activity")}
                </div>
              ) : (
                <ul className="divide-y divide-zinc-800">
                  {q.data.recentActivity.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center gap-3 px-4 py-3 text-sm"
                    >
                      <span className="font-mono text-xs text-zinc-500">
                        {new Date(a.createdAt).toLocaleString()}
                      </span>
                      <span className="text-zinc-300">
                        {a.actorName ?? a.actorId ?? "system"}
                      </span>
                      <span className="font-mono text-xs text-emerald-400">
                        {a.action}
                      </span>
                      {a.targetType && (
                        <span className="text-xs text-zinc-500">
                          {a.targetType}/{a.targetId?.slice(0, 8)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
