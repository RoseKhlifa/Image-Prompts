import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ApproveInput, AspectRatio } from "@ip/shared";
import { useCategories } from "../../lib/hooks/useCategories.ts";
import TagPicker from "../submit/TagPicker.tsx";

type Edits = NonNullable<ApproveInput["edits"]>;

type Props = {
  initial: Partial<Edits>;
  onChange: (v: Edits) => void;
};

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
 * Admin "approve with edits" panel. Mirrors SubmissionForm field set:
 * titleZh/En, promptZh/En, negativePromptZh/En, notesZh/En, aspectRatio,
 * categoryId, tagSlugs. ApproveInputSchema already accepts all of these as
 * optional partial — fields the admin doesn't touch are simply omitted from
 * the `edits` payload, and the route falls back to the submission's values.
 */
export default function AdminEditPanel({ initial, onChange }: Props) {
  const { t } = useTranslation();
  const [edits, setEdits] = useState<Edits>(initial ?? {});
  const categories = useCategories();

  function set<K extends keyof Edits>(k: K, v: Edits[K]) {
    const next = { ...edits, [k]: v };
    setEdits(next);
    onChange(next);
  }

  return (
    <div className="space-y-4 rounded-card border border-border-soft bg-panel/60 p-3">
      {/* Section 1: 内容覆盖 */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink/60">
          {t("admin.edit_section_content")}
        </h4>
        <input
          type="text"
          placeholder={t("submit.title_zh_label")}
          value={edits.titleZh ?? ""}
          onChange={(e) => set("titleZh", e.target.value || undefined)}
          className="block w-full rounded border border-border-soft bg-panel px-2 py-1 text-sm"
        />
        <input
          type="text"
          placeholder={t("submit.title_en_label")}
          value={edits.titleEn ?? ""}
          onChange={(e) => set("titleEn", e.target.value || undefined)}
          className="block w-full rounded border border-border-soft bg-panel px-2 py-1 text-sm"
        />
        <textarea
          rows={3}
          placeholder={t("submit.prompt_zh_label")}
          value={edits.promptZh ?? ""}
          onChange={(e) => set("promptZh", e.target.value || undefined)}
          className="block w-full rounded border border-border-soft bg-panel px-2 py-1 text-sm"
        />
        <textarea
          rows={3}
          placeholder={t("submit.prompt_en_label")}
          value={edits.promptEn ?? ""}
          onChange={(e) => set("promptEn", e.target.value || undefined)}
          className="block w-full rounded border border-border-soft bg-panel px-2 py-1 text-sm"
        />
        <textarea
          rows={2}
          placeholder={t("submit.negative_zh_label")}
          value={edits.negativePromptZh ?? ""}
          onChange={(e) =>
            set("negativePromptZh", e.target.value || undefined)
          }
          className="block w-full rounded border border-border-soft bg-panel px-2 py-1 text-sm"
        />
        <textarea
          rows={2}
          placeholder={t("submit.negative_en_label")}
          value={edits.negativePromptEn ?? ""}
          onChange={(e) =>
            set("negativePromptEn", e.target.value || undefined)
          }
          className="block w-full rounded border border-border-soft bg-panel px-2 py-1 text-sm"
        />
        <textarea
          rows={2}
          placeholder={t("submit.notes_zh_label")}
          value={edits.notesZh ?? ""}
          onChange={(e) => set("notesZh", e.target.value || undefined)}
          className="block w-full rounded border border-border-soft bg-panel px-2 py-1 text-sm"
        />
        <textarea
          rows={2}
          placeholder={t("submit.notes_en_label")}
          value={edits.notesEn ?? ""}
          onChange={(e) => set("notesEn", e.target.value || undefined)}
          className="block w-full rounded border border-border-soft bg-panel px-2 py-1 text-sm"
        />
      </div>

      {/* Section 2: 元信息覆盖 */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink/60">
          {t("admin.edit_section_meta")}
        </h4>
        <select
          value={edits.aspectRatio ?? ""}
          onChange={(e) =>
            set(
              "aspectRatio",
              (e.target.value || undefined) as AspectRatio | undefined,
            )
          }
          className="block w-full rounded border border-border-soft bg-panel px-2 py-1 text-sm"
        >
          <option value="">{t("submit.aspect_label")}</option>
          {ASPECTS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select
          value={edits.categoryId ?? ""}
          onChange={(e) => set("categoryId", e.target.value || undefined)}
          className="block w-full rounded border border-border-soft bg-panel px-2 py-1 text-sm"
        >
          <option value="">{t("submit.category_label")}</option>
          {(categories.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name.zh ?? c.name.en ?? c.slug}
            </option>
          ))}
        </select>
        <TagPicker
          value={edits.tagSlugs ?? []}
          onChange={(slugs) => set("tagSlugs", slugs)}
        />
      </div>
    </div>
  );
}
