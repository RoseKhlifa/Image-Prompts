import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { categories } from "../db/schema/taxonomy.ts";

type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export class NsfwTagInvariantError extends Error {
  constructor() {
    super("nsfw_category_tags_locked");
    this.name = "NsfwTagInvariantError";
  }
}

/**
 * Enforce: prompts in the `nsfw` category may carry ONLY the `nsfw` tag.
 * No-op for any other category. Compares tag names case-insensitively after trim.
 *
 * Throws NsfwTagInvariantError (.message === "nsfw_category_tags_locked").
 */
export async function assertNsfwTagInvariant(
  tx: DbOrTx,
  categoryId: string,
  tagNames: string[],
): Promise<void> {
  const [category] = await tx
    .select({ slug: categories.slug })
    .from(categories)
    .where(eq(categories.id, categoryId))
    .limit(1);
  if (category?.slug !== "nsfw") return;
  const normalized = tagNames.map((t) => t.trim().toLowerCase());
  if (normalized.length !== 1 || normalized[0] !== "nsfw") {
    throw new NsfwTagInvariantError();
  }
}
