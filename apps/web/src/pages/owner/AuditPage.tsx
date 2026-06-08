import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router";
import AvatarBadge from "../../components/auth/AvatarBadge";
import EmptyState from "../../components/EmptyState";
import {
  useOwnerAudit,
  type OwnerAuditFilters,
  type OwnerAuditRow,
} from "../../lib/hooks/useOwnerAudit";

/**
 * /:locale/rosekhlifa/audit — read-only audit log feed.
 *
 * Binds to GET /api/owner/audit (W1.4). Filters live in the URL so a row
 * pointing at, say, `?actor=<uuid>` is shareable; inputs are mirrored into
 * local drafts and debounced 300ms before being written back, mirroring the
 * UsersPage (W1.3) pattern so the two pages behave the same.
 *
 * All body styles use theme tokens — owner-theme (set on OwnerLayout) re-skins
 * the Apple HIG palette to zinc/emerald via CSS vars, so this page renders
 * dark without hardcoding `zinc-*` / `emerald-*` anywhere below.
 */
export default function AuditPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();

  // ── URL-backed filters ───────────────────────────────────────────────
  // Param names (`action`, `actor`, `target`) are the *shareable URL* shape;
  // the API expects `actionPrefix` / `actorId` / `targetType`. The hook
  // maps between them so the URL stays readable.
  const actionParam = params.get("action") ?? "";
  const actorParam = params.get("actor") ?? "";
  const targetParam = params.get("target") ?? "";

  const [actionDraft, setActionDraft] = useState(actionParam);
  const [actorDraft, setActorDraft] = useState(actorParam);
  const [targetDraft, setTargetDraft] = useState(targetParam);

  // Debounce each filter input → URL (300ms). The early-return when draft
  // already matches URL prevents the effect/loop cycle: writing the URL
  // bumps the param, the effect re-runs, and the next iteration is a no-op.
  useEffect(() => {
    const handle = setTimeout(() => {
      if (
        actionDraft === actionParam &&
        actorDraft === actorParam &&
        targetDraft === targetParam
      ) {
        return;
      }
      const next = new URLSearchParams(params);
      if (actionDraft) next.set("action", actionDraft);
      else next.delete("action");
      if (actorDraft) next.set("actor", actorDraft);
      else next.delete("actor");
      if (targetDraft) next.set("target", targetDraft);
      else next.delete("target");
      setParams(next, { replace: true });
    }, 300);
    return () => clearTimeout(handle);
  }, [
    actionDraft,
    actorDraft,
    targetDraft,
    actionParam,
    actorParam,
    targetParam,
    params,
    setParams,
  ]);

  // Keep drafts in sync if the URL changes externally (back/forward).
  useEffect(() => setActionDraft(actionParam), [actionParam]);
  useEffect(() => setActorDraft(actorParam), [actorParam]);
  useEffect(() => setTargetDraft(targetParam), [targetParam]);

  const filters: OwnerAuditFilters = useMemo(() => {
    const f: OwnerAuditFilters = {};
    if (actionParam) f.actionPrefix = actionParam;
    if (actorParam) f.actorId = actorParam;
    if (targetParam) f.targetType = targetParam;
    return f;
  }, [actionParam, actorParam, targetParam]);

  const q = useOwnerAudit(filters);
  const items = (q.data?.pages ?? []).flatMap((p) => p.items);
  const hasMore = q.hasNextPage ?? false;

  // ── Expanded payload rows ────────────────────────────────────────────
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">{t("owner.audit.title")}</h1>
      <p className="mt-1 text-sm text-ink-muted">{t("owner.audit.subtitle")}</p>

      {/* Filters row — sticky just below OwnerTopbar (h-14). */}
      <div className="sticky top-14 z-[5] -mx-6 mt-5 border-b border-border-soft bg-canvas/95 px-6 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={actionDraft}
            onChange={(e) => setActionDraft(e.target.value)}
            placeholder={t("owner.audit.filter_action_placeholder")}
            className="w-56 rounded-control border border-border-soft bg-panel-2 px-3 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:border-accent focus:outline-none"
          />
          <input
            type="text"
            value={actorDraft}
            onChange={(e) => setActorDraft(e.target.value)}
            placeholder={t("owner.audit.filter_actor_placeholder")}
            className="w-80 rounded-control border border-border-soft bg-panel-2 px-3 py-1.5 font-mono text-xs text-ink placeholder:text-ink-dim focus:border-accent focus:outline-none"
          />
          <input
            type="text"
            value={targetDraft}
            onChange={(e) => setTargetDraft(e.target.value)}
            placeholder={t("owner.audit.filter_target_placeholder")}
            className="w-56 rounded-control border border-border-soft bg-panel-2 px-3 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:border-accent focus:outline-none"
          />
          <div className="ml-auto text-xs text-ink-muted">
            {q.isLoading ? "…" : `${items.length}${hasMore ? "+" : ""}`}
          </div>
        </div>
      </div>

      {/* Table / empty state */}
      {!q.isLoading && !q.isError && items.length === 0 ? (
        <EmptyState message={t("owner.audit.no_results")} />
      ) : (
        <div className="mt-4 overflow-x-auto rounded-card border border-border-soft bg-panel">
          <table className="w-full text-sm">
            <thead className="border-b border-border-soft text-xs uppercase tracking-wider text-ink-muted">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">
                  {t("owner.audit.col_time")}
                </th>
                <th className="px-4 py-3 text-left font-semibold">
                  {t("owner.audit.col_actor")}
                </th>
                <th className="px-4 py-3 text-left font-semibold">
                  {t("owner.audit.col_action")}
                </th>
                <th className="px-4 py-3 text-left font-semibold">
                  {t("owner.audit.col_target")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-soft">
              {q.isLoading && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-ink-muted">
                    {t("common.loading")}
                  </td>
                </tr>
              )}
              {q.isError && !q.isLoading && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-danger">
                    {t("common.error_load")}
                  </td>
                </tr>
              )}
              {items.map((row) => (
                <AuditRow
                  key={row.id}
                  row={row}
                  expanded={expanded.has(row.id)}
                  onToggle={() => toggle(row.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hasMore && (
        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={() => q.fetchNextPage()}
            disabled={q.isFetchingNextPage}
            className="rounded-control border border-border-soft bg-panel px-4 py-1.5 text-sm text-ink-muted hover:text-ink disabled:opacity-50"
          >
            {q.isFetchingNextPage ? t("common.loading") : t("common.load_more")}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Row ────────────────────────────────────────────────────────────────

function AuditRow({
  row,
  expanded,
  onToggle,
}: {
  row: OwnerAuditRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();

  // Pretty-print the JSON payload when expanded. `JSON.stringify` returns
  // the string "undefined" for `undefined` (vs throwing for circular refs),
  // so guard for that explicitly.
  const payloadText = useMemo(() => {
    if (row.payload === null || row.payload === undefined) return "null";
    try {
      return JSON.stringify(row.payload, null, 2);
    } catch {
      return String(row.payload);
    }
  }, [row.payload]);

  return (
    <>
      <tr
        onClick={onToggle}
        className={`cursor-pointer transition ${
          expanded ? "bg-accent-soft" : "hover:bg-bg-2"
        }`}
      >
        <td className="px-4 py-3 align-top">
          <span className="font-mono text-xs text-ink-dim">
            {new Date(row.createdAt).toLocaleString()}
          </span>
        </td>
        <td className="px-4 py-3 align-top">
          {row.actorId ? (
            <div className="flex items-center gap-2">
              <AvatarBadge
                src={null}
                name={row.actorName}
                email={row.actorEmail ?? row.actorId}
                size={20}
              />
              <span className="text-sm text-ink">
                {row.actorName ?? row.actorEmail ?? t("owner.audit.system_actor")}
              </span>
            </div>
          ) : (
            <span className="text-sm italic text-ink-dim">
              {t("owner.audit.system_actor")}
            </span>
          )}
        </td>
        <td className="px-4 py-3 align-top">
          <ActionLabel action={row.action} />
        </td>
        <td className="px-4 py-3 align-top">
          {row.targetType ? (
            <span className="font-mono text-xs text-ink">
              {row.targetType}
              {row.targetId ? (
                <span className="text-ink-dim">
                  /{row.targetId.slice(0, 8)}
                </span>
              ) : null}
            </span>
          ) : (
            <span className="text-ink-dim">—</span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-bg-2">
          <td colSpan={4} className="px-4 pb-4 pt-0">
            <div className="mb-1 text-[10px] uppercase tracking-wider text-ink-dim">
              {t("owner.audit.collapse_payload")}
            </div>
            <pre className="overflow-x-auto rounded-control border border-border-soft bg-panel p-3 font-mono text-xs text-ink-muted whitespace-pre-wrap break-all">
              {payloadText}
            </pre>
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * Renders a dotted action like `user.role.update` with the prefix (everything
 * before the first dot) highlighted via `text-accent` and the remainder muted.
 * Falls back to a single muted span when the action has no dot.
 */
function ActionLabel({ action }: { action: string }) {
  const dot = action.indexOf(".");
  if (dot === -1) {
    return <span className="font-mono text-xs text-accent">{action}</span>;
  }
  const head = action.slice(0, dot);
  const tail = action.slice(dot);
  return (
    <span className="font-mono text-xs">
      <span className="text-accent">{head}</span>
      <span className="text-ink-dim">{tail}</span>
    </span>
  );
}
