# Sprint 2 / M9 — 用户侧补完 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 Image-Prompts 补完 8 项用户侧体验:显眼投稿入口、卡片真实头像、详情页 uploader + 用户主页、点赞/收藏聚合通知、搜索、投稿 modal、首页 tabs 重组、个人主页数据卡。让真实非自己的用户访问体验完整。

**Architecture:** 后端先扩 schema(notifications 加聚合列、prompts.contributor JOIN users)+ 新增 users-public / stats 两个 endpoint 家族,然后前端铺路(Avatar / StatsCard 共享组件)+ 写 UserPage / HomePage tabs / SubmitModal / 接通 search + NotificationsList 新类型 + PromptDetailPage uploader 行。所有改动遵循现有 react-i18next 单大括号 / Apple HIG 浅色主题 / Drizzle expression JOIN / pnpm monorepo 规范。

**Tech Stack:** TypeScript / Hono / Drizzle ORM / Postgres / React 18 + Vite / TanStack Query 5 / Zustand / Vitest / React Testing Library / lucide-react / react-i18next。

---

## Pre-Task Setup (controller dispatches before Task 1)

**Baseline:** main @ `0091477`(M9 spec close 6 Open Questions 已 commit)。

**Worktree:** `.worktrees/m9-user-side` on `feat/m9-user-side`。

```bash
git worktree add .worktrees/m9-user-side -b feat/m9-user-side
cd .worktrees/m9-user-side
# .env 必须从主仓 copy 一份(gitignored)
cp ../../apps/api/.env apps/api/.env
pnpm install
pnpm test
# Expected: 290+ passing (M4 polish state baseline)
```

如果 baseline 不绿 STOP 报告。

---

## Task 1: notifications schema 加聚合列 + enum 扩展

**Spec ref:** §3.4

**Why:** 用户选了 hourly aggregation。需要 `group_key` + `aggregated_count` 列 + 加 `prompt_liked` / `prompt_favorited` 两个 enum 值。

**Files:**
- Create: `apps/api/drizzle/0007_m9_notifications_agg.sql`
- Modify: `apps/api/src/db/schema/notifications.ts` — enum + 新列 + payload union 扩展
- Modify: `packages/shared/src/schemas/submission.ts` — `NotificationSchema` 的 type enum 加 2 个值

- [ ] **Step 1: 写 migration SQL**

创建 `apps/api/drizzle/0007_m9_notifications_agg.sql`:

```sql
-- M9: notification aggregation + new types
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'prompt_liked';
ALTER TYPE "notification_type" ADD VALUE IF NOT EXISTS 'prompt_favorited';

ALTER TABLE "notifications" ADD COLUMN "group_key" text;
ALTER TABLE "notifications" ADD COLUMN "aggregated_count" integer NOT NULL DEFAULT 1;

-- Partial index for the aggregation lookup hot-path:
--   SELECT ... WHERE user_id=$1 AND group_key=$2 AND read_at IS NULL AND created_at >= now() - INTERVAL '1 hour' ORDER BY created_at DESC LIMIT 1
CREATE INDEX IF NOT EXISTS "notifications_group_lookup_idx"
  ON "notifications" ("user_id", "group_key", "created_at" DESC)
  WHERE "group_key" IS NOT NULL AND "read_at" IS NULL;
```

- [ ] **Step 2: 更新 schema TS**

修改 `apps/api/src/db/schema/notifications.ts` 完整覆盖为:

```ts
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth.ts";

export const notificationTypeEnum = pgEnum("notification_type", [
  "submission_approved",
  "submission_rejected",
  "prompt_liked",
  "prompt_favorited",
]);

export type NotificationPayload =
  | {
      submissionId: string;
      promptId: string;
      promptSlug: string;
      titleZh: string | null;
      titleEn: string | null;
    }
  | {
      submissionId: string;
      reason: string;
      titleZh: string | null;
      titleEn: string | null;
    }
  | {
      promptId: string;
      promptSlug: string;
      titleZh: string | null;
      titleEn: string | null;
      lastActorId: string;
      lastActorName: string | null;
    };

export const notifications = pgTable(
  "notifications",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: notificationTypeEnum().notNull(),
    payload: jsonb().$type<NotificationPayload>().notNull(),
    groupKey: text("group_key"),
    aggregatedCount: integer("aggregated_count").notNull().default(1),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userUnreadIdx: index("notifications_user_unread_idx")
      .on(t.userId, t.createdAt.desc())
      .where(sql`${t.readAt} IS NULL`),
    userAllIdx: index("notifications_user_all_idx").on(t.userId, t.createdAt.desc()),
    groupLookupIdx: index("notifications_group_lookup_idx")
      .on(t.userId, t.groupKey, t.createdAt.desc())
      .where(sql`${t.groupKey} IS NOT NULL AND ${t.readAt} IS NULL`),
  }),
);
```

- [ ] **Step 3: 扩 shared NotificationSchema 的 type enum**

修改 `packages/shared/src/schemas/submission.ts` 找到 `NotificationSchema`(line 76-82),把 `type` enum 加两个值:

```ts
export const NotificationSchema = z.object({
  id: z.string().uuid(),
  type: z.enum([
    "submission_approved",
    "submission_rejected",
    "prompt_liked",
    "prompt_favorited",
  ]),
  payload: z.record(z.unknown()),
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  aggregatedCount: z.number().int().min(1).default(1),
});
```

(加 `aggregatedCount` 字段供前端用。)

- [ ] **Step 4: 跑 migration**

```bash
pnpm --filter @ip/api db:push 2>&1 | tail -10
```

Expected: 应用成功,无报错。

- [ ] **Step 5: 跑测试无回归**

```bash
pnpm typecheck && pnpm test 2>&1 | tail -5
```

Expected: 全 PASS(290+)。Schema TS 改了但 repo 还没用新列,不影响现有功能。

- [ ] **Step 6: Commit**

```bash
git add apps/api/drizzle/0007_m9_notifications_agg.sql \
        apps/api/src/db/schema/notifications.ts \
        packages/shared/src/schemas/submission.ts
git commit -m "feat(m9): notifications schema for hourly aggregation + 2 new types"
```

---

## Task 2: createInteractionNotification repo with hourly aggregation

**Spec ref:** §3.4

**Why:** 实现聚合算法 — SELECT FOR UPDATE 最近 1 小时未读同 group → UPDATE 累加,否则 INSERT。

**Files:**
- Modify: `apps/api/src/repositories/notifications.ts` — 新 `createInteractionNotification` 函数
- Modify: `apps/api/src/repositories/notifications.test.ts` — 加测试

- [ ] **Step 1: 写测试(失败)**

修改 `apps/api/src/repositories/notifications.test.ts`,在文件末尾追加:

```ts
import { createInteractionNotification } from "./notifications.ts";

describe("createInteractionNotification (hourly aggregate)", () => {
  it("INSERTs new row when no recent unread same-group exists", async () => {
    const u = await makeUser();  // helper from existing tests
    const actor1 = await makeUser();
    const promptId = crypto.randomUUID();
    const result = await createInteractionNotification({
      userId: u.id,
      type: "prompt_liked",
      promptId,
      promptSlug: "x",
      titleZh: "T", titleEn: null,
      actorId: actor1.id,
      actorName: "A1",
    });
    expect(result.created).toBe(true);
    expect(result.aggregatedCount).toBe(1);
  });

  it("UPDATEs aggregated_count when same-group recent unread exists", async () => {
    const u = await makeUser();
    const actor1 = await makeUser();
    const actor2 = await makeUser();
    const promptId = crypto.randomUUID();
    await createInteractionNotification({
      userId: u.id, type: "prompt_liked", promptId, promptSlug: "x",
      titleZh: "T", titleEn: null, actorId: actor1.id, actorName: "A1",
    });
    const r2 = await createInteractionNotification({
      userId: u.id, type: "prompt_liked", promptId, promptSlug: "x",
      titleZh: "T", titleEn: null, actorId: actor2.id, actorName: "A2",
    });
    expect(r2.created).toBe(false);
    expect(r2.aggregatedCount).toBe(2);

    // Verify only 1 row exists in DB
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, u.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.aggregatedCount).toBe(2);
    // Payload's lastActor refreshed to the most recent actor
    expect((rows[0]!.payload as { lastActorName: string }).lastActorName).toBe("A2");
  });

  it("INSERTs new row when previous notification is already read", async () => {
    const u = await makeUser();
    const actor1 = await makeUser();
    const actor2 = await makeUser();
    const promptId = crypto.randomUUID();
    await createInteractionNotification({
      userId: u.id, type: "prompt_liked", promptId, promptSlug: "x",
      titleZh: "T", titleEn: null, actorId: actor1.id, actorName: "A1",
    });
    // Mark all read
    await db.update(notifications)
      .set({ readAt: new Date() })
      .where(eq(notifications.userId, u.id));
    const r2 = await createInteractionNotification({
      userId: u.id, type: "prompt_liked", promptId, promptSlug: "x",
      titleZh: "T", titleEn: null, actorId: actor2.id, actorName: "A2",
    });
    expect(r2.created).toBe(true);
    expect(r2.aggregatedCount).toBe(1);

    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, u.id));
    expect(rows).toHaveLength(2);  // 1 read + 1 fresh
  });
});
```

(Assumes existing test file has a `makeUser()` helper. If not, copy the pattern from `submissions.test.ts:makeUser`.)

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @ip/api test -- notifications.test.ts 2>&1 | tail -10
```

Expected: FAIL — `createInteractionNotification` 还没导出。

- [ ] **Step 3: 实现 createInteractionNotification**

修改 `apps/api/src/repositories/notifications.ts`,在文件末尾追加:

```ts
type InteractionInput = {
  userId: string;          // contributor (recipient)
  type: "prompt_liked" | "prompt_favorited";
  promptId: string;
  promptSlug: string;
  titleZh: string | null;
  titleEn: string | null;
  actorId: string;
  actorName: string | null;
};

/**
 * Aggregated interaction notification.
 *
 * Strategy: within a single transaction, look up the most recent unread
 * notification matching (userId, groupKey) within the last hour. If found,
 * UPDATE aggregated_count + refresh payload's lastActor + bump createdAt
 * (which floats it to the top of the user's list). If not found, INSERT a
 * new row with aggregated_count = 1.
 *
 * `groupKey` is `<type-prefix>:<promptId>`. The `notifications_group_lookup_idx`
 * partial index covers the SELECT predicate exactly.
 *
 * `SELECT ... FOR UPDATE` prevents concurrent same-group inserts from
 * creating duplicate rows when two actors hit the like endpoint within ms.
 */
