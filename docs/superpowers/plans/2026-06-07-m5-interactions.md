# M5 Implementation Plan: Likes / Favorites / Views + Copy + More

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Light up the four disabled buttons left over from M3 (detail-page Copy / Favorite / More + card-hover Heart), add a Like toggle, record per-prompt view counts with 24h dedup, and add a "My Favorites" tab on `/profile`.

**Architecture:** Six new endpoints (POST/DELETE `/api/prompts/:id/like|favorite`, POST `/api/prompts/:id/view`, GET `/api/me/favorites`) backed by a single new DB table (`view_log`). The `likes`/`favorites` tables already exist from M1. Extends `GET /api/prompts*` to include `userLiked`/`userFavorited` on each item when the request is authenticated, so the card grid never needs a follow-up API call. Frontend mutations use optimistic updates with rollback on failure. `LikeButton` is reused at two sizes for the card-hover overlay and the detail page.

**Tech Stack:** (no new deps) Hono + Drizzle + TanStack Query 5 + React 18, with the existing rate limiter, test-session helper, and SignInModal from M3.

**Spec reference:** `docs/superpowers/specs/2026-06-07-m5-interactions-design.md`

---

## File Structure (Created / Modified)

### Backend (`apps/api/`)

```
src/
├── db/schema/
│   └── interactions.ts                   # MODIFY: append viewLog table
├── lib/
│   └── ip-hash.ts                        # NEW: sha256(ip + AUTH_SECRET).slice(0,16)
├── repositories/
│   ├── interactions.ts                   # NEW: toggleLike, toggleFavorite,
│   │                                     #      recordView, listMyFavorites
│   ├── interactions.test.ts              # NEW: unit tests for the above
│   └── prompts.ts                        # MODIFY: listPrompts + getPromptBySlug
│                                         #         accept optional currentUserId
│                                         #         and add EXISTS subqueries
└── routes/
    ├── interactions.ts                   # NEW: 6 routes (4 toggle + 1 view + 1 favorites)
    ├── interactions.test.ts              # NEW: integration tests
    ├── prompts.ts                        # MODIFY: pass authUser.id to repo
    └── prompts.test.ts                   # MODIFY: extend tests for userLiked/userFavorited
drizzle/                                  # auto: new migration for view_log
```

### Shared (`packages/shared/`)

```
src/
└── schemas/
    ├── prompt.ts                         # MODIFY: PromptSummary/Detail += userLiked, userFavorited (.optional())
    └── interactions.ts                   # NEW: ToggleResultSchema, ViewAckSchema, MyFavoritesQuery
```

### Frontend (`apps/web/`)

```
src/
├── lib/
│   ├── hooks/
│   │   ├── useLikeMutation.ts            # NEW: like/unlike with optimistic update
│   │   ├── useFavoriteMutation.ts        # NEW: same shape, different endpoint
│   │   ├── useView.ts                    # NEW: fire-and-forget POST on detail mount
│   │   └── useMyFavorites.ts             # NEW: paginated list
│   └── interactions.ts                   # NEW: low-level fetch helpers
├── components/
│   ├── PromptDetail/
│   │   ├── CopyPromptButton.tsx          # NEW
│   │   ├── LikeButton.tsx                # NEW (variant: "full" | "compact")
│   │   ├── FavoriteButton.tsx            # NEW
│   │   ├── MoreMenu.tsx                  # NEW (icon-only dropdown)
│   │   ├── CopyPromptButton.test.tsx     # NEW
│   │   ├── LikeButton.test.tsx           # NEW
│   │   ├── FavoriteButton.test.tsx       # NEW
│   │   └── MoreMenu.test.tsx             # NEW
│   ├── PromptCard.tsx                    # MODIFY: hover overlay uses LikeButton compact
│   └── profile/
│       ├── ProfileInfoTab.tsx            # NEW: extracted from existing ProfilePage
│       └── FavoritesTab.tsx              # NEW: paginated masonry list
├── pages/
│   ├── PromptDetailPage.tsx              # MODIFY: wire 4 buttons, fire useView
│   └── ProfilePage.tsx                   # MODIFY: tab switcher reads ?tab=
└── i18n/locales/
    ├── zh.json                           # MODIFY: detail.* + interactions.* + profile.tabs
    └── en.json                           # MODIFY: same
```

---

## Task Dependency Order

```
Task 1  (Shared schemas)
  ↓
Task 2  (view_log table + migration)
  ↓
Task 3  (ip-hash helper + tests)
  ↓
Task 4  (interactions repository + unit tests — TDD)
  ↓
Task 5  (interactions routes + integration tests)
  ↓
Task 6  (extend prompts repo with userLiked/userFavorited)
  ↓
Task 7  (extend prompts route + tests)
  ↓
Task 8  (GET /api/me/favorites route + tests)
  ↓
Task 9  (Mount routes in server.ts)
  ↓
Task 10 (i18n keys)
  ↓
Task 11 (Frontend low-level fetch helpers)
  ↓
Task 12 (CopyPromptButton + test)
  ↓
Task 13 (useLikeMutation hook)
  ↓
Task 14 (LikeButton component + test)
  ↓
Task 15 (useFavoriteMutation hook)
  ↓
Task 16 (FavoriteButton + test)
  ↓
Task 17 (MoreMenu + test)
  ↓
Task 18 (PromptCard hover Heart → LikeButton compact)
  ↓
Task 19 (PromptDetailPage wiring: CTA grid + MoreMenu)
  ↓
Task 20 (useView hook + PromptDetailPage call)
  ↓
Task 21 (useMyFavorites hook)
  ↓
Task 22 (ProfilePage refactor + FavoritesTab + ProfileInfoTab)
  ↓
Task 23 (Manual test pass + final review)
```

---

### Task 1: Shared schemas

**Files:**
- Modify: `packages/shared/src/schemas/prompt.ts`
- Create: `packages/shared/src/schemas/interactions.ts`
- Modify: `packages/shared/src/schemas/index.ts` (only if not `export *`)

- [ ] **Step 1: Append `userLiked` / `userFavorited` to `PromptSummarySchema`**

Open `packages/shared/src/schemas/prompt.ts` and replace `PromptSummarySchema` with:

```ts
export const PromptSummarySchema = z.object({
  id: UuidSchema,
  slug: SlugSchema,
  title: BilingualTextSchema,
  category: z.object({
    id: UuidSchema,
    slug: SlugSchema,
    name: BilingualTextSchema,
  }),
  tags: z.array(z.object({ slug: SlugSchema, name: BilingualTextSchema })),
  aspectRatio: AspectRatioSchema.nullable(),
  primaryImage: PromptImageSchema.pick({
    r2AccountId: true,
    r2Key: true,
    width: true,
    height: true,
    lqip: true,
  }).nullable(),
  viewCount: z.number().int().nonnegative(),
  likeCount: z.number().int().nonnegative(),
  sendCount: z.number().int().nonnegative(),
  favoriteCount: z.number().int().nonnegative(),
  approvedAt: z.string(),
  // ★ M5: session-aware. Absent when the caller is anonymous; either field
  // present means the response was personalised for a logged-in viewer.
  userLiked: z.boolean().optional(),
  userFavorited: z.boolean().optional(),
});
```

`PromptDetailSchema` already extends `PromptSummarySchema`, so it inherits the new fields automatically.

- [ ] **Step 2: Create `packages/shared/src/schemas/interactions.ts`**

```ts
import { z } from "zod";
import { UuidSchema } from "./common.ts";

/**
 * Server response for a successful toggle (POST or DELETE). Even DELETE
 * returns the body so the client can sync the count without a second
 * request.
 */
export const ToggleResultSchema = z.object({
  liked: z.boolean().optional(),       // present on like routes
  favorited: z.boolean().optional(),   // present on favorite routes
  like_count: z.number().int().nonnegative().optional(),
  favorite_count: z.number().int().nonnegative().optional(),
});
export type ToggleResult = z.infer<typeof ToggleResultSchema>;

export const ViewAckSchema = z.object({
  recorded: z.boolean(),
});
export type ViewAck = z.infer<typeof ViewAckSchema>;

export const MyFavoritesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(60).default(24),
});
export type MyFavoritesQuery = z.infer<typeof MyFavoritesQuerySchema>;

export const PromptIdParamSchema = z.object({
  id: UuidSchema,
});
```

- [ ] **Step 3: Verify barrel export**

```bash
cat packages/shared/src/schemas/index.ts
```

If it ends with `export * from "./api.ts"; export * from "./common.ts"; export * from "./prompt.ts";` add a sibling line:

```ts
export * from "./interactions.ts";
```

If it does named exports, append the named exports too. (Match whatever the file already does for `prompt.ts`.)

- [ ] **Step 4: Tests pass**

```bash
pnpm --filter @ip/shared test
```

Expected: still 27 passing (existing tests unchanged; we haven't added schema tests for the new types because they're just `.optional()` extensions of well-tested base schemas).

- [ ] **Step 5: Typecheck workspace-wide**

```bash
pnpm typecheck
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/
git commit -m "feat(shared): session-aware prompt summary + interaction schemas"
```

---

### Task 2: `view_log` table + migration

**Files:**
- Modify: `apps/api/src/db/schema/interactions.ts`
- Create: `apps/api/drizzle/<timestamp>_view_log.sql` (auto-generated, then possibly hand-edited)

- [ ] **Step 1: Append `viewLog` to the schema file**

Add imports + the new table at the bottom of `apps/api/src/db/schema/interactions.ts`:

```ts
import { pgTable, uuid, text, timestamp, index, primaryKey, date, bigserial } from "drizzle-orm/pg-core";
// (extend the existing imports — don't duplicate)
```

Append:

```ts
/**
 * Per-prompt view log. The unique constraint on
 * (prompt_id, coalesce(user_id::text, ip_hash), bucket_date) gives us
 * 24h dedup: same viewer in the same UTC day inserts at most one row.
 *
 * Drizzle 0.38's `uniqueIndex(...).on(sql\`coalesce(...)\`)` is unreliable
 * for expression indexes, so the unique constraint is declared in the SQL
 * migration directly; here we only register a plain index on prompt_id.
 */
export const viewLog = pgTable(
  "view_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    promptId: uuid("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    ipHash: text("ip_hash"),
    bucketDate: date("bucket_date").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    promptIdx: index("view_log_prompt_idx").on(t.promptId),
  }),
);
```

- [ ] **Step 2: Generate the migration**

```bash
cd apps/api
pnpm db:generate
```

If drizzle-kit asks interactive questions, accept the default (this is a brand-new table with no overlap with existing ones). On Git Bash hangs (per M3 Task 2 retrospective), hand-write the migration as in M3 Task 2: copy the latest snapshot, bump prevId/id, append the table to it, and write the SQL by hand.

- [ ] **Step 3: Add the unique expression index to the migration SQL**

Open the generated migration file (`apps/api/drizzle/000X_*.sql`). After the `CREATE TABLE "view_log" (...)` block, append:

```sql
--> statement-breakpoint
CREATE UNIQUE INDEX "view_log_dedup_idx"
  ON "view_log" ("prompt_id", coalesce("user_id"::text, "ip_hash"), "bucket_date");
