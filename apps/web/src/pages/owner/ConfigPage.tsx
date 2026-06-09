import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  useSiteSettings,
  useUpdateSetting,
  type SiteSetting,
} from "../../lib/hooks/useSiteSettings";

export default function ConfigPage() {
  const { t } = useTranslation();
  const q = useSiteSettings();

  return (
    <div>
      <h1 className="text-2xl font-semibold">{t("owner.config.title")}</h1>
      <p className="mt-1 text-sm text-zinc-400">{t("owner.config.subtitle")}</p>

      {q.isLoading && <div className="mt-6 text-zinc-400">…</div>}
      {q.isError && <div className="mt-6 text-rose-400">{t("common.error_load")}</div>}

      {q.data && (
        <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-800 text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-3 text-left">{t("owner.config.col_key")}</th>
                <th className="px-4 py-3 text-left">{t("owner.config.col_value")}</th>
                <th className="px-4 py-3 text-left">{t("owner.config.col_description")}</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {q.data.items.map((s) => (
                <SettingRow key={s.key} setting={s} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SettingRow({ setting }: { setting: SiteSetting }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(stringifyValue(setting.value));
  const [error, setError] = useState<string | null>(null);
  const mut = useUpdateSetting();

  const dirty = draft !== stringifyValue(setting.value);

  function onSave() {
    let parsed: unknown;
    try {
      parsed = parseValue(draft);
    } catch {
      setError(t("owner.config.parse_error"));
      return;
    }
    // jsonb NOT NULL — defend client-side too so the user sees a clear
    // message instead of a 500/400 round-trip. Note: `""`, 0, false, [],
    // {} are all valid non-null values and ARE allowed through.
    if (parsed === null || parsed === undefined) {
      setError(t("owner.config.value_required"));
      return;
    }
    setError(null);
    mut.mutate(
      { key: setting.key, value: parsed },
      {
        onError: (e) => setError(e.message ?? t("owner.config.save_failed")),
      },
    );
  }

  return (
    <tr>
      <td className="px-4 py-2 font-mono text-xs text-zinc-300">{setting.key}</td>
      <td className="px-4 py-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
        />
        {error && <div className="mt-1 text-xs text-rose-400">{error}</div>}
      </td>
      <td className="px-4 py-2 text-xs text-zinc-400">
        {/* Prefer the locale-specific gloss; fall back to the DB description
            (English from seed) when the key has no i18n entry yet. */}
        {t(`owner.config.desc.${setting.key}`, {
          defaultValue: setting.description,
        })}
      </td>
      <td className="px-4 py-2 text-right">
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty || mut.isPending}
          className="rounded-md bg-emerald-500 px-3 py-1 text-xs font-medium text-zinc-950 hover:bg-emerald-400 disabled:opacity-40"
        >
          {mut.isPending ? "…" : t("owner.config.save")}
        </button>
      </td>
    </tr>
  );
}

function stringifyValue(v: unknown): string {
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}
function parseValue(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
