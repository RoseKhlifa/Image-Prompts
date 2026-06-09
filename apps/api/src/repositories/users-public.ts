import { and, desc, eq, lt, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { users } from "../db/schema/auth.ts";
import { prompts, promptImages, categories } from "../db/schema/index.ts";
import { favorites } from "../db/schema/interactions.ts";

export async function getUserPublic(id: string) {
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      image: users.image,
      role: users.role,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    image: row.image,
    role: row.role,
    joinedAt: row.createdAt.toISOString(),
  };
}

export async function getUserStats(id: string) {
  const [r] = await db
    .select({
      publishedCount: sql<number>`COUNT(*)::int`,
      totalViews: sql<number>`COALESCE(SUM(${prompts.viewCount})::int, 0)`,
      totalLikes: sql<number>`COALESCE(SUM(${prompts.likeCount})::int, 0)`,
      totalFavorites: sql<number>`COALESCE(SUM(${prompts.favoriteCount})::int, 0)`,
    })
    .from(prompts)
    .where(eq(prompts.contributorId, id));
  return {
    publishedCount: r?.publishedCount ?? 0,
    totalViews: r?.totalViews ?? 0,
    totalLikes: r?.totalLikes ?? 0,
    totalFavorites: r?.totalFavorites ?? 0,
  };
}

type ListOpts = { cursor: string | null; limit: number };

/** This user's published prompts (PromptSummary-ish shape). Newest first. */
export async function listUserPrompts(userId: string, opts: ListOpts) {
  const conds = [eq(prompts.contributorId, userId)];
  if (opts.cursor) conds.push(lt(prompts.approvedAt, new Date(opts.cursor)));
  const rows = await db
    .select({
      id: prompts.id,
      slug: prompts.slug,
      title: prompts.title,
      aspectRatio: prompts.aspectRatio,
      viewCount: prompts.viewCount,
      likeCount: prompts.likeCount,
      favoriteCount: prompts.favoriteCount,
      sendCount: prompts.sendCount,
      approvedAt: prompts.approvedAt,
      categoryId: prompts.categoryId,
      categorySlug: categories.slug,
      categoryName: categories.name,
      // ★ Without these the PromptCard renders "anonymous" even on the
      //   contributor's own works tab — `listPrompts` includes contributor
      //   info, but this projection used to skip it. Keep them in sync.
      contributorId: prompts.contributorId,
      contributorName: users.name,
      contributorImage: users.image,
    })
    .from(prompts)
    .innerJoin(categories, eq(categories.id, prompts.categoryId))
    .leftJoin(users, eq(users.id, prompts.contributorId))
    .where(and(...conds))
    .orderBy(desc(prompts.approvedAt))
    .limit(opts.limit + 1);
  const trimmed = rows.slice(0, opts.limit);
  const ids = trimmed.map((r) => r.id);
  const imgs =
    ids.length === 0
      ? []
      : await db
          .select()
          .from(promptImages)
          .where(
            sql`${promptImages.promptId} IN (${sql.join(
              ids.map((i) => sql`${i}`),
              sql`, `,
            )})`,
          )
          .orderBy(promptImages.order);
  const firstImg = new Map<string, (typeof imgs)[number]>();
  for (const img of imgs) if (!firstImg.has(img.promptId)) firstImg.set(img.promptId, img);
  return {
    items: trimmed.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      category: { id: r.categoryId, slug: r.categorySlug, name: r.categoryName },
      tags: [],
      aspectRatio: r.aspectRatio,
      primaryImage: firstImg.get(r.id)
        ? {
            r2AccountId: firstImg.get(r.id)!.r2AccountId,
            r2Key: firstImg.get(r.id)!.r2Key,
            width: firstImg.get(r.id)!.width,
            height: firstImg.get(r.id)!.height,
            lqip: firstImg.get(r.id)!.lqip,
          }
        : null,
      contributor: r.contributorId
        ? {
            id: r.contributorId,
            name: r.contributorName,
            avatarUrl: r.contributorImage,
          }
        : null,
      viewCount: r.viewCount,
      likeCount: r.likeCount,
      favoriteCount: r.favoriteCount,
      sendCount: r.sendCount,
      approvedAt: r.approvedAt.toISOString(),
    })),
    nextCursor:
      rows.length > opts.limit ? trimmed[trimmed.length - 1]!.approvedAt.toISOString() : null,
  };
}

/** This user's favorited prompts. ONLY the user themselves should call this. */
export async function listUserFavorites(userId: string, opts: ListOpts) {
  const conds = [eq(favorites.userId, userId)];
  if (opts.cursor) conds.push(lt(favorites.createdAt, new Date(opts.cursor)));
  const rows = await db
    .select({
      id: prompts.id,
      slug: prompts.slug,
      title: prompts.title,
      aspectRatio: prompts.aspectRatio,
      viewCount: prompts.viewCount,
      likeCount: prompts.likeCount,
      favoriteCount: prompts.favoriteCount,
      sendCount: prompts.sendCount,
      approvedAt: prompts.approvedAt,
      categoryId: prompts.categoryId,
      categorySlug: categories.slug,
      categoryName: categories.name,
      favoritedAt: favorites.createdAt,
      contributorId: prompts.contributorId,
      contributorName: users.name,
      contributorImage: users.image,
    })
    .from(favorites)
    .innerJoin(prompts, eq(prompts.id, favorites.promptId))
    .innerJoin(categories, eq(categories.id, prompts.categoryId))
    .leftJoin(users, eq(users.id, prompts.contributorId))
    .where(and(...conds))
    .orderBy(desc(favorites.createdAt))
    .limit(opts.limit + 1);
  const trimmed = rows.slice(0, opts.limit);
  const ids = trimmed.map((r) => r.id);
  const imgs =
    ids.length === 0
      ? []
      : await db
          .select()
          .from(promptImages)
          .where(
            sql`${promptImages.promptId} IN (${sql.join(
              ids.map((i) => sql`${i}`),
              sql`, `,
            )})`,
          )
          .orderBy(promptImages.order);
  const firstImg = new Map<string, (typeof imgs)[number]>();
  for (const img of imgs) if (!firstImg.has(img.promptId)) firstImg.set(img.promptId, img);
  return {
    items: trimmed.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      category: { id: r.categoryId, slug: r.categorySlug, name: r.categoryName },
      tags: [],
      aspectRatio: r.aspectRatio,
      primaryImage: firstImg.get(r.id)
        ? {
            r2AccountId: firstImg.get(r.id)!.r2AccountId,
            r2Key: firstImg.get(r.id)!.r2Key,
            width: firstImg.get(r.id)!.width,
            height: firstImg.get(r.id)!.height,
            lqip: firstImg.get(r.id)!.lqip,
          }
        : null,
      contributor: r.contributorId
        ? {
            id: r.contributorId,
            name: r.contributorName,
            avatarUrl: r.contributorImage,
          }
        : null,
      viewCount: r.viewCount,
      likeCount: r.likeCount,
      favoriteCount: r.favoriteCount,
      sendCount: r.sendCount,
      approvedAt: r.approvedAt.toISOString(),
    })),
    nextCursor:
      rows.length > opts.limit ? trimmed[trimmed.length - 1]!.favoritedAt.toISOString() : null,
  };
}
