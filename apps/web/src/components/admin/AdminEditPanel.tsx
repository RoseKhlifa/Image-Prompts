import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ApproveInput } from "@ip/shared";
import { useCategories } from "../../lib/hooks/useCategories.ts";

type Edits = NonNullable<ApproveInput["edits"]>;

type Props = {
  initial: Partial<Edits>;
  onChange: (v: Edits) => void;
};

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
    <div className="space-y-2 rounded-card border border-border-soft bg-panel/60 p-3">
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
    </div>
  );
}