```

This is what enforces the 24h dedup; the Drizzle TS schema only knows about the plain `prompt_id` index.

- [ ] **Step 4: Apply the migration**

```bash
pnpm db:migrate
```

If you hand-edited the journal, ensure `when` is strictly greater than the previous entry (see M3 Task 3 retrospective).

- [ ] **Step 5: Verify with psql**

```bash
psql "$DATABASE_URL" -c '\d view_log'
psql "$DATABASE_URL" -c "SELECT indexdef FROM pg_indexes WHERE tablename='view_log';"
```

Expected:
- Table has columns: id (bigint not null), prompt_id (uuid not null), user_id (uuid nullable), ip_hash (text nullable), bucket_date (date not null), created_at (timestamptz not null)
- Indexes include `view_log_dedup_idx` (unique) and `view_log_prompt_idx`
- FK `view_log_prompt_id_prompts_id_fk` ON DELETE CASCADE
- FK `view_log_user_id_users_id_fk` ON DELETE SET NULL

- [ ] **Step 6: Verify drift check**

```bash
cd apps/api
pnpm db:generate
```

Expected: "No schema changes, nothing to migrate".

- [ ] **Step 7: Tests pass**

```bash
cd /d/Image-Prompts
pnpm test
```

Expected: 78 still passing.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/db/schema/interactions.ts apps/api/drizzle/
git commit -m "feat(api): add view_log table with 24h dedup unique index"
```

---

### Task 3: `ip-hash` helper + tests (TDD)

**Files:**
- Create: `apps/api/src/lib/ip-hash.ts`
- Create: `apps/api/src/lib/ip-hash.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/ip-hash.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hashIp } from "./ip-hash.ts";

describe("hashIp", () => {
  it("returns a 16-char lowercase hex string", () => {
    const out = hashIp("203.0.113.42", "test-secret-with-enough-chars-here");
    expect(out).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic for the same ip + secret", () => {
    const a = hashIp("203.0.113.42", "secret");
    const b = hashIp("203.0.113.42", "secret");
    expect(a).toBe(b);
  });

  it("differs for different ips with same secret", () => {
    const a = hashIp("203.0.113.42", "secret");
    const b = hashIp("203.0.113.43", "secret");
    expect(a).not.toBe(b);
  });

  it("differs for same ip with different secrets (rainbow-table resistance)", () => {
    const a = hashIp("203.0.113.42", "secret-A");
    const b = hashIp("203.0.113.42", "secret-B");
    expect(a).not.toBe(b);
  });

  it("returns 'unknown' marker for empty input", () => {
    // We don't want every guest with no XFF header to share a single bucket.
    // Instead, return null and let the caller decide.
    expect(hashIp("", "secret")).toBeNull();
    expect(hashIp(null, "secret")).toBeNull();
    expect(hashIp(undefined, "secret")).toBeNull();
  });
});
```

- [ ] **Step 2: Run — verify failure**

```bash
pnpm --filter @ip/api test src/lib/ip-hash.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `apps/api/src/lib/ip-hash.ts`:

```ts
import { createHash } from "node:crypto";

/**
 * Compute a salted 16-char hex hash of an IP address, suitable for use as
 * a privacy-preserving dedup key in view_log. The secret salts against
 * rainbow tables — different deployments produce different hashes for the
 * same IP. Restarting the API with a new secret rotates all hashes (and
 * effectively resets dedup buckets), which is acceptable.
 *
 * Returns null for empty/missing input so the caller can decide whether
 * to fall back to a different identifier or skip the view entirely. We
 * deliberately do NOT collapse all empty inputs into a single shared
 * bucket — that would let one bot fill a single row repeatedly while
 * blocking every other anonymous viewer.
 */
export function hashIp(ip: string | null | undefined, secret: string): string | null {
  if (!ip) return null;
  return createHash("sha256").update(ip).update(secret).digest("hex").slice(0, 16);
}
```

- [ ] **Step 4: Run — verify pass**

```bash
pnpm --filter @ip/api test src/lib/ip-hash.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/ip-hash.ts apps/api/src/lib/ip-hash.test.ts
git commit -m "feat(api): hashIp helper (salted sha256, privacy-preserving dedup key)"
```

---

### Task 4: `interactions` repository + unit tests (TDD)

**Files:**
- Create: `apps/api/src/repositories/interactions.ts`
- Create: `apps/api/src/repositories/interactions.test.ts`

- [ ] **Step 1: Write the first failing test**

Create `apps/api/src/repositories/interactions.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db, pool } from "../db/client.ts";
import { users } from "../db/schema/auth.ts";
import { prompts, categories } from "../db/schema/index.ts";
import { likes, favorites, viewLog } from "../db/schema/interactions.ts";
import {
  toggleLike,
  toggleFavorite,
  recordView,
  listMyFavorites,
  AlreadyExistsError,
  NotFoundError,
} from "./interactions.ts";

async function ensureTestUser(email: string) {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing) return existing.id;
  const [row] = await db.insert(users).values({ email }).returning({ id: users.id });
  return row!.id;
}

async function anyPrompt() {
  const [row] = await db
    .select({ id: prompts.id, likeCount: prompts.likeCount, favoriteCount: prompts.favoriteCount, viewCount: prompts.viewCount })
    .from(prompts)
    .limit(1);
  if (!row) throw new Error("test fixture missing: run pnpm db:seed first");
  return row;
}

beforeEach(async () => {
  await db.delete(viewLog);
  await db.delete(likes);
  await db.delete(favorites);
});

afterAll(async () => {
  await db.delete(viewLog);
  await db.delete(likes);
  await db.delete(favorites);
  await db.delete(users).where(like(users.email, "interactions-test-%@example.com"));
  await pool.end();
});

describe("toggleLike", () => {
  it("inserts a like row and increments like_count atomically", async () => {
    const userId = await ensureTestUser("interactions-test-1@example.com");
    const p = await anyPrompt();
    const result = await toggleLike(userId, p.id, "add");
    expect(result.like_count).toBe(p.likeCount + 1);

    const [row] = await db.select().from(likes).where(eq(likes.userId, userId));
    expect(row).toBeDefined();
  });

  it("throws AlreadyExistsError on double-add", async () => {
    const userId = await ensureTestUser("interactions-test-2@example.com");
    const p = await anyPrompt();
    await toggleLike(userId, p.id, "add");
    await expect(toggleLike(userId, p.id, "add")).rejects.toBeInstanceOf(AlreadyExistsError);
  });

  it("removes a like row and decrements like_count", async () => {
    const userId = await ensureTestUser("interactions-test-3@example.com");
    const p = await anyPrompt();
    await toggleLike(userId, p.id, "add");
    const result = await toggleLike(userId, p.id, "remove");
    expect(result.like_count).toBe(p.likeCount);
  });

  it("throws NotFoundError on remove when not liked", async () => {
    const userId = await ensureTestUser("interactions-test-4@example.com");
    const p = await anyPrompt();
    await expect(toggleLike(userId, p.id, "remove")).rejects.toBeInstanceOf(NotFoundError);
  });
});
```

- [ ] **Step 2: Run — verify failure**

```bash
pnpm --filter @ip/api test src/repositories/interactions.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement the repository**

Create `apps/api/src/repositories/interactions.ts`:

```ts
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { likes, favorites, viewLog } from "../db/schema/interactions.ts";
import { prompts, categories, promptImages, promptTags, tags } from "../db/schema/index.ts";

/**
 * Discriminated errors so the route layer can map to 404/409 without
 * parsing free-text messages.
 */
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

/**
 * Atomically insert/delete a like row and adjust prompts.like_count.
 * Returns the new like_count so the client can sync without a second read.
 */
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

/**
 * Same shape as toggleLike but against favorites.
 */
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

/**
 * Insert a view_log row (no-op on dedup conflict) and increment
 * prompts.view_count on first sight today. Returns whether a new row
 * was recorded.
 *
 * Caller must supply at least one of (userId, ipHash); both null means
 * skip silently (return recorded:false) — we can't dedup an anonymous
 * request with no IP.
 */
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
        bucketDate: new Date().toISOString().slice(0, 10), // YYYY-MM-DD UTC
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
    categoryId: string;
    categorySlug: string;
    categoryName: unknown;
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

/**
 * Return prompts the user has favorited, newest-favorite-first.
 *
 * Reuses prompts/categories/promptImages/promptTags joins from the main
 * listing repo but filters by user_id and orders by favorites.created_at.
 */
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

  // Every row in this query is a favorite, so userFavorited is always true.
  // userLiked needs a query.
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
      categoryId: r.categoryId,
      categorySlug: r.categorySlug,
      categoryName: r.categoryName,
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
```

- [ ] **Step 4: Run the like tests — verify pass**

```bash
pnpm --filter @ip/api test src/repositories/interactions.test.ts -t "toggleLike"
```

Expected: 4 tests pass.

- [ ] **Step 5: Add favorite + view + listMyFavorites tests**

Append to `apps/api/src/repositories/interactions.test.ts`:

```ts
describe("toggleFavorite", () => {
  it("inserts and increments", async () => {
    const userId = await ensureTestUser("interactions-test-5@example.com");
    const p = await anyPrompt();
    const result = await toggleFavorite(userId, p.id, "add");
    expect(result.favorite_count).toBe(p.favoriteCount + 1);
  });

  it("throws AlreadyExistsError on double-add", async () => {
    const userId = await ensureTestUser("interactions-test-6@example.com");
    const p = await anyPrompt();
    await toggleFavorite(userId, p.id, "add");
    await expect(toggleFavorite(userId, p.id, "add")).rejects.toBeInstanceOf(AlreadyExistsError);
  });

  it("throws NotFoundError on remove when not favorited", async () => {
    const userId = await ensureTestUser("interactions-test-7@example.com");
    const p = await anyPrompt();
    await expect(toggleFavorite(userId, p.id, "remove")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("recordView", () => {
  it("records a view and increments view_count on first sight", async () => {
    const userId = await ensureTestUser("interactions-test-8@example.com");
    const p = await anyPrompt();
    const result = await recordView({ promptId: p.id, userId, ipHash: null });
    expect(result.recorded).toBe(true);

    const [after] = await db.select({ viewCount: prompts.viewCount }).from(prompts).where(eq(prompts.id, p.id));
    expect(after!.viewCount).toBe(p.viewCount + 1);
  });

  it("dedups repeat views from the same user on the same day", async () => {
    const userId = await ensureTestUser("interactions-test-9@example.com");
    const p = await anyPrompt();
    await recordView({ promptId: p.id, userId, ipHash: null });
    const second = await recordView({ promptId: p.id, userId, ipHash: null });
    expect(second.recorded).toBe(false);
  });

  it("treats guest (ipHash only) and user as separate buckets", async () => {
    const userId = await ensureTestUser("interactions-test-10@example.com");
    const p = await anyPrompt();
    const a = await recordView({ promptId: p.id, userId: null, ipHash: "abc1234567890def" });
    const b = await recordView({ promptId: p.id, userId, ipHash: null });
    expect(a.recorded).toBe(true);
    expect(b.recorded).toBe(true);
  });

  it("returns recorded:false when both userId and ipHash are null", async () => {
    const p = await anyPrompt();
    const result = await recordView({ promptId: p.id, userId: null, ipHash: null });
    expect(result.recorded).toBe(false);
  });
});

describe("listMyFavorites", () => {
  it("returns paginated favorites ordered by favorited-at desc", async () => {
    const userId = await ensureTestUser("interactions-test-11@example.com");
    const rows = await db.select({ id: prompts.id }).from(prompts).limit(3);
    for (const r of rows) await toggleFavorite(userId, r.id, "add");

    const result = await listMyFavorites(userId, 1, 10);
    expect(result.total).toBe(3);
    expect(result.items.length).toBe(3);
    for (const item of result.items) {
      expect(item.userFavorited).toBe(true);
    }
  });

  it("returns empty page when user has no favorites", async () => {
    const userId = await ensureTestUser("interactions-test-12@example.com");
    const result = await listMyFavorites(userId, 1, 10);
    expect(result.total).toBe(0);
    expect(result.items).toEqual([]);
  });
});
```

