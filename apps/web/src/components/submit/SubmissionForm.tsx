import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import {
  SubmissionInputSchema,
  isLocale,
  type SubmissionInput,
  type AspectRatio,
  type Locale,
} from "@ip/shared";
import { useCategories } from "../../lib/hooks/useCategories.ts";
import { useCreateSubmission } from "../../lib/hooks/useCreateSubmission.ts";
import { toast } from "../../lib/toast.ts";
import { saveDraft, loadDraft } from "../../lib/submission-draft.ts";
import { withLocale } from "../../lib/locale.ts";
import { zodErrorsToMap } from "../../lib/zod-errors.ts";
import TagPicker from "./TagPicker.tsx";
import ImageUploadGrid from "./ImageUploadGrid.tsx";
import type { SlotValue } from "./ImageSlot.tsx";

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

/**
 * Renders a red error message under a form field when `errors[keyName]` is
 * set. The error value is treated as an i18n key under `submit.error.*`; if
 * the key isn't in the catalog (e.g. Zod's default "Required" message), we
 * fall back to `submit.error.field_required`.
 */
function FieldError({
  keyName,
  errors,
}: {
  keyName: string;
  errors: Record<string, string>;
}) {
  const { t } = useTranslation();
  const code = errors[keyName];
  if (!code) return null;
  return (
    <p className="mt-1 text-xs text-red-600">
      {t(`submit.error.${code}`, {
        defaultValue: t("submit.error.field_required"),
      })}
    </p>
  );
}

/**
 * Orchestrates the whole submission flow: bilingual title/prompt fields,
 * optional negative prompts + aspect ratio, category select, tag picker,
 * image upload grid, optional notes. Persists every change to sessionStorage
 * (`submit-draft-v1`) so a reload or accidental nav-away doesn't wipe the
 * user's work; `useCreateSubmission` clears the draft on success.
 *
 * Validation: `SubmissionInputSchema.safeParse(values)` runs only on submit.
 * The schema's `bilingual_required` refine guarantees the user filled at
 * least one of (titleZh+promptZh) or (titleEn+promptEn). Server errors are
 * routed to the toast via the `onError` callback in the mutation.
 */
