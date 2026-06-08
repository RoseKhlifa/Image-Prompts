import { asc, like, eq, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { siteSettings } from "../db/schema/index.ts";

export type Setting = {
  key: string;
  value: unknown;
  description: string | null;
  updatedAt: Date;
  updatedBy: string | null;
};

/**
 * Read all rows from site_settings, ordered by key ascending. Used by the
 * owner /settings page (a single GET seeds the whole list view).
 */
export async function listAllSettings(): Promise<Setting[]> {
  const rows = await db
    .select({
      key: siteSettings.key,
      value: siteSettings.value,
      description: siteSettings.description,
      updatedAt: siteSettings.updatedAt,
      updatedBy: siteSettings.updatedBy,
    })
    .from(siteSettings)
    .orderBy(asc(siteSettings.key));
  return rows;
}

/**
 * Read a single key. Returns undefined when the row doesn't exist (caller
 * decides whether to fall back to a code default).
 *
 * Generic T lets call sites narrow:
 *   const limit = await getSetting<number>("submit.daily_limit");
 */
export async function getSetting<T = unknown>(key: string): Promise<T | undefined> {
  const [row] = await db
    .select({ value: siteSettings.value })
    .from(siteSettings)
    .where(eq(siteSettings.key, key))
    .limit(1);
  return row ? (row.value as T) : undefined;
}

/**
 * Read every row whose key matches `<prefix>%`. Returns a Map<key, value>
 * for cheap O(1) lookup at the call site. Use this when a subsystem needs
 * all of its keys at once (submit.* / translator.* / site.*).
 */
export async function getSettingsByPrefix(prefix: string): Promise<Map<string, unknown>> {
  const rows = await db
    .select({ key: siteSettings.key, value: siteSettings.value })
    .from(siteSettings)
    .where(like(siteSettings.key, `${prefix}%`));
  const m = new Map<string, unknown>();
  for (const r of rows) m.set(r.key, r.value);
  return m;
}

/**
 * Upsert a single key. The DB row's updatedAt is bumped to now(); updatedBy
 * records which owner did it (NULL is allowed for seed scripts).
 *
 * jsonb accepts any JSON value: primitives, arrays, objects. The caller is
 * responsible for shape — there's no validation at the repo layer because
 * different keys have different shapes (number vs string vs array).
 */
export async function setSetting(
  key: string,
  value: unknown,
  updatedBy: string | null,
): Promise<void> {
  await db
    .insert(siteSettings)
    .values({
      key,
      value: value as never,
      updatedBy: updatedBy,
      updatedAt: sql`now()`,
    })
    .onConflictDoUpdate({
      target: siteSettings.key,
      set: {
        value: value as never,
        updatedBy: updatedBy,
        updatedAt: sql`now()`,
      },
    });
}