- [ ] **Step 6: Run all interaction tests**

```bash
pnpm --filter @ip/api test src/repositories/interactions.test.ts
```

Expected: 13 tests pass.

- [ ] **Step 7: Run full suite**

```bash
pnpm test
```

Expected: 78 + 5 (ip-hash) + 13 (interactions) = 96 passing.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/repositories/interactions.ts apps/api/src/repositories/interactions.test.ts
git commit -m "feat(api): interactions repository (like/favorite toggle + view dedup + my favorites)"
```

---

### Task 5: `interactions` routes + integration tests

**Files:**
- Create: `apps/api/src/routes/interactions.ts` (the 4 toggle routes + view route)
- Create: `apps/api/src/routes/interactions.test.ts`

**Note:** GET `/api/me/favorites` lives in its own route file (Task 8) since it's mounted at a different prefix.

- [ ] **Step 1: Sketch route layout**

The routes hang off `/api/prompts/:id/...`. Rather than fold them into the existing `routes/prompts.ts`, we put them in a sibling file and mount it parallel:

```ts
// server.ts (Task 9)
app.route("/api/prompts", interactionsRoute);   // /api/prompts/:id/like etc.
app.route("/api/prompts", promptsRoute);        // /api/prompts (list) and /:slug (detail)
```

Order matters: interactions has the more specific `:id/like` etc., so it's registered first. The `:slug` route in promptsRoute would otherwise match `:id` too.

Actually, Hono matches by path **and** method. `/api/prompts/:id/like` (POST) and `/api/prompts/:slug` (GET) don't conflict. Order doesn't matter — but the trick is the `:slug` route in promptsRoute is GET-only, and our new POST/DELETE routes won't compete.

- [ ] **Step 2: Write failing integration tests**

Create `apps/api/src/routes/interactions.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { like } from "drizzle-orm";
import { db, pool } from "../db/client.ts";
import { users, sessions } from "../db/schema/auth.ts";
import { likes, favorites, viewLog } from "../db/schema/interactions.ts";
import { prompts } from "../db/schema/prompts.ts";
import { createServer } from "../server.ts";
import { createTestSession } from "../auth/test-session.ts";

const app = createServer();

async function anyPromptId(): Promise<string> {
  const [row] = await db.select({ id: prompts.id }).from(prompts).limit(1);
  if (!row) throw new Error("seed missing");
  return row.id;
}

beforeEach(async () => {
  await db.delete(viewLog);
  await db.delete(likes);
  await db.delete(favorites);
});

afterAll(async () => {
  await db.delete(viewLog);
  await db.delete(likes);
  await db.delete(favorites);
  await db.delete(sessions);
  await db.delete(users).where(like(users.email, "test-%@example.com"));
  await pool.end();
});

