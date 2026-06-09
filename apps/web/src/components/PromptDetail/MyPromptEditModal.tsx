import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import {
  SubmissionInputSchema,
  type AspectRatio,
  type SubmissionInput,
} from "@ip/shared";
import { usePromptDetail } from "../../lib/hooks/usePromptDetail";
import { useCategories } from "../../lib/hooks/useCategories";
import { useSubmitMyPromptEdit } from "../../lib/hooks/useMyPrompts";
import { toast } from "../../lib/toast";
import TagPicker from "../submit/TagPicker";
import ImageUploadGrid from "../submit/ImageUploadGrid";
import type { SlotValue } from "../submit/ImageSlot";

const ASPECTS: AspectRatio[] = [
  "1:1",
  "3:2",
  "2:3",
  "16:9",
  "9:16",
  "4:3",
  "3:4",
  "21:9",
  "9:21",
];

type Props = {
  promptId: string;
  slug: string;
  onClose: () => void;
};

/**
 * Contributor self-edit modal. Same shape as SubmissionForm (bilingual prompt,
 * optional negative + notes, category, tags, image grid) but mounted as a
 * lazy-loaded dialog from MoreMenu and submitting to /api/me/prompts/:id/edit.
 *
 * Approach to SubmissionForm reuse: this is intentionally a pragmatic copy.
 * SubmissionForm is a full-page-style form with sessionStorage drafts,
 * onAuthRequired callbacks, etc — none of that applies to a modal edit
 * surface that pre-populates from a live prompt. Sharing components ends at
 * TagPicker + ImageUploadGrid (both already reusable). Sharing the outer
 * form would force us to muck with submit-draft / useCreateSubmission and
 * leak modal concerns into the public submit flow.
 *
 * The submission is created with `originalPromptId = promptId` via the
 * useSubmitMyPromptEdit hook; on approval the moderator UPDATEs the original
 * prompt rather than INSERTing a new one (see approveSubmission in the
 * submissions repo).
 */
