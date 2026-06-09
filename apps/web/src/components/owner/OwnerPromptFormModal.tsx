import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { X } from "lucide-react";
import { isLocale, pickBilingual, type Locale } from "@ip/shared";
import {
  useCreateOwnerPrompt,
  useOwnerPromptDetail,
  useUpdateOwnerPrompt,
  type OwnerPromptInput,
  type OwnerPromptUpdatePatch,
} from "../../lib/hooks/useOwnerPrompts";
import { useCategories } from "../../lib/hooks/useCategories";
import { toast } from "../../lib/toast";
import TagPicker from "../submit/TagPicker";
import ImageUploadGrid from "../submit/ImageUploadGrid";
import type { SlotValue } from "../submit/ImageSlot";

const ASPECTS = [
  "1:1",
  "3:2",
  "2:3",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "21:9",
  "9:21",
] as const;

type Props = {
  /** Edit mode when an id is supplied; otherwise create. */
  editingId: string | null;
  onClose: () => void;
  /** Called after a successful create — useful for the detail-page redirect. */
  onCreated?: (next: { id: string; slug: string }) => void;
  /** Called after a successful update. */
  onUpdated?: () => void;
};

/**
 * Owner-only "direct prompt" form. Two modes:
 *
 *   create — blank form, image grid is editable (1-10 uploads via the same
 *            useImageUpload pipeline as the public submission flow). After
 *            POST /api/owner/prompts the route migrates the R2 keys out of
 *            submissions/ — we don't touch keys here.
 *
 *   edit   — pre-populated from useOwnerPromptDetail. Existing images are
 *            READ-ONLY in MVP (the API repo's updatePromptForOwner doesn't
 *            touch images). We render thumbnails + a hint and PATCH the
 *            remaining fields only.
 *
 * Bilingual fields follow the SubmissionForm shape — zh + en textareas with
 * "at least one side required" for title/prompt. Empty strings clear optional
 * bilingual fields on the server (mergeBi in owner-prompts.ts).
 */
