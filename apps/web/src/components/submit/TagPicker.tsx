import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { useTagSuggestions } from "../../lib/hooks/useTagSuggestions.ts";
import { isLocale, pickBilingual, type Locale, type TagSummary } from "@ip/shared";

type Props = {
  value: string[];
  onChange: (slugs: string[]) => void;
  /** Optional injection for tests; if omitted, calls the query hook. */
  allTags?: TagSummary[];
};

const MAX = 6;

/**
 * Bilingual tag autocomplete for the submission form:
 *   - chip list of selected slugs (max 6)
 *   - search input → useTagSuggestions(q)
 *   - clicking a suggestion adds to selection (disabled at 6)
 *   - clicking chip × removes from selection
 *
 * Tests can inject `allTags` to bypass the network query.
 */
export default function TagPicker({ value, onChange, allTags }: Props) {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const [q, setQ] = useState("");
  const query = useTagSuggestions(q);
  const list = allTags ?? query.data ?? [];

  function add(slug: string) {
    if (value.includes(slug)) return;
    if (value.length >= MAX) return;
    onChange([...value, slug]);
  }
  function remove(slug: string) {
    onChange(value.filter((s) => s !== slug));
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {value.map((slug) => {
          const tag = list.find((x) => x.slug === slug);
          const name = tag ? pickBilingual(tag.name, locale) ?? slug : slug;
          return (
            <span
              key={slug}
              className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-xs"
            >
              {name}
              <button
                type="button"
                onClick={() => remove(slug)}
                className="text-ink/60 hover:text-ink"
                aria-label="Remove"
              >
                ×
              </button>
            </span>
          );
        })}
      </div>
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={t("submit.tags_search_placeholder")}
        className="block w-full rounded-card border border-border-soft bg-panel px-2 py-1.5 text-sm"
      />
      <ul className="mt-1 flex flex-wrap gap-1.5">
        {list
          .filter((tag) => !value.includes(tag.slug))
          .slice(0, 8)
          .map((tag) => (
            <li key={tag.id}>
              <button
                type="button"
                onClick={() => add(tag.slug)}
                disabled={value.length >= MAX}
                className="rounded-full border border-border-soft px-2 py-0.5 text-xs hover:border-accent disabled:opacity-40"
              >
                {pickBilingual(tag.name, locale) ?? tag.slug}
              </button>
            </li>
          ))}
      </ul>
      <p className="mt-1 text-xs text-ink/60">{t("submit.tags_hint")}</p>
    </div>
  );
}