export default function MyPromptEditModal({ promptId, slug, onClose }: Props) {
  const { t } = useTranslation();
  const detailQ = usePromptDetail(slug);
  const detail = detailQ.data;
  const categoriesQ = useCategories();
  const categories = categoriesQ.data ?? [];
  const submitMut = useSubmitMyPromptEdit();
  const pending = submitMut.isPending;

  // Form state — populated from the prompt detail when it loads.
  const [title, setTitle] = useState("");
  const [promptZh, setPromptZh] = useState("");
  const [promptEn, setPromptEn] = useState("");
  const [negZh, setNegZh] = useState("");
  const [negEn, setNegEn] = useState("");
  const [notesZh, setNotesZh] = useState("");
  const [notesEn, setNotesEn] = useState("");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio | "">("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [tagSlugs, setTagSlugs] = useState<string[]>([]);
  const [images, setImages] = useState<SlotValue[]>([]);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (!detail) return;
    // Title is language-agnostic on the submission schema; default to the
    // zh side if present, else the en side. The server will mirror our
    // single string into both columns (see /api/submissions handler).
    setTitle(detail.title.zh ?? detail.title.en ?? "");
    setPromptZh(detail.prompt.zh ?? "");
    setPromptEn(detail.prompt.en ?? "");
    setNegZh(detail.negativePrompt?.zh ?? "");
    setNegEn(detail.negativePrompt?.en ?? "");
    setNotesZh(detail.notes?.zh ?? "");
    setNotesEn(detail.notes?.en ?? "");
    setAspectRatio((detail.aspectRatio as AspectRatio | null) ?? "");
    // PromptDetail doesn't carry categoryId directly — it carries category as
    // {id, slug, name}. Use the id.
    setCategoryId(detail.category?.id ?? "");
    setTagSlugs(detail.tags?.map((t2) => t2.slug) ?? []);
    // Re-pre-populate images with the prompts/<id>/* keys. The user may
    // remove/replace them (submissions/* takes over after upload); the
    // approving moderator's flow will copy submissions/* → prompts/<id>/*
    // and best-effort delete the prior prompt/* keys.
    setImages(
      detail.images.map((i) => ({
        r2AccountId: i.r2AccountId,
        r2Key: i.r2Key,
      })),
    );
  }, [detail]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pending, onClose]);

  function submit() {
    const errs: string[] = [];
    if (title.trim() === "") errs.push(t("submit.error.title_required"));
    if (!promptZh.trim() && !promptEn.trim()) errs.push(t("submit.error.prompt_required"));
    if (!categoryId) errs.push(t("submit.error.category_required"));
    if (images.length === 0) errs.push(t("submit.error.images_required"));
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    setErrors([]);

    // The submission schema requires `submissions/*` keys for images. When
    // the user has kept any prompts/<id>/* image as-is (i.e. didn't replace
    // it), the schema parse will fail. We surface that case here so they
    // know they need to re-upload to "lock in" any image as part of the edit.
    const nonSubmission = images.find((i) => !i.r2Key.startsWith("submissions/"));
    if (nonSubmission) {
      setErrors([t("detail.edit_requires_resubmit_images")]);
      return;
    }

    const candidate: Partial<SubmissionInput> = {
      title: title.trim(),
      promptZh: promptZh.trim() || undefined,
      promptEn: promptEn.trim() || undefined,
      negativePromptZh: negZh.trim() || undefined,
      negativePromptEn: negEn.trim() || undefined,
      notesZh: notesZh.trim() || undefined,
      notesEn: notesEn.trim() || undefined,
      aspectRatio: aspectRatio || undefined,
      categoryId,
      tagSlugs,
      images: images.map((i) => ({
        r2AccountId: i.r2AccountId,
        r2Key: i.r2Key,
      })),
    };
    const parsed = SubmissionInputSchema.safeParse(candidate);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => i.message));
      return;
    }

    submitMut.mutate(
      { id: promptId, input: parsed.data },
      {
        onSuccess: () => {
          toast.success(t("detail.edit_queued_for_review"));
          onClose();
        },
        onError: (err) => toast.error(err.message ?? t("common.error")),
      },
    );
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("detail.edit_modal_title")}
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
          <h2 className="text-base font-semibold text-ink">{t("detail.edit_modal_title")}</h2>
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

        {detailQ.isLoading || !detail ? (
          <div className="mt-6 text-center text-sm text-ink-muted">{t("common.loading")}</div>
        ) : (
          <div className="mt-4 space-y-4">
            <Field label={t("submit.title_label")}>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={200}
                disabled={pending}
                className="w-full rounded-control border border-border-soft bg-panel-2 px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
              />
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("submit.prompt_zh_label")}>
                <textarea
                  value={promptZh}
                  onChange={(e) => setPromptZh(e.target.value)}
                  maxLength={8000}
                  rows={5}
                  disabled={pending}
                  className="w-full resize-none rounded-control border border-border-soft bg-panel-2 px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
                />
              </Field>
              <Field label={t("submit.prompt_en_label")}>
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

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("submit.negative_zh_label")}>
                <textarea
                  value={negZh}
                  onChange={(e) => setNegZh(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  disabled={pending}
                  className="w-full resize-none rounded-control border border-border-soft bg-panel-2 px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
                />
              </Field>
              <Field label={t("submit.negative_en_label")}>
                <textarea
                  value={negEn}
                  onChange={(e) => setNegEn(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  disabled={pending}
                  className="w-full resize-none rounded-control border border-border-soft bg-panel-2 px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("submit.notes_zh_label")}>
                <textarea
                  value={notesZh}
                  onChange={(e) => setNotesZh(e.target.value)}
                  maxLength={2000}
                  rows={2}
                  disabled={pending}
                  className="w-full resize-none rounded-control border border-border-soft bg-panel-2 px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
                />
              </Field>
              <Field label={t("submit.notes_en_label")}>
                <textarea
                  value={notesEn}
                  onChange={(e) => setNotesEn(e.target.value)}
                  maxLength={2000}
                  rows={2}
                  disabled={pending}
                  className="w-full resize-none rounded-control border border-border-soft bg-panel-2 px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
                />
              </Field>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={t("submit.aspect_label")}>
                <select
                  value={aspectRatio}
                  onChange={(e) => setAspectRatio((e.target.value || "") as AspectRatio | "")}
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
              <Field label={t("submit.category_label")}>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  disabled={pending}
                  className="w-full rounded-control border border-border-soft bg-panel-2 px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
                >
                  <option value="">—</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name.zh ?? c.name.en ?? c.slug}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div>
              <span className="block text-xs uppercase tracking-wider text-ink-muted">
                {t("submit.section_meta")}
              </span>
              <div className="mt-1">
                <TagPicker value={tagSlugs} onChange={setTagSlugs} />
              </div>
            </div>

            <div>
              <span className="block text-xs uppercase tracking-wider text-ink-muted">
                {t("submit.section_images")}
              </span>
              <div className="mt-2">
                <ImageUploadGrid value={images} onChange={setImages} />
              </div>
            </div>
          </div>
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
            disabled={pending || detailQ.isLoading}
            className="rounded-control bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-2 disabled:opacity-40"
          >
            {pending ? t("owner.prompts.modal_saving") : t("owner.prompts.modal_save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wider text-ink-muted">{label}</span>
      <span className="mt-1 block">{children}</span>
    </label>
  );
}
