import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams, useSearchParams } from "react-router";
import { X } from "lucide-react";
import { isLocale, type Locale } from "@ip/shared";
import AvatarBadge from "../../components/auth/AvatarBadge";
import {
  useBanUser,
  useOwnerUsersList,
  useOwnerUserDetail,
  useUnbanUser,
  useUpdateUserRole,
  type OwnerUserListRow,
  type OwnerUserRole,
  type UsersListFilters,
} from "../../lib/hooks/useOwnerUsers";
import { toast } from "../../lib/toast";

const ROLES: OwnerUserRole[] = ["user", "moderator", "admin"];

function isRole(v: string | null): v is OwnerUserRole {
  return v === "user" || v === "moderator" || v === "admin";
}

/**
 * /:locale/rosekhlifa/users — list + drawer for owner user management.
 *
 * Sits inside OwnerLayout, so all `bg-panel / text-ink / bg-accent-soft /
 * border-border-soft` utilities pick up the zinc/emerald palette from the
 * `owner-theme` scope (see styles/tokens.css). The page deliberately does
 * not hardcode zinc-* / emerald-* classes for body content — letting the
 * theme tokens drive presentation keeps the read-skin contract clean.
 *
 * M10b W2 wired ban/unban into the drawer (banned_at + banned_reason now
 * live on `users`). Still out of scope: force-logout, delete user, and
 * resetting rejected_count.
 */
export default function UsersPage() {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const _locale: Locale = isLocale(param) ? param : "zh";
  // _locale reserved for future localized rendering (e.g., date formatters /
  // bilingual title fallback inside the recent submissions list).
  void _locale;
  const [params, setParams] = useSearchParams();

  // ── URL-backed filter state ──────────────────────────────────────────
  const qParam = params.get("q") ?? "";
  const roleParam = isRole(params.get("role")) ? (params.get("role") as OwnerUserRole) : null;

  // Local-only mirror of the search box so we can debounce writes to the
  // URL (and therefore the query). Initialized from the URL on mount.
  const [searchDraft, setSearchDraft] = useState(qParam);

  // Debounce the search input → URL (300ms). Skip the no-op write so we
  // don't push extra history entries.
  //
  // We include `qParam` (URL truth), `params` (so we copy current shape),
  // and `setParams` (stable). The early return when draft === qParam
  // prevents the loop: writing the URL bumps `qParam`, the effect re-runs,
  // and the next iteration is a no-op.
  useEffect(() => {
    const handle = setTimeout(() => {
      if (searchDraft === qParam) return;
      const next = new URLSearchParams(params);
      if (searchDraft) next.set("q", searchDraft);
      else next.delete("q");
      setParams(next, { replace: true });
    }, 300);
    return () => clearTimeout(handle);
  }, [searchDraft, qParam, params, setParams]);

  // Keep the draft in sync if the URL changes externally (e.g. back/forward).
  useEffect(() => {
    setSearchDraft(qParam);
  }, [qParam]);

  function setRole(next: OwnerUserRole | null) {
    const params2 = new URLSearchParams(params);
    if (next) params2.set("role", next);
    else params2.delete("role");
    setParams(params2, { replace: true });
  }

  const filters: UsersListFilters = useMemo(() => {
    const f: UsersListFilters = {};
    if (qParam) f.q = qParam;
    if (roleParam) f.role = roleParam;
    return f;
  }, [qParam, roleParam]);

  const q = useOwnerUsersList(filters);
  const items = (q.data?.pages ?? []).flatMap((p) => p.items);
  const hasMore = q.hasNextPage ?? false;

  // ── Drawer ────────────────────────────────────────────────────────────
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-ink">{t("owner.users.title")}</h1>
      <p className="mt-1 text-sm text-ink-muted">{t("owner.users.subtitle")}</p>

      {/* Filters row — sticky just below OwnerTopbar (h-14). */}
      <div className="sticky top-14 z-[5] -mx-6 mt-5 border-b border-border-soft bg-canvas/95 px-6 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="search"
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder={t("owner.users.search_placeholder")}
            className="w-72 rounded-control border border-border-soft bg-panel-2 px-3 py-1.5 text-sm text-ink placeholder:text-ink-dim focus:border-accent focus:outline-none"
          />
          <select
            value={roleParam ?? ""}
            onChange={(e) => setRole(isRole(e.target.value) ? e.target.value : null)}
            className="rounded-control border border-border-soft bg-panel-2 px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
          >
            <option value="">{t("owner.users.role_all")}</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <div className="ml-auto text-xs text-ink-muted">
            {q.isLoading ? "…" : `${items.length}${hasMore ? "+" : ""}`}
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="mt-4 overflow-x-auto rounded-card border border-border-soft bg-panel">
        <table className="w-full text-sm">
          <thead className="border-b border-border-soft text-xs uppercase tracking-wider text-ink-muted">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">
                {t("owner.users.col_user")}
              </th>
              <th className="px-4 py-3 text-left font-semibold">
                {t("owner.users.col_email")}
              </th>
              <th className="px-4 py-3 text-left font-semibold">
                {t("owner.users.col_role")}
              </th>
              <th className="px-4 py-3 text-right font-semibold">
                {t("owner.users.col_published")}
              </th>
              <th className="px-4 py-3 text-right font-semibold">
                {t("owner.users.col_submissions")}
              </th>
              <th className="px-4 py-3 text-right font-semibold">
                {t("owner.users.col_rejected")}
              </th>
              <th className="px-4 py-3 text-left font-semibold">
                {t("owner.users.col_status")}
              </th>
              <th className="px-4 py-3 text-left font-semibold">
                {t("owner.users.col_joined")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {q.isLoading && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-ink-muted">
                  {t("common.loading")}
                </td>
              </tr>
            )}
            {q.isError && !q.isLoading && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-danger">
                  {t("common.error_load")}
                </td>
              </tr>
            )}
            {!q.isLoading && items.length === 0 && !q.isError && (
              <tr>
                <td colSpan={8} className="px-4 py-6 text-center text-ink-muted">
                  {t("common.empty")}
                </td>
              </tr>
            )}
            {items.map((u) => (
              <UserRow
                key={u.id}
                user={u}
                selected={selectedId === u.id}
                onSelect={() => setSelectedId(u.id)}
              />
            ))}
          </tbody>
        </table>
      </div>

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

      {selectedId !== null && (
        <UserDrawer id={selectedId} onClose={() => setSelectedId(null)} />
      )}
    </div>
  );
}

