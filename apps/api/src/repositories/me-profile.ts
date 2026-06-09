import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { users } from "../db/schema/auth.ts";
import {
  prompts as promptsTable,
  userPinnedPrompts,
} from "../db/schema/index.ts";
import {
  type SocialLinks,
  getPinnedPromptsForUser,
} from "./users-public.ts";

type Bilingual = { zh?: string; en?: string };

/**
 * Thrown by setMyPinnedPrompts when one of the supplied prompt ids isn't
 * owned by the calling user — either the prompt doesn't exist or it belongs
 * to a different contributor. The route layer maps this to 400 with
 * `not_owned:<id>` so the modal can highlight the bad row.
 */
export class PromptNotOwnedError extends Error {
  constructor(public readonly promptId: string) {
    super(`prompt ${promptId} is not owned by the user`);
    this.name = "PromptNotOwnedError";
  }
}

export type UpdateMyProfilePatch = {
  bio?:
    | {
        zh?: string | undefined;
        en?: string | undefined;
      }
    | undefined;
  socialLinks?:
    | {
        github?: string | undefined;
        twitter?: string | undefined;
        bilibili?: string | undefined;
        website?: string | undefined;
      }
    | undefined;
};

export type ProfileSlice = {
  bio: Bilingual | null;
  socialLinks: SocialLinks | null;
};

/**
 * Patches the calling user's profile slice (bio + social links). Each side of
 * bio and each social slot is "merge on present": pass the side/slot to
 * change, omit it to leave it as-is. An empty string clears that side/slot.
 * When all sides/slots end up empty, the jsonb column becomes null.
 *
 * NB: bio and socialLinks are patched independently. If the caller only sends
 * `bio`, socialLinks is untouched; merging happens against the current row.
 */
export async function updateMyProfile(
  userId: string,
  patch: UpdateMyProfilePatch,
): Promise<ProfileSlice> {
  // Read current values up front so we can merge per-side / per-slot. Bilingual
  // bio merges similar to prompt fields: send only the side you want to update.
  const [cur] = await db
    .select({ bio: users.bio, socialLinks: users.socialLinks })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!cur) {
    throw new Error(`updateMyProfile: user ${userId} not found`);
  }

  const setClause: Record<string, unknown> = { updatedAt: sql`now()` };

  if (patch.bio !== undefined) {
    const incoming = patch.bio;
    const curBio = (cur.bio as Bilingual | null) ?? {};
    const merged: Bilingual = {};
    // For each side: caller-supplied (even empty string) wins; otherwise keep
    // current. Empty string then drops the side via compactBilingual below.
    const zh = incoming.zh !== undefined ? incoming.zh : curBio.zh;
    const en = incoming.en !== undefined ? incoming.en : curBio.en;
    if (zh && zh.length > 0) merged.zh = zh;
    if (en && en.length > 0) merged.en = en;
    setClause.bio = Object.keys(merged).length > 0 ? merged : null;
  }

  if (patch.socialLinks !== undefined) {
    const incoming = patch.socialLinks;
    const curLinks = (cur.socialLinks as SocialLinks | null) ?? {};
    const merged: SocialLinks = {};
    const gh = incoming.github !== undefined ? incoming.github : curLinks.github;
    const tw = incoming.twitter !== undefined ? incoming.twitter : curLinks.twitter;
    const bili =
      incoming.bilibili !== undefined ? incoming.bilibili : curLinks.bilibili;
    const site =
      incoming.website !== undefined ? incoming.website : curLinks.website;
    if (gh && gh.length > 0) merged.github = gh;
    if (tw && tw.length > 0) merged.twitter = tw;
    if (bili && bili.length > 0) merged.bilibili = bili;
    if (site && site.length > 0) merged.website = site;
    setClause.socialLinks = Object.keys(merged).length > 0 ? merged : null;
  }

  await db.update(users).set(setClause).where(eq(users.id, userId));

  const [after] = await db
    .select({ bio: users.bio, socialLinks: users.socialLinks })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return {
    bio: (after?.bio as Bilingual | null) ?? null,
    socialLinks: (after?.socialLinks as SocialLinks | null) ?? null,
  };
}

/**
 * Replace the user's pinned set with the supplied prompt ids (0–3, max
 * enforced by the route schema). Validates that every id belongs to a
 * prompt with `contributorId = userId`; otherwise throws
 * PromptNotOwnedError for the first offender.
 *
 * Implementation: DELETE all existing rows for the user, then INSERT the
 * new ones with `order = position in the array`. Atomic inside a single
 * transaction so a partial failure can't leave the user with a torn set.
 *
 * Returns the new pinned summaries (`PromptSummary`-shaped, same enrichment
 * as `getUserPublic`) so the caller can hydrate the cache without a refetch.
 */
export async function setMyPinnedPrompts(
  userId: string,
  promptIds: string[],
): Promise<Awaited<ReturnType<typeof getPinnedPromptsForUser>>> {
  // De-dupe defensively. The route validates max 3 but doesn't dedupe;
  // duplicates here would just shadow each other on PRIMARY KEY conflict.
  // Preserving first-seen order matches the modal's click-order convention.
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of promptIds) {
    if (!seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  }

  if (ordered.length > 0) {
    // Ownership check: every id must be a prompt with contributorId = userId.
    // We use IN (...) + check the returned set so a single round-trip catches
    // multiple bad ids; the error reports the FIRST id that's missing or
    // foreign-owned so the modal can point at one row at a time.
    const owned = await db
      .select({ id: promptsTable.id })
      .from(promptsTable)
      .where(
        and(
          inArray(promptsTable.id, ordered),
          eq(promptsTable.contributorId, userId),
        ),
      );
    const ownedSet = new Set(owned.map((r) => r.id));
    for (const id of ordered) {
      if (!ownedSet.has(id)) throw new PromptNotOwnedError(id);
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(userPinnedPrompts)
      .where(eq(userPinnedPrompts.userId, userId));
    if (ordered.length > 0) {
      await tx.insert(userPinnedPrompts).values(
        ordered.map((promptId, idx) => ({
          userId,
          promptId,
          order: idx,
        })),
      );
    }
  });

  return getPinnedPromptsForUser(userId);
}

// Re-export for callers that want the enrichment view without importing both.
export { getPinnedPromptsForUser };