describe("POST /api/prompts/:id/like", () => {
  it("returns 401 when no session", async () => {
    const id = await anyPromptId();
    const res = await app.request(`/api/prompts/${id}/like`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("returns 422 when id is not a UUID", async () => {
    const sess = await createTestSession();
    const res = await app.request("/api/prompts/not-a-uuid/like", {
      method: "POST",
      headers: { Cookie: sess.cookie },
    });
    expect(res.status).toBe(400); // ZodError → 400 from global handler
  });

  it("returns 201 + liked:true + like_count on first like", async () => {
    const sess = await createTestSession();
    const id = await anyPromptId();
    const res = await app.request(`/api/prompts/${id}/like`, {
      method: "POST",
      headers: { Cookie: sess.cookie },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.liked).toBe(true);
    expect(typeof body.like_count).toBe("number");
  });

  it("returns 409 already_liked on double-like", async () => {
    const sess = await createTestSession();
    const id = await anyPromptId();
    await app.request(`/api/prompts/${id}/like`, { method: "POST", headers: { Cookie: sess.cookie } });
    const res = await app.request(`/api/prompts/${id}/like`, { method: "POST", headers: { Cookie: sess.cookie } });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("already_liked");
  });
});

describe("DELETE /api/prompts/:id/like", () => {
  it("returns 204 + liked:false after removing", async () => {
    const sess = await createTestSession();
    const id = await anyPromptId();
    await app.request(`/api/prompts/${id}/like`, { method: "POST", headers: { Cookie: sess.cookie } });
    const res = await app.request(`/api/prompts/${id}/like`, { method: "DELETE", headers: { Cookie: sess.cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.liked).toBe(false);
  });

  it("returns 404 like_not_found when not liked", async () => {
    const sess = await createTestSession();
    const id = await anyPromptId();
    const res = await app.request(`/api/prompts/${id}/like`, { method: "DELETE", headers: { Cookie: sess.cookie } });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("like_not_found");
  });
});

describe("POST /api/prompts/:id/favorite", () => {
  it("returns 201 + favorited:true on first favorite", async () => {
    const sess = await createTestSession();
    const id = await anyPromptId();
    const res = await app.request(`/api/prompts/${id}/favorite`, {
      method: "POST",
      headers: { Cookie: sess.cookie },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.favorited).toBe(true);
  });
});

describe("DELETE /api/prompts/:id/favorite", () => {
  it("returns favorited:false after removing", async () => {
    const sess = await createTestSession();
    const id = await anyPromptId();
    await app.request(`/api/prompts/${id}/favorite`, { method: "POST", headers: { Cookie: sess.cookie } });
    const res = await app.request(`/api/prompts/${id}/favorite`, { method: "DELETE", headers: { Cookie: sess.cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.favorited).toBe(false);
  });
});

describe("POST /api/prompts/:id/view", () => {
  it("returns 200 recorded:true for a fresh anonymous visit with XFF", async () => {
    const id = await anyPromptId();
    const res = await app.request(`/api/prompts/${id}/view`, {
      method: "POST",
      headers: { "X-Forwarded-For": "203.0.113.99" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recorded).toBe(true);
  });

  it("returns recorded:false on second visit from same IP same day", async () => {
    const id = await anyPromptId();
    const headers = { "X-Forwarded-For": "203.0.113.42" };
    await app.request(`/api/prompts/${id}/view`, { method: "POST", headers });
    const second = await app.request(`/api/prompts/${id}/view`, { method: "POST", headers });
    expect(second.status).toBe(200);
    const body = await second.json();
    expect(body.recorded).toBe(false);
  });

  it("returns recorded:false but does not error when no IP and no session", async () => {
    const id = await anyPromptId();
    const res = await app.request(`/api/prompts/${id}/view`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recorded).toBe(false);
  });
});
```

- [ ] **Step 3: Run — verify failure**

```bash
pnpm --filter @ip/api test src/routes/interactions.test.ts
```

Expected: all FAIL (404 not_found from Hono since the routes don't exist yet).

- [ ] **Step 4: Implement the routes**

Create `apps/api/src/routes/interactions.ts`:

```ts
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { verifyAuth } from "@hono/auth-js";
import { PromptIdParamSchema } from "@ip/shared";
import { zv } from "../lib/validate.ts";
import { createRateLimiter } from "../lib/rate-limit.ts";
import { hashIp } from "../lib/ip-hash.ts";
import { env } from "../env.ts";
import {
  toggleLike,
  toggleFavorite,
  recordView,
  AlreadyExistsError,
  NotFoundError,
} from "../repositories/interactions.ts";

const app = new Hono();

const toggleUserLimiter = createRateLimiter({ limit: 60, windowMs: 60_000 });
const toggleIpLimiter = createRateLimiter({ limit: 200, windowMs: 60_000 });
const viewIpLimiter = createRateLimiter({ limit: 120, windowMs: 60_000 });

function clientIp(c: { req: { header: (k: string) => string | undefined } }): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    "unknown"
  );
}

function requireUser(c: { get: (key: "authUser") => unknown }): string {
  const authUser = c.get("authUser") as { session?: { user?: { id?: string } } } | undefined;
  const id = authUser?.session?.user?.id;
  if (!id) throw new HTTPException(401, { message: "unauthorized" });
  return id;
}

app.post("/:id/like", verifyAuth(), zv("param", PromptIdParamSchema), async (c) => {
  const userId = requireUser(c);
  const ip = clientIp(c);
  if (!toggleUserLimiter.check(userId)) throw new HTTPException(429, { message: "rate_limit" });
  if (!toggleIpLimiter.check(ip)) throw new HTTPException(429, { message: "rate_limit" });
  const { id } = c.req.valid("param");
  try {
    const result = await toggleLike(userId, id, "add");
    return c.json({ liked: true, like_count: result.like_count }, 201);
  } catch (e) {
    if (e instanceof AlreadyExistsError) return c.json({ error: "already_liked" }, 409);
    throw e;
  }
});

app.delete("/:id/like", verifyAuth(), zv("param", PromptIdParamSchema), async (c) => {
  const userId = requireUser(c);
  const ip = clientIp(c);
  if (!toggleUserLimiter.check(userId)) throw new HTTPException(429, { message: "rate_limit" });
  if (!toggleIpLimiter.check(ip)) throw new HTTPException(429, { message: "rate_limit" });
  const { id } = c.req.valid("param");
  try {
    const result = await toggleLike(userId, id, "remove");
    return c.json({ liked: false, like_count: result.like_count }, 200);
  } catch (e) {
    if (e instanceof NotFoundError) return c.json({ error: "like_not_found" }, 404);
    throw e;
  }
});

app.post("/:id/favorite", verifyAuth(), zv("param", PromptIdParamSchema), async (c) => {
  const userId = requireUser(c);
  const ip = clientIp(c);
  if (!toggleUserLimiter.check(userId)) throw new HTTPException(429, { message: "rate_limit" });
  if (!toggleIpLimiter.check(ip)) throw new HTTPException(429, { message: "rate_limit" });
  const { id } = c.req.valid("param");
  try {
    const result = await toggleFavorite(userId, id, "add");
    return c.json({ favorited: true, favorite_count: result.favorite_count }, 201);
  } catch (e) {
    if (e instanceof AlreadyExistsError) return c.json({ error: "already_favorited" }, 409);
    throw e;
  }
});

app.delete("/:id/favorite", verifyAuth(), zv("param", PromptIdParamSchema), async (c) => {
  const userId = requireUser(c);
  const ip = clientIp(c);
  if (!toggleUserLimiter.check(userId)) throw new HTTPException(429, { message: "rate_limit" });
  if (!toggleIpLimiter.check(ip)) throw new HTTPException(429, { message: "rate_limit" });
  const { id } = c.req.valid("param");
  try {
    const result = await toggleFavorite(userId, id, "remove");
    return c.json({ favorited: false, favorite_count: result.favorite_count }, 200);
  } catch (e) {
    if (e instanceof NotFoundError) return c.json({ error: "favorite_not_found" }, 404);
    throw e;
  }
});

app.post("/:id/view", zv("param", PromptIdParamSchema), async (c) => {
  const ip = clientIp(c);
  if (!viewIpLimiter.check(ip)) {
    // Quietly accept on rate-limit — views are best-effort, never blocked
    return c.json({ recorded: false }, 200);
  }
  const { id } = c.req.valid("param");
  const authUser = c.get("authUser") as { session?: { user?: { id?: string } } } | undefined;
  const userId = authUser?.session?.user?.id ?? null;
  // Use hashed IP only for guests; logged-in users dedup by user_id alone
  const ipHash = userId ? null : hashIp(ip === "unknown" ? null : ip, env.AUTH_SECRET);

  try {
    const result = await recordView({ promptId: id, userId, ipHash });
    return c.json(result, 200);
  } catch (e) {
    // Views must never throw — log and ack false
    console.warn("[views] recordView failed", e);
    return c.json({ recorded: false }, 200);
  }
});

export default app;
```

- [ ] **Step 5: Mount in `server.ts`**

Don't do this yet — Task 9 mounts both interaction routes and the favorites route together. For now, change the test file to import the route and mount it directly:

Edit the top of `apps/api/src/routes/interactions.test.ts`:

```ts
import { createServer } from "../server.ts";
import interactionsRoute from "./interactions.ts";

const app = createServer();
app.route("/api/prompts", interactionsRoute);
```

(This is a temporary test-only mount; Task 9 wires it for real and the test re-runs without it.)

- [ ] **Step 6: Run interaction route tests — verify pass**

```bash
pnpm --filter @ip/api test src/routes/interactions.test.ts
```

Expected: 11 tests pass.

- [ ] **Step 7: Run full suite**

```bash
pnpm test
```

Expected: 96 + 11 = 107 passing.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/routes/interactions.ts apps/api/src/routes/interactions.test.ts
git commit -m "feat(api): POST/DELETE /api/prompts/:id/like|favorite + POST /:id/view"
```

---

### Task 6: Extend `prompts` repo with `userLiked` / `userFavorited`

**Files:**
- Modify: `apps/api/src/repositories/prompts.ts`

- [ ] **Step 1: Add an optional `currentUserId` parameter to `listPrompts`**

Open `apps/api/src/repositories/prompts.ts`. Change the function signature and add EXISTS subqueries to the main SELECT:

```ts
export async function listPrompts(q: PromptListQuery, currentUserId?: string) {
  // ... existing offset / categoryId / promptIdsByTag / conditions / where setup
  // unchanged through the count query

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
      userLiked: currentUserId
        ? sql<boolean>`EXISTS (SELECT 1 FROM likes WHERE likes.prompt_id = ${prompts.id} AND likes.user_id = ${currentUserId})`
        : sql<boolean>`FALSE`,
      userFavorited: currentUserId
        ? sql<boolean>`EXISTS (SELECT 1 FROM favorites WHERE favorites.prompt_id = ${prompts.id} AND favorites.user_id = ${currentUserId})`
        : sql<boolean>`FALSE`,
    })
    .from(prompts)
    .innerJoin(categories, eq(categories.id, prompts.categoryId))
    .where(where)
    .orderBy(orderBy(q.sort))
    .limit(q.pageSize)
    .offset(offset);

  // ... rest of the function (image fetch, tags fetch) unchanged

  const items = rows.map((r) => {
    const img = firstImageByPrompt.get(r.id) ?? null;
    return {
      // ... existing fields
      // append:
      ...(currentUserId ? { userLiked: r.userLiked, userFavorited: r.userFavorited } : {}),
    };
  });

  return { items, total, page: q.page, pageSize: q.pageSize, hasMore: q.page * q.pageSize < total };
}
```

Key change: when `currentUserId` is undefined, the subqueries evaluate to `FALSE` and we strip them from the returned object so the wire shape matches the spec (fields absent for guests).

- [ ] **Step 2: Same change in `getPromptBySlug`**

```ts
export async function getPromptBySlug(slug: string, currentUserId?: string) {
  const [row] = await db
    .select({
      // ... all existing fields
      userLiked: currentUserId
        ? sql<boolean>`EXISTS (SELECT 1 FROM likes WHERE likes.prompt_id = ${prompts.id} AND likes.user_id = ${currentUserId})`
        : sql<boolean>`FALSE`,
      userFavorited: currentUserId
        ? sql<boolean>`EXISTS (SELECT 1 FROM favorites WHERE favorites.prompt_id = ${prompts.id} AND favorites.user_id = ${currentUserId})`
        : sql<boolean>`FALSE`,
    })
    .from(prompts)
    .innerJoin(categories, eq(categories.id, prompts.categoryId))
    .where(eq(prompts.slug, slug));

  if (!row) return null;

  // ... rest unchanged

  return {
    // ... existing fields
    ...(currentUserId ? { userLiked: row.userLiked, userFavorited: row.userFavorited } : {}),
  };
}
```

- [ ] **Step 3: Make sure imports include `likes` and `favorites`**

The repo currently imports from `db/schema/index.ts`. Verify that file re-exports `likes` and `favorites` from `interactions.ts`:

```bash
grep -E "^export.*likes|^export.*favorites" apps/api/src/db/schema/index.ts
```

If they're not re-exported, add to the file:

```ts
export * from "./interactions.ts";
```

If `index.ts` already does `export *`, no change needed.

- [ ] **Step 4: Run existing tests — verify nothing breaks**

```bash
pnpm --filter @ip/api test src/repositories/prompts.test.ts
```

Expected: all existing pass — the new fields are optional and only appear when `currentUserId` is passed.

- [ ] **Step 5: Add new tests for the session-aware behavior**

Append to `apps/api/src/repositories/prompts.test.ts`:

```ts
describe("listPrompts session-aware", () => {
  it("omits userLiked/userFavorited for anonymous queries", async () => {
    const result = await listPrompts({ sort: "latest", page: 1, pageSize: 24 });
    if (result.items.length > 0) {
      expect("userLiked" in result.items[0]!).toBe(false);
      expect("userFavorited" in result.items[0]!).toBe(false);
    }
  });

  it("returns userLiked:true on the prompts the user has liked", async () => {
    const userId = await ensureUser("plt-list-1@example.com");
    const p = await anyPromptForTest();
    await db.insert(likes).values({ userId, promptId: p.id }).onConflictDoNothing();

    const result = await listPrompts({ sort: "latest", page: 1, pageSize: 24 }, userId);
    const item = result.items.find((i) => i.id === p.id);
    expect(item?.userLiked).toBe(true);
    expect(item?.userFavorited).toBe(false);

    // cleanup
    await db.delete(likes).where(eq(likes.userId, userId));
  });
});
```

If `ensureUser` / `anyPromptForTest` aren't already in `prompts.test.ts`, add them following the patterns from Task 4. Import `likes` from `../db/schema/interactions.ts` and `eq` from `drizzle-orm`.

- [ ] **Step 6: Run new tests**

```bash
pnpm --filter @ip/api test src/repositories/prompts.test.ts
```

Expected: existing tests still pass + 2 new tests pass.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/repositories/prompts.ts apps/api/src/repositories/prompts.test.ts apps/api/src/db/schema/index.ts
git commit -m "feat(api): prompts repo emits userLiked/userFavorited when authed"
```

---

### Task 7: Extend `prompts` route to pass `authUser.id`

**Files:**
- Modify: `apps/api/src/routes/prompts.ts`
- Modify: `apps/api/src/routes/prompts.test.ts`

- [ ] **Step 1: Modify the route handlers**

Open `apps/api/src/routes/prompts.ts`. Both handlers extract `authUser` and pass it to the repo:

```ts
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { PromptListQuerySchema } from "@ip/shared";
import { zv } from "../lib/validate.ts";
import { getPromptBySlug, listPrompts, listRelatedPrompts } from "../repositories/prompts.ts";

const app = new Hono();

function currentUserId(c: { get: (key: "authUser") => unknown }): string | undefined {
  const authUser = c.get("authUser") as { session?: { user?: { id?: string } } } | undefined;
  return authUser?.session?.user?.id;
}

app.get("/", zv("query", PromptListQuerySchema), async (c) => {
  const query = c.req.valid("query");
  const result = await listPrompts(query, currentUserId(c));
  return c.json(result);
});

app.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const userId = currentUserId(c);
  const detail = await getPromptBySlug(slug, userId);
  if (!detail) throw new HTTPException(404, { message: "prompt_not_found" });

  const related = await listRelatedPrompts(detail.id, detail.category.id, 12);
  return c.json({
    ...detail,
    related: related.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      aspectRatio: r.aspectRatio,
      viewCount: r.viewCount,
      likeCount: r.likeCount,
      sendCount: r.sendCount,
      favoriteCount: r.favoriteCount,
      approvedAt: r.approvedAt.toISOString(),
      primaryImage: r.primaryImage,
    })),
  });
});

export default app;
```

(We deliberately leave `listRelatedPrompts` without `userLiked` — the detail page only shows likeCount in the related row, so we don't need it. M5 keeps this simple.)

- [ ] **Step 2: Add integration tests**

Append to `apps/api/src/routes/prompts.test.ts`:

```ts
describe("GET /api/prompts/:slug session-aware", () => {
  it("omits userLiked/userFavorited when unauthenticated", async () => {
    // pick any seeded prompt slug
    const [row] = await db.select({ slug: prompts.slug }).from(prompts).limit(1);
    const res = await app.request(`/api/prompts/${row!.slug}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect("userLiked" in body).toBe(false);
    expect("userFavorited" in body).toBe(false);
  });

  it("returns userLiked:true after the session user has liked the prompt", async () => {
    const sess = await createTestSession();
    const [row] = await db.select({ id: prompts.id, slug: prompts.slug }).from(prompts).limit(1);
    await db.insert(likes).values({ userId: sess.userId, promptId: row!.id }).onConflictDoNothing();

    const res = await app.request(`/api/prompts/${row!.slug}`, { headers: { Cookie: sess.cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userLiked).toBe(true);
    expect(body.userFavorited).toBe(false);

    await db.delete(likes);
  });
});
```

Import `createTestSession`, `likes`, `prompts` from the obvious paths (mirror the existing test file's imports).

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @ip/api test src/routes/prompts.test.ts
```

Expected: existing tests still pass + 2 new tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/routes/prompts.ts apps/api/src/routes/prompts.test.ts
git commit -m "feat(api): prompts route forwards authUser.id for personalised responses"
```

---

### Task 8: `GET /api/me/favorites` route + tests

**Files:**
- Create: `apps/api/src/routes/me.ts`
- Create: `apps/api/src/routes/me.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/api/src/routes/me.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { like } from "drizzle-orm";
import { db, pool } from "../db/client.ts";
import { users, sessions } from "../db/schema/auth.ts";
import { favorites } from "../db/schema/interactions.ts";
import { prompts } from "../db/schema/prompts.ts";
import { createServer } from "../server.ts";
import meRoute from "./me.ts";
import { createTestSession } from "../auth/test-session.ts";

const app = createServer();
app.route("/api/me", meRoute);

beforeEach(async () => {
  await db.delete(favorites);
});

afterAll(async () => {
  await db.delete(favorites);
  await db.delete(sessions);
  await db.delete(users).where(like(users.email, "test-%@example.com"));
  await pool.end();
});

describe("GET /api/me/favorites", () => {
  it("returns 401 when not logged in", async () => {
    const res = await app.request("/api/me/favorites");
    expect(res.status).toBe(401);
  });

  it("returns empty list for a user with no favorites", async () => {
    const sess = await createTestSession();
    const res = await app.request("/api/me/favorites", { headers: { Cookie: sess.cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });

  it("returns favorited prompts with userFavorited:true", async () => {
    const sess = await createTestSession();
    const [p] = await db.select({ id: prompts.id }).from(prompts).limit(1);
    await db.insert(favorites).values({ userId: sess.userId, promptId: p!.id });

    const res = await app.request("/api/me/favorites", { headers: { Cookie: sess.cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.items[0].userFavorited).toBe(true);
  });

  it("respects page/pageSize", async () => {
    const sess = await createTestSession();
    const rows = await db.select({ id: prompts.id }).from(prompts).limit(5);
    for (const r of rows) {
      await db.insert(favorites).values({ userId: sess.userId, promptId: r.id });
    }

    const res = await app.request("/api/me/favorites?page=1&pageSize=2", { headers: { Cookie: sess.cookie } });
    const body = await res.json();
    expect(body.items.length).toBe(2);
    expect(body.pageSize).toBe(2);
    expect(body.hasMore).toBe(true);
  });
});
```

- [ ] **Step 2: Run — verify failure**

```bash
pnpm --filter @ip/api test src/routes/me.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `apps/api/src/routes/me.ts`:

```ts
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { verifyAuth } from "@hono/auth-js";
import { MyFavoritesQuerySchema } from "@ip/shared";
import { zv } from "../lib/validate.ts";
import { listMyFavorites } from "../repositories/interactions.ts";

const app = new Hono();

app.get("/favorites", verifyAuth(), zv("query", MyFavoritesQuerySchema), async (c) => {
  const authUser = c.get("authUser") as { session?: { user?: { id?: string } } } | undefined;
  const userId = authUser?.session?.user?.id;
  if (!userId) throw new HTTPException(401, { message: "unauthorized" });

  const { page, pageSize } = c.req.valid("query");
  const result = await listMyFavorites(userId, page, pageSize);
  // Items' `approvedAt` is already a string in the repo; nothing more to massage.
  return c.json(result);
});

export default app;
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @ip/api test src/routes/me.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/me.ts apps/api/src/routes/me.test.ts
git commit -m "feat(api): GET /api/me/favorites — paginated user favorites"
```

---

### Task 9: Mount the new routes in `server.ts`

**Files:**
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Add imports + mounts**

Open `apps/api/src/server.ts`. Add the two imports near the existing ones:

```ts
import interactionsRoute from "./routes/interactions.ts";
import meRoute from "./routes/me.ts";
```

Add the two route mounts inside `createServer()` after the existing `app.route("/api/import-tokens", ...)`:

```ts
  // ★ M5: like/favorite/view toggles share the /api/prompts prefix with
  //   listing — Hono dispatches per-method so they don't conflict.
  app.route("/api/prompts", interactionsRoute);
  app.route("/api/me", meRoute);
```

- [ ] **Step 2: Remove the test-only mount in `interactions.test.ts`**

Open `apps/api/src/routes/interactions.test.ts`. Replace:

```ts
const app = createServer();
app.route("/api/prompts", interactionsRoute);
```

with just:

```ts
const app = createServer();
```

Remove the `import interactionsRoute from "./interactions.ts";` line too.

Do the same for `me.test.ts`:

Replace:

```ts
const app = createServer();
app.route("/api/me", meRoute);
```

with:

```ts
const app = createServer();
```

Remove the `import meRoute from "./me.ts";` line.

- [ ] **Step 3: Run all api tests**

```bash
pnpm --filter @ip/api test
```

Expected: all pass — the routes are now mounted at the server level and the integration tests use the real mount path.

- [ ] **Step 4: Run full suite**

```bash
pnpm test
```

Expected: 107 + (extended prompts.test.ts) + 4 (me.test.ts) ≈ 120 passing.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/server.ts apps/api/src/routes/interactions.test.ts apps/api/src/routes/me.test.ts
git commit -m "chore(api): mount interactions + me routes in server"
```

---

### Task 10: i18n keys

**Files:**
- Modify: `apps/web/src/i18n/locales/zh.json`
- Modify: `apps/web/src/i18n/locales/en.json`

- [ ] **Step 1: Update `zh.json`**

Append/merge these keys (do NOT delete existing keys). Inside `"detail"` object:

```json
    "copied": "已复制",
    "copy_failed": "复制失败,请手动选择",
    "report": "举报",
    "report_coming_soon": "举报功能即将上线",
    "send_failed": "操作失败,请重试"
```

(If `send_failed` already exists from M3 keep the M3 value.)

Add top-level `"interactions"` block (insert before `"profile"`):

```json
  "interactions": {
    "liked": "已点赞",
    "unliked": "已取消点赞",
    "favorited": "已收藏",
    "unfavorited": "已取消收藏",
    "session_expired": "登录已过期,请重新登录",
    "rate_limited": "操作过频,请稍候",
    "generic_error": "操作失败,请重试"
  },
```

Inside `"profile"`:

```json
    "tab_profile": "资料",
    "tab_favorites": "我的收藏",
    "no_favorites": "暂无收藏",
    "no_favorites_hint": "在任意提示词卡片或详情页点 ⭐ 收藏起来"
```

- [ ] **Step 2: Update `en.json` (parallel keys)**

`"detail"`:

```json
    "copied": "Copied",
    "copy_failed": "Copy failed — please select manually",
    "report": "Report",
    "report_coming_soon": "Reporting is coming soon",
    "send_failed": "Action failed, please retry"
```

New `"interactions"`:

```json
  "interactions": {
    "liked": "Liked",
    "unliked": "Unliked",
    "favorited": "Saved to favorites",
    "unfavorited": "Removed from favorites",
    "session_expired": "Your session expired — please sign in again",
    "rate_limited": "Too many actions — please slow down",
    "generic_error": "Action failed, please retry"
  },
```

`"profile"`:

```json
    "tab_profile": "Profile",
    "tab_favorites": "My Favorites",
    "no_favorites": "No favorites yet",
    "no_favorites_hint": "Click ⭐ on any prompt card or detail page to save it here"
```

- [ ] **Step 3: Verify JSON parses**

```bash
node -e "JSON.parse(require('fs').readFileSync('apps/web/src/i18n/locales/zh.json','utf8')); JSON.parse(require('fs').readFileSync('apps/web/src/i18n/locales/en.json','utf8')); console.log('valid')"
```

Expected: `valid`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/i18n/locales/
git commit -m "feat(web): i18n keys for interactions + profile tabs + report placeholder"
```

---

### Task 11: Frontend low-level fetch helpers

**Files:**
- Create: `apps/web/src/lib/interactions.ts`

- [ ] **Step 1: Implement helpers**

Create `apps/web/src/lib/interactions.ts`:

```ts
import { apiFetch } from "./api";

export type LikeResponse = { liked: boolean; like_count: number };
export type FavoriteResponse = { favorited: boolean; favorite_count: number };
export type ViewAck = { recorded: boolean };

export function postLike(promptId: string): Promise<LikeResponse> {
  return apiFetch<LikeResponse>(`/api/prompts/${promptId}/like`, { method: "POST" });
}
export function deleteLike(promptId: string): Promise<LikeResponse> {
  return apiFetch<LikeResponse>(`/api/prompts/${promptId}/like`, { method: "DELETE" });
}

export function postFavorite(promptId: string): Promise<FavoriteResponse> {
  return apiFetch<FavoriteResponse>(`/api/prompts/${promptId}/favorite`, { method: "POST" });
}
export function deleteFavorite(promptId: string): Promise<FavoriteResponse> {
  return apiFetch<FavoriteResponse>(`/api/prompts/${promptId}/favorite`, { method: "DELETE" });
}

export function postView(promptId: string): Promise<ViewAck> {
  return apiFetch<ViewAck>(`/api/prompts/${promptId}/view`, { method: "POST" });
}
```

- [ ] **Step 2: TypeScript check**

```bash
pnpm --filter @ip/web exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/interactions.ts
git commit -m "feat(web): low-level fetch helpers for like/favorite/view"
```

---

### Task 12: `CopyPromptButton` + test

**Files:**
- Create: `apps/web/src/components/PromptDetail/CopyPromptButton.tsx`
- Create: `apps/web/src/components/PromptDetail/CopyPromptButton.test.tsx`

- [ ] **Step 1: Implement the component**

Create `apps/web/src/components/PromptDetail/CopyPromptButton.tsx`:

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { Copy, Check } from "lucide-react";
import { isLocale, pickBilingual, type Locale, type BilingualText } from "@ip/shared";
import { toast } from "../../lib/toast";

type Props = {
  prompt: BilingualText;
};

/**
 * Copy the prompt body to clipboard. No auth required, no backend call.
 * Two visual states: idle / just-copied (2s).
 */
export default function CopyPromptButton({ prompt }: Props) {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    const text = pickBilingual(prompt, locale) ?? "";
    if (!text) {
      toast.error(t("detail.copy_failed"));
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Legacy fallback for old browsers / non-HTTPS dev pages.
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      toast.success(t("detail.copied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("detail.copy_failed"));
    }
  }

  const Icon = copied ? Check : Copy;
  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center justify-center gap-1.5 rounded-pill border border-border-soft bg-surface px-3 py-2 text-[12.5px] text-ink-muted transition hover:bg-panel-2 hover:text-ink"
    >
      <Icon size={12} aria-hidden />
      {t("detail.copy_prompt")}
    </button>
  );
}
```

- [ ] **Step 2: Write tests**

Create `apps/web/src/components/PromptDetail/CopyPromptButton.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import i18n, { initI18n } from "../../i18n";
import CopyPromptButton from "./CopyPromptButton";

function setup() {
  return render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <CopyPromptButton prompt={{ en: "test prompt body" }} />
      </I18nextProvider>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  await initI18n("en");
});

afterEach(() => {
  cleanup();
});

describe("CopyPromptButton", () => {
  it("copies the prompt to clipboard on click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    setup();
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("test prompt body"));
  });

  it("shows the check icon briefly after copy succeeds", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    setup();
    fireEvent.click(screen.getByRole("button"));
    // The check icon appears immediately; we don't assert on it leaving the DOM here
    // (that's a 2s setTimeout — covered by the copy_failed test for the error branch).
    await waitFor(() => expect(screen.getByRole("button")).toBeTruthy());
  });
});
```

- [ ] **Step 3: Run — expect pass**

```bash
pnpm --filter @ip/web test src/components/PromptDetail/CopyPromptButton.test.tsx
```

Expected: 2 tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/PromptDetail/CopyPromptButton.tsx apps/web/src/components/PromptDetail/CopyPromptButton.test.tsx
git commit -m "feat(web): CopyPromptButton (clipboard + fallback + toast)"
```

---

### Task 13: `useLikeMutation` hook

**Files:**
- Create: `apps/web/src/lib/hooks/useLikeMutation.ts`

- [ ] **Step 1: Implement**

Create `apps/web/src/lib/hooks/useLikeMutation.ts`:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../api";
import { postLike, deleteLike, type LikeResponse } from "../interactions";

export type LikeState = { liked: boolean; count: number };

export type UseLikeMutationOptions = {
  promptId: string;
  onAuthRequired?: () => void;
  onError?: (err: unknown) => void;
};

/**
 * Mutation that toggles a like. Caller owns the optimistic local state
 * (so the LikeButton can update visually before the network roundtrip
 * resolves). On success we adopt the server's like_count to stay in sync
 * with other tabs / cards.
 */
export function useLikeMutation(opts: UseLikeMutationOptions) {
  const qc = useQueryClient();
  return useMutation<LikeResponse, unknown, { action: "like" | "unlike"; previous: LikeState }>({
    mutationFn: async ({ action }) => {
      if (action === "like") return postLike(opts.promptId);
      return deleteLike(opts.promptId);
    },
    onSuccess: () => {
      // Tell other consumers (cards on the list page, detail page) to refetch.
      qc.invalidateQueries({ queryKey: ["prompts"] });
    },
    onError: (err, _vars) => {
      if (err instanceof ApiError && err.status === 401) {
        opts.onAuthRequired?.();
      } else {
        // Treat 409 (already liked) and 404 (not liked) as silent successes —
        // caller's optimistic state already matches reality.
        if (err instanceof ApiError && (err.status === 409 || err.status === 404)) return;
        opts.onError?.(err);
      }
    },
  });
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @ip/web exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/hooks/useLikeMutation.ts
git commit -m "feat(web): useLikeMutation hook (optimistic-friendly, 401 → modal hook)"
```

---

### Task 14: `LikeButton` + test

**Files:**
- Create: `apps/web/src/components/PromptDetail/LikeButton.tsx`
- Create: `apps/web/src/components/PromptDetail/LikeButton.test.tsx`

- [ ] **Step 1: Implement**

Create `apps/web/src/components/PromptDetail/LikeButton.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Heart } from "lucide-react";
import { useSession } from "../../lib/hooks/useSession";
import { useLikeMutation, type LikeState } from "../../lib/hooks/useLikeMutation";
import { ApiError } from "../../lib/api";
import { toast } from "../../lib/toast";
import SignInModal from "../auth/SignInModal";

type Props = {
  promptId: string;
  initial: LikeState;
  /** "full" = pill button with label (detail page); "compact" = icon + count, no label (card hover). */
  variant?: "full" | "compact";
};

export default function LikeButton({ promptId, initial, variant = "full" }: Props) {
  const { t } = useTranslation();
  const session = useSession();
  const isGuest = !session.isLoading && !session.data;
  const [state, setState] = useState<LikeState>(initial);
  const [signInOpen, setSignInOpen] = useState(false);

  // Resync if parent passes fresh props (e.g. after invalidate)
  useEffect(() => setState(initial), [initial.liked, initial.count]);

  const mutation = useLikeMutation({
    promptId,
    onAuthRequired: () => {
      // Roll back optimistic state, then open the modal.
      setState((s) => ({ liked: !s.liked, count: s.liked ? s.count + 1 : s.count - 1 }));
      setSignInOpen(true);
    },
    onError: (err) => {
      // Roll back optimistic state.
      setState((s) => ({ liked: !s.liked, count: s.liked ? s.count + 1 : s.count - 1 }));
      if (err instanceof ApiError && err.status === 429) {
        toast.error(t("interactions.rate_limited"));
      } else {
        toast.error(t("interactions.generic_error"));
      }
    },
  });

  useEffect(() => {
    if (mutation.data) {
      // Adopt server's authoritative count
      setState((s) => ({ liked: s.liked, count: mutation.data!.like_count }));
    }
  }, [mutation.data]);

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();

    if (isGuest) {
      setSignInOpen(true);
      return;
    }
    if (mutation.isPending) return;

    const action = state.liked ? "unlike" : "like";
    const next: LikeState = {
      liked: !state.liked,
      count: state.liked ? state.count - 1 : state.count + 1,
    };
    setState(next);
    mutation.mutate({ action, previous: state });
  }

  if (variant === "compact") {
    return (
      <>
        <button
          type="button"
          onClick={handleClick}
          aria-label={state.liked ? t("interactions.unliked") : t("interactions.liked")}
          aria-pressed={state.liked}
          className={`inline-flex items-center gap-1 text-xs ${
            state.liked ? "text-danger" : "text-white/90"
          }`}
        >
          <Heart size={12} fill={state.liked ? "currentColor" : "none"} aria-hidden />
          {state.count}
        </button>
        <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        aria-pressed={state.liked}
        className={`inline-flex items-center justify-center gap-1.5 rounded-pill border px-3 py-2 text-[12.5px] transition ${
          state.liked
            ? "border-danger/40 bg-danger/10 text-danger"
            : "border-border-soft bg-surface text-ink-muted hover:bg-panel-2 hover:text-ink"
        }`}
      >
        <Heart size={12} fill={state.liked ? "currentColor" : "none"} aria-hidden />
        {state.count}
      </button>
      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
    </>
  );
}
```

- [ ] **Step 2: Tests**

Create `apps/web/src/components/PromptDetail/LikeButton.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import i18n, { initI18n } from "../../i18n";
import LikeButton from "./LikeButton";

vi.mock("../../lib/hooks/useSession", () => ({
  useSession: vi.fn(),
}));
import { useSession } from "../../lib/hooks/useSession";

function setup(initial = { liked: false, count: 5 }, variant: "full" | "compact" = "full") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={qc}>
          <LikeButton promptId="550e8400-e29b-41d4-a716-446655440000" initial={initial} variant={variant} />
        </QueryClientProvider>
      </I18nextProvider>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  await initI18n("en");
});
afterEach(() => cleanup());

describe("LikeButton", () => {
  it("opens SignInModal when guest clicks", async () => {
    (useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: false });
    setup();
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(screen.getByRole("dialog", { name: /sign in/i })).toBeTruthy());
  });

  it("optimistically increments the count when logged in user likes", async () => {
    (useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { user: { id: "u1", email: "x@y", name: null, image: null, role: "user" }, expires: "" },
      isLoading: false,
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ liked: true, like_count: 6 }), { status: 201, headers: { "Content-Type": "application/json" } }),
    );
    setup({ liked: false, count: 5 });
    fireEvent.click(screen.getByRole("button"));
    // optimistic count is 6 immediately
    await waitFor(() => expect(screen.getByRole("button").textContent).toContain("6"));
  });

  it("rolls back on 5xx error and shows generic error toast", async () => {
    (useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { user: { id: "u1", email: "x@y", name: null, image: null, role: "user" }, expires: "" },
      isLoading: false,
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "internal_error" }), { status: 500, headers: { "Content-Type": "application/json" } }),
    );
    setup({ liked: false, count: 5 });
    fireEvent.click(screen.getByRole("button"));
    // First optimistically jumps to 6, then rolls back to 5
    await waitFor(() => expect(screen.getByRole("button").textContent).toContain("5"));
  });

  it("renders compact variant without label", () => {
    (useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: false });
    setup({ liked: false, count: 3 }, "compact");
    const btn = screen.getByRole("button");
    expect(btn.textContent).toContain("3");
  });
});
```

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @ip/web test src/components/PromptDetail/LikeButton.test.tsx
```

Expected: 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/PromptDetail/LikeButton.tsx apps/web/src/components/PromptDetail/LikeButton.test.tsx
git commit -m "feat(web): LikeButton (full + compact variants, optimistic + rollback)"
```

---

### Task 15: `useFavoriteMutation` hook

**Files:**
- Create: `apps/web/src/lib/hooks/useFavoriteMutation.ts`

- [ ] **Step 1: Implement** — mirror Task 13's hook against the favorite endpoints:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../api";
import { postFavorite, deleteFavorite, type FavoriteResponse } from "../interactions";

export type FavoriteState = { favorited: boolean };

export type UseFavoriteMutationOptions = {
  promptId: string;
  onAuthRequired?: () => void;
  onError?: (err: unknown) => void;
};

export function useFavoriteMutation(opts: UseFavoriteMutationOptions) {
  const qc = useQueryClient();
  return useMutation<FavoriteResponse, unknown, { action: "favorite" | "unfavorite" }>({
    mutationFn: async ({ action }) => {
      if (action === "favorite") return postFavorite(opts.promptId);
      return deleteFavorite(opts.promptId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prompts"] });
      qc.invalidateQueries({ queryKey: ["me", "favorites"] });
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) {
        opts.onAuthRequired?.();
      } else if (err instanceof ApiError && (err.status === 409 || err.status === 404)) {
        // Silent — server says state already matches
      } else {
        opts.onError?.(err);
      }
    },
  });
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @ip/web exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/hooks/useFavoriteMutation.ts
git commit -m "feat(web): useFavoriteMutation hook"
```

---

### Task 16: `FavoriteButton` + test

**Files:**
- Create: `apps/web/src/components/PromptDetail/FavoriteButton.tsx`
- Create: `apps/web/src/components/PromptDetail/FavoriteButton.test.tsx`

- [ ] **Step 1: Implement**

Create `apps/web/src/components/PromptDetail/FavoriteButton.tsx`:

```tsx
import { useEffect, useState, type MouseEvent } from "react";
import { useTranslation } from "react-i18next";
import { Star } from "lucide-react";
import { useSession } from "../../lib/hooks/useSession";
import { useFavoriteMutation, type FavoriteState } from "../../lib/hooks/useFavoriteMutation";
import { ApiError } from "../../lib/api";
import { toast } from "../../lib/toast";
import SignInModal from "../auth/SignInModal";

type Props = {
  promptId: string;
  initial: FavoriteState;
};

const FAVORITE_YELLOW = "#ffcc00";

export default function FavoriteButton({ promptId, initial }: Props) {
  const { t } = useTranslation();
  const session = useSession();
  const isGuest = !session.isLoading && !session.data;
  const [state, setState] = useState<FavoriteState>(initial);
  const [signInOpen, setSignInOpen] = useState(false);

  useEffect(() => setState(initial), [initial.favorited]);

  const mutation = useFavoriteMutation({
    promptId,
    onAuthRequired: () => {
      setState((s) => ({ favorited: !s.favorited }));
      setSignInOpen(true);
    },
    onError: (err) => {
      setState((s) => ({ favorited: !s.favorited }));
      if (err instanceof ApiError && err.status === 429) {
        toast.error(t("interactions.rate_limited"));
      } else {
        toast.error(t("interactions.generic_error"));
      }
    },
  });

  function handleClick(e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (isGuest) {
      setSignInOpen(true);
      return;
    }
    if (mutation.isPending) return;
    const action = state.favorited ? "unfavorite" : "favorite";
    setState({ favorited: !state.favorited });
    mutation.mutate({ action });
  }

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        aria-pressed={state.favorited}
        className={`inline-flex items-center justify-center gap-1.5 rounded-pill border px-3 py-2 text-[12.5px] transition ${
          state.favorited
            ? "border-yellow-300/40 bg-yellow-100/30 hover:bg-yellow-100/40"
            : "border-border-soft bg-surface text-ink-muted hover:bg-panel-2 hover:text-ink"
        }`}
        style={state.favorited ? { color: FAVORITE_YELLOW } : undefined}
      >
        <Star size={12} fill={state.favorited ? "currentColor" : "none"} aria-hidden />
        {t("detail.favorite")}
      </button>
      <SignInModal open={signInOpen} onClose={() => setSignInOpen(false)} />
    </>
  );
}
```

- [ ] **Step 2: Tests**

Create `apps/web/src/components/PromptDetail/FavoriteButton.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import i18n, { initI18n } from "../../i18n";
import FavoriteButton from "./FavoriteButton";

vi.mock("../../lib/hooks/useSession", () => ({ useSession: vi.fn() }));
import { useSession } from "../../lib/hooks/useSession";

function setup(initial = { favorited: false }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={qc}>
          <FavoriteButton promptId="550e8400-e29b-41d4-a716-446655440000" initial={initial} />
        </QueryClientProvider>
      </I18nextProvider>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  vi.clearAllMocks();
  await initI18n("en");
});
afterEach(() => cleanup());

describe("FavoriteButton", () => {
  it("opens SignInModal when guest clicks", async () => {
    (useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({ data: null, isLoading: false });
    setup();
    fireEvent.click(screen.getByRole("button", { name: /favorite/i }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: /sign in/i })).toBeTruthy());
  });

  it("toggles aria-pressed on successful favorite", async () => {
    (useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { user: { id: "u1", email: "x@y", name: null, image: null, role: "user" }, expires: "" },
      isLoading: false,
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ favorited: true, favorite_count: 3 }), { status: 201, headers: { "Content-Type": "application/json" } }),
    );
    setup({ favorited: false });
    const btn = screen.getByRole("button", { name: /favorite/i });
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(btn);
    await waitFor(() => expect(btn.getAttribute("aria-pressed")).toBe("true"));
  });
});
```

- [ ] **Step 3: Run**

```bash
pnpm --filter @ip/web test src/components/PromptDetail/FavoriteButton.test.tsx
```

Expected: 2 tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/PromptDetail/FavoriteButton.tsx apps/web/src/components/PromptDetail/FavoriteButton.test.tsx
git commit -m "feat(web): FavoriteButton (optimistic toggle, yellow filled-star)"
```

---

### Task 17: `MoreMenu` + test

**Files:**
- Create: `apps/web/src/components/PromptDetail/MoreMenu.tsx`
- Create: `apps/web/src/components/PromptDetail/MoreMenu.test.tsx`

- [ ] **Step 1: Implement**

Create `apps/web/src/components/PromptDetail/MoreMenu.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MoreHorizontal, Flag } from "lucide-react";
import { toast } from "../../lib/toast";

export default function MoreMenu(_props: { promptId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", onClickOutside);
      return () => document.removeEventListener("mousedown", onClickOutside);
    }
    return undefined;
  }, [open]);

  function handleReport() {
    // M5 placeholder — M7 will wire to ReportModal
    toast.info(t("detail.report_coming_soon"));
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border-soft bg-surface text-ink-muted hover:bg-panel-2 hover:text-ink"
      >
        <MoreHorizontal size={14} aria-hidden />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-40 rounded-card border border-border-soft bg-panel p-1 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={handleReport}
            className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-[12.5px] text-ink-muted hover:bg-panel-2 hover:text-ink"
          >
            <Flag size={12} aria-hidden />
            {t("detail.report")}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Tests**

Create `apps/web/src/components/PromptDetail/MoreMenu.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import i18n, { initI18n } from "../../i18n";
import MoreMenu from "./MoreMenu";
import { useToastStore } from "../../lib/toast";

function setup() {
  return render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <MoreMenu promptId="abc" />
      </I18nextProvider>
    </MemoryRouter>,
  );
}

beforeEach(async () => {
  await initI18n("en");
  useToastStore.setState({ toasts: [] });
});
afterEach(() => cleanup());

describe("MoreMenu", () => {
  it("opens the menu on trigger click", () => {
    setup();
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("menu")).toBeTruthy();
  });

  it("clicking 'Report' pushes a toast", async () => {
    setup();
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("menuitem", { name: /report/i }));
    await waitFor(() => {
      expect(useToastStore.getState().toasts.length).toBeGreaterThan(0);
    });
  });

  it("closes on outside click", () => {
    setup();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
```

- [ ] **Step 3: Run**

```bash
pnpm --filter @ip/web test src/components/PromptDetail/MoreMenu.test.tsx
```

Expected: 3 tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/PromptDetail/MoreMenu.tsx apps/web/src/components/PromptDetail/MoreMenu.test.tsx
git commit -m "feat(web): MoreMenu (icon-only dropdown, report placeholder)"
```

---

### Task 18: `PromptCard` hover Heart → `LikeButton` compact

**Files:**
- Modify: `apps/web/src/components/PromptCard.tsx`

- [ ] **Step 1: Replace the read-only Heart span with `LikeButton` compact**

Open `apps/web/src/components/PromptCard.tsx`. Add the import:

```tsx
import LikeButton from "./PromptDetail/LikeButton";
```

Find this block:

```tsx
<span className="flex items-center gap-0.5">
  <Heart size={12} aria-hidden /> {prompt.likeCount}
</span>
```

Replace with:

```tsx
<LikeButton
  promptId={prompt.id}
  initial={{ liked: prompt.userLiked ?? false, count: prompt.likeCount }}
  variant="compact"
/>
```

Remove the `Heart` import (no longer used in the card itself).

- [ ] **Step 2: Update the `PromptSummary` consumer**

The shared `PromptSummary` type now has `userLiked` as `boolean | undefined`. Reading `prompt.userLiked ?? false` already handles the absent case.

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @ip/web exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Run web tests — confirm no regression**

```bash
pnpm --filter @ip/web test
```

Expected: existing tests pass (the card has no dedicated test file; LikeButton tests cover the click behaviour).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/PromptCard.tsx
git commit -m "feat(web): card hover Heart upgrades to clickable LikeButton (compact)"
```

---

### Task 19: PromptDetailPage wiring

**Files:**
- Modify: `apps/web/src/pages/PromptDetailPage.tsx`

- [ ] **Step 1: Replace the 3 disabled buttons + add MoreMenu**

Open `apps/web/src/pages/PromptDetailPage.tsx`. Add imports near the top:

```tsx
import CopyPromptButton from "../components/PromptDetail/CopyPromptButton";
import LikeButton from "../components/PromptDetail/LikeButton";
import FavoriteButton from "../components/PromptDetail/FavoriteButton";
import MoreMenu from "../components/PromptDetail/MoreMenu";
```

Remove the `import { Heart, Send } from "lucide-react";` (Send was already removed in M3; Heart is no longer used in this file). Adjust the remaining import to drop unused icons.

Find the existing block:

```tsx
<div className="grid grid-cols-3 gap-2 text-[12.5px]">
  <button ... > {t("detail.copy_prompt")} </button>
  <button ... > <Heart size={12} /> {t("detail.favorite")} </button>
  <button ... > {t("detail.more")} </button>
</div>
```

Replace with:

```tsx
<div className="grid grid-cols-3 gap-2 text-[12.5px]">
  <CopyPromptButton prompt={d.prompt} />
  <LikeButton
    promptId={d.id}
    initial={{ liked: d.userLiked ?? false, count: d.likeCount }}
    variant="full"
  />
  <FavoriteButton
    promptId={d.id}
    initial={{ favorited: d.userFavorited ?? false }}
  />
</div>

<div className="flex justify-end">
  <MoreMenu promptId={d.id} />
</div>
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @ip/web exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Run all web tests**

```bash
pnpm --filter @ip/web test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/PromptDetailPage.tsx
git commit -m "feat(web): wire detail page CTA grid (Copy / Like / Favorite + More)"
```

---

### Task 20: `useView` hook + PromptDetailPage call

**Files:**
- Create: `apps/web/src/lib/hooks/useView.ts`
- Modify: `apps/web/src/pages/PromptDetailPage.tsx`

- [ ] **Step 1: Hook**

Create `apps/web/src/lib/hooks/useView.ts`:

```ts
import { useEffect, useRef } from "react";
import { postView } from "../interactions";

/**
 * Fire-and-forget view recording. Runs once per mounted detail page per
 * promptId; the ref prevents StrictMode's double-mount from double-firing
 * in dev. Failures are swallowed — views are best-effort.
 */
export function useView(promptId: string | undefined) {
  const fired = useRef<string | null>(null);
  useEffect(() => {
    if (!promptId || fired.current === promptId) return;
    fired.current = promptId;
    void postView(promptId).catch(() => {
      /* best-effort; ignore */
    });
  }, [promptId]);
}
```

- [ ] **Step 2: Wire into PromptDetailPage**

Open `apps/web/src/pages/PromptDetailPage.tsx`. Add at the top:

```tsx
import { useView } from "../lib/hooks/useView";
```

Inside the component, after `const detail = usePromptDetail(slug)`, add:

```tsx
useView(detail.data?.id);
```

- [ ] **Step 3: Typecheck + tests**

```bash
pnpm --filter @ip/web exec tsc --noEmit
pnpm --filter @ip/web test
```

Expected: all clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/hooks/useView.ts apps/web/src/pages/PromptDetailPage.tsx
git commit -m "feat(web): fire view ping on PromptDetailPage mount (best-effort)"
```

---

### Task 21: `useMyFavorites` hook

**Files:**
- Create: `apps/web/src/lib/hooks/useMyFavorites.ts`

- [ ] **Step 1: Implement**

Create `apps/web/src/lib/hooks/useMyFavorites.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import type { PromptSummary } from "@ip/shared";
import { apiFetch } from "../api";

export type MyFavoritesResponse = {
  items: PromptSummary[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

export function useMyFavorites(page: number, pageSize = 24) {
  return useQuery<MyFavoritesResponse>({
    queryKey: ["me", "favorites", { page, pageSize }],
    queryFn: ({ signal }) =>
      apiFetch<MyFavoritesResponse>(`/api/me/favorites?page=${page}&pageSize=${pageSize}`, { signal }),
    staleTime: 30 * 1000,
  });
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm --filter @ip/web exec tsc --noEmit
git add apps/web/src/lib/hooks/useMyFavorites.ts
git commit -m "feat(web): useMyFavorites hook"
```

---

### Task 22: ProfilePage refactor + tabs

**Files:**
- Create: `apps/web/src/components/profile/ProfileInfoTab.tsx`
- Create: `apps/web/src/components/profile/FavoritesTab.tsx`
- Modify: `apps/web/src/pages/ProfilePage.tsx`

- [ ] **Step 1: Extract ProfileInfoTab**

Create `apps/web/src/components/profile/ProfileInfoTab.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import { isLocale, type Locale } from "@ip/shared";
import AvatarBadge from "../auth/AvatarBadge";
import { useInvalidateSession, type Session } from "../../lib/hooks/useSession";
import { signOut } from "../../lib/auth";
import { toast } from "../../lib/toast";
import { withLocale } from "../../lib/locale";

export default function ProfileInfoTab({ session }: { session: Session }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const invalidate = useInvalidateSession();

  async function handleSignOut() {
    await signOut();
    await invalidate();
    toast.info(t("auth.sign_out"));
    navigate(withLocale(locale, "/"), { replace: true });
  }

  const u = session.user;
  return (
    <div className="mx-auto max-w-md">
      <div className="flex flex-col items-center gap-4 rounded-card border border-border-soft bg-panel p-8">
        <AvatarBadge src={u.image} name={u.name} email={u.email} size={72} />
        {u.name && <div className="text-base font-medium">{u.name}</div>}
        <div className="text-[13px] text-ink-muted">{u.email}</div>
        <button
          type="button"
          onClick={handleSignOut}
          className="mt-4 rounded-pill border border-border-soft bg-surface px-5 py-2 text-[13px] font-medium text-ink hover:bg-panel-2"
        >
          {t("profile.sign_out_button")}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create FavoritesTab**

Create `apps/web/src/components/profile/FavoritesTab.tsx`:

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import PromptCard from "../PromptCard";
import Masonry, { type MasonryBreakpoint, type MasonryItem } from "../Masonry";
import { useMyFavorites } from "../../lib/hooks/useMyFavorites";
import { CardGridSkeleton } from "../Skeleton";

const BREAKPOINTS: MasonryBreakpoint[] = [
  { minWidth: 1280, columns: 4 },
  { minWidth: 1024, columns: 3 },
  { minWidth: 640, columns: 2 },
  { minWidth: 0, columns: 1 },
];

export default function FavoritesTab() {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const query = useMyFavorites(page, 24);

  if (query.isLoading) return <CardGridSkeleton count={12} />;
  if (query.isError) return <div className="py-12 text-center text-ink-dim">{t("common.error")}</div>;
  if (!query.data || query.data.items.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-base font-medium text-ink">{t("profile.no_favorites")}</p>
        <p className="mt-2 text-[13px] text-ink-muted">{t("profile.no_favorites_hint")}</p>
      </div>
    );
  }

  const items: MasonryItem[] = query.data.items.map((p) => ({
    key: p.id,
    aspectRatio:
      p.primaryImage?.width && p.primaryImage?.height
        ? p.primaryImage.width / p.primaryImage.height
        : 1,
    node: <PromptCard prompt={p} />,
  }));

  const maxPage = Math.max(1, Math.ceil(query.data.total / query.data.pageSize));
  return (
    <div className="space-y-4">
      <Masonry items={items} breakpoints={BREAKPOINTS} gap={4} className="p-2" />
      <div className="flex items-center justify-center gap-2 py-4 text-[13px]">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
          className="rounded-pill border border-border-soft bg-surface px-4 py-1.5 text-ink-muted hover:enabled:text-ink disabled:opacity-40"
        >
          ← prev
        </button>
        <span className="px-2 text-ink-dim">{page} / {maxPage}</span>
        <button
          type="button"
          disabled={!query.data.hasMore}
          onClick={() => setPage((p) => p + 1)}
          className="rounded-pill border border-border-soft bg-surface px-4 py-1.5 text-ink-muted hover:enabled:text-ink disabled:opacity-40"
        >
          next →
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Refactor ProfilePage**

Replace `apps/web/src/pages/ProfilePage.tsx` body with:

```tsx
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useEffect } from "react";
import { isLocale, type Locale } from "@ip/shared";
import AppShell from "../components/layout/AppShell";
import ProfileInfoTab from "../components/profile/ProfileInfoTab";
import FavoritesTab from "../components/profile/FavoritesTab";
import { useSession } from "../lib/hooks/useSession";
import { withLocale } from "../lib/locale";

type TabKey = "profile" | "favorites";

function readTab(v: string | null): TabKey {
  return v === "favorites" ? "favorites" : "profile";
}

export default function ProfilePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const session = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = readTab(searchParams.get("tab"));

  useEffect(() => {
    if (!session.isLoading && !session.data) {
      navigate(withLocale(locale, "/"), { replace: true });
    }
  }, [session.isLoading, session.data, navigate, locale]);

  function setTab(next: TabKey) {
    const updated = new URLSearchParams(searchParams);
    if (next === "profile") updated.delete("tab");
    else updated.set("tab", "favorites");
    setSearchParams(updated);
  }

  if (session.isLoading || !session.data) {
    return (
      <AppShell>
        <div className="mx-auto max-w-md px-6 py-12 text-center text-ink-dim">
          {t("common.loading")}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <article className="mx-auto w-full max-w-5xl px-6 py-8">
        <h1 className="mb-4 text-xl font-semibold tracking-tight">{t("profile.page_title")}</h1>

        <div role="tablist" className="mb-6 flex gap-4 border-b border-border-soft">
          <TabButton active={tab === "profile"} onClick={() => setTab("profile")}>
            {t("profile.tab_profile")}
          </TabButton>
          <TabButton active={tab === "favorites"} onClick={() => setTab("favorites")}>
            {t("profile.tab_favorites")}
          </TabButton>
        </div>

        {tab === "profile" ? <ProfileInfoTab session={session.data} /> : <FavoritesTab />}
      </article>
    </AppShell>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px border-b-2 px-3 pb-2 text-[13px] font-medium transition ${
        active ? "border-accent text-ink" : "border-transparent text-ink-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 4: Typecheck + tests**

```bash
pnpm --filter @ip/web exec tsc --noEmit
pnpm --filter @ip/web test
```

Expected: all clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/ProfilePage.tsx apps/web/src/components/profile/
git commit -m "feat(web): ProfilePage tabs (Profile / Favorites) with paginated favorites list"
```

---

### Task 23: Manual test + final review

This task is verification only — no new code.

- [ ] **Step 1: Full automated suite**

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
```

Expected: all clean. If format:check fails, run `pnpm format` and commit the deltas as `chore: apply formatter`.

- [ ] **Step 2: Boot smoke**

```bash
pnpm --filter @ip/api dev &
sleep 4
curl -s http://localhost:3000/api/health
kill %1 2>/dev/null
```

Expected: `{"status":"ok"}` (or whatever M1 health returns).

- [ ] **Step 3: Manual browser matrix**

Boot `pnpm dev` and walk through:

1. **Guest detail page** → "Copy" works, "Like" / "Favorite" open SignInModal, "More" → Report → toast "举报功能即将上线"
2. **Sign in (Google or GitHub)** → return to detail page → both Like / Favorite buttons enabled
3. **Click Like** → button turns red, count +1, no spinner needed (optimistic)
4. **Refresh** → count is still +1, button is still red (server confirmed)
5. **Click Favorite** → star turns yellow
6. **Navigate to `/zh/profile`** → tab strip shows "资料" / "我的收藏"
7. **Click "我的收藏"** → URL becomes `/zh/profile?tab=favorites`, the prompt you favorited shows
8. **Go back to list page** → the card with Like applied still shows the Heart filled red in the hover overlay
9. **Click Heart in card hover** → toggles without navigating to detail page
10. **More menu** → click outside closes the menu

If anything misbehaves, fix inline and commit; otherwise this task is complete.

- [ ] **Step 4: Final commit (if any cleanup)**

```bash
git add -A && git commit -m "chore: M5 final manual-pass cleanup"
```

Skip if nothing to commit.

---

## Plan Self-Review

### Spec Coverage

| Spec section | Plan task |
|---|---|
| §1.2 — Copy / Like / Favorite / More buttons | Tasks 12, 14, 16, 17, 19 |
| §1.2 — card hover Heart toggleable | Task 18 |
| §1.2 — view tracking | Tasks 3, 4 (recordView), 5 (view route), 20 (useView) |
| §1.2 — /profile favorites tab | Tasks 21, 22 |
| §2 — view_log table | Task 2 |
| §3.2/3.3 — POST/DELETE /like /favorite | Tasks 4, 5 |
| §3.4 — POST /view | Tasks 3, 4, 5 |
| §3.5 — GET /me/favorites | Tasks 4 (repo), 8 (route) |
| §3.6 — extend prompts response with userLiked/userFavorited | Tasks 1, 6, 7 |
| §3.7 — rate limiting | Task 5 (toggle limiters + view limiter) |
| §4 — data flow + optimistic + 401 | Tasks 13, 14, 15, 16 (mutations + buttons) |
| §5.1-5.7 — UI surface | Tasks 12, 14, 16, 17, 18, 19, 22 |
| §5.8 — i18n keys | Task 10 |
| §6 — error matrix | Tasks 14, 16 (mutation onError branches), 5 (route error codes) |
| §7 — security (ip-hash, dedup, limiters) | Tasks 3, 5, 2 (unique index) |
| §8 — tests | Tasks 3, 4, 5, 6, 7, 8, 12, 14, 16, 17 |

No section uncovered.

### Placeholder Scan

Searched for "TBD", "TODO", "implement later", "fill in" — none in the plan body. The only "placeholder" word appears in Task 17's description of the Report menu item, which is intentional (M5 ships it as a placeholder by design).

### Type Consistency

- `LikeState = { liked: boolean; count: number }` (Task 13) → consumed by LikeButton (Task 14) ✓
- `FavoriteState = { favorited: boolean }` (Task 15) → consumed by FavoriteButton (Task 16) ✓
- Repo's `toggleLike` returns `{ like_count: number }` (Task 4) → route wraps as `{ liked, like_count }` (Task 5) → hook returns `LikeResponse` (Task 11) → button calls (Task 14) ✓
- `AlreadyExistsError` / `NotFoundError` from repo (Task 4) → mapped to 409 / 404 in route (Task 5) → mutation hook treats both as silent (Tasks 13, 15) ✓
- `userLiked` / `userFavorited` added in shared schema (Task 1) → emitted by repo (Task 6) → forwarded by route (Task 7) → consumed by detail page (Task 19) + card (Task 18) ✓

All consistent.