// ── Row ────────────────────────────────────────────────────────────────

function UserRow({
  user,
  selected,
  onSelect,
}: {
  user: OwnerUserListRow;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <tr
      onClick={onSelect}
      className={`cursor-pointer transition ${
        selected ? "bg-accent-soft" : "hover:bg-bg-2"
      }`}
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <AvatarBadge src={user.image} name={user.name} email={user.email} />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-ink">
              {user.name ?? "—"}
            </div>
            <div className="truncate font-mono text-[11px] text-ink-dim">
              {user.id.slice(0, 8)}
            </div>
          </div>
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-ink-muted">{user.email}</td>
      <td className="px-4 py-3">
        <RoleBadge role={user.role} />
      </td>
      <td className="px-4 py-3 text-right text-sm tabular-nums text-ink">
        {user.publishedPrompts.toLocaleString()}
      </td>
      <td className="px-4 py-3 text-right text-sm tabular-nums text-ink">
        {user.totalSubmissions.toLocaleString()}
      </td>
      <td className="px-4 py-3 text-right text-sm tabular-nums text-ink-muted">
        {user.rejectedCount.toLocaleString()}
      </td>
      <td className="px-4 py-3">
        <BanStatusPill bannedAt={user.bannedAt} />
      </td>
      <td className="px-4 py-3 text-xs text-ink-muted">
        {new Date(user.createdAt).toLocaleDateString()}
      </td>
    </tr>
  );
}

/**
 * Active / Banned pill. Driven by `users.banned_at IS NOT NULL`. Uses the
 * `--success` / `--danger` tokens exposed via the Tailwind theme block, so
 * the colour is consistent across the Apple HIG and owner zinc/emerald
 * skins without per-page overrides.
 */
