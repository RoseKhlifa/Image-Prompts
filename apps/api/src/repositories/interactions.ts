import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { likes, favorites, viewLog } from "../db/schema/interactions.ts";
import { prompts, categories, promptImages, promptTags, tags } from "../db/schema/index.ts";

export class AlreadyExistsError extends Error {
  constructor() {
    super("already_exists");
    this.name = "AlreadyExistsError";
  }
}
export class NotFoundError extends Error {
  constructor() {
    super("not_found");
    this.name = "NotFoundError";
  }
}

export type ToggleAction = "add" | "remove";

export async function toggleLike(
  userId: string,
  promptId: string,
  action: ToggleAction,
): Promise<{ like_count: number }> {
  return await db.transaction(async (tx) => {
    if (action === "add") {
      const inserted = await tx
        .insert(likes)
        .values({ userId, promptId })
        .onConflictDoNothing()
        .returning({ userId: likes.userId });
      if (inserted.length === 0) throw new AlreadyExistsError();

      const [row] = await tx
        .update(prompts)
        .set({ likeCount: sql`${prompts.likeCount} + 1` })
        .where(eq(prompts.id, promptId))
        .returning({ likeCount: prompts.likeCount });
      return { like_count: row?.likeCount ?? 0 };
    } else {
      const deleted = await tx
        .delete(likes)
        .where(and(eq(likes.userId, userId), eq(likes.promptId, promptId)))
        .returning({ userId: likes.userId });
      if (deleted.length === 0) throw new NotFoundError();

      const [row] = await tx
        .update(prompts)
        .set({ likeCount: sql`${prompts.likeCount} - 1` })
        .where(eq(prompts.id, promptId))
        .returning({ likeCount: prompts.likeCount });
      return { like_count: row?.likeCount ?? 0 };
    }
  });
}

export async function toggleFavorite(
  userId: string,
  promptId: string,
  action: ToggleAction,
): Promise<{ favorite_count: number }> {
  return await db.transaction(async (tx) => {
    if (action === "add") {
      const inserted = await tx
        .insert(favorites)
        .values({ userId, promptId })
        .onConflictDoNothing()
        .returning({ userId: favorites.userId });
      if (inserted.length === 0) throw new AlreadyExistsError();

      const [row] = await tx
        .update(prompts)
        .set({ favoriteCount: sql`${prompts.favoriteCount} + 1` })
        .where(eq(prompts.id, promptId))
        .returning({ favoriteCount: prompts.favoriteCount });
      return { favorite_count: row?.favoriteCount ?? 0 };
    } else {
      const deleted = await tx
        .delete(favorites)
        .where(and(eq(favorites.userId, userId), eq(favorites.promptId, promptId)))
        .returning({ userId: favorites.userId });
      if (deleted.length === 0) throw new NotFoundError();

      const [row] = await tx
        .update(prompts)
        .set({ favoriteCount: sql`${prompts.favoriteCount} - 1` })
        .where(eq(prompts.id, promptId))
        .returning({ favoriteCount: prompts.favoriteCount });
      return { favorite_count: row?.favoriteCount ?? 0 };
    }
  });
}

export type RecordViewInput = {
  promptId: string;
  userId: string | null;
  ipHash: string | null;
};

export async function recordView(input: RecordViewInput): Promise<{ recorded: boolean }> {
  if (input.userId === null && input.ipHash === null) {
    return { recorded: false };
  }
  return await db.transaction(async (tx) => {
    const inserted = await tx
      .insert(viewLog)
      .values({
        promptId: input.promptId,
        userId: input.userId,
        ipHash: input.ipHash,
        bucketDate: new Date().toISOString().slice(0, 10),
      })
      .onConflictDoNothing()
      .returning({ id: viewLog.id });

    if (inserted.length === 0) return { recorded: false };

    await tx
      .update(prompts)
      .set({ viewCount: sql`${prompts.viewCount} + 1` })
      .where(eq(prompts.id, input.promptId));

    return { recorded: true };
  });
}

