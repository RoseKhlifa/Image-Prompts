import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import { MoreHorizontal, Flag, Pencil, Trash2 } from "lucide-react";
import { isLocale, type Locale } from "@ip/shared";
import { toast } from "../../lib/toast";
import { useSession } from "../../lib/hooks/useSession";
import { useDeleteOwnerPrompt } from "../../lib/hooks/useOwnerPrompts";
import { useDeleteMyPrompt } from "../../lib/hooks/useMyPrompts";
import { withLocale } from "../../lib/locale";

// Lazy-load the owner modal — most viewers aren't owners, and the modal pulls
// in TagPicker, useImageUpload, the categories query, etc. Keeping it out of
// the public-detail bundle reduces TTI for the common case.
const OwnerPromptFormModal = lazy(
  () => import("../owner/OwnerPromptFormModal"),
);
// Same logic for the contributor self-edit modal — only loaded when the
// signed-in viewer is the contributor and clicks "edit".
const MyPromptEditModal = lazy(() => import("./MyPromptEditModal"));

type Props = {
  promptId: string;
  slug: string;
  titleZh?: string;
  titleEn?: string;
  /**
   * The prompt's contributor id (null for seed content). When the signed-in
   * viewer matches this and isOwner is false, MoreMenu shows the contributor
   * branch: 编辑 → MyPromptEditModal (queues a submission), 删除 → confirm
   * + DELETE /api/me/prompts/:id (immediate). The owner branch (isOwner=true)
   * still takes precedence — owners see the existing OwnerPromptFormModal.
   */
  contributorId?: string | null;
};

/**
 * Detail-page "more" affordance. Three branches, in priority order:
 *
 *   1. isOwner: 编辑 (OwnerPromptFormModal) + 删除 (immediate, owner DELETE).
 *      Highest precedence — owners always get the direct affordance.
 *   2. contributor (session.user.id === contributorId, NOT owner):
 *      编辑 (MyPromptEditModal, queues a submission) + 删除 (confirm +
 *      /api/me/prompts/:id DELETE). The owner's UI affordance is shadowed.
 *   3. otherwise: Report only (the M5 placeholder).
 *
 * Non-owners + non-contributors see the original report-only menu — that's
 * the existing shape tested in MoreMenu.test.tsx, kept green by mocking
 * useSession to return null for those baseline tests.
 */
export default function MoreMenu({
  promptId,
  slug,
  titleZh,
  titleEn,
  contributorId,
}: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const session = useSession();
  const isOwner = session.data?.user.isOwner ?? false;
  const sessionUserId = session.data?.user.id ?? null;
  const isContributor =
    !isOwner &&
    Boolean(contributorId) &&
    Boolean(sessionUserId) &&
    sessionUserId === contributorId;

  const [open, setOpen] = useState(false);
  // Two separate edit modal flags so the owner branch and the contributor
  // branch can both compile in this file without colliding.
  const [editingOwner, setEditingOwner] = useState(false);
  const [editingMine, setEditingMine] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const ownerDeleteMut = useDeleteOwnerPrompt();
  const myDeleteMut = useDeleteMyPrompt();

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", onClickOutside);
      return () => document.removeEventListener("mousedown", onClickOutside);
    }
    return undefined;
  }, [open]);

  function handleReport() {
    // M5 placeholder — M7 will wire to ReportModal
    toast.info(t("detail.report_coming_soon"));
    setOpen(false);
  }

  function handleEditOwner() {
    setEditingOwner(true);
    setOpen(false);
  }

  function handleEditMine() {
    setEditingMine(true);
    setOpen(false);
  }

  function handleDeleteOwner() {
    setOpen(false);
    const title = titleZh ?? titleEn ?? slug;
    if (!window.confirm(t("detail.delete_confirm", { title }))) return;
    ownerDeleteMut.mutate(promptId, {
      onSuccess: () => {
        toast.success(t("detail.deleted"));
        navigate(withLocale(locale, "/prompts"));
      },
      onError: (err) => toast.error(err.message ?? t("common.error")),
    });
  }

  function handleDeleteMine() {
    setOpen(false);
    const title = titleZh ?? titleEn ?? slug;
    if (!window.confirm(t("detail.delete_my_prompt_confirm", { title }))) return;
    myDeleteMut.mutate(
      { id: promptId, slug },
      {
        onSuccess: () => {
          toast.success(t("detail.deleted_self"));
          navigate(withLocale(locale, "/prompts"));
        },
        onError: (err) => toast.error(err.message ?? t("common.error")),
      },
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border-soft bg-surface text-ink-muted hover:bg-panel-2 hover:text-ink"
      >
        <MoreHorizontal size={14} aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-40 rounded-card border border-border-soft bg-panel p-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={handleReport}
            className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-[12.5px] text-ink-muted hover:bg-panel-2 hover:text-ink"
          >
            <Flag size={12} aria-hidden />
            {t("detail.report")}
          </button>
          {isOwner && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={handleEditOwner}
                className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-[12.5px] text-ink-muted hover:bg-panel-2 hover:text-ink"
              >
                <Pencil size={12} aria-hidden />
                {t("detail.edit")}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={handleDeleteOwner}
                className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-[12.5px] text-ink-muted hover:bg-danger/10 hover:text-danger"
              >
                <Trash2 size={12} aria-hidden />
                {t("detail.delete")}
              </button>
            </>
          )}
          {isContributor && (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={handleEditMine}
                className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-[12.5px] text-ink-muted hover:bg-panel-2 hover:text-ink"
              >
                <Pencil size={12} aria-hidden />
                {t("detail.edit")}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={handleDeleteMine}
                className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-[12.5px] text-ink-muted hover:bg-danger/10 hover:text-danger"
              >
                <Trash2 size={12} aria-hidden />
                {t("detail.delete")}
              </button>
            </>
          )}
        </div>
      )}
      {editingOwner && isOwner && (
        <Suspense fallback={null}>
          <OwnerPromptFormModal
            editingId={promptId}
            onClose={() => setEditingOwner(false)}
          />
        </Suspense>
      )}
      {editingMine && isContributor && (
        <Suspense fallback={null}>
          <MyPromptEditModal
            promptId={promptId}
            slug={slug}
            onClose={() => setEditingMine(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