export default function OwnerPromptFormModal({
  editingId,
  onClose,
  onCreated,
  onUpdated,
}: Props) {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";

  const isEdit = editingId !== null;
  const detailQ = useOwnerPromptDetail(editingId);
  const detail = detailQ.data;
  const categoriesQ = useCategories();
  const categories = categoriesQ.data ?? [];

  const createMut = useCreateOwnerPrompt();
  const updateMut = useUpdateOwnerPrompt();
  const pending = createMut.isPending || updateMut.isPending;

  // ── Form state ────────────────────────────────────────────────────────
  // Initialized empty; useEffect below hydrates from detail when it lands.
  const [titleZh, setTitleZh] = useState("");
  const [titleEn, setTitleEn] = useState("");
  const [promptZh, setPromptZh] = useState("");
  const [promptEn, setPromptEn] = useState("");
  const [negZh, setNegZh] = useState("");
  const [negEn, setNegEn] = useState("");
  const [notesZh, setNotesZh] = useState("");
  const [notesEn, setNotesEn] = useState("");
  const [aspectRatio, setAspectRatio] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [tagSlugs, setTagSlugs] = useState<string[]>([]);
  const [images, setImages] = useState<SlotValue[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (!isEdit || !detail) return;
    setTitleZh(detail.title.zh ?? "");
    setTitleEn(detail.title.en ?? "");
    setPromptZh(detail.prompt.zh ?? "");
    setPromptEn(detail.prompt.en ?? "");
    setNegZh(detail.negativePrompt?.zh ?? "");
    setNegEn(detail.negativePrompt?.en ?? "");
    setNotesZh(detail.notes?.zh ?? "");
    setNotesEn(detail.notes?.en ?? "");
    setAspectRatio(detail.aspectRatio ?? "");
    setCategoryId(detail.category.id);
    setTagSlugs(detail.tagSlugs);
    // Pre-populate the image grid with the existing prompt's images. The
    // server diff-replace handles the "everything unchanged" case (no-op);
    // when the user edits, new submissions/* keys are migrated server-side
    // and removed prompts/<id>/* keys are best-effort deleted.
    setImages(
      detail.images.map((i) => ({
        r2AccountId: i.r2AccountId,
        r2Key: i.r2Key,
      })),
    );
  }, [isEdit, detail]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, onClose]);

  function validate(): string[] {
    const errs: string[] = [];
    if (titleZh.trim() === "" && titleEn.trim() === "") {
      errs.push(t("owner.prompts.modal_title_required"));
    }
    if (promptZh.trim() === "" && promptEn.trim() === "") {
      errs.push(t("owner.prompts.modal_prompt_required"));
    }
    if (!categoryId) {
      errs.push(t("owner.prompts.modal_category_required"));
    }
    if (images.length === 0) {
      errs.push(t("owner.prompts.modal_images_required"));
    }
    return errs;
  }

  function submit() {
    const errs = validate();
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    setErrors([]);

    if (isEdit) {
      // Build a patch with only the fields we actually want to send. For edit
      // we send all fields (it's a single editing session) — `mergeBi` on the
      // server preserves untouched sides, and the empty string clears optional
      // ones. We never send undefined keys here (exactOptionalPropertyTypes).
      //
      // Images: always send the current grid state. The server diff-replace
      // partitions entries by r2Key prefix — `prompts/<id>/*` stays put
      // (potentially reordered), `submissions/*` is migrated via copyObject,
      // and existing-but-missing rows are best-effort deleted. Sending the
      // same array twice is a safe no-op.
      const patch: OwnerPromptUpdatePatch = {
        titleZh,
        titleEn,
        promptZh,
        promptEn,
        negativePromptZh: negZh,
        negativePromptEn: negEn,
        notesZh,
        notesEn,
        aspectRatio: aspectRatio || "",
        categoryId,
        tagSlugs,
        images,
      };
      updateMut.mutate(
        { id: editingId, patch },
        {
          onSuccess: () => {
            toast.success(t("owner.prompts.save_success_update"));
            onUpdated?.();
            onClose();
          },
          onError: (err) =>
            toast.error(
              err.message
                ? `${t("owner.prompts.save_failed")}: ${err.message}`
                : t("owner.prompts.save_failed"),
            ),
        },
      );
    } else {
      // Create mode: build input with only set keys so the wire body matches
      // the server zod schema (which uses `.optional()` for bilingual sides).
      const input: OwnerPromptInput = {
        categoryId,
        tagSlugs,
        images,
      };
      if (titleZh.trim()) input.titleZh = titleZh.trim();
      if (titleEn.trim()) input.titleEn = titleEn.trim();
      if (promptZh.trim()) input.promptZh = promptZh.trim();
      if (promptEn.trim()) input.promptEn = promptEn.trim();
      if (negZh.trim()) input.negativePromptZh = negZh.trim();
      if (negEn.trim()) input.negativePromptEn = negEn.trim();
      if (notesZh.trim()) input.notesZh = notesZh.trim();
      if (notesEn.trim()) input.notesEn = notesEn.trim();
      if (aspectRatio) input.aspectRatio = aspectRatio;

      createMut.mutate(input, {
        onSuccess: (data) => {
          toast.success(t("owner.prompts.save_success_create"));
          onCreated?.(data);
          onClose();
        },
        onError: (err) =>
          toast.error(
            err.message
              ? `${t("owner.prompts.save_failed")}: ${err.message}`
              : t("owner.prompts.save_failed"),
          ),
      });
    }
  }

  const modalTitle = isEdit
    ? t("owner.prompts.modal_title_edit")
    : t("owner.prompts.modal_title_create");

  // While loading the detail in edit mode, show a minimal skeleton inside the
  // modal frame so the user gets immediate feedback.
  const loadingDetail = isEdit && detailQ.isLoading;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={modalTitle}
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 px-4"
      onClick={() => {
        if (!pending) onClose();
      }}
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-card bg-panel p-6 shadow-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-base font-semibold text-ink">{modalTitle}</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            aria-label="close"
            className="rounded-control p-1 text-ink-muted hover:bg-surface hover:text-ink disabled:opacity-40"
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        {errors.length > 0 && (
          <div className="mt-3 rounded-control bg-danger/10 px-3 py-2 text-xs text-danger">
            {errors.map((e) => (
              <div key={e}>{e}</div>
            ))}
          </div>
        )}

        {loadingDetail ? (
          <div className="mt-6 text-center text-sm text-ink-muted">
            {t("common.loading")}
          </div>
        ) : (
          <>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label={t("owner.prompts.modal_title_zh")}>
                <input
                  type="text"
                  value={titleZh}
                  onChange={(e) => setTitleZh(e.target.value)}
                  maxLength={200}
                  disabled={pending}
                  className="w-full rounded-control border border-border-soft bg-panel-2 px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
                />
              </Field>
              <Field label={t("owner.prompts.modal_title_en")}>
                <input
                  type="text"
                  value={titleEn}
                  onChange={(e) => setTitleEn(e.target.value)}
                  maxLength={200}
                  disabled={pending}
                  className="w-full rounded-control border border-border-soft bg-panel-2 px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
                />
              </Field>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label={t("owner.prompts.modal_prompt_zh")}>
                <textarea
                  value={promptZh}
                  onChange={(e) => setPromptZh(e.target.value)}
                  maxLength={8000}
                  rows={5}
                  disabled={pending}
                  className="w-full resize-none rounded-control border border-border-soft bg-panel-2 px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
                />
              </Field>
              <Field label={t("owner.prompts.modal_prompt_en")}>
                <textarea
                  value={promptEn}
                  onChange={(e) => setPromptEn(e.target.value)}
                  maxLength={8000}
                  rows={5}
                  disabled={pending}
                  className="w-full resize-none rounded-control border border-border-soft bg-panel-2 px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
                />
              </Field>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label={t("owner.prompts.modal_negative_zh")}>
                <textarea
                  value={negZh}
                  onChange={(e) => setNegZh(e.target.value)}
                  maxLength={4000}
                  rows={3}
                  disabled={pending}
                  className="w-full resize-none rounded-control border border-border-soft bg-panel-2 px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
                />
              </Field>
              <Field label={t("owner.prompts.modal_negative_en")}>
                <textarea
                  value={negEn}
                  onChange={(e) => setNegEn(e.target.value)}
                  maxLength={4000}
                  rows={3}
                  disabled={pending}
                  className="w-full resize-none rounded-control border border-border-soft bg-panel-2 px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
                />
              </Field>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label={t("owner.prompts.modal_notes_zh")}>
                <textarea
                  value={notesZh}
                  onChange={(e) => setNotesZh(e.target.value)}
                  maxLength={4000}
                  rows={2}
                  disabled={pending}
                  className="w-full resize-none rounded-control border border-border-soft bg-panel-2 px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
                />
              </Field>
              <Field label={t("owner.prompts.modal_notes_en")}>
                <textarea
                  value={notesEn}
                  onChange={(e) => setNotesEn(e.target.value)}
                  maxLength={4000}
                  rows={2}
                  disabled={pending}
                  className="w-full resize-none rounded-control border border-border-soft bg-panel-2 px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
                />
              </Field>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label={t("owner.prompts.modal_aspect")}>
                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio(e.target.value)}
                  disabled={pending}
                  className="w-full rounded-control border border-border-soft bg-panel-2 px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
                >
                  <option value="">—</option>
                  {ASPECTS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("owner.prompts.modal_category")}>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  disabled={pending}
                  className="w-full rounded-control border border-border-soft bg-panel-2 px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
                >
                  <option value="">—</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {pickBilingual(c.name, locale) ?? c.slug}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="mt-4">
              <span className="block text-xs uppercase tracking-wider text-ink-muted">
                {t("owner.prompts.modal_tags")}
              </span>
              <div className="mt-1">
                <TagPicker value={tagSlugs} onChange={setTagSlugs} />
              </div>
            </div>

            <div className="mt-4">
              <span className="block text-xs uppercase tracking-wider text-ink-muted">
                {t("owner.prompts.modal_images")}
              </span>
              <div className="mt-2">
                <ImageUploadGrid value={images} onChange={setImages} />
              </div>
            </div>
          </>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-control border border-border-soft px-3 py-1.5 text-xs font-medium text-ink hover:bg-panel-2 disabled:opacity-40"
          >
            {t("owner.prompts.modal_cancel")}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending || loadingDetail}
            className="rounded-control bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-2 disabled:opacity-40"
          >
            {pending
              ? t("owner.prompts.modal_saving")
              : t("owner.prompts.modal_save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wider text-ink-muted">
        {label}
      </span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}