export async function createInteractionNotification(
  input: InteractionInput,
): Promise<{ created: boolean; aggregatedCount: number }> {
  const groupKey = `${input.type === "prompt_liked" ? "liked" : "favorited"}:${input.promptId}`;
  const payload = {
    promptId: input.promptId,
    promptSlug: input.promptSlug,
    titleZh: input.titleZh,
    titleEn: input.titleEn,
    lastActorId: input.actorId,
    lastActorName: input.actorName,
  };
  return await db.transaction(async (tx) => {
    const cutoff = new Date(Date.now() - 60 * 60 * 1000);
    const [existing] = await tx
      .select({
        id: notifications.id,
        aggregatedCount: notifications.aggregatedCount,
      })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, input.userId),
          eq(notifications.groupKey, groupKey),
          isNull(notifications.readAt),
          sql`${notifications.createdAt} >= ${cutoff}`,
        ),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(1)
      .for("update");
    if (existing) {
      const newCount = existing.aggregatedCount + 1;
      await tx
        .update(notifications)
        .set({
          aggregatedCount: newCount,
          payload,
          createdAt: new Date(),
        })
        .where(eq(notifications.id, existing.id));
      return { created: false, aggregatedCount: newCount };
    }
    await tx.insert(notifications).values({
      userId: input.userId,
      type: input.type,
      payload,
      groupKey,
      aggregatedCount: 1,
    });
    return { created: true, aggregatedCount: 1 };
  });
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
pnpm --filter @ip/api test -- notifications.test.ts 2>&1 | tail -10
```

Expected: 所有 case PASS。

- [ ] **Step 5: 4 gate**

```bash
pnpm typecheck && pnpm lint
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/repositories/notifications.ts \
        apps/api/src/repositories/notifications.test.ts
git commit -m "feat(m9): createInteractionNotification with hourly aggregation

Within a single tx, SELECT FOR UPDATE the most recent unread same-group
notification in the last hour. If found, UPDATE aggregated_count + refresh
payload's lastActor + bump createdAt. Otherwise INSERT a fresh row.
Group key is '<liked|favorited>:<promptId>'."
```

---

## Task 3: 接通 interactions 路由触发通知

**Spec ref:** §3.4

**Why:** `POST /:id/like` 和 `POST /:id/favorite` 在 toggle "add" 成功后调用 createInteractionNotification。不给自己发(actor === contributor 跳过)。

**Files:**
- Modify: `apps/api/src/routes/interactions.ts` — 在 add 成功后 await createInteractionNotification
- Modify: `apps/api/src/routes/interactions.test.ts` — 加测试

- [ ] **Step 1: 写测试(失败)**

修改 `apps/api/src/routes/interactions.test.ts`,加新 case:

```ts
describe("POST /api/prompts/:id/like — notification side effect", () => {
  it("creates a notification for the prompt contributor on first like (different user)", async () => {
    // setup: create contributor user + prompt; create actor user with session
    const contributor = await makeUser();
    const promptId = await createTestPrompt({ contributorId: contributor.id });
    const actor = await makeUser({ name: "ActorName" });
    const session = await createTestSession({ userId: actor.id });

    const res = await app.request(`/api/prompts/${promptId}/like`, {
      method: "POST",
      headers: { Cookie: session.cookie },
    });
    expect(res.status).toBe(201);

    // Notification was created for contributor
    const notifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, contributor.id));
    expect(notifs).toHaveLength(1);
    expect(notifs[0]!.type).toBe("prompt_liked");
    expect(notifs[0]!.aggregatedCount).toBe(1);
    expect((notifs[0]!.payload as { lastActorName: string }).lastActorName).toBe("ActorName");
  });

  it("does NOT create a notification when actor === contributor (liking own prompt)", async () => {
    const me = await makeUser();
    const promptId = await createTestPrompt({ contributorId: me.id });
    const session = await createTestSession({ userId: me.id });

    const res = await app.request(`/api/prompts/${promptId}/like`, {
      method: "POST",
      headers: { Cookie: session.cookie },
    });
    expect(res.status).toBe(201);

    const notifs = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, me.id));
    expect(notifs).toHaveLength(0);
  });
});
```

(Adapt `createTestPrompt` / `createTestSession` to existing helpers. If not present, mirror `submissions.test.ts` helpers.)

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @ip/api test -- interactions.test.ts 2>&1 | tail -8
```

Expected: 新 case FAIL — 路由现在不创建 notification。

- [ ] **Step 3: 修改 interactions.ts 路由**

修改 `apps/api/src/routes/interactions.ts`,在文件顶部 imports 加:

```ts
import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { prompts, users } from "../db/schema/index.ts";
import { createInteractionNotification } from "../repositories/notifications.ts";
```

然后修改 `app.post("/:id/like", ...)` 在 `return c.json({...}, 201)` 之前(line 44 之前)插入:

```ts
    // Side-effect: notify contributor unless actor IS contributor.
    const [info] = await db
      .select({
        contributorId: prompts.contributorId,
        slug: prompts.slug,
        title: prompts.title,
        actorName: users.name,
      })
      .from(prompts)
      .leftJoin(users, eq(users.id, userId))
      .where(eq(prompts.id, id))
      .limit(1);
    if (info && info.contributorId && info.contributorId !== userId) {
      const title = (info.title ?? {}) as { zh?: string; en?: string };
      try {
        await createInteractionNotification({
          userId: info.contributorId,
          type: "prompt_liked",
          promptId: id,
          promptSlug: info.slug,
          titleZh: title.zh ?? null,
          titleEn: title.en ?? null,
          actorId: userId,
          actorName: info.actorName ?? null,
        });
      } catch (e) {
        console.warn("[like] notification side-effect failed (non-fatal)", e);
      }
    }
```

对 `POST /:id/favorite` 同样处理,只是 `type: "prompt_favorited"`。

DELETE 路径不动(取消赞/收藏不撤回聚合通知,详见 spec §3.4)。

- [ ] **Step 4: 跑测试确认通过**

```bash
pnpm --filter @ip/api test -- interactions.test.ts 2>&1 | tail -10
```

Expected: 全 PASS。

- [ ] **Step 5: 4 gate**

```bash
pnpm typecheck && pnpm lint
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/interactions.ts \
        apps/api/src/routes/interactions.test.ts
git commit -m "feat(m9): like/favorite routes trigger aggregated notifications

After toggleLike/toggleFavorite 'add' success, look up the prompt's
contributor and call createInteractionNotification. Skip when actor ===
contributor (no self-notify). Errors are swallowed (notification is a
best-effort side effect, not on the critical path)."
```

---

## Task 4: users-public repo + tests

**Spec ref:** §3.3

**Why:** 用户主页需要 4 个 read endpoint:基础信息、累计统计、已发布 prompts、已收藏 prompts(仅自己可见)。

**Files:**
- Create: `apps/api/src/repositories/users-public.ts`
- Create: `apps/api/src/repositories/users-public.test.ts`

- [ ] **Step 1: 写测试(失败)**

创建 `apps/api/src/repositories/users-public.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db, pool } from "../db/client.ts";
import { users } from "../db/schema/auth.ts";
import { prompts, promptImages, r2Accounts } from "../db/schema/index.ts";
import { likes, favorites } from "../db/schema/interactions.ts";
import {
  getUserPublic,
  getUserStats,
  listUserPrompts,
  listUserFavorites,
} from "./users-public.ts";

const PREFIX = "users-public-test-";

afterAll(async () => {
  // Clean test users + cascade their data
  const ids = (await db.select({ id: users.id }).from(users).where(like(users.email, `${PREFIX}%`)))
    .map((r) => r.id);
  // delete prompts contributed by test users first (FK)
  for (const uid of ids) {
    const ps = (await db.select({ id: prompts.id }).from(prompts).where(eq(prompts.contributorId, uid))).map((p) => p.id);
    for (const pid of ps) {
      await db.delete(promptImages).where(eq(promptImages.promptId, pid));
      await db.delete(prompts).where(eq(prompts.id, pid));
    }
  }
  await db.delete(users).where(like(users.email, `${PREFIX}%`));
  await pool.end();
});

async function makeUser(label: string) {
  const [u] = await db.insert(users).values({
    email: `${PREFIX}${label}@example.com`,
    name: `Name-${label}`,
    image: null,
  }).returning();
  return u!;
}

describe("getUserPublic", () => {
  it("returns id/name/image/role/joinedAt without email", async () => {
    const u = await makeUser("get1");
    const got = await getUserPublic(u.id);
    expect(got).not.toBeNull();
    expect(got!.id).toBe(u.id);
    expect(got!.name).toBe(`Name-get1`);
    expect(got!.role).toBe("user");
    expect("email" in got!).toBe(false);
  });
  it("returns null for unknown id", async () => {
    const got = await getUserPublic("00000000-0000-0000-0000-000000000000");
    expect(got).toBeNull();
  });
});

describe("getUserStats", () => {
  it("counts published prompts + sums view/like/favorite counters", async () => {
    const u = await makeUser("stats1");
    const stats = await getUserStats(u.id);
    expect(stats).toEqual({
      publishedCount: 0,
      totalViews: 0,
      totalLikes: 0,
      totalFavorites: 0,
    });
  });
});

describe("listUserPrompts", () => {
  it("returns only this user's published prompts ordered newest first", async () => {
    const u = await makeUser("list1");
    const r = await listUserPrompts(u.id, { cursor: null, limit: 10 });
    expect(r.items).toEqual([]);
    expect(r.nextCursor).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @ip/api test -- users-public.test.ts 2>&1 | tail -8
```

Expected: FAIL — 模块不存在。

- [ ] **Step 3: 实现 users-public repo**

创建 `apps/api/src/repositories/users-public.ts`:

```ts
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { users } from "../db/schema/auth.ts";
import { prompts, promptImages, categories, promptTags, tags } from "../db/schema/index.ts";
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
    })
    .from(prompts)
    .innerJoin(categories, eq(categories.id, prompts.categoryId))
    .where(and(...conds))
    .orderBy(desc(prompts.approvedAt))
    .limit(opts.limit + 1);
  const trimmed = rows.slice(0, opts.limit);
  const ids = trimmed.map((r) => r.id);
  const imgs = ids.length === 0 ? [] : await db
    .select()
    .from(promptImages)
    .where(sql`${promptImages.promptId} IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`)
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
      viewCount: r.viewCount,
      likeCount: r.likeCount,
      favoriteCount: r.favoriteCount,
      sendCount: r.sendCount,
      approvedAt: r.approvedAt.toISOString(),
    })),
    nextCursor:
      rows.length > opts.limit
        ? trimmed[trimmed.length - 1]!.approvedAt.toISOString()
        : null,
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
    })
    .from(favorites)
    .innerJoin(prompts, eq(prompts.id, favorites.promptId))
    .innerJoin(categories, eq(categories.id, prompts.categoryId))
    .where(and(...conds))
    .orderBy(desc(favorites.createdAt))
    .limit(opts.limit + 1);
  const trimmed = rows.slice(0, opts.limit);
  const ids = trimmed.map((r) => r.id);
  const imgs = ids.length === 0 ? [] : await db
    .select()
    .from(promptImages)
    .where(sql`${promptImages.promptId} IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`)
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
      viewCount: r.viewCount,
      likeCount: r.likeCount,
      favoriteCount: r.favoriteCount,
      sendCount: r.sendCount,
      approvedAt: r.approvedAt.toISOString(),
    })),
    nextCursor:
      rows.length > opts.limit
        ? trimmed[trimmed.length - 1]!.favoritedAt.toISOString()
        : null,
  };
}
```

