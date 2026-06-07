/**
 * Build a {zh?, en?} JSONB payload from two optional strings. Returns null if
 * both sides are empty/missing — used for nullable jsonb columns like
 * prompts.notes / submissions.negativePrompt.
 *
 * If you need a notNull column, assert non-null at the call site (`bi(...)!`)
 * and rely on Zod's bilingual_required refine to guarantee a value upstream.
 */
export function bi(
  zh: string | null | undefined,
  en: string | null | undefined,
): { zh?: string; en?: string } | null {
  const obj: { zh?: string; en?: string } = {};
  if (zh && zh.length > 0) obj.zh = zh;
  if (en && en.length > 0) obj.en = en;
  return Object.keys(obj).length > 0 ? obj : null;
}