export default function SubmissionForm() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const categories = useCategories();

  const initial = loadDraft<Partial<SubmissionInput>>() ?? {};
  const [values, setValues] = useState<Partial<SubmissionInput>>({
    tagSlugs: [],
    images: [],
    ...initial,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    saveDraft(values);
  }, [values]);

  const create = useCreateSubmission({
    onAuthRequired: () => {
      /* SubmitPage re-renders the SignInModal when the session goes null. */
    },
    onGuidelinesRequired: () => toast.error(t("submit.error.guidelines")),
    onError: (code) => {
      const key = code?.includes(":") ? code.split(":")[0] : code;
      toast.error(
        t(`submit.error.${key}`, { defaultValue: t("submit.error.generic") }),
      );
    },
  });

  function setField<K extends keyof SubmissionInput>(
    k: K,
    v: SubmissionInput[K] | undefined,
  ) {
    setValues((prev) => ({ ...prev, [k]: v }));
    setErrors((prev) => {
      if (!(k in prev)) return prev;
      const next = { ...prev };
      delete next[k as string];
      return next;
    });
  }

  function submit() {
    const parsed = SubmissionInputSchema.safeParse(values);
    if (!parsed.success) {
      const map = zodErrorsToMap(parsed.error);
      setErrors(map);
      const issueCount = parsed.error.issues.length;
      toast.error(t("submit.error.summary", { count: issueCount }));
      return;
    }
    setErrors({});
    create.mutate(parsed.data, {
      onSuccess: () => {
        toast.success(t("my_submissions.status_pending"));
        navigate(withLocale(locale, "/profile?tab=submissions"));
      },
    });
  }

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-sm font-semibold text-ink">
          {t("submit.section_title")}
        </h3>
        <input
          type="text"
          placeholder={t("submit.title_zh_label")}
          value={values.titleZh ?? ""}
          onChange={(e) => setField("titleZh", e.target.value || undefined)}
          className="mb-1 block w-full rounded-card border border-border-soft bg-panel px-2 py-1.5 text-sm"
        />
        <FieldError keyName="titleZh" errors={errors} />
        <input
          type="text"
          placeholder={t("submit.title_en_label")}
          value={values.titleEn ?? ""}
          onChange={(e) => setField("titleEn", e.target.value || undefined)}
          className="mt-2 mb-1 block w-full rounded-card border border-border-soft bg-panel px-2 py-1.5 text-sm"
        />
        <FieldError keyName="titleEn" errors={errors} />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-ink">
          {t("submit.section_prompt")}
        </h3>
        <textarea
          placeholder={t("submit.prompt_zh_label")}
          rows={4}
          value={values.promptZh ?? ""}
          onChange={(e) => setField("promptZh", e.target.value || undefined)}
          className="mb-1 block w-full rounded-card border border-border-soft bg-panel px-2 py-1.5 text-sm"
        />
        <FieldError keyName="promptZh" errors={errors} />
        <textarea
          placeholder={t("submit.prompt_en_label")}
          rows={4}
          value={values.promptEn ?? ""}
          onChange={(e) => setField("promptEn", e.target.value || undefined)}
          className="mt-2 mb-1 block w-full rounded-card border border-border-soft bg-panel px-2 py-1.5 text-sm"
        />
        <FieldError keyName="promptEn" errors={errors} />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-ink">
          {t("submit.section_optional")}
        </h3>
        <textarea
          placeholder={t("submit.negative_zh_label")}
          rows={2}
          value={values.negativePromptZh ?? ""}
          onChange={(e) =>
            setField("negativePromptZh", e.target.value || undefined)
          }
          className="mb-1 block w-full rounded-card border border-border-soft bg-panel px-2 py-1.5 text-sm"
        />
        <FieldError keyName="negativePromptZh" errors={errors} />
        <textarea
          placeholder={t("submit.negative_en_label")}
          rows={2}
          value={values.negativePromptEn ?? ""}
          onChange={(e) =>
            setField("negativePromptEn", e.target.value || undefined)
          }
          className="mt-2 mb-1 block w-full rounded-card border border-border-soft bg-panel px-2 py-1.5 text-sm"
        />
        <FieldError keyName="negativePromptEn" errors={errors} />
        <select
          value={values.aspectRatio ?? ""}
          onChange={(e) =>
            setField(
              "aspectRatio",
              (e.target.value || undefined) as AspectRatio | undefined,
            )
          }
          className="mt-2 mb-1 block w-full rounded-card border border-border-soft bg-panel px-2 py-1.5 text-sm"
        >
          <option value="">{t("submit.aspect_label")}</option>
          {ASPECTS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <FieldError keyName="aspectRatio" errors={errors} />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-ink">
          {t("submit.section_meta")}
        </h3>
        <select
          value={values.categoryId ?? ""}
          onChange={(e) => setField("categoryId", e.target.value || undefined)}
          className="mb-1 block w-full rounded-card border border-border-soft bg-panel px-2 py-1.5 text-sm"
        >
          <option value="">{t("submit.category_label")}</option>
          {(categories.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name.zh ?? c.name.en ?? c.slug}
            </option>
          ))}
        </select>
        <FieldError keyName="categoryId" errors={errors} />
        <div className="mt-2">
          <TagPicker
            value={values.tagSlugs ?? []}
            onChange={(slugs) => setField("tagSlugs", slugs)}
          />
          <FieldError keyName="tagSlugs" errors={errors} />
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-ink">
          {t("submit.section_images")}
        </h3>
        <ImageUploadGrid
          value={(values.images ?? []) as SlotValue[]}
          onChange={(imgs) => setField("images", imgs)}
        />
        <FieldError keyName="images" errors={errors} />
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-ink">
          {t("submit.section_notes")}
        </h3>
        <textarea
          placeholder={t("submit.notes_zh_label")}
          rows={2}
          value={values.notesZh ?? ""}
          onChange={(e) => setField("notesZh", e.target.value || undefined)}
          className="mb-1 block w-full rounded-card border border-border-soft bg-panel px-2 py-1.5 text-sm"
        />
        <FieldError keyName="notesZh" errors={errors} />
        <textarea
          placeholder={t("submit.notes_en_label")}
          rows={2}
          value={values.notesEn ?? ""}
          onChange={(e) => setField("notesEn", e.target.value || undefined)}
          className="mt-2 mb-1 block w-full rounded-card border border-border-soft bg-panel px-2 py-1.5 text-sm"
        />
        <FieldError keyName="notesEn" errors={errors} />
      </section>

      {errors[""] && (
        <p className="text-xs text-red-600">
          {t(`submit.error.${errors[""]}`, {
            defaultValue: t("submit.error.generic"),
          })}
        </p>
      )}
      <button
        type="button"
        disabled={create.isPending}
        onClick={submit}
        className="inline-flex w-full items-center justify-center rounded-card bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {create.isPending ? t("submit.submitting") : t("submit.submit_button")}
      </button>
    </div>
  );
}
