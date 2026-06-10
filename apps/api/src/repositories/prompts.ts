import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { db } from "../db/client.ts";
import { categories, prompts, promptImages, promptTags, tags } from "../db/schema/index.ts";
import { users } from "../db/schema/auth.ts";
import type { PromptListQuerySchema } from "@ip/shared";
import { excludeNsfw } from "./_filters.ts";

type PromptListQuery = z.infer<typeof PromptListQuerySchema>;

// PRIMARY: user-submitted content (source='site') always comes ahead of
// imported / seeded content. This is the editorial signal — visitors should
// see what real contributors made before they see the crawled gallery the
// owner curated as a baseline. SECONDARY: the user-selected sort criterion.
const sourcePriorityAsc = sql`CASE WHEN ${prompts.source} = 'site' THEN 0 ELSE 1 END`;

// Daily-seeded shuffle hash. Same value all day → pagination is stable;
// changes at midnight → list rotates every day so visitors get a different
// face on the homepage without us having to do anything. Used as either
// (a) the active sort key for the imported tier under `sort=latest` (where
// chronological order is meaningless — every imported row was approved
// within seconds of every other), or (b) a tiebreaker for the other sorts
// (where imported rows currently all share the same metric value of 0).
function dailySeed(): string {
  // YYYY-MM-DD in UTC. Server's clock; doesn't have to match user timezone.
  return new Date().toISOString().slice(0, 10);
}

const orderBy = (sort: PromptListQuery["sort"]) => {
  const seed = dailySeed();
  const tiebreaker = sql`md5(${prompts.id}::text || ${seed})`;

  switch (sort) {
    case "popular":
      return [asc(sourcePriorityAsc), desc(prompts.viewCount), tiebreaker];
    case "liked":
      return [asc(sourcePriorityAsc), desc(prompts.likeCount), tiebreaker];
    case "sent":
      return [asc(sourcePriorityAsc), desc(prompts.sendCount), tiebreaker];
    case "latest":
    default:
      // For source='site' rows: real chronological order on approved_at.
      // For source='imported' rows: NULL in this clause so they fall through
      //   to the tiebreaker (daily hash) — bulk imports approved within
      //   seconds of each other make approved_at meaningless for them.
      return [
        asc(sourcePriorityAsc),
        sql`CASE WHEN ${prompts.source} = 'site' THEN ${prompts.approvedAt} END DESC NULLS LAST`,
        tiebreaker,
      ];
  }
};

