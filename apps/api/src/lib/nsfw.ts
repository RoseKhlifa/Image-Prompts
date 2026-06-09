import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { categories } from "../db/schema/taxonomy.ts";

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

const NSFW_TAG_SLUG = "nsfw";

/**
 * For prompts whose category is `nsfw`, return the tag-slug list with the
 * `nsfw` marker guaranteed present (case-insensitive). Non-NSFW categories
 * pass through unchanged.
 *
 * The `nsfw` tag is an internal marker every NSFW prompt must carry — the
 * sidebar / autocomplete suppressor keys off it, and the detail-page chip
 * filter assumes it's there. Callers pipe their input through this helper
 * before INSERTing prompt_tags rows.
 *
 * (Pre-rename: `assertNsfwTagInvariant` enforced "exactly ['nsfw']" — that
 * was too strict for crawled NSFW data which carries content-descriptive
 * tags like `二次元` / `真人` / `猎奇` alongside the marker.)
 */
export async function ensureNsfwTag(
  tx: DbOrTx,
  categoryId: string,
  tagSlugs: string[],
): Promise<string[]> {
  const [cat] = await tx
    .select({ slug: categories.slug })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .limit(1);
  if (cat?.slug !== "nsfw") return tagSlugs;
  const hasNsfw = tagSlugs.some(
    (t) => t.trim().toLowerCase() === NSFW_TAG_SLUG,
  );
  return hasNsfw ? tagSlugs : [...tagSlugs, NSFW_TAG_SLUG];
}