function BanStatusPill({ bannedAt }: { bannedAt: string | null }) {
  const { t } = useTranslation();
  const banned = bannedAt !== null;
  const className = banned
    ? "bg-danger/15 text-danger"
    : "bg-success/15 text-success";
  return (
    <span
      className={`inline-flex items-center rounded-pill px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {banned ? t("owner.users.status_banned") : t("owner.users.status_active")}
    </span>
  );
}

function RoleBadge({ role }: { role: OwnerUserRole }) {
  const isAdmin = role === "admin";
  const isMod = role === "moderator";
  const className = isAdmin
    ? "bg-accent-soft text-accent"
    : isMod
      ? "bg-surface text-ink"
      : "bg-bg-2 text-ink-muted";
  return (
    <span
      className={`inline-flex items-center rounded-pill px-2 py-0.5 text-xs font-medium ${className}`}
    >
      {role}
    </span>
  );
}

// ── Drawer ─────────────────────────────────────────────────────────────

function UserDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const detail = useOwnerUserDetail(id);
  const mut = useUpdateUserRole();
  const banMut = useBanUser();
  const unbanMut = useUnbanUser();
  const [roleDraft, setRoleDraft] = useState<OwnerUserRole | null>(null);
  const [banModalOpen, setBanModalOpen] = useState(false);

  // Initialize the role draft from the loaded detail (without overriding a
  // pending in-flight selection if the user is in the middle of editing).
  useEffect(() => {
    if (detail.data && roleDraft === null) {
      setRoleDraft(detail.data.role);
    }
  }, [detail.data, roleDraft]);

  // Reset the draft when switching users. Also close the ban modal so a
  // half-typed reason can't leak across drawer subjects.
  useEffect(() => {
    setRoleDraft(null);
    setBanModalOpen(false);
  }, [id]);

  const dirty =
    detail.data !== null &&
    detail.data !== undefined &&
    roleDraft !== null &&
    roleDraft !== detail.data.role;

  function save() {
    if (!detail.data || roleDraft === null) return;
    mut.mutate(
      { id, role: roleDraft },
      {
        onSuccess: () => {
          toast.success(t("owner.users.drawer_role_updated"));
        },
        onError: (err) => {
          toast.error(err.message ?? t("common.error"));
        },
      },
    );
  }

  function unban() {
    if (!detail.data) return;
    // Cheap inline confirm — the user is the operator, not an end-user, so
    // the platform-level `confirm()` is sufficient and keeps us free of an
    // extra modal in the drawer. The list+detail invalidate covers
    // optimistic UI without us touching the cache directly.
    if (!window.confirm(t("owner.users.unban_confirm_question"))) return;
    unbanMut.mutate(id, {
      onSuccess: () => {
        toast.success(t("owner.users.unban_success"));
      },
      onError: (err) => {
        toast.error(err.message ?? t("owner.users.unban_failed"));
      },
    });
  }

  return (
    <>
    <aside
      role="dialog"
      aria-label={t("owner.users.drawer_role_label")}
      className="fixed right-0 top-14 bottom-0 z-20 flex w-96 flex-col border-l border-border-soft bg-panel-2 shadow-card"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-border-soft px-5 py-4">
        {detail.data ? (
          <div className="flex min-w-0 items-center gap-3">
            <AvatarBadge
              src={detail.data.image}
              name={detail.data.name}
              email={detail.data.email}
              size={40}
            />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-ink">
                {detail.data.name ?? "—"}
              </div>
              <div className="truncate text-xs text-ink-muted">
                {detail.data.email}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-sm text-ink-muted">
            {detail.isLoading ? t("common.loading") : t("common.error_load")}
          </div>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label={t("owner.users.drawer_close")}
          className="rounded-control p-1 text-ink-muted hover:bg-surface hover:text-ink"
        >
          <X size={16} aria-hidden />
        </button>
      </div>

      {detail.data && (
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Stats grid */}
          <div className="grid grid-cols-2 gap-2">
            <StatCard
              label={t("owner.users.col_published")}
              value={detail.data.publishedPrompts}
            />
            <StatCard
              label={t("owner.users.col_submissions")}
              value={detail.data.totalSubmissions}
            />
            <StatCard
              label={t("owner.users.col_rejected")}
              value={detail.data.rejectedCount}
            />
            <StatCard
              label="CGV"
              value={detail.data.communityGuidelinesVersion}
            />
          </div>

          {/* Role section */}
          <div className="mt-5 rounded-card border border-border-soft bg-panel p-4">
            <label className="block text-xs uppercase tracking-wider text-ink-muted">
              {t("owner.users.drawer_role_label")}
            </label>
            <div className="mt-2 flex items-center gap-2">
              <select
                value={roleDraft ?? detail.data.role}
                onChange={(e) =>
                  setRoleDraft(isRole(e.target.value) ? e.target.value : detail.data!.role)
                }
                disabled={mut.isPending}
                className="flex-1 rounded-control border border-border-soft bg-panel-2 px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={save}
                disabled={!dirty || mut.isPending}
                className="rounded-control bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-2 disabled:opacity-40"
              >
                {mut.isPending
                  ? t("owner.users.drawer_saving")
                  : t("owner.users.drawer_save")}
              </button>
            </div>
          </div>

          {/* Moderation (ban / unban) */}
          <div className="mt-5 rounded-card border border-border-soft bg-panel p-4">
            <div className="text-xs uppercase tracking-wider text-ink-muted">
              {t("owner.users.ban_section_title")}
            </div>
            {detail.data.bannedAt !== null && (
              <div className="mt-2 space-y-1.5 rounded-control bg-danger/10 px-3 py-2 text-xs text-danger">
                <div className="flex items-center gap-2 font-medium">
                  <BanStatusPill bannedAt={detail.data.bannedAt} />
                  <span>
                    {t("owner.users.ban_since")}{" "}
                    {new Date(detail.data.bannedAt).toLocaleString()}
                  </span>
                </div>
                {detail.data.bannedReason !== null && (
                  <div>
                    <span className="text-ink-muted">
                      {t("owner.users.ban_reason_label_shown")}:
                    </span>{" "}
                    <span className="text-ink">{detail.data.bannedReason}</span>
                  </div>
                )}
              </div>
            )}
            <div className="mt-3">
              {detail.data.bannedAt === null ? (
                <button
                  type="button"
                  onClick={() => setBanModalOpen(true)}
                  disabled={banMut.isPending}
                  className="rounded-control bg-danger px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
                >
                  {t("owner.users.ban_button")}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={unban}
                  disabled={unbanMut.isPending}
                  className="rounded-control border border-border-soft px-3 py-1.5 text-xs font-medium text-ink hover:bg-panel-2 disabled:opacity-40"
                >
                  {unbanMut.isPending
                    ? t("owner.users.drawer_saving")
                    : t("owner.users.unban_button")}
                </button>
              )}
            </div>
          </div>

          {/* Recent submissions */}
          <div className="mt-5">
            <div className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
              {t("owner.users.drawer_recent_submissions")}
            </div>
            {detail.data.recentSubmissions.length === 0 ? (
              <div className="mt-2 text-sm text-ink-muted">
                {t("owner.users.drawer_no_recent")}
              </div>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {detail.data.recentSubmissions.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center gap-2 rounded-control border border-border-soft bg-panel px-3 py-2 text-xs"
                  >
                    <StatusPill status={s.status} />
                    <span className="min-w-0 flex-1 truncate text-ink">
                      {s.titleZh ?? s.titleEn ?? "—"}
                    </span>
                    <span className="text-[10px] text-ink-dim">
                      {new Date(s.createdAt).toLocaleDateString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </aside>
    {banModalOpen && (
      <BanModal
        pending={banMut.isPending}
        onCancel={() => setBanModalOpen(false)}
        onConfirm={(reason) => {
          banMut.mutate(
            { id, reason },
            {
              onSuccess: () => {
                toast.success(t("owner.users.ban_success"));
                setBanModalOpen(false);
              },
              onError: (err) => {
                toast.error(err.message ?? t("owner.users.ban_failed"));
              },
            },
          );
        }}
      />
    )}
    </>
  );
}

/**
 * Tiny inline modal for the ban-reason form. Deliberately styled inline
 * rather than reaching for a shared Dialog primitive — it's a single
 * narrow case (operator-only, locale-aware, no nested focus traps) so the
 * fixed-overlay + bg-panel pair below is enough.
 *
 * Trims the reason before validating + submitting (matches the API
 * z.string().trim().min(1).max(500) schema in routes/owner.ts).
 */
function BanModal({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState("");
  const [showError, setShowError] = useState(false);
  const trimmed = reason.trim();

  function submit() {
    if (trimmed.length === 0) {
      setShowError(true);
      return;
    }
    onConfirm(trimmed);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("owner.users.ban_modal_title")}
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 px-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-card bg-panel p-6 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-ink">
          {t("owner.users.ban_modal_title")}
        </h2>
        <label className="mt-4 block text-xs uppercase tracking-wider text-ink-muted">
          {t("owner.users.ban_reason_label")}
        </label>
        <textarea
          autoFocus
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            if (showError && e.target.value.trim().length > 0) setShowError(false);
          }}
          placeholder={t("owner.users.ban_reason_placeholder")}
          rows={4}
          maxLength={500}
          disabled={pending}
          className="mt-2 w-full resize-none rounded-control border border-border-soft bg-panel-2 px-3 py-2 text-sm text-ink placeholder:text-ink-dim focus:border-accent focus:outline-none"
        />
        {showError && (
          <div className="mt-1 text-xs text-danger">
            {t("owner.users.ban_reason_required")}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="rounded-control border border-border-soft px-3 py-1.5 text-xs font-medium text-ink hover:bg-panel-2 disabled:opacity-40"
          >
            {t("owner.users.ban_cancel")}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="rounded-control bg-danger px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            {pending ? t("owner.users.drawer_saving") : t("owner.users.ban_confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-card border border-border-soft bg-panel p-3">
      <div className="text-[10px] uppercase tracking-wider text-ink-dim">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold text-ink tabular-nums">
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: "pending" | "approved" | "rejected" }) {
  const className =
    status === "approved"
      ? "bg-accent-soft text-accent"
      : status === "rejected"
        ? "bg-surface text-ink-muted"
        : "bg-bg-2 text-ink-muted";
  return (
    <span
      className={`inline-flex items-center rounded-pill px-1.5 py-0.5 text-[10px] font-medium ${className}`}
    >
      {status}
    </span>
  );
}