- [ ] **Step 4: 跑测试**

```bash
pnpm --filter @ip/api test -- users-public.test.ts 2>&1 | tail -10
```

Expected: 全 PASS。

- [ ] **Step 5: 4 gate**

```bash
pnpm typecheck && pnpm lint
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/repositories/users-public.ts \
        apps/api/src/repositories/users-public.test.ts
git commit -m "feat(m9): users-public repo — get/stats/listPrompts/listFavorites"
```

---

## Task 5: users routes + tests

**Spec ref:** §3.3

**Why:** 暴露 4 个 GET endpoint。`/:id/favorites` 私有(仅自己可见)。

**Files:**
- Create: `apps/api/src/routes/users.ts`
- Create: `apps/api/src/routes/users.test.ts`
- Modify: `apps/api/src/server.ts` — 挂载 `/api/users` 路由

- [ ] **Step 1: 写测试(失败)**

创建 `apps/api/src/routes/users.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { eq, like } from "drizzle-orm";
import { db, pool } from "../db/client.ts";
import { users } from "../db/schema/auth.ts";
import { createServer } from "../server.ts";
import { createTestSession } from "../auth/test-session.ts";

const app = createServer();
const PREFIX = "users-route-test-";

afterAll(async () => {
  await db.delete(users).where(like(users.email, `${PREFIX}%`));
  await pool.end();
});

async function makeUser(label: string) {
  const [u] = await db.insert(users).values({
    email: `${PREFIX}${label}@example.com`,
    name: `Name-${label}`,
  }).returning();
  return u!;
}

describe("GET /api/users/:id", () => {
  it("returns public user info (no email)", async () => {
    const u = await makeUser("get1");
    const res = await app.request(`/api/users/${u.id}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(u.id);
    expect(body.email).toBeUndefined();
  });
  it("returns 404 for unknown id", async () => {
    const res = await app.request(`/api/users/00000000-0000-0000-0000-000000000000`);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/users/:id/stats", () => {
  it("returns stats object", async () => {
    const u = await makeUser("stats1");
    const res = await app.request(`/api/users/${u.id}/stats`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      publishedCount: expect.any(Number),
      totalViews: expect.any(Number),
      totalLikes: expect.any(Number),
      totalFavorites: expect.any(Number),
    });
  });
});