export async function listPrompts(q: PromptListQuery, currentUserId?: string) {
  const offset = (q.page - 1) * q.pageSize;

  // Resolve category and tag IDs from slugs.
  let categoryId: string | undefined;
  if (q.category) {
    const [row] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, q.category));
    if (!row) return { items: [], total: 0, page: q.page, pageSize: q.pageSize, hasMore: false };
    categoryId = row.id;
  }

  let promptIdsByTag: string[] | undefined;
  if (q.tag) {
    const [tagRow] = await db.select({ id: tags.id }).from(tags).where(eq(tags.slug, q.tag));
    if (!tagRow) return { items: [], total: 0, page: q.page, pageSize: q.pageSize, hasMore: false };
    const ids = await db
      .select({ id: promptTags.promptId })
      .from(promptTags)
      .where(eq(promptTags.tagId, tagRow.id));
    promptIdsByTag = ids.map((r) => r.id);
    if (promptIdsByTag.length === 0)
      return { items: [], total: 0, page: q.page, pageSize: q.pageSize, hasMore: false };
  }

  const conditions = [
    categoryId ? eq(prompts.categoryId, categoryId) : undefined,
    promptIdsByTag ? inArray(prompts.id, promptIdsByTag) : undefined,
    q.aspect ? eq(prompts.aspectRatio, q.aspect) : undefined,
    q.q
      ? sql`(${prompts.title}->>'zh' ILIKE ${"%" + q.q + "%"}
            OR ${prompts.title}->>'en' ILIKE ${"%" + q.q + "%"}
            OR ${prompts.prompt}->>'zh' ILIKE ${"%" + q.q + "%"}
            OR ${prompts.prompt}->>'en' ILIKE ${"%" + q.q + "%"}
            OR EXISTS (
              SELECT 1 FROM prompt_tags pt
              JOIN tags t ON pt.tag_id = t.id
              WHERE pt.prompt_id = ${prompts.id}
                AND (t.slug ILIKE ${"%" + q.q + "%"}
                  OR t.name->>'zh' ILIKE ${"%" + q.q + "%"}
                  OR t.name->>'en' ILIKE ${"%" + q.q + "%"}))
            )`
      : undefined,
    // Exclude NSFW prompts from the default list. Bypass only when the caller
    // explicitly asked for ?category=nsfw — that's the opt-in entry point per
    // the spec. (See docs/superpowers/plans/2026-06-09-nsfw-category.md.)
    q.category === "nsfw" ? undefined : excludeNsfw(),
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const where = conditions.length ? and(...conditions) : undefined;

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(prompts)
    .where(where);
  const total = countRow?.total ?? 0;

  if (total === 0) return { items: [], total, page: q.page, pageSize: q.pageSize, hasMore: false };

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
      contributorId: prompts.contributorId,
      contributorName: users.name,
      contributorImage: users.image,
      sourceSite: prompts.sourceSite,
      sourceUrl: prompts.sourceUrl,
      userLiked: currentUserId
        ? sql<boolean>`EXISTS (SELECT 1 FROM likes WHERE likes.prompt_id = ${prompts.id} AND likes.user_id = ${currentUserId})`
        : sql<boolean>`FALSE`,
      userFavorited: currentUserId
        ? sql<boolean>`EXISTS (SELECT 1 FROM favorites WHERE favorites.prompt_id = ${prompts.id} AND favorites.user_id = ${currentUserId})`
        : sql<boolean>`FALSE`,
    })
    .from(prompts)
    .innerJoin(categories, eq(categories.id, prompts.categoryId))
    .leftJoin(users, eq(users.id, prompts.contributorId))
    .where(where)
    .orderBy(...orderBy(q.sort))
    .limit(q.pageSize)
    .offset(offset);

  if (rows.length === 0)
    return { items: [], total, page: q.page, pageSize: q.pageSize, hasMore: false };

  const ids = rows.map((r) => r.id);

  // Primary image per prompt (order = 0)
  const images = await db
    .select({
      promptId: promptImages.promptId,
      r2AccountId: promptImages.r2AccountId,
      r2Key: promptImages.r2Key,
      remoteUrl: promptImages.remoteUrl,
      width: promptImages.width,
      height: promptImages.height,
      lqip: promptImages.lqip,
      order: promptImages.order,
    })
    .from(promptImages)
    .where(inArray(promptImages.promptId, ids))
    .orderBy(asc(promptImages.order));
  const firstImageByPrompt = new Map<string, (typeof images)[number]>();
  for (const img of images) {
    if (!firstImageByPrompt.has(img.promptId)) firstImageByPrompt.set(img.promptId, img);
  }

  // Tags per prompt
  const tagsRows = await db
    .select({
      promptId: promptTags.promptId,
      slug: tags.slug,
      name: tags.name,
    })
    .from(promptTags)
    .innerJoin(tags, eq(tags.id, promptTags.tagId))
    .where(inArray(promptTags.promptId, ids));

  const tagsByPrompt = new Map<
    string,
    Array<{ slug: string; name: (typeof tagsRows)[number]["name"] }>
  >();
  for (const r of tagsRows) {
    const list = tagsByPrompt.get(r.promptId) ?? [];
    list.push({ slug: r.slug, name: r.name });
    tagsByPrompt.set(r.promptId, list);
  }

  const items = rows.map((r) => {
    const img = firstImageByPrompt.get(r.id) ?? null;
    return {
      id: r.id,
      slug: r.slug,
      title: r.title,
      category: { id: r.categoryId, slug: r.categorySlug, name: r.categoryName },
      tags: tagsByPrompt.get(r.id) ?? [],
      aspectRatio: r.aspectRatio,
      primaryImage: img
        ? {
            r2AccountId: img.r2AccountId,
            r2Key: img.r2Key,
            remoteUrl: img.remoteUrl,
            width: img.width,
            height: img.height,
            lqip: img.lqip,
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
      sendCount: r.sendCount,
      favoriteCount: r.favoriteCount,
      approvedAt: r.approvedAt.toISOString(),
      ...(r.sourceSite ? { sourceSite: r.sourceSite } : {}),
      ...(r.sourceUrl ? { sourceUrl: r.sourceUrl } : {}),
      ...(currentUserId ? { userLiked: r.userLiked, userFavorited: r.userFavorited } : {}),
    };
  });

  return {
    items,
    total,
    page: q.page,
    pageSize: q.pageSize,
    hasMore: q.page * q.pageSize < total,
  };
}

