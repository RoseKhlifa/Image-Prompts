import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import { MoreHorizontal, Flag, Pencil, Trash2 } from "lucide-react";
import { isLocale, type Locale } from "@ip/shared";
import { toast } from "../../lib/toast";
import { useSession } from "../../lib/hooks/useSession";
import { useDeleteOwnerPrompt } from "../../lib/hooks/useOwnerPrompts";
import { withLocale } from "../../lib/locale";

// Lazy-load the owner modal — most viewers aren't owners, and the modal pulls
// in TagPicker, useImageUpload, the categories query, etc. Keeping it out of
// the public-detail bundle reduces TTI for the common case.
const OwnerPromptFormModal = lazy(
  () => import("../owner/OwnerPromptFormModal"),
);

type Props = {
  promptId: string;
  slug: string;
  titleZh?: string;
  titleEn?: string;
};

/**
 * Detail-page "more" affordance. Always shows Report. When the viewer is an
 * owner (session.user.isOwner === true), appends Edit + Delete:
 *   - Edit opens OwnerPromptFormModal in edit mode (lazy-loaded; the modal
 *     fetches the detail on mount via useOwnerPromptDetail).
 *   - Delete confirms, then DELETEs and navigates to the prompts list.
 *
 * Non-owners see the original report-only menu — that's the existing shape
 * tested in MoreMenu.test.tsx, which we keep green by mocking useSession to
 * return null (anon) for those baseline tests.
 */
export default function MoreMenu({
  promptId,
  slug: _slug,
  titleZh,
  titleEn,
}: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const session = useSession();
  const isOwner = session.data?.user.isOwner ?? false;

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const deleteMut = useDeleteOwnerPrompt();

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

  function handleEdit() {
    setEditing(true);
    setOpen(false);
  }

  function handleDelete() {
    setOpen(false);
    const title = titleZh ?? titleEn ?? _slug;
    if (!window.confirm(t("detail.delete_confirm", { title }))) return;
    deleteMut.mutate(promptId, {
      onSuccess: () => {
        toast.success(t("detail.deleted"));
        navigate(withLocale(locale, "/prompts"));
      },
      onError: (err) => toast.error(err.message ?? t("common.error")),
    });
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
                onClick={handleEdit}
                className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-[12.5px] text-ink-muted hover:bg-panel-2 hover:text-ink"
              >
                <Pencil size={12} aria-hidden />
                {t("detail.edit")}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={handleDelete}
                className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-[12.5px] text-ink-muted hover:bg-danger/10 hover:text-danger"
              >
                <Trash2 size={12} aria-hidden />
                {t("detail.delete")}
              </button>
            </>
          )}
        </div>
      )}
      {editing && isOwner && (
        <Suspense fallback={null}>
          <OwnerPromptFormModal
            editingId={promptId}
            onClose={() => setEditing(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
