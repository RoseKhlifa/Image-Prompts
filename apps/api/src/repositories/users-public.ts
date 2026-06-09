import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { users } from "../db/schema/auth.ts";
import {
  prompts,
  promptImages,
  categories,
  userPinnedPrompts,
} from "../db/schema/index.ts";
import { favorites } from "../db/schema/interactions.ts";

type Bilingual = { zh?: string; en?: string };

export type SocialLinks = {
  github?: string;
  twitter?: string;
  bilibili?: string;
  website?: string;
};

type PromptSummaryPublic = {
  id: string;
  slug: string;
  title: Bilingual;
  category: { id: string; slug: string; name: Bilingual };
  tags: Array<{ slug: string; name: Bilingual }>;
  aspectRatio: string | null;
  primaryImage:
    | {
        r2AccountId: string;
        r2Key: string;
        width: number | null;
        height: number | null;
        lqip: string | null;
      }
    | null;
  contributor: { id: string; name: string | null; avatarUrl: string | null } | null;
  viewCount: number;
  likeCount: number;
  favoriteCount: number;
  sendCount: number;
  approvedAt: string;
};

export type UserPublic = {
  id: string;
  name: string | null;
  image: string | null;
  role: "user" | "moderator" | "admin";
  joinedAt: string;
  /** Bilingual short self-intro. Null when never set. */
  bio: Bilingual | null;
  /** Fixed-slot social links. Null when none are set. */
  socialLinks: SocialLinks | null;
  /** 0–3 pinned prompts, ordered by pin order ASC. */
  pinnedPrompts: PromptSummaryPublic[];
};

export async function getUserPublic(id: string): Promise<UserPublic | null> {
  const [row] = await db
    .select({
      id: users.id,
      name: users.name,
      image: users.image,
      role: users.role,
      createdAt: users.createdAt,
      bio: users.bio,
      socialLinks: users.socialLinks,
    })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!row) return null;

  const pinnedPrompts = await getPinnedPromptsForUser(id);

  return {
    id: row.id,
    name: row.name,
    image: row.image,
    role: row.role,
    joinedAt: row.createdAt.toISOString(),
    bio: (row.bio as Bilingual | null) ?? null,
    socialLinks: (row.socialLinks as SocialLinks | null) ?? null,
    pinnedPrompts,
  };
}

/**
 * Returns this user's pinned prompts as `PromptSummary`-shaped rows ordered by
 * `user_pinned_prompts.order ASC`. Empty array when no pins or any pinned ids
 * were silently dropped (FK cascade on prompt delete).
 *
 * Same enrichment shape as `listUserPrompts` so the frontend can render the
 * pinned row with the same `PromptCard` component as the works grid.
 */
export async function getPinnedPromptsForUser(
  userId: string,
): Promise<PromptSummaryPublic[]> {
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
      contributorId: prompts.contributorId,
      contributorName: users.name,
      contributorImage: users.image,
      pinOrder: userPinnedPrompts.order,
    })
    .from(userPinnedPrompts)
    .innerJoin(prompts, eq(prompts.id, userPinnedPrompts.promptId))
    .innerJoin(categories, eq(categories.id, prompts.categoryId))
    .leftJoin(users, eq(users.id, prompts.contributorId))
    .where(eq(userPinnedPrompts.userId, userId))
    .orderBy(asc(userPinnedPrompts.order), asc(userPinnedPrompts.createdAt));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const imgs = await db
    .select()
    .from(promptImages)
    .where(inArray(promptImages.promptId, ids))
    .orderBy(asc(promptImages.order));
  const firstImg = new Map<string, (typeof imgs)[number]>();
  for (const img of imgs) if (!firstImg.has(img.promptId)) firstImg.set(img.promptId, img);
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    title: r.title as Bilingual,
    category: {
      id: r.categoryId,
      slug: r.categorySlug,
      name: r.categoryName as Bilingual,
    },
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
  }));
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