export async function getPromptBySlug(slug: string, currentUserId?: string) {
  const [row] = await db
    .select({
      id: prompts.id,
      slug: prompts.slug,
      title: prompts.title,
      prompt: prompts.prompt,
      negativePrompt: prompts.negativePrompt,
      notes: prompts.notes,
      aspectRatio: prompts.aspectRatio,
      viewCount: prompts.viewCount,
      likeCount: prompts.likeCount,
      sendCount: prompts.sendCount,
      favoriteCount: prompts.favoriteCount,
      approvedAt: prompts.approvedAt,
      createdAt: prompts.createdAt,
      updatedAt: prompts.updatedAt,
      source: prompts.source,
      contributorId: prompts.contributorId,
      categoryId: prompts.categoryId,
      categorySlug: categories.slug,
      categoryName: categories.name,
      contributorName: users.name,
      contributorImage: users.image,
      sourceSite: prompts.sourceSite,
      sourceUrl: prompts.sourceUrl,
      userLiked: currentUserId
        ? sql<boolean>`EXISTS (SELECT 1 FROM likes WHERE likes.prompt_id = ${prompts.id} AND likes.user_id = ${currentUserId})`
        : sql<boolean>`FALSE`,
      userFavorited: currentUserId
        ? sql<boolean>`EXISTS (SELECT 1 FROM favorites WHERE favorites.prompt_id = ${prompts.id} AND favorites.user_id = ${currentUserId})`
        : sql<boolean>`FALSE`,
    })
    .from(prompts)
    .innerJoin(categories, eq(categories.id, prompts.categoryId))
    .leftJoin(users, eq(users.id, prompts.contributorId))
    .where(eq(prompts.slug, slug));

  if (!row) return null;

  const images = await db
    .select()
    .from(promptImages)
    .where(eq(promptImages.promptId, row.id))
    .orderBy(asc(promptImages.order));

  const tagRows = await db
    .select({ slug: tags.slug, name: tags.name })
    .from(promptTags)
    .innerJoin(tags, eq(tags.id, promptTags.tagId))
    .where(eq(promptTags.promptId, row.id));

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    prompt: row.prompt,
    negativePrompt: row.negativePrompt,
    notes: row.notes,
    aspectRatio: row.aspectRatio,
    category: { id: row.categoryId, slug: row.categorySlug, name: row.categoryName },
    tags: tagRows,
    primaryImage: images[0]
      ? {
          r2AccountId: images[0].r2AccountId,
          r2Key: images[0].r2Key,
          remoteUrl: images[0].remoteUrl,
          width: images[0].width,
          height: images[0].height,
          lqip: images[0].lqip,
        }
      : null,
    images: images.map((i) => ({
      id: i.id,
      r2AccountId: i.r2AccountId,
      r2Key: i.r2Key,
      remoteUrl: i.remoteUrl,
      order: i.order,
      altText: i.altText,
      width: i.width,
      height: i.height,
      lqip: i.lqip,
    })),
    contributor: row.contributorId
      ? {
          id: row.contributorId,
          name: row.contributorName,
          avatarUrl: row.contributorImage,
        }
      : null,
    viewCount: row.viewCount,
    likeCount: row.likeCount,
    sendCount: row.sendCount,
    favoriteCount: row.favoriteCount,
    source: row.source,
    approvedAt: row.approvedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.sourceSite ? { sourceSite: row.sourceSite } : {}),
    ...(row.sourceUrl ? { sourceUrl: row.sourceUrl } : {}),
    ...(currentUserId ? { userLiked: row.userLiked, userFavorited: row.userFavorited } : {}),
  };
}

export async function listRelatedPrompts(promptId: string, categoryId: string, limit = 6) {
  // Same-category siblings, excluding self. The `categoryId` filter already
  // constrains visibility correctly: an SFW source naturally yields SFW
  // siblings (a prompt belongs to exactly one category), and an NSFW source
  // yields its NSFW siblings — which is what we want on the detail page of
  // a gated NSFW prompt. So we do NOT apply `excludeNsfw()` here.
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
    })
    .from(prompts)
    .where(
      and(
        eq(prompts.categoryId, categoryId),
        sql`${prompts.id} <> ${promptId}`,
      ),
    )
    // Source priority first (user submissions ahead of imports), then the
    // ranking signal. Matches the listPrompts ordering rule.
    .orderBy(asc(sourcePriorityAsc), desc(prompts.likeCount), desc(prompts.approvedAt))
    .limit(limit);

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);

  // Fetch primary images (smallest order) for all related prompts
  const images = await db
    .select({
      promptId: promptImages.promptId,
      r2AccountId: promptImages.r2AccountId,
      r2Key: promptImages.r2Key,
      remoteUrl: promptImages.remoteUrl,
      width: promptImages.width,
      height: promptImages.height,
      lqip: promptImages.lqip,
      order: promptImages.order,
    })
    .from(promptImages)
    .where(inArray(promptImages.promptId, ids))
    .orderBy(asc(promptImages.order));

  const firstImageByPrompt = new Map<string, (typeof images)[number]>();
  for (const img of images) {
    if (!firstImageByPrompt.has(img.promptId)) firstImageByPrompt.set(img.promptId, img);
  }

  return rows.map((r) => {
    const img = firstImageByPrompt.get(r.id) ?? null;
    return {
      ...r,
      primaryImage: img
        ? {
            r2AccountId: img.r2AccountId,
            r2Key: img.r2Key,
            remoteUrl: img.remoteUrl,
            width: img.width,
            height: img.height,
            lqip: img.lqip,
          }
        : null,
    };
  });
}
