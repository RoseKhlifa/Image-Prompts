import { useTranslation } from "react-i18next";
import { useOwnerR2Accounts } from "../../lib/hooks/useOwnerR2";

function fmtBytes(n: number | null): string {
  if (n === null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function R2Page() {
  const { t } = useTranslation();
  const q = useOwnerR2Accounts();

  return (
    <div>
      <h1 className="text-2xl font-semibold">{t("owner.r2.title")}</h1>
      <p className="mt-1 text-sm text-zinc-400">{t("owner.r2.subtitle_readonly")}</p>

      {q.isLoading && <div className="mt-6 text-zinc-400">…</div>}
      {q.isError && <div className="mt-6 text-rose-400">{t("common.error_load")}</div>}

      {q.data && (
        <div className="mt-6 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-800 text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-3 py-3 text-left">{t("owner.r2.col_name")}</th>
                <th className="px-3 py-3 text-left">{t("owner.r2.col_endpoint")}</th>
                <th className="px-3 py-3 text-left">{t("owner.r2.col_bucket")}</th>
                <th className="px-3 py-3 text-right">{t("owner.r2.col_priority")}</th>
                <th className="px-3 py-3 text-left">{t("owner.r2.col_enabled")}</th>
                <th className="px-3 py-3 text-right">{t("owner.r2.col_used")}</th>
                <th className="px-3 py-3 text-left">{t("owner.r2.col_synced")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {q.data.items.map((r) => (
                <tr key={r.id} className={r.deletedAt ? "opacity-50" : ""}>
                  <td className="px-3 py-2 text-zinc-100">{r.name}</td>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-400">
                    {truncate(r.endpoint, 32)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-400">{r.bucket}</td>
                  <td className="px-3 py-2 text-right text-zinc-300">{r.priority}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        r.enabled
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-zinc-700/60 text-zinc-400"
                      }`}
                    >
                      {r.enabled ? t("owner.r2.enabled_yes") : t("owner.r2.enabled_no")}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-zinc-300">
                    {fmtBytes(r.usedBytes)}
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-500">
                    {r.lastSyncedAt
                      ? new Date(r.lastSyncedAt).toLocaleString()
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-zinc-500">
        {t("owner.r2.crud_coming_in_b")}
      </p>
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