export type ListMyFavoritesResult = {
  items: Array<{
    id: string;
    slug: string;
    title: unknown;
    aspectRatio: string | null;
    viewCount: number;
    likeCount: number;
    sendCount: number;
    favoriteCount: number;
    approvedAt: string;
    category: {
      id: string;
      slug: string;
      name: unknown;
    };
    primaryImage: {
      r2AccountId: string;
      r2Key: string;
      width: number | null;
      height: number | null;
      lqip: string | null;
    } | null;
    tags: Array<{ slug: string; name: unknown }>;
    userLiked: boolean;
    userFavorited: boolean;
  }>;
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

export async function listMyFavorites(
  userId: string,
  page: number,
  pageSize: number,
): Promise<ListMyFavoritesResult> {
  const offset = (page - 1) * pageSize;

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(favorites)
    .where(eq(favorites.userId, userId));
  const total = countRow?.total ?? 0;

  if (total === 0) {
    return { items: [], total: 0, page, pageSize, hasMore: false };
  }

  const rows = await db
    .select({
      id: prompts.id,
      slug: prompts.slug,
      title: prompts.title,
      aspectRatio: prompts.aspectRatio,
      viewCount: prompts.viewCount,
      likeCount: prompts.likeCount,
      sendCount: prompts.sendCount,
      favoriteCount: prompts.favoriteCount,
      approvedAt: prompts.approvedAt,
      categoryId: prompts.categoryId,
      categorySlug: categories.slug,
      categoryName: categories.name,
      favoritedAt: favorites.createdAt,
    })
    .from(favorites)
    .innerJoin(prompts, eq(prompts.id, favorites.promptId))
    .innerJoin(categories, eq(categories.id, prompts.categoryId))
    .where(eq(favorites.userId, userId))
    .orderBy(desc(favorites.createdAt))
    .limit(pageSize)
    .offset(offset);

  const ids = rows.map((r) => r.id);

  const images = await db
    .select({
      promptId: promptImages.promptId,
      r2AccountId: promptImages.r2AccountId,
      r2Key: promptImages.r2Key,
      width: promptImages.width,
      height: promptImages.height,
      lqip: promptImages.lqip,
      order: promptImages.order,
    })
    .from(promptImages)
    .where(inArray(promptImages.promptId, ids))
    .orderBy(asc(promptImages.order));

  const firstImage = new Map<string, (typeof images)[number]>();
  for (const img of images) {
    if (!firstImage.has(img.promptId)) firstImage.set(img.promptId, img);
  }

  const tagRows = await db
    .select({ promptId: promptTags.promptId, slug: tags.slug, name: tags.name })
    .from(promptTags)
    .innerJoin(tags, eq(tags.id, promptTags.tagId))
    .where(inArray(promptTags.promptId, ids));

  const tagsByPrompt = new Map<string, Array<{ slug: string; name: unknown }>>();
  for (const tr of tagRows) {
    const list = tagsByPrompt.get(tr.promptId) ?? [];
    list.push({ slug: tr.slug, name: tr.name });
    tagsByPrompt.set(tr.promptId, list);
  }

  const likedRows = await db
    .select({ promptId: likes.promptId })
    .from(likes)
    .where(and(eq(likes.userId, userId), inArray(likes.promptId, ids)));
  const likedSet = new Set(likedRows.map((r) => r.promptId));

  const items = rows.map((r) => {
    const img = firstImage.get(r.id) ?? null;
    return {
      id: r.id,
      slug: r.slug,
      title: r.title,
      aspectRatio: r.aspectRatio,
      viewCount: r.viewCount,
      likeCount: r.likeCount,
      sendCount: r.sendCount,
      favoriteCount: r.favoriteCount,
      approvedAt: r.approvedAt.toISOString(),
      category: {
        id: r.categoryId,
        slug: r.categorySlug,
        name: r.categoryName,
      },
      primaryImage: img
        ? {
            r2AccountId: img.r2AccountId,
            r2Key: img.r2Key,
            width: img.width,
            height: img.height,
            lqip: img.lqip,
          }
        : null,
      tags: tagsByPrompt.get(r.id) ?? [],
      userLiked: likedSet.has(r.id),
      userFavorited: true,
    };
  });

  return {
    items,
    total,
    page,
    pageSize,
    hasMore: page * pageSize < total,
  };
}