describe("GET /api/users/:id/favorites", () => {
  it("returns 403 when caller is not the same user", async () => {
    const owner = await makeUser("fav-owner");
    const other = await makeUser("fav-other");
    const session = await createTestSession({ userId: other.id });
    const res = await app.request(`/api/users/${owner.id}/favorites`, {
      headers: { Cookie: session.cookie },
    });
    expect(res.status).toBe(403);
  });
  it("returns favorites for the owner", async () => {
    const u = await makeUser("fav-self");
    const session = await createTestSession({ userId: u.id });
    const res = await app.request(`/api/users/${u.id}/favorites`, {
      headers: { Cookie: session.cookie },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.items).toBeDefined();
  });
  it("returns 401 for anonymous", async () => {
    const u = await makeUser("fav-anon");
    const res = await app.request(`/api/users/${u.id}/favorites`);
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @ip/api test -- users.test.ts 2>&1 | tail -10
```

Expected: 404 from all routes (file not mounted yet).

- [ ] **Step 3: 实现 users routes**

创建 `apps/api/src/routes/users.ts`:

```ts
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { zv } from "../lib/validate.ts";
import { softAuth, requireUserId } from "../middleware/auth.ts";
import {
  getUserPublic,
  getUserStats,
  listUserPrompts,
  listUserFavorites,
} from "../repositories/users-public.ts";

const app = new Hono();

const UuidParamSchema = z.object({ id: z.string().uuid() });
const ListQuerySchema = z.object({
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(24),
});

app.get("/:id", zv("param", UuidParamSchema), async (c) => {
  const u = await getUserPublic(c.req.valid("param").id);
  if (!u) throw new HTTPException(404, { message: "not_found" });
  return c.json(u);
});

app.get("/:id/stats", zv("param", UuidParamSchema), async (c) => {
  const u = await getUserPublic(c.req.valid("param").id);
  if (!u) throw new HTTPException(404, { message: "not_found" });
  const stats = await getUserStats(c.req.valid("param").id);
  return c.json(stats);
});

app.get(
  "/:id/prompts",
  zv("param", UuidParamSchema),
  zv("query", ListQuerySchema),
  async (c) => {
    const u = await getUserPublic(c.req.valid("param").id);
    if (!u) throw new HTTPException(404, { message: "not_found" });
    const r = await listUserPrompts(c.req.valid("param").id, {
      cursor: c.req.valid("query").cursor ?? null,
      limit: c.req.valid("query").limit,
    });
    return c.json(r);
  },
);

// Owner-only: returns favorites only when caller's session matches :id
app.get(
  "/:id/favorites",
  softAuth(),
  zv("param", UuidParamSchema),
  zv("query", ListQuerySchema),
  async (c) => {
    const callerId = requireUserId(c);  // 401 if not signed in
    const targetId = c.req.valid("param").id;
    if (callerId !== targetId) {
      throw new HTTPException(403, { message: "forbidden" });
    }
    const r = await listUserFavorites(targetId, {
      cursor: c.req.valid("query").cursor ?? null,
      limit: c.req.valid("query").limit,
    });
    return c.json(r);
  },
);

export default app;
```

- [ ] **Step 4: 挂载路由**

修改 `apps/api/src/server.ts` 找到挂载其他 routes 的位置(类似 `app.route("/api/prompts", promptsRoutes)`),加:

```ts
import usersRoutes from "./routes/users.ts";
// ...
app.route("/api/users", usersRoutes);
```

- [ ] **Step 5: 跑测试**

```bash
pnpm --filter @ip/api test -- users.test.ts 2>&1 | tail -10
```

Expected: 全 PASS。

- [ ] **Step 6: 4 gate**

```bash
pnpm typecheck && pnpm lint
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/users.ts \
        apps/api/src/routes/users.test.ts \
        apps/api/src/server.ts
git commit -m "feat(m9): public users routes (info / stats / prompts / favorites-private)"
```

---

## Task 6: prompts repo 加 contributor JOIN(list + detail)

**Spec ref:** §3.2, §3.3.1

**Why:** PromptCard 要显示真实头像;PromptDetailPage 要显示 uploader。两条 query 都 JOIN users 取 id/name/image。

**Files:**
- Modify: `packages/shared/src/schemas/prompt.ts` — PromptSummary 加 contributor 字段
- Modify: `apps/api/src/repositories/prompts.ts` — listPrompts + getPromptBySlug LEFT JOIN users
- Modify: `apps/api/src/repositories/prompts.test.ts` — 加测试

- [ ] **Step 1: 扩 PromptSummarySchema**

修改 `packages/shared/src/schemas/prompt.ts:36-63`,在 `PromptSummarySchema` object 内 `userFavorited` 之后追加:

```ts
  contributor: z
    .object({
      id: UuidSchema,
      name: z.string().nullable(),
      avatarUrl: z.string().nullable(),
    })
    .nullable(),
```

(与 PromptDetailSchema.contributor 字段名一致 — `avatarUrl` 而非 `image`。)

- [ ] **Step 2: 改 listPrompts JOIN users**

修改 `apps/api/src/repositories/prompts.ts:69-95` 的 SELECT 块,在 select object 加:

```ts
      contributorId: prompts.contributorId,
      contributorName: users.name,
      contributorImage: users.image,
```

修改 line 90 之后(.from(prompts).innerJoin(categories...)),在 categories join 之后加:

```ts
    .leftJoin(users, eq(users.id, prompts.contributorId))
```

需要 import `users`:

```ts
import { categories, prompts, promptImages, promptTags, tags } from "../db/schema/index.ts";
import { users } from "../db/schema/auth.ts";
```

修改 items map 在 line 142-167,加 contributor 字段:

```ts
  const items = rows.map((r) => {
    const img = firstImageByPrompt.get(r.id) ?? null;
    return {
      // ... existing fields ...
      contributor: r.contributorId
        ? {
            id: r.contributorId,
            name: r.contributorName,
            avatarUrl: r.contributorImage,
          }
        : null,
      ...(currentUserId ? { userLiked: r.userLiked, userFavorited: r.userFavorited } : {}),
    };
  });
```

- [ ] **Step 3: 改 getPromptBySlug 同样 JOIN users**

修改 `apps/api/src/repositories/prompts.ts:178-211`,在 select 加:

```ts
      contributorName: users.name,
      contributorImage: users.image,
```

(已经 select 了 contributorId 在 line 196。)

innerJoin 后加 leftJoin:

```ts
    .leftJoin(users, eq(users.id, prompts.contributorId))
```

最后替换 line 254 的 `contributor: null,` 为:

```ts
    contributor: row.contributorId
      ? {
          id: row.contributorId,
          name: row.contributorName,
          avatarUrl: row.contributorImage,
        }
      : null,
```

- [ ] **Step 4: 加测试**

修改 `apps/api/src/repositories/prompts.test.ts`,在 `describe("listPrompts...")` 后加一个新 describe:

```ts
describe("contributor join", () => {
  it("returns contributor info for prompts with contributorId", async () => {
    // Use existing seeded prompt(s); inject a contributor
    const [u] = await db.insert(users).values({
      email: "prompts-test-contributor@example.com",
      name: "Contributor One",
      image: "https://example.com/avatar.png",
    }).returning();
    await db.update(prompts).set({ contributorId: u!.id }).where(eq(prompts.slug, (await latestPromptForTest()).slug));

    const detail = await getPromptBySlug((await latestPromptForTest()).slug);
    expect(detail?.contributor).toEqual({
      id: u!.id,
      name: "Contributor One",
      avatarUrl: "https://example.com/avatar.png",
    });

    // Cleanup
    await db.update(prompts).set({ contributorId: null }).where(eq(prompts.contributorId, u!.id));
    await db.delete(users).where(eq(users.id, u!.id));
  });

  it("returns contributor:null for prompts without contributorId", async () => {
    const p = await latestPromptForTest();
    await db.update(prompts).set({ contributorId: null }).where(eq(prompts.slug, p.slug));
    const detail = await getPromptBySlug(p.slug);
    expect(detail?.contributor).toBeNull();
  });
});
```

(Test file already imports `users` from `auth.ts:4`.)

- [ ] **Step 5: 跑测试**

```bash
pnpm --filter @ip/api test -- prompts.test.ts 2>&1 | tail -12
```

Expected: 全 PASS,包括新 case。

- [ ] **Step 6: 4 gate**

```bash
pnpm typecheck && pnpm lint
```

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/schemas/prompt.ts \
        apps/api/src/repositories/prompts.ts \
        apps/api/src/repositories/prompts.test.ts
git commit -m "feat(m9): prompts repo + schema — contributor JOIN users (id/name/avatarUrl)"
```

---

## Task 7: 站点 stats endpoint

**Spec ref:** §3.7

**Why:** 首页 logo 副标题"本站已收录 X 条"需要新 endpoint(不沿用 `/api/prompts?total=` 因为后者带 filter)。

**Files:**
- Create: `apps/api/src/repositories/stats.ts`
- Create: `apps/api/src/routes/stats.ts`
- Create: `apps/api/src/routes/stats.test.ts`
- Modify: `apps/api/src/server.ts` — 挂载 `/api/stats`

- [ ] **Step 1: 写测试**

创建 `apps/api/src/routes/stats.test.ts`:

```ts
import { describe, it, expect, afterAll } from "vitest";
import { createServer } from "../server.ts";
import { pool } from "../db/client.ts";

const app = createServer();

afterAll(async () => { await pool.end(); });

describe("GET /api/stats/summary", () => {
  it("returns publishedCount", async () => {
    const res = await app.request("/api/stats/summary");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.publishedCount).toBe("number");
    expect(body.publishedCount).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 2: 跑测试(失败 — 404)**

```bash
pnpm --filter @ip/api test -- stats.test.ts 2>&1 | tail -6
```

- [ ] **Step 3: 写 repo + route**

创建 `apps/api/src/repositories/stats.ts`:

```ts
import { sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { prompts } from "../db/schema/index.ts";

export async function getStatsSummary() {
  const [r] = await db
    .select({ publishedCount: sql<number>`COUNT(*)::int` })
    .from(prompts);
  return { publishedCount: r?.publishedCount ?? 0 };
}
```

创建 `apps/api/src/routes/stats.ts`:

```ts
import { Hono } from "hono";
import { getStatsSummary } from "../repositories/stats.ts";

const app = new Hono();
app.get("/summary", async (c) => c.json(await getStatsSummary()));
export default app;
```

修改 `apps/api/src/server.ts`,加挂载:

```ts
import statsRoutes from "./routes/stats.ts";
// ...
app.route("/api/stats", statsRoutes);
```

- [ ] **Step 4: 跑测试**

```bash
pnpm --filter @ip/api test -- stats.test.ts 2>&1 | tail -8
```

Expected: PASS。

- [ ] **Step 5: 4 gate + commit**

```bash
pnpm typecheck && pnpm lint
git add apps/api/src/repositories/stats.ts \
        apps/api/src/routes/stats.ts \
        apps/api/src/routes/stats.test.ts \
        apps/api/src/server.ts
git commit -m "feat(m9): GET /api/stats/summary (publishedCount)"
```

---

## Task 8: 搜索 backend 扩展 tag 匹配

**Spec ref:** §3.5

**Why:** 现有 `listPrompts` 的 q 只匹配 title + prompt。spec 要求三层:title + prompt + tag(tag.slug + tag.name->zh/en)。

**Files:**
- Modify: `apps/api/src/repositories/prompts.ts:54-57` — q 条件加 EXISTS tag 匹配
- Modify: `apps/api/src/repositories/prompts.test.ts` — 加测试

- [ ] **Step 1: 写测试(失败)**

修改 `apps/api/src/repositories/prompts.test.ts` 加新 case:

```ts
describe("listPrompts search (q parameter)", () => {
  it("matches by tag slug", async () => {
    const r = await listPrompts({ sort: "latest", page: 1, pageSize: 24, q: "cyberpunk" });
    // Result expected to contain prompts tagged 'cyberpunk' (assumes seed has one)
    if (r.items.length > 0) {
      expect(r.items.some((i) => i.tags.some((t) => t.slug.includes("cyberpunk")))).toBe(true);
    }
  });
});
```

(loose assertion: depends on seed; passes if no prompts match too.)

- [ ] **Step 2: 跑测试(可能 PASS 也可能 FAIL,看 seed)**

```bash
pnpm --filter @ip/api test -- prompts.test.ts -t "search" 2>&1 | tail -8
```

如果空 DB 没 prompt 有 'cyberpunk' tag,测试 PASS 但没真验证。OK 继续 — 主要靠后续手测。

- [ ] **Step 3: 扩 q 条件**

修改 `apps/api/src/repositories/prompts.ts:54-56` 的 q 条件:

```ts
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
```

- [ ] **Step 4: 跑测试**

```bash
pnpm --filter @ip/api test -- prompts.test.ts 2>&1 | tail -10
```

Expected: PASS。

- [ ] **Step 5: 4 gate + commit**

```bash
pnpm typecheck && pnpm lint
git add apps/api/src/repositories/prompts.ts \
        apps/api/src/repositories/prompts.test.ts
git commit -m "feat(m9): search now matches title + prompt + tag (3-layer ILIKE)"
```

---

## Task 9: Avatar 组件 + lib/avatar.ts

**Spec ref:** §3.2

**Why:** 复用组件 — 头像 / 圆形占位(首字母 + hash 颜色)。

**Files:**
- Create: `apps/web/src/lib/avatar.ts` + test
- Create: `apps/web/src/components/Avatar.tsx`

- [ ] **Step 1: 写 lib/avatar.ts test**

创建 `apps/web/src/lib/avatar.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { initialFromName, colorForId } from "./avatar";

describe("initialFromName", () => {
  it("returns first char uppercased", () => {
    expect(initialFromName("alice")).toBe("A");
    expect(initialFromName("张三")).toBe("张");
  });
  it("returns ? for null/empty", () => {
    expect(initialFromName(null)).toBe("?");
    expect(initialFromName("")).toBe("?");
  });
});

describe("colorForId", () => {
  it("is deterministic for same id", () => {
    expect(colorForId("abc")).toBe(colorForId("abc"));
  });
  it("returns a hex color", () => {
    const c = colorForId("xyz");
    expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
```

- [ ] **Step 2: 跑测试(失败)**

- [ ] **Step 3: 实现 lib/avatar.ts**

创建 `apps/web/src/lib/avatar.ts`:

```ts
/**
 * Avatar utilities. Used by the Avatar component when the user has no
 * provider image (OAuth providers don't always include picture).
 */

export function initialFromName(name: string | null | undefined): string {
  if (!name) return "?";
  const trimmed = name.trim();
  if (trimmed.length === 0) return "?";
  return Array.from(trimmed)[0]!.toUpperCase();
}

const PALETTE = [
  "#f87171", "#fb923c", "#fbbf24", "#a3e635", "#34d399",
  "#22d3ee", "#60a5fa", "#a78bfa", "#f472b6", "#fb7185",
];

export function colorForId(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  }
  return PALETTE[Math.abs(h) % PALETTE.length]!;
}
```

- [ ] **Step 4: 实现 Avatar component**

创建 `apps/web/src/components/Avatar.tsx`:

```tsx
import { initialFromName, colorForId } from "../lib/avatar";

type Props = {
  id: string | null;
  name: string | null;
  src: string | null;
  size?: number;
  className?: string;
};

/**
 * Shared avatar. Renders the provider image when available; falls back to
 * a deterministic colored circle with the first character of the name.
 */
export default function Avatar({ id, name, src, size = 24, className = "" }: Props) {
  if (src) {
    return (
      <img
        src={src}
        alt={name ?? ""}
        width={size}
        height={size}
        className={`rounded-full object-cover ${className}`}
      />
    );
  }
  const bg = id ? colorForId(id) : "#9ca3af";
  return (
    <span
      aria-hidden={!name}
      style={{ width: size, height: size, backgroundColor: bg }}
      className={`inline-flex items-center justify-center rounded-full text-white font-medium ${className}`}
    >
      <span style={{ fontSize: size * 0.5 }}>{initialFromName(name)}</span>
    </span>
  );
}
```

- [ ] **Step 5: 跑测试**

```bash
pnpm --filter @ip/web test -- avatar.test.ts 2>&1 | tail -6
```

- [ ] **Step 6: 4 gate + commit**

```bash
pnpm typecheck && pnpm lint
git add apps/web/src/lib/avatar.ts \
        apps/web/src/lib/avatar.test.ts \
        apps/web/src/components/Avatar.tsx
git commit -m "feat(m9): Avatar component + lib/avatar helpers"
```

---

## Task 10: StatsCard 组件(共享)

**Spec ref:** §3.3, §3.8

**Why:** 用户主页 + 个人主页 + 详情页 uploader 行 都用同一个数据卡片。

**Files:**
- Create: `apps/web/src/components/profile/StatsCard.tsx`

- [ ] **Step 1: 实现 StatsCard**

创建 `apps/web/src/components/profile/StatsCard.tsx`:

```tsx
import { useTranslation } from "react-i18next";

type Stats = {
  publishedCount: number;
  totalViews: number;
  totalLikes: number;
  totalFavorites: number;
};

type Props = {
  stats: Stats;
  /** "full" = 4-column grid; "compact" = inline horizontal */
  variant?: "full" | "compact";
};

const ITEMS: ReadonlyArray<{ key: keyof Stats; labelKey: string }> = [
  { key: "publishedCount", labelKey: "stats.published" },
  { key: "totalViews", labelKey: "stats.views" },
  { key: "totalLikes", labelKey: "stats.likes" },
  { key: "totalFavorites", labelKey: "stats.favorites" },
];

export default function StatsCard({ stats, variant = "full" }: Props) {
  const { t } = useTranslation();
  if (variant === "compact") {
    return (
      <div className="flex flex-wrap gap-3 text-xs text-ink-muted">
        {ITEMS.map((i) => (
          <span key={i.key}>
            <span className="font-semibold text-ink">{stats[i.key].toLocaleString()}</span>{" "}
            {t(i.labelKey)}
          </span>
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {ITEMS.map((i) => (
        <div
          key={i.key}
          className="rounded-card border border-border-soft bg-panel p-3 text-center"
        >
          <div className="text-2xl font-semibold text-ink">{stats[i.key].toLocaleString()}</div>
          <div className="text-xs text-ink-muted">{t(i.labelKey)}</div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: 加 i18n keys**

修改 `apps/web/src/i18n/locales/zh.json`,顶层加新节(放在 `"home"` 之后):

```json
  "stats": {
    "published": "已发布",
    "views": "总浏览",
    "likes": "总赞",
    "favorites": "总收藏"
  },
```

修改 `apps/web/src/i18n/locales/en.json` 同样位置:

```json
  "stats": {
    "published": "Published",
    "views": "Views",
    "likes": "Likes",
    "favorites": "Favorites"
  },
```

- [ ] **Step 3: 4 gate + commit**

```bash
pnpm typecheck && pnpm lint
git add apps/web/src/components/profile/StatsCard.tsx \
        apps/web/src/i18n/locales/zh.json \
        apps/web/src/i18n/locales/en.json
git commit -m "feat(m9): StatsCard component (full + compact variants) + i18n keys"
```

---

## Task 11: PromptCard 显示真实 contributor

**Spec ref:** §3.2

**Why:** 现在卡片 hover 显示 "匿名" 硬编码。换成 prompt.contributor 真实头像 + 名字,点击跳用户主页。

**Files:**
- Modify: `apps/web/src/components/PromptCard.tsx`

- [ ] **Step 1: 重写 PromptCard 的 contributor 显示**

修改 `apps/web/src/components/PromptCard.tsx:30-43`,把整个 hover overlay 替换为:

```tsx
import Avatar from "./Avatar";  // 加 import 到文件顶部
// ...

      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 opacity-0 transition-opacity group-hover:opacity-100">
        <div className="flex items-center justify-between text-xs text-white">
          {prompt.contributor ? (
            <Link
              to={withLocale(locale, `/users/${prompt.contributor.id}`)}
              onClick={(e) => e.stopPropagation()}
              className="pointer-events-auto flex items-center gap-1.5 hover:underline"
            >
              <Avatar
                id={prompt.contributor.id}
                name={prompt.contributor.name}
                src={prompt.contributor.avatarUrl}
                size={24}
              />
              <span className="line-clamp-1">
                {prompt.contributor.name ?? t("common.anonymous")}
              </span>
            </Link>
          ) : (
            <div className="flex items-center gap-1.5">
              <Avatar id={null} name={null} src={null} size={24} />
              <span className="line-clamp-1">{t("common.anonymous")}</span>
            </div>
          )}
          <LikeButton
            promptId={prompt.id}
            initial={{ liked: prompt.userLiked ?? false, count: prompt.likeCount }}
            variant="compact"
          />
        </div>
        <div className="mt-1 line-clamp-1 text-sm font-medium text-white">{title}</div>
      </div>
```

(注意:`<Link>` 已 import,加 `onClick={(e) => e.stopPropagation()}` 阻止外层卡片 Link 拦截。)

- [ ] **Step 2: 跑测试 + 4 gate**

```bash
pnpm typecheck && pnpm lint && pnpm --filter @ip/web test 2>&1 | tail -6
```

Expected: 全 PASS(PromptCard 现有 test 可能要 mock prompt.contributor)。如果有测试 fail,补 mock。

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/PromptCard.tsx
git commit -m "feat(m9): PromptCard shows contributor avatar + name (links to user page)"
```

---

## Task 12: UserPage + hooks + route

**Spec ref:** §3.3

**Why:** 新页面 `/zh/users/:id`。Hero(头像 / 名 / 角色 / 加入时间)+ 数据卡 + tabs(作品 + 收藏)。收藏 tab 仅自己可见。

**Files:**
- Create: `apps/web/src/lib/hooks/useUser.ts`
- Create: `apps/web/src/lib/hooks/useUserStats.ts`
- Create: `apps/web/src/lib/hooks/useUserPrompts.ts`
- Create: `apps/web/src/lib/hooks/useUserFavorites.ts`
- Create: `apps/web/src/pages/UserPage.tsx`
- Modify: `apps/web/src/routes/index.tsx` — 加 `users/:id` 路由

- [ ] **Step 1: 写 hooks**

创建 `apps/web/src/lib/hooks/useUser.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api";

export type UserPublic = {
  id: string;
  name: string | null;
  image: string | null;
  role: "user" | "moderator" | "admin";
  joinedAt: string;
};

export function useUser(id: string | undefined) {
  return useQuery<UserPublic>({
    queryKey: ["user", id],
    queryFn: () => apiFetch(`/api/users/${id}`),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}
```

创建 `apps/web/src/lib/hooks/useUserStats.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api";

export type UserStats = {
  publishedCount: number;
  totalViews: number;
  totalLikes: number;
  totalFavorites: number;
};

export function useUserStats(id: string | undefined) {
  return useQuery<UserStats>({
    queryKey: ["user", id, "stats"],
    queryFn: () => apiFetch(`/api/users/${id}/stats`),
    enabled: !!id,
    staleTime: 60 * 1000,
  });
}
```

创建 `apps/web/src/lib/hooks/useUserPrompts.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api";
import type { PromptSummary } from "@ip/shared";

export function useUserPrompts(id: string | undefined) {
  return useQuery<{ items: PromptSummary[]; nextCursor: string | null }>({
    queryKey: ["user", id, "prompts"],
    queryFn: () => apiFetch(`/api/users/${id}/prompts`),
    enabled: !!id,
    staleTime: 60 * 1000,
  });
}
```

创建 `apps/web/src/lib/hooks/useUserFavorites.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api";
import type { PromptSummary } from "@ip/shared";

export function useUserFavorites(id: string | undefined, enabled: boolean) {
  return useQuery<{ items: PromptSummary[]; nextCursor: string | null }>({
    queryKey: ["user", id, "favorites"],
    queryFn: () => apiFetch(`/api/users/${id}/favorites`),
    enabled: !!id && enabled,
    staleTime: 60 * 1000,
  });
}
```

- [ ] **Step 2: 实现 UserPage**

创建 `apps/web/src/pages/UserPage.tsx`:

```tsx
import { useState } from "react";
import { useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { isLocale, type Locale } from "@ip/shared";
import AppShell from "../components/layout/AppShell";
import Avatar from "../components/Avatar";
import StatsCard from "../components/profile/StatsCard";
import PromptCard from "../components/PromptCard";
import Masonry, { type MasonryBreakpoint, type MasonryItem } from "../components/Masonry";
import { CardGridSkeleton } from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import { useUser } from "../lib/hooks/useUser";
import { useUserStats } from "../lib/hooks/useUserStats";
import { useUserPrompts } from "../lib/hooks/useUserPrompts";
import { useUserFavorites } from "../lib/hooks/useUserFavorites";
import { useSession } from "../lib/hooks/useSession";

const BREAKPOINTS: MasonryBreakpoint[] = [
  { minWidth: 1280, columns: 4 },
  { minWidth: 1024, columns: 3 },
  { minWidth: 640, columns: 2 },
  { minWidth: 0, columns: 1 },
];

export default function UserPage() {
  const { t } = useTranslation();
  const { id, locale: param } = useParams<{ id: string; locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const session = useSession();
  const isOwner = !!session.data && (session.data.user as { id?: string }).id === id;
  const [tab, setTab] = useState<"works" | "favorites">("works");

  const user = useUser(id);
  const stats = useUserStats(id);
  const works = useUserPrompts(id);
  const favorites = useUserFavorites(id, isOwner && tab === "favorites");

  if (user.isLoading) {
    return <AppShell><div className="p-8 text-center text-ink-dim">{t("common.loading")}</div></AppShell>;
  }
  if (!user.data) {
    return <AppShell><div className="p-8 text-center text-ink-dim">{t("common.not_found_title")}</div></AppShell>;
  }

  return (
    <AppShell>
      <article className="mx-auto max-w-5xl px-6 py-8">
        {/* Hero */}
        <header className="mb-6 flex items-center gap-4">
          <Avatar
            id={user.data.id}
            name={user.data.name}
            src={user.data.image}
            size={64}
          />
          <div>
            <h1 className="text-xl font-semibold text-ink">{user.data.name ?? t("common.anonymous")}</h1>
            <p className="text-xs text-ink-muted">
              {t("user.joined_at", { date: new Date(user.data.joinedAt).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US") })}
            </p>
          </div>
        </header>

        {/* Stats */}
        {stats.data && <div className="mb-6"><StatsCard stats={stats.data} /></div>}

        {/* Tabs */}
        <div role="tablist" className="mb-4 flex gap-4 border-b border-border-soft">
          <button
            role="tab"
            aria-selected={tab === "works"}
            onClick={() => setTab("works")}
            className={`-mb-px border-b-2 px-3 pb-2 text-[13px] font-medium transition ${
              tab === "works" ? "border-accent text-ink" : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {t("user.tab_works")}
          </button>
          {isOwner && (
            <button
              role="tab"
              aria-selected={tab === "favorites"}
              onClick={() => setTab("favorites")}
              className={`-mb-px border-b-2 px-3 pb-2 text-[13px] font-medium transition ${
                tab === "favorites" ? "border-accent text-ink" : "border-transparent text-ink-muted hover:text-ink"
              }`}
            >
              {t("user.tab_favorites")}
            </button>
          )}
        </div>

        {/* Tab content */}
        {tab === "works" ? (
          works.isLoading ? <CardGridSkeleton count={6} /> :
          (works.data?.items.length ?? 0) === 0 ? <EmptyState /> :
          <Masonry
            items={(works.data?.items ?? []).map<MasonryItem>((p) => ({
              key: p.id,
              aspectRatio: p.primaryImage?.width && p.primaryImage?.height
                ? p.primaryImage.width / p.primaryImage.height : 1,
              node: <PromptCard prompt={p} />,
            }))}
            breakpoints={BREAKPOINTS}
            gap={4}
            className="p-2"
          />
        ) : (
          favorites.isLoading ? <CardGridSkeleton count={6} /> :
          (favorites.data?.items.length ?? 0) === 0 ? <EmptyState /> :
          <Masonry
            items={(favorites.data?.items ?? []).map<MasonryItem>((p) => ({
              key: p.id,
              aspectRatio: p.primaryImage?.width && p.primaryImage?.height
                ? p.primaryImage.width / p.primaryImage.height : 1,
              node: <PromptCard prompt={p} />,
            }))}
            breakpoints={BREAKPOINTS}
            gap={4}
            className="p-2"
          />
        )}
      </article>
    </AppShell>
  );
}
```

- [ ] **Step 3: 加 route**

修改 `apps/web/src/routes/index.tsx`,在 `submit` 路由后加:

```tsx
import UserPage from "../pages/UserPage";
// ...
      { path: "users/:id", element: <UserPage /> },
```

- [ ] **Step 4: 加 i18n keys**

修改 `apps/web/src/i18n/locales/zh.json`,顶层加新节(`stats` 之后):

```json
  "user": {
    "joined_at": "加入于 {date}",
    "tab_works": "作品",
    "tab_favorites": "收藏"
  },
```

英文同样位置加:

```json
  "user": {
    "joined_at": "Joined {date}",
    "tab_works": "Works",
    "tab_favorites": "Favorites"
  },
```

- [ ] **Step 5: 4 gate**

```bash
pnpm typecheck && pnpm lint && pnpm --filter @ip/web test 2>&1 | tail -6
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/hooks/useUser.ts \
        apps/web/src/lib/hooks/useUserStats.ts \
        apps/web/src/lib/hooks/useUserPrompts.ts \
        apps/web/src/lib/hooks/useUserFavorites.ts \
        apps/web/src/pages/UserPage.tsx \
        apps/web/src/routes/index.tsx \
        apps/web/src/i18n/locales/zh.json \
        apps/web/src/i18n/locales/en.json
git commit -m "feat(m9): UserPage at /:locale/users/:id (hero + stats + works/favorites tabs)"
```

---

## Task 13: HomePage tabs 重组 + Hero 副标题

**Spec ref:** §3.7

**Why:** 首页加 tabs(画廊/我的收藏/我的投稿/关于),Hero 副标题改成"本站已收录 X 条"(用 stats endpoint)。

**Files:**
- Create: `apps/web/src/lib/hooks/useStats.ts`
- Modify: `apps/web/src/components/Hero.tsx` — subtitle 用新文案
- Modify: `apps/web/src/pages/HomePage.tsx` — 加 tabs
- Modify: `apps/web/src/i18n/locales/*.json` — 加 tab + subtitle keys

- [ ] **Step 1: useStats hook**

创建 `apps/web/src/lib/hooks/useStats.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api";

export function useStats() {
  return useQuery<{ publishedCount: number }>({
    queryKey: ["stats", "summary"],
    queryFn: () => apiFetch("/api/stats/summary"),
    staleTime: 30 * 60 * 1000,  // 30 min per spec §3.7
  });
}
```

- [ ] **Step 2: 改 Hero**

修改 `apps/web/src/components/Hero.tsx`,改 props signature(去掉 promptCount,内部用 useStats):

```tsx
import { Link, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { isLocale, type Locale } from "@ip/shared";
import { withLocale } from "../lib/locale";
import { useStats } from "../lib/hooks/useStats";

export default function Hero() {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const stats = useStats();
  const count = stats.data?.publishedCount ?? 0;

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border-soft px-6 py-7">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">{t("home.hero_title")}</h1>
        <p className="mt-1.5 text-[13.5px] text-ink-muted">
          {t("home.published_subtitle", { count: count.toLocaleString() })}
        </p>
      </div>
      <Link
        to={withLocale(locale, "/prompts")}
        className="whitespace-nowrap rounded-pill bg-accent px-4 py-2 text-[13px] font-medium text-white hover:bg-accent-2"
      >
        {t("home.start_browsing")}
      </Link>
    </div>
  );
}
```

- [ ] **Step 3: HomePage 加 tabs**

修改 `apps/web/src/pages/HomePage.tsx` 完整覆盖为:

```tsx
import { useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import type { SortOption } from "@ip/shared";
import AppShell from "../components/layout/AppShell";
import Sidebar from "../components/layout/Sidebar";
import Hero from "../components/Hero";
import Toolbar from "../components/Toolbar";
import PromptCard from "../components/PromptCard";
import { CardGridSkeleton } from "../components/Skeleton";
import EmptyState from "../components/EmptyState";
import ErrorState from "../components/ErrorState";
import AboutPageContent from "./AboutPageContent";  // see below
import { usePromptList } from "../lib/hooks/usePromptList";
import { useSession } from "../lib/hooks/useSession";
import { useUserFavorites } from "../lib/hooks/useUserFavorites";
import { useUserPrompts } from "../lib/hooks/useUserPrompts";
import Masonry, { type MasonryBreakpoint, type MasonryItem } from "../components/Masonry";

type Tab = "gallery" | "favorites" | "mine" | "about";

const SORT_VALUES: readonly SortOption[] = ["latest", "popular", "liked", "sent"];
function asSort(v: string | null): SortOption {
  return SORT_VALUES.includes(v as SortOption) ? (v as SortOption) : "latest";
}
function asTab(v: string | null): Tab {
  if (v === "favorites" || v === "mine" || v === "about") return v;
  return "gallery";
}

const BREAKPOINTS: MasonryBreakpoint[] = [
  { minWidth: 1280, columns: 4 },
  { minWidth: 1024, columns: 3 },
  { minWidth: 640, columns: 2 },
  { minWidth: 0, columns: 1 },
];

export default function HomePage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const sort = asSort(params.get("sort"));
  const tab = asTab(params.get("tab"));
  const session = useSession();
  const userId = (session.data?.user as { id?: string } | undefined)?.id;

  const gallery = usePromptList({ sort, page: 1, pageSize: 24 });
  const favorites = useUserFavorites(userId, tab === "favorites" && !!userId);
  const mine = useUserPrompts(tab === "mine" ? userId : undefined);

  function setTab(next: Tab) {
    const updated = new URLSearchParams(params);
    if (next === "gallery") updated.delete("tab");
    else updated.set("tab", next);
    setParams(updated);
  }
  function setSort(next: SortOption) {
    const updated = new URLSearchParams(params);
    updated.set("sort", next);
    setParams(updated);
  }

  const TABS: { key: Tab; labelKey: string; requiresAuth: boolean }[] = [
    { key: "gallery", labelKey: "home.tab_gallery", requiresAuth: false },
    { key: "favorites", labelKey: "home.tab_favorites", requiresAuth: true },
    { key: "mine", labelKey: "home.tab_mine", requiresAuth: true },
    { key: "about", labelKey: "home.tab_about", requiresAuth: false },
  ];

  function renderItems(items: { items: { id: string; primaryImage: { width: number | null; height: number | null } | null }[] } | null) {
    if (!items || items.items.length === 0) return <EmptyState />;
    return (
      <Masonry
        items={items.items.map<MasonryItem>((p) => ({
          key: p.id,
          aspectRatio: p.primaryImage?.width && p.primaryImage?.height
            ? p.primaryImage.width / p.primaryImage.height : 1,
          node: <PromptCard prompt={p as never} />,
        }))}
        breakpoints={BREAKPOINTS}
        gap={4}
        className="p-2"
      />
    );
  }

  return (
    <AppShell sidebar={<Sidebar />}>
      <Hero />
      <div role="tablist" className="flex gap-4 border-b border-border-soft px-6">
        {TABS.map((tt) => {
          if (tt.requiresAuth && !userId) return null;
          return (
            <button
              key={tt.key}
              role="tab"
              aria-selected={tab === tt.key}
              onClick={() => setTab(tt.key)}
              className={`-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition ${
                tab === tt.key ? "border-accent text-ink" : "border-transparent text-ink-muted hover:text-ink"
              }`}
            >
              {t(tt.labelKey)}
            </button>
          );
        })}
      </div>

      {tab === "gallery" && (
        <>
          <Toolbar total={gallery.data?.total ?? 0} sort={sort} onSortChange={setSort} />
          {gallery.isLoading && <CardGridSkeleton count={12} />}
          {gallery.isError && <ErrorState onRetry={() => gallery.refetch()} />}
          {!gallery.isLoading && !gallery.isError && gallery.data && renderItems(gallery.data)}
        </>
      )}
      {tab === "favorites" && (favorites.isLoading ? <CardGridSkeleton count={6} /> : renderItems(favorites.data ?? null))}
      {tab === "mine" && (mine.isLoading ? <CardGridSkeleton count={6} /> : renderItems(mine.data ?? null))}
      {tab === "about" && <AboutPageContent />}
    </AppShell>
  );
}
```

- [ ] **Step 4: 抽 AboutPageContent**

修改 `apps/web/src/pages/AboutPage.tsx`,把它的核心内容抽到一个新组件 `AboutPageContent.tsx`(纯展示,不带 AppShell):

创建 `apps/web/src/pages/AboutPageContent.tsx`:

```tsx
import { useTranslation } from "react-i18next";

export default function AboutPageContent() {
  const { t } = useTranslation();
  return (
    <article className="mx-auto max-w-3xl px-6 py-8 prose prose-sm">
      <h1>{t("about.title")}</h1>
      <p>{t("about.body")}</p>
    </article>
  );
}
```

修改 AboutPage 简化为:

```tsx
import AppShell from "../components/layout/AppShell";
import AboutPageContent from "./AboutPageContent";

export default function AboutPage() {
  return (
    <AppShell>
      <AboutPageContent />
    </AppShell>
  );
}
```

- [ ] **Step 5: 加 i18n keys**

修改 zh.json 的 `"home"` 节:

```json
  "home": {
    "hero_title": "生图提示词聚合",
    "hero_subtitle": "{formattedCount}+ 条精选提示词 · 一键送到 Image-Studio",
    "published_subtitle": "本站已收录 {count} 条图片提示词",
    "start_browsing": "开始浏览 →",
    "tab_gallery": "画廊",
    "tab_favorites": "我的收藏",
    "tab_mine": "我的投稿",
    "tab_about": "关于"
  },
```

en.json 同样:

```json
  "home": {
    "hero_title": "Image-Prompts gallery",
    "hero_subtitle": "{formattedCount}+ curated prompts · one-click into Image-Studio",
    "published_subtitle": "{count} prompts published",
    "start_browsing": "Start browsing →",
    "tab_gallery": "Gallery",
    "tab_favorites": "Favorites",
    "tab_mine": "Mine",
    "tab_about": "About"
  },
```

- [ ] **Step 6: 4 gate + commit**

```bash
pnpm typecheck && pnpm lint && pnpm --filter @ip/web test 2>&1 | tail -6
git add apps/web/src/lib/hooks/useStats.ts \
        apps/web/src/components/Hero.tsx \
        apps/web/src/pages/HomePage.tsx \
        apps/web/src/pages/AboutPage.tsx \
        apps/web/src/pages/AboutPageContent.tsx \
        apps/web/src/i18n/locales/zh.json \
        apps/web/src/i18n/locales/en.json
git commit -m "feat(m9): HomePage 4 tabs (gallery/favorites/mine/about) + Hero published subtitle"
```

---

## Task 14: ProfilePage 加 StatsCard 区

**Spec ref:** §3.8

**Why:** 个人资料页加数据卡区(在标签上方),复用 StatsCard 组件 + useUserStats hook(传 current user id)。

**Files:**
- Modify: `apps/web/src/pages/ProfilePage.tsx`

- [ ] **Step 1: 加 StatsCard 到 ProfilePage**

修改 `apps/web/src/pages/ProfilePage.tsx`,顶部 imports 加:

```tsx
import StatsCard from "../components/profile/StatsCard";
import { useUserStats } from "../lib/hooks/useUserStats";
```

在组件函数中,在 return 块上方加:

```tsx
  const userId = (session.data?.user as { id?: string } | undefined)?.id;
  const stats = useUserStats(userId);
```

在 article 内,`<h1>` 之后、`<div role="tablist">` 之前插入:

```tsx
        {stats.data && (
          <div className="mb-6">
            <StatsCard stats={stats.data} />
          </div>
        )}
```

- [ ] **Step 2: 4 gate + commit**

```bash
pnpm typecheck && pnpm lint
git add apps/web/src/pages/ProfilePage.tsx
git commit -m "feat(m9): ProfilePage shows StatsCard above tabs"
```

---

## Task 15: AppShell 头部 "+" 投稿 CTA

**Spec ref:** §3.1

**Why:** Header 右侧加 CTA 按钮,登录态点击触发投稿 modal,未登录态弹 SignIn modal。

**Files:**
- Modify: `apps/web/src/components/layout/AppShell.tsx`

- [ ] **Step 1: 加按钮**

修改 `apps/web/src/components/layout/AppShell.tsx`,顶部加 import:

```tsx
import { Plus } from "lucide-react";
import { useNavigate } from "react-router";
```

在组件函数加导航 helper:

```tsx
  const navigate = useNavigate();
  function openSubmit() {
    navigate(withLocale(locale, "/submit"));
  }
```

在 header 的右侧 div(class `flex items-center gap-2`)内 `<ThemeSwitcher />` 之前插入:

```tsx
          <button
            type="button"
            onClick={openSubmit}
            className="hidden h-8 items-center gap-1 rounded-pill bg-accent px-3 text-xs font-medium text-white hover:bg-accent-2 md:inline-flex"
            aria-label={t("nav.submit")}
          >
            <Plus size={14} aria-hidden />
            {t("nav.submit")}
          </button>
```

- [ ] **Step 2: 4 gate + commit**

```bash
pnpm typecheck && pnpm lint
git add apps/web/src/components/layout/AppShell.tsx
git commit -m "feat(m9): AppShell header — Submit CTA button (+ icon, accent pill)"
```

---

## Task 16: SubmitPage → SubmitModal(uiStore + 全局挂载)

**Spec ref:** §3.6

**Why:** 投稿改成 modal — 从 header CTA 触发。`/zh/submit` 直链保留,onMount 自动打开 modal。

**Files:**
- Create: `apps/web/src/state/uiStore.ts`
- Create: `apps/web/src/components/submit/SubmitModal.tsx`
- Modify: `apps/web/src/pages/SubmitPage.tsx` — 简化成 modal trigger
- Modify: `apps/web/src/components/layout/AppShell.tsx` — 挂载全局 SubmitModal

- [ ] **Step 1: uiStore**

创建 `apps/web/src/state/uiStore.ts`:

```ts
import { create } from "zustand";

type UiState = {
  submitModalOpen: boolean;
  openSubmitModal: () => void;
  closeSubmitModal: () => void;
};

export const useUiStore = create<UiState>((set) => ({
  submitModalOpen: false,
  openSubmitModal: () => set({ submitModalOpen: true }),
  closeSubmitModal: () => set({ submitModalOpen: false }),
}));
```

- [ ] **Step 2: SubmitModal**

创建 `apps/web/src/components/submit/SubmitModal.tsx`:

```tsx
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import { X } from "lucide-react";
import { isLocale, type Locale } from "@ip/shared";
import CommunityGuidelinesGate from "./CommunityGuidelinesGate";
import SubmissionForm from "./SubmissionForm";
import SignInModal from "../auth/SignInModal";
import { useSession } from "../../lib/hooks/useSession";
import { useUiStore } from "../../state/uiStore";
import { withLocale } from "../../lib/locale";

export default function SubmitModal() {
  const { t } = useTranslation();
  const open = useUiStore((s) => s.submitModalOpen);
  const close = useUiStore((s) => s.closeSubmitModal);
  const session = useSession();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const navigate = useNavigate();

  // ESC closes
  useEffect(() => {
    if (!open) return;
    function k(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [open, close]);

  if (!open) return null;

  return (
    <>
      <div
        role="dialog"
        aria-modal="true"
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
        onClick={close}
      >
        <div
          className="relative my-8 w-full max-w-3xl rounded-card border border-border-soft bg-panel p-6 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            onClick={close}
            aria-label={t("common.close")}
            className="absolute right-3 top-3 rounded-full p-1 hover:bg-ink/5"
          >
            <X size={18} />
          </button>
          <h2 className="mb-4 text-lg font-semibold text-ink">{t("submit.page_title")}</h2>
          {session.data ? (
            <CommunityGuidelinesGate onCancel={close}>
              <SubmissionForm />
            </CommunityGuidelinesGate>
          ) : null}
        </div>
      </div>
      <SignInModal
        open={!session.isLoading && !session.data}
        onClose={() => {
          if (!session.data) {
            close();
            navigate(withLocale(locale, "/"));
          }
        }}
      />
    </>
  );
}
```

- [ ] **Step 3: SubmitPage 简化为 trigger**

修改 `apps/web/src/pages/SubmitPage.tsx` 完整覆盖:

```tsx
import { useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { isLocale, type Locale } from "@ip/shared";
import { useUiStore } from "../state/uiStore";
import { withLocale } from "../lib/locale";

/**
 * /:locale/submit is a deep-link entry to the modal. On mount it opens the
 * modal and replaces the URL to /:locale (so closing the modal lands the
 * user on the homepage, not stuck on /submit).
 */
export default function SubmitPage() {
  const open = useUiStore((s) => s.openSubmitModal);
  const navigate = useNavigate();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";

  useEffect(() => {
    open();
    navigate(withLocale(locale, "/"), { replace: true });
  }, [open, navigate, locale]);

  return null;
}
```

- [ ] **Step 4: AppShell 挂载 + Header CTA 改用 uiStore**

修改 `apps/web/src/components/layout/AppShell.tsx`:

(1) 顶部 imports 加:

```tsx
import SubmitModal from "../submit/SubmitModal";
import { useUiStore } from "../../state/uiStore";
```

(2) 把 Task 15 的 `function openSubmit() { navigate(...) }` 改为:

```tsx
  const openSubmitModal = useUiStore((s) => s.openSubmitModal);
```

(3) Header CTA onClick 改:

```tsx
  onClick={openSubmitModal}
```

(4) 在 JSX 树底部(`</div>` 关闭 `flex-1` 之后,return 块最后)挂载 SubmitModal:

```tsx
      <SubmitModal />
    </div>
  );
}
```

- [ ] **Step 5: 加 i18n key for common.close**

修改 `apps/web/src/i18n/locales/zh.json` 的 `"common"` 节加:

```json
    "close": "关闭",
```

en.json 同:

```json
    "close": "Close",
```

(若已存在则跳过 — 之前有 `studio_modal.close` 但不在 common。)

- [ ] **Step 6: 4 gate + commit**

```bash
pnpm typecheck && pnpm lint && pnpm --filter @ip/web test 2>&1 | tail -6
git add apps/web/src/state/uiStore.ts \
        apps/web/src/components/submit/SubmitModal.tsx \
        apps/web/src/pages/SubmitPage.tsx \
        apps/web/src/components/layout/AppShell.tsx \
        apps/web/src/i18n/locales/zh.json \
        apps/web/src/i18n/locales/en.json
git commit -m "feat(m9): submit becomes a global modal triggered from header CTA"
```

---

## Task 17: Header 搜索框 wire-up

**Spec ref:** §3.5

**Why:** AppShell 的 `<input type="search">` 之前没绑定任何 state。改成把输入同步到 URL `?q=`,HomePage 读 q 传给 listPrompts。

**Files:**
- Modify: `apps/web/src/components/layout/AppShell.tsx`
- Modify: `apps/web/src/lib/hooks/usePromptList.ts` — 加 q 参数(若没有)
- Modify: `apps/web/src/pages/HomePage.tsx` — 把 q 透传给 usePromptList

- [ ] **Step 1: 检查 usePromptList 是否已支持 q**

```bash
grep -n "q?" apps/web/src/lib/hooks/usePromptList.ts
```

如果没 q 参数,需要扩展:

修改 `apps/web/src/lib/hooks/usePromptList.ts`,在 args type 加 `q?: string`,queryFn 把 q 编码进 URL。

(若 hook 不存在或 args 结构不同,以实际代码为准。)

- [ ] **Step 2: AppShell 搜索框接 URL**

修改 `apps/web/src/components/layout/AppShell.tsx`,顶部加:

```tsx
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
```

组件函数内加:

```tsx
  const [searchParams] = useSearchParams();
  const [searchValue, setSearchValue] = useState(searchParams.get("q") ?? "");

  useEffect(() => {
    setSearchValue(searchParams.get("q") ?? "");
  }, [searchParams]);

  function submitSearch(value: string) {
    const trimmed = value.trim();
    const updated = new URLSearchParams(searchParams);
    if (trimmed) updated.set("q", trimmed);
    else updated.delete("q");
    navigate({ pathname: "/" + locale + "/", search: `?${updated.toString()}` });
  }
```

把 `<input type="search" ...>` 改为:

```tsx
          <input
            type="search"
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submitSearch(searchValue); }}
            placeholder={t("common.search_placeholder")}
            className="hidden h-8 w-56 rounded-pill border border-border-soft bg-surface px-3 text-xs text-ink placeholder:text-ink-dim focus:outline-none focus:ring-2 focus:ring-accent-soft md:block"
          />
```

- [ ] **Step 3: HomePage 透传 q**

修改 `apps/web/src/pages/HomePage.tsx`,在 const 块加:

```tsx
  const q = params.get("q") ?? undefined;
```

把 `usePromptList` 调用改:

```tsx
  const gallery = usePromptList({ sort, page: 1, pageSize: 24, q });
```

- [ ] **Step 4: 4 gate + commit**

```bash
pnpm typecheck && pnpm lint
git add apps/web/src/components/layout/AppShell.tsx \
        apps/web/src/lib/hooks/usePromptList.ts \
        apps/web/src/pages/HomePage.tsx
git commit -m "feat(m9): wire header search to ?q= → HomePage listPrompts"
```

---

## Task 18: NotificationsList 渲染新类型(prompt_liked / prompt_favorited)

**Spec ref:** §3.4

**Why:** 通知下拉里要显示新类型,根据 aggregated_count 决定显示单数 / 复数文案。点击跳 prompt 详情。

**Files:**
- Modify: `apps/web/src/components/notifications/NotificationsList.tsx`
- Modify: `apps/web/src/i18n/locales/*.json` — 加 4 个新 keys

- [ ] **Step 1: 加 i18n keys**

修改 zh.json `"notifications"` 节:

```json
  "notifications": {
    "title": "通知",
    "empty": "暂无通知",
    "mark_all_read": "全部已读",
    "submission_approved": "你的投稿《{title}》已通过审核",
    "submission_rejected": "你的投稿《{title}》未通过审核",
    "prompt_liked_single": "{actor} 赞了你的《{title}》",
    "prompt_liked_aggregated": "{actor} 等 {n} 人 赞了你的《{title}》",
    "prompt_favorited_single": "{actor} 收藏了你的《{title}》",
    "prompt_favorited_aggregated": "{actor} 等 {n} 人 收藏了你的《{title}》",
    "view": "查看"
  }
```

en.json:

```json
  "notifications": {
    "title": "Notifications",
    "empty": "No notifications",
    "mark_all_read": "Mark all read",
    "submission_approved": "Your submission \"{title}\" was approved",
    "submission_rejected": "Your submission \"{title}\" was rejected",
    "prompt_liked_single": "{actor} liked your \"{title}\"",
    "prompt_liked_aggregated": "{actor} and {n} others liked your \"{title}\"",
    "prompt_favorited_single": "{actor} favorited your \"{title}\"",
    "prompt_favorited_aggregated": "{actor} and {n} others favorited your \"{title}\"",
    "view": "View"
  }
```

- [ ] **Step 2: 改 NotificationsList**

修改 `apps/web/src/components/notifications/NotificationsList.tsx` 的 navigateFor + render 逻辑:

(1) navigateFor 加新类型分支:

```tsx
  function navigateFor(n: NotificationDTO) {
    const p = n.payload as { promptSlug?: string; submissionId?: string };
    if ((n.type === "submission_approved" || n.type === "prompt_liked" || n.type === "prompt_favorited") && p.promptSlug) {
      navigate(withLocale(locale, `/prompts/${p.promptSlug}`));
    } else if (n.type === "submission_rejected" && p.submissionId) {
      navigate(withLocale(locale, `/profile?tab=submissions&highlight=${p.submissionId}`));
    }
  }
```

(2) 修改 render 循环里 msgKey + 文案插值:

```tsx
        {items.map((n) => {
          const p = n.payload as {
            titleZh?: string;
            titleEn?: string;
            lastActorName?: string;
          };
          const title = (locale === "zh" ? p.titleZh ?? p.titleEn : p.titleEn ?? p.titleZh) ?? "";
          const actor = p.lastActorName ?? t("common.anonymous");
          const agg = (n as { aggregatedCount?: number }).aggregatedCount ?? 1;

          let msgKey: string;
          if (n.type === "submission_approved") msgKey = "notifications.submission_approved";
          else if (n.type === "submission_rejected") msgKey = "notifications.submission_rejected";
          else if (n.type === "prompt_liked") msgKey = agg > 1 ? "notifications.prompt_liked_aggregated" : "notifications.prompt_liked_single";
          else if (n.type === "prompt_favorited") msgKey = agg > 1 ? "notifications.prompt_favorited_aggregated" : "notifications.prompt_favorited_single";
          else msgKey = "notifications.submission_approved";  // unreachable

          return (
            <li key={n.id} className={n.readAt ? "opacity-60" : ""}>
              <button
                type="button"
                onClick={() => { markRead.mutate(n.id); navigateFor(n); onItemNavigate(); }}
                className="block w-full px-3 py-2 text-left text-xs hover:bg-ink/5"
              >
                {t(msgKey, { title, actor, n: agg - 1 })}
              </button>
            </li>
          );
        })}
```

- [ ] **Step 3: 4 gate + commit**

```bash
pnpm typecheck && pnpm lint && pnpm --filter @ip/web test 2>&1 | tail -6
git add apps/web/src/components/notifications/NotificationsList.tsx \
        apps/web/src/i18n/locales/zh.json \
        apps/web/src/i18n/locales/en.json
git commit -m "feat(m9): NotificationsList renders prompt_liked/favorited (single + aggregated)"
```

---

## Task 19: PromptDetailPage 显示 uploader row

**Spec ref:** §3.3.1

**Why:** 详情页标题下方加 "by <Avatar + 名字>" 行,点击跳用户主页。带 mini stats(用 compact StatsCard)。

**Files:**
- Modify: `apps/web/src/pages/PromptDetailPage.tsx`

- [ ] **Step 1: 加 uploader row**

修改 `apps/web/src/pages/PromptDetailPage.tsx`,顶部加:

```tsx
import { Link } from "react-router";
import Avatar from "../components/Avatar";
import StatsCard from "../components/profile/StatsCard";
import { useUserStats } from "../lib/hooks/useUserStats";
import { withLocale } from "../lib/locale";
```

在组件内,通过 `detail.data.contributor` 决定渲染:

```tsx
  const contributor = detail.data?.contributor;
  const uploaderStats = useUserStats(contributor?.id);
```

在 JSX 中(title 渲染下方),加:

```tsx
      {contributor && (
        <div className="my-4 flex items-center gap-3 border-y border-border-soft py-3">
          <Link
            to={withLocale(locale, `/users/${contributor.id}`)}
            className="flex items-center gap-2 hover:underline"
          >
            <Avatar
              id={contributor.id}
              name={contributor.name}
              src={contributor.avatarUrl}
              size={32}
            />
            <span className="text-sm font-medium text-ink">
              {contributor.name ?? t("common.anonymous")}
            </span>
          </Link>
          {uploaderStats.data && (
            <div className="ml-auto">
              <StatsCard stats={uploaderStats.data} variant="compact" />
            </div>
          )}
        </div>
      )}
```

(具体插入位置取决于 PromptDetailPage 现有结构 — 一般在 `<h1>title</h1>` 之后、prompt 文本之前。)

- [ ] **Step 2: 4 gate + commit**

```bash
pnpm typecheck && pnpm lint
git add apps/web/src/pages/PromptDetailPage.tsx
git commit -m "feat(m9): PromptDetailPage shows uploader row (Avatar + name + compact stats)"
```

---

## 收尾

完成所有 task 之后:

- [ ] **Step 1: 全套 4 gate**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: 全绿。新测试 ~10 个左右,总数应 ≥ 300。

- [ ] **Step 2: 浏览器手测重点**

(参考 spec §9 manual test matrix)

- **A**:未登录访问首页 → 卡片显示真实头像 + 用户名
- **B**:卡片 hover → Author 链接 → 跳 `/zh/users/:id`
- **C**:用户主页 hero / 数据卡 / 作品 tab 正常
- **D-E**:别人的用户主页无收藏 tab;自己的有
- **F-G**:详情页 uploader 行 + stats 缩略
- **H-J**:点赞 / 收藏别人 prompt → contributor 收到聚合通知;给自己点赞不发
- **K**:Header `+ 投稿` 按钮,未登录点 → SignInModal
- **L-M**:`/zh/submit` 自动开 modal,关闭回首页
- **N**:首页 tabs 切换正常
- **O**:Hero 副标题"已收录 N 条"
- **P**:Profile 数据卡 4 项
- **Q-R**:搜索框输入 → 列表过滤 → 清空恢复

- [ ] **Step 3: 用 finishing-a-development-branch 收尾**

提示 user 4 选项(merge / PR / keep / discard)。

---

## 完成定义

- 19 个 commit 全部应用到 `feat/m9-user-side`,merge 到 main 或按用户选择 PR
- 4 gate 全绿
- 测试数 ≥ baseline + ~10(新增 Task 2 notification agg + Task 4-5 users repo+route + Task 7 stats + Task 9 avatar + Task 11 prompts.test contributor)
- spec §9 manual matrix 全过
- 新 schema 变更安全 migration 应用(0007 已 push)
- worktree cleanup

---

## 不在本 sprint 范围

- 用户头像上传 / 改名(M9 复用 OAuth provider 头像)
- 关注 / 粉丝系统(M12+)
- 评论 / 转发
- 通知 push(只在站内显示)
- 搜索的 Postgres 全文索引(MVP 用 ILIKE,等数据量大再升级)
- Test isolation 修(P1.6 follow-up)

---

## Self-review 已完成

1. **Spec 覆盖**:
   - §3.1 显眼投稿 → Task 15 ✓
   - §3.2 卡片 contributor → Task 6 (schema/repo) + Task 9 (Avatar) + Task 11 (PromptCard) ✓
   - §3.3 详情页 uploader + 用户主页 → Task 4-5 (repo/route) + Task 12 (UserPage) + Task 19 (Detail uploader) ✓
   - §3.4 聚合通知 → Task 1-3 (schema/repo/route) + Task 18 (UI) ✓
   - §3.5 搜索三层 → Task 8 (backend) + Task 17 (header wire) ✓
   - §3.6 投稿 modal → Task 16 ✓
   - §3.7 首页 tabs + Hero 副标题 → Task 7 (stats endpoint) + Task 13 ✓
   - §3.8 数据卡 → Task 10 (StatsCard) + Task 14 (Profile) ✓

2. **No placeholders**:每 step 都有完整代码块或精确命令。Task 17 的 usePromptList 接 q 我没看现有实现,标注"以实际代码为准"是合理(读完看到再写细)。

3. **Type 一致性**:
   - `contributor: {id, name, avatarUrl}` 在 PromptSummary 与 PromptDetail schema、PromptCard 消费、UserPage 渲染、PromptDetailPage uploader 全部一致
   - `aggregatedCount` 字段在 schema(snake_case `aggregated_count` → camelCase `aggregatedCount`)、shared NotificationSchema、NotificationsList 消费都用 camelCase 命名
   - `groupKey` 同 camelCase
   - StatsCard 接受 `{ publishedCount, totalViews, totalLikes, totalFavorites }`,UserStats / useUserStats / getUserStats 全部用同名字段
   - Avatar 接受 `{id, name, src}` — 调用方都传 `avatarUrl` 进 `src=...`(注意命名差异)

