# Sprint 3a / M10a — `/rosekhlifa` Owner Console 基础设施 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为项目所有者搭好 `/rosekhlifa` 站长后台的骨架:OWNER_EMAILS 白名单 + `requireOwner` 中间件 + site_settings repo + submit-config 改成 DB-backed cache + 概览 dashboard + 配置页 + R2 池只读视图 + 审核队列入口。只读路径优先,所有写操作(R2 CRUD / 用户 ban / 公告 / 翻译端到端)留给 M10b。

**Architecture:** 复用现有 admin role + 新加 OWNER_EMAILS env(B 方案),session.user 暴露 `isOwner: boolean` 派生字段。`/api/owner/**` 路由用 `requireOwner = compose(requireRole('admin'), requireOwnerEmail())`。`site_settings` 表 M0 已建,本 sprint 只新增 repo + endpoints + seed keys。`submit-config.ts` 从硬编码常量改成异步 `getSubmitConfig()`(60 秒内存缓存)。前端用独立深色主题(`bg-zinc-950` + `emerald-500` accent,不复用 Apple HIG),挂在 `/:locale/rosekhlifa/*` 路由树下,owner 不通过的渲染 403 占位页。

**Tech Stack:** TypeScript / Hono / Drizzle ORM / Postgres / React 18 + Vite / TanStack Query 5 / Vitest / React Testing Library / lucide-react / react-i18next / Tailwind CSS。

---

## Pre-Task Setup (controller dispatches before Task 1)

**Baseline:** main @ `72e30e6`(M10 spec 决策已 commit)。

**Worktree:** `.worktrees/m10a-owner-infra` on `feat/m10a-owner-infra`。

```bash
git worktree add .worktrees/m10a-owner-infra -b feat/m10a-owner-infra
cd .worktrees/m10a-owner-infra
cp ../../apps/api/.env apps/api/.env
pnpm install
pnpm test
# Expected: 319+ passing (M9 完成后 baseline)
```

如果 baseline 不绿 STOP 报告。

**关键约束**:
- 路由保护**复用 admin role + OWNER_EMAILS**,不动 enum,零 migration
- 翻译 keys(`translator.*`)只 seed 占位,**端到端不在 M10a**
- R2 池**只读**,新增 / 编辑 / 软删 / sync 全部留 M10b
- 用户管理 / Ban / Audit viewer / Announcements 全部留 M10b

---

## Task 1: OWNER_EMAILS env + session callback 暴露 isOwner

**Spec ref:** §3 路由保护 / §4 视觉

**Why:** Owner 是单人场景,用 email 白名单 + admin role 复合判断,session callback 把派生的 `isOwner` 注入 session.user,前端无需再读 env。

**Files:**
- Modify: `apps/api/src/env.ts` — 加 OWNER_EMAILS env
- Modify: `apps/api/src/auth/index.ts` — 加 isOwnerEmail() + session callback 注入
- Modify: `apps/api/.env` 和 `.env.example`(添加占位)
- Modify: `apps/api/src/auth/index.test.ts`(若已有)或新建,断言 owner email 触发 isOwner=true
- Modify: `apps/web/src/lib/hooks/useSession.ts` — Session.user 类型加 `isOwner?: boolean`

- [ ] **Step 1: env schema 加 OWNER_EMAILS**

修改 `apps/api/src/env.ts`,找到 zod schema(ADMIN_EMAILS 旁边),加:

```ts
// Add inside the z.object({ ... }) for env validation
OWNER_EMAILS: z.string().optional().default(""),
```

- [ ] **Step 2: 加 .env 占位 + .env.example**

修改 `apps/api/.env`(本地)和 `apps/api/.env.example`,在 ADMIN_EMAILS 下面加一行:

```
# Comma-separated list of project-owner emails. Owners have full /rosekhlifa
# access. Must ALSO be in ADMIN_EMAILS to take effect (B-scheme — owner is
# strictly a subset of admin).
OWNER_EMAILS=2221542777@qq.com
```

(本地 .env 可直接填你自己的邮箱;.env.example 填占位字符串。)

- [ ] **Step 3: 写 isOwnerEmail() 帮手 + session callback 注入**

修改 `apps/api/src/auth/index.ts`,在 `promoteIfAdminEmail` 函数下方加:

```ts
/**
 * True iff the email matches OWNER_EMAILS (case-insensitive). Pure read of
 * env at call time — no DB roundtrip. Empty env = no owners.
 */
export function isOwnerEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const raw = process.env.OWNER_EMAILS ?? "";
  const list = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (list.length === 0) return false;
  return list.includes(email.toLowerCase());
}
```

然后在同文件的 `callbacks.session` 内,**在已有的 role 处理之后**(`(session.user as { role?: string }).role = role;` 之后),加:

```ts
        // ★ M10a: expose owner flag derived from OWNER_EMAILS env. We don't
        // ship env to the client — the session is the single source of truth.
        // Owner is a strict subset of admin (B-scheme).
        (session.user as { isOwner?: boolean }).isOwner =
          isOwnerEmail(user.email) && role === "admin";
```

- [ ] **Step 4: 加测试**

创建或扩展 `apps/api/src/auth/index.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isOwnerEmail } from "./index.ts";

describe("isOwnerEmail", () => {
  const origEnv = process.env.OWNER_EMAILS;
  afterEach(() => {
    process.env.OWNER_EMAILS = origEnv;
  });

  it("returns false for null/undefined/empty email", () => {
    process.env.OWNER_EMAILS = "x@y.com";
    expect(isOwnerEmail(null)).toBe(false);
    expect(isOwnerEmail(undefined)).toBe(false);
    expect(isOwnerEmail("")).toBe(false);
  });

  it("returns false when OWNER_EMAILS env is empty", () => {
    process.env.OWNER_EMAILS = "";
    expect(isOwnerEmail("foo@bar.com")).toBe(false);
  });

  it("matches case-insensitively", () => {
    process.env.OWNER_EMAILS = "FOO@bar.com";
    expect(isOwnerEmail("foo@BAR.com")).toBe(true);
  });

  it("handles multiple comma-separated emails", () => {
    process.env.OWNER_EMAILS = "alice@a.com, bob@b.com , carol@c.com";
    expect(isOwnerEmail("bob@b.com")).toBe(true);
    expect(isOwnerEmail("carol@c.com")).toBe(true);
    expect(isOwnerEmail("dan@d.com")).toBe(false);
  });
});
```

- [ ] **Step 5: 更新前端 Session 类型**

修改 `apps/web/src/lib/hooks/useSession.ts` 的 `Session` 类型:

```ts
export type Session = {
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
    role: "user" | "moderator" | "admin";
    communityGuidelinesVersion?: number;
    /**
     * ★ M10a: derived in API session callback from OWNER_EMAILS env. True iff
     * user is admin AND their email matches the env whitelist. UI uses this
     * to decide whether to show /rosekhlifa nav entry and 403-guard pages.
     */
    isOwner?: boolean;
  };
  expires: string;
};
```

- [ ] **Step 6: 4 gate + commit**

```bash
pnpm --filter @ip/api test -- auth/index
pnpm typecheck && pnpm lint
git add apps/api/src/env.ts apps/api/src/auth/index.ts apps/api/src/auth/index.test.ts apps/api/.env.example apps/web/src/lib/hooks/useSession.ts
git commit -m "feat(m10a): OWNER_EMAILS env + isOwner derived in session callback"
```

(本地 `apps/api/.env` 是 gitignored,你已经手动加了 OWNER_EMAILS,不需要 commit。)

---

## Task 2: requireOwner 中间件 + 测试

**Spec ref:** §3 路由保护

**Why:** 单独的中间件让 /api/owner/** 路由声明意图清晰,403 错误消息可识别。复用 admin role check + email whitelist 检查,两步任一 fail 都 throw 403。

**Files:**
- Create: `apps/api/src/middleware/owner.ts`
- Create: `apps/api/src/middleware/owner.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/api/src/middleware/owner.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { requireOwner } from "./owner.ts";

function buildApp(authUser: unknown) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("authUser", authUser);
    await next();
  });
  app.use("*", requireOwner());
  app.get("/", (c) => c.json({ ok: true }));
  return app;
}

describe("requireOwner middleware", () => {
  const origEnv = process.env.OWNER_EMAILS;
  beforeEach(() => {
    process.env.OWNER_EMAILS = "owner@example.com";
  });
  afterEach(() => {
    process.env.OWNER_EMAILS = origEnv;
  });

  it("403 when no session", async () => {
    const app = buildApp(null);
    const res = await app.request("/");
    expect(res.status).toBe(403);
  });

  it("403 when role is user", async () => {
    const app = buildApp({
      session: { user: { role: "user", email: "owner@example.com" } },
    });
    const res = await app.request("/");
    expect(res.status).toBe(403);
  });

  it("403 when role is moderator", async () => {
    const app = buildApp({
      session: { user: { role: "moderator", email: "owner@example.com" } },
    });
    const res = await app.request("/");
    expect(res.status).toBe(403);
  });

  it("403 when role is admin but email not in OWNER_EMAILS", async () => {
    const app = buildApp({
      session: { user: { role: "admin", email: "notowner@example.com" } },
    });
    const res = await app.request("/");
    expect(res.status).toBe(403);
  });

  it("200 when role is admin and email in OWNER_EMAILS", async () => {
    const app = buildApp({
      session: { user: { role: "admin", email: "owner@example.com" } },
    });
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("matches email case-insensitively", async () => {
    const app = buildApp({
      session: { user: { role: "admin", email: "OWNER@example.com" } },
    });
    const res = await app.request("/");
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

```bash
pnpm --filter @ip/api test -- middleware/owner
```

Expected: 模块找不到 "./owner.ts" 报错。

- [ ] **Step 3: 实现 requireOwner**

创建 `apps/api/src/middleware/owner.ts`:

```ts
import { HTTPException } from "hono/http-exception";
import type { MiddlewareHandler } from "hono";
import { isOwnerEmail } from "../auth/index.ts";

/**
 * Gate the handler to project owners only. Composed predicate:
 *   1. session.user.role === 'admin'
 *   2. session.user.email is in OWNER_EMAILS env (case-insensitive)
 *
 * Both must pass. Either failure → 403 (we don't distinguish to avoid
 * leaking which check failed). Must run AFTER softAuth() / authConfig
 * populates c.var.authUser.
 *
 * B-scheme: there is no 'owner' role enum value. Owner is admin + email.
 */
export function requireOwner(): MiddlewareHandler {
  return async (c, next) => {
    const authUser = c.get("authUser") as
      | { session?: { user?: { role?: string; email?: string | null } } }
      | null
      | undefined;
    const role = authUser?.session?.user?.role;
    const email = authUser?.session?.user?.email;
    if (role !== "admin" || !isOwnerEmail(email)) {
      throw new HTTPException(403, { message: "forbidden" });
    }
    await next();
  };
}
```

- [ ] **Step 4: 跑测试通过**

```bash
pnpm --filter @ip/api test -- middleware/owner
```

Expected: 6 passing。

- [ ] **Step 5: 4 gate + commit**

```bash
pnpm typecheck && pnpm lint
git add apps/api/src/middleware/owner.ts apps/api/src/middleware/owner.test.ts
git commit -m "feat(m10a): requireOwner middleware (admin role + email whitelist)"
```

---

## Task 3: site_settings repository(typed get/set + tests)

**Spec ref:** §5.3

**Why:** `site_settings` 表 M0 已建。M10a 加 repo,提供 typed key→value 读取 + set 写入(updatedBy 必填)。后续 submit-config 改造、config UI、translator config 都会用。

**Files:**
- Create: `apps/api/src/repositories/site-settings.ts`
- Create: `apps/api/src/repositories/site-settings.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/api/src/repositories/site-settings.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../db/client.ts";
import { siteSettings, users } from "../db/schema/index.ts";
import { eq, like } from "drizzle-orm";
import {
  listAllSettings,
  getSetting,
  getSettingsByPrefix,
  setSetting,
} from "./site-settings.ts";

describe("site-settings repository", () => {
  let testUserId: string;

  beforeEach(async () => {
    // clean settings table to known state
    await db.delete(siteSettings).where(like(siteSettings.key, "test.%"));
    // need a user for updatedBy FK; reuse first user or insert one
    const [u] = await db.select({ id: users.id }).from(users).limit(1);
    testUserId = u?.id ?? "00000000-0000-0000-0000-000000000001";
  });

  it("setSetting + getSetting roundtrip primitive number", async () => {
    await setSetting("test.daily_limit", 25, testUserId);
    const v = await getSetting<number>("test.daily_limit");
    expect(v).toBe(25);
  });

  it("setSetting + getSetting roundtrip object", async () => {
    await setSetting("test.obj", { foo: "bar", n: 1 }, testUserId);
    const v = await getSetting<{ foo: string; n: number }>("test.obj");
    expect(v).toEqual({ foo: "bar", n: 1 });
  });

  it("setSetting + getSetting roundtrip array", async () => {
    await setSetting("test.mimes", ["image/jpeg", "image/png"], testUserId);
    const v = await getSetting<string[]>("test.mimes");
    expect(v).toEqual(["image/jpeg", "image/png"]);
  });

  it("getSetting returns undefined for missing key", async () => {
    const v = await getSetting("test.nonexistent");
    expect(v).toBeUndefined();
  });

  it("setSetting upserts (writes second time updates value + updatedAt)", async () => {
    await setSetting("test.upsert", "v1", testUserId);
    const a = await getSetting<string>("test.upsert");
    expect(a).toBe("v1");
    await setSetting("test.upsert", "v2", testUserId);
    const b = await getSetting<string>("test.upsert");
    expect(b).toBe("v2");
  });

  it("listAllSettings returns rows ordered by key asc", async () => {
    await setSetting("test.bbb", 1, testUserId);
    await setSetting("test.aaa", 2, testUserId);
    const rows = await listAllSettings();
    const testRows = rows.filter((r) => r.key.startsWith("test."));
    expect(testRows[0]?.key).toBe("test.aaa");
    expect(testRows[1]?.key).toBe("test.bbb");
  });

  it("getSettingsByPrefix returns matching keys as map", async () => {
    await setSetting("test.a.x", 1, testUserId);
    await setSetting("test.a.y", 2, testUserId);
    await setSetting("test.b.z", 3, testUserId);
    const m = await getSettingsByPrefix("test.a.");
    expect(m.get("test.a.x")).toBe(1);
    expect(m.get("test.a.y")).toBe(2);
    expect(m.has("test.b.z")).toBe(false);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @ip/api test -- repositories/site-settings
```

Expected: 找不到 "./site-settings.ts"。

- [ ] **Step 3: 实现 repository**

创建 `apps/api/src/repositories/site-settings.ts`:

```ts
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
```

- [ ] **Step 4: 跑测试通过**

```bash
pnpm --filter @ip/api test -- repositories/site-settings
```

Expected: 7 passing。

- [ ] **Step 5: 4 gate + commit**

```bash
pnpm typecheck && pnpm lint
git add apps/api/src/repositories/site-settings.ts apps/api/src/repositories/site-settings.test.ts
git commit -m "feat(m10a): site-settings repository (typed get/set/upsert + prefix lookup)"
```

---

## Task 4: 扩展 DEMO_SITE_SETTINGS seed 加全部 M10 keys

**Spec ref:** §5.3 初始 keys

**Why:** 现有 `DEMO_SITE_SETTINGS` 只有 5 个 key,M10 需要 11 个 submit.* + 7 个 translator.* + 2 个 site.* = 20 个 keys。改 seed-data.ts 让 fresh seed 一次性 insert,已有数据库通过 onConflictDoNothing 跳过(seed.ts 已经在循环里调 onConflictDoNothing,不会覆盖人工调过的值)。

**Files:**
- Modify: `apps/api/src/db/seed-data.ts` — 重写 DEMO_SITE_SETTINGS

- [ ] **Step 1: 替换 DEMO_SITE_SETTINGS 数组**

修改 `apps/api/src/db/seed-data.ts` 末尾的 `export const DEMO_SITE_SETTINGS = [...]`,**整段替换**为:

```ts
export const DEMO_SITE_SETTINGS = [
  // -- submit.* — investigated by getSubmitConfig() in apps/api/src/lib/submit-config.ts
  { key: "submit.daily_limit", value: 10, description: "Per-user daily submission limit (good standing)" },
  { key: "submit.demoted_daily_limit", value: 5, description: "Per-user daily limit when rejectedCount >= demote_threshold" },
  { key: "submit.demote_threshold", value: 3, description: "rejectedCount >= this triggers halved daily limit" },
  { key: "submit.guidelines_version", value: 1, description: "Current community guidelines version (bumping invalidates user accept)" },
  { key: "submit.max_images_per_submission", value: 5, description: "Max image files per single submission" },
  { key: "submit.min_images_per_submission", value: 1, description: "Min image files per single submission" },
  { key: "submit.max_image_size_bytes", value: 10485760, description: "Max bytes per uploaded image (10 MB)" },
  {
    key: "submit.allowed_mime",
    value: ["image/jpeg", "image/png", "image/webp"],
    description: "Allowed image MIME types",
  },
  { key: "submit.max_tags", value: 6, description: "Max tags per prompt" },
  { key: "submit.presign_ttl_seconds", value: 900, description: "Presigned upload URL TTL (seconds)" },
  { key: "submit.reject_reason_min_chars", value: 1, description: "Min chars in admin rejection reason" },
  { key: "submit.reject_reason_max_chars", value: 500, description: "Max chars in admin rejection reason" },
  { key: "submit.daily_reset_timezone", value: "Asia/Shanghai", description: "Timezone for the daily-limit reset boundary" },

  // -- community_guidelines.* — body shown to submitters before they may submit
  { key: "community_guidelines.body",
    value: { zh: "请遵守社区准则。", en: "Please follow community guidelines." },
    description: "Guidelines body (bilingual)" },

  // -- view_count.* — interaction dedup window
  { key: "view_count.dedup_hours", value: 24, description: "View dedup window in hours" },

  // -- translator.* — M10a seeds keys; M10b wires the endpoint + UI
  { key: "translator.enabled", value: false, description: "AI translation feature toggle (off until M10b)" },
  { key: "translator.base_url", value: "https://api.openai.com/v1", description: "OpenAI /responses-compatible endpoint base URL (relay-friendly)" },
  { key: "translator.api_key", value: "", description: "API key (encrypted at REST when set via owner UI)" },
  { key: "translator.model", value: "gpt-4o-mini", description: "Model name passed to /responses" },
  { key: "translator.system_prompt", value: "", description: "Override built-in fallback prompt (empty = code default)" },
  { key: "translator.max_chars_per_request", value: 2000, description: "Max input chars per single translate call" },
  { key: "translator.rate_limit_per_user_hour", value: 20, description: "Max translate calls per user per hour" },

  // -- site.* — misc site-wide
  { key: "site.maintenance_mode", value: false, description: "Show maintenance banner / block writes when true" },
  { key: "site.maintenance_message", value: "", description: "Message displayed during maintenance" },
];
```

- [ ] **Step 2: 跑 seed 验证**

```bash
pnpm --filter @ip/api db:seed
```

Expected: seed 成功,console 输出 "Seeded ... prompts ..."。

- [ ] **Step 3: 验证 keys 落到 DB**

```bash
docker exec -i $(docker ps -qf name=postgres) psql -U ip_app -d image_prompts -c "SELECT key, value FROM site_settings WHERE key LIKE 'translator.%' OR key LIKE 'submit.%' ORDER BY key;"
```

(具体 docker container name / psql 命令以你本地环境为准。)

Expected: 列出全部 submit.* + translator.* 行。

- [ ] **Step 4: 4 gate + commit**

```bash
pnpm typecheck && pnpm lint && pnpm --filter @ip/api test
git add apps/api/src/db/seed-data.ts
git commit -m "feat(m10a): seed full site_settings keys (submit.* + translator.* + site.*)"
```

---

## Task 5: refactor submit-config.ts → DB-backed async cache

**Spec ref:** §5.3 改造

**Why:** Owner 调 site_settings 改 `submit.daily_limit` 后,代码必须自动生效。把 SUBMIT_CONFIG(硬编码常量)改成 `getSubmitConfig()`(异步函数,60 秒内存缓存)。调用方共 2 处:`apps/api/src/lib/daily-limit.ts` 和 `apps/api/src/routes/submissions.ts`。

**Files:**
- Modify: `apps/api/src/lib/submit-config.ts` — 整体重写为 async + cache
- Modify: `apps/api/src/lib/daily-limit.ts` — 调用方改 await
- Modify: `apps/api/src/routes/submissions.ts` — 调用方改 await
- Create: `apps/api/src/lib/submit-config.test.ts` — 测试 cache 行为

- [ ] **Step 1: 写新 submit-config.ts**

整体替换 `apps/api/src/lib/submit-config.ts` 为:

```ts
/**
 * M10a:动态加载 submit.* keys from site_settings table,带 60 秒内存缓存。
 *
 * Cache 策略:第一次 call 加载,后续 60s 内复用同一 snapshot;过期后下次
 * call 重新加载。不做主动 invalidate(owner 通过 UI 改完后,最坏 60s 内
 * 生效。这是有意的 — invalidate 会引入跨进程协调复杂度,不值得)。
 *
 * 默认值用现有 DB seed 值;DB 缺 key 时用 fallback(防御性,正常 seed 跑过
 * 后不会触发)。
 */
import { getSettingsByPrefix } from "../repositories/site-settings.ts";

export type SubmitConfig = {
  DAILY_LIMIT: number;
  DEMOTED_LIMIT: number;
  DEMOTE_THRESHOLD: number;
  MAX_IMAGES_PER_SUBMISSION: number;
  MIN_IMAGES_PER_SUBMISSION: number;
  MAX_IMAGE_SIZE_BYTES: number;
  ALLOWED_MIME: string[];
  MAX_TAGS: number;
  PRESIGN_TTL_SECONDS: number;
  GUIDELINES_VERSION: number;
  GUIDELINES_READ_SECONDS: number;
  DAILY_RESET_TIMEZONE: string;
  REJECT_REASON_MIN_CHARS: number;
  REJECT_REASON_MAX_CHARS: number;
};

const FALLBACK: SubmitConfig = {
  DAILY_LIMIT: 10,
  DEMOTED_LIMIT: 5,
  DEMOTE_THRESHOLD: 3,
  MAX_IMAGES_PER_SUBMISSION: 5,
  MIN_IMAGES_PER_SUBMISSION: 1,
  MAX_IMAGE_SIZE_BYTES: 10 * 1024 * 1024,
  ALLOWED_MIME: ["image/jpeg", "image/png", "image/webp"],
  MAX_TAGS: 6,
  PRESIGN_TTL_SECONDS: 15 * 60,
  GUIDELINES_VERSION: 1,
  GUIDELINES_READ_SECONDS: 5,
  DAILY_RESET_TIMEZONE: "Asia/Shanghai",
  REJECT_REASON_MIN_CHARS: 1,
  REJECT_REASON_MAX_CHARS: 500,
};

const CACHE_TTL_MS = 60_000;
let cached: { config: SubmitConfig; loadedAt: number } | null = null;

/**
 * Read submit.* keys from site_settings; merge over FALLBACK; cache 60s.
 *
 * Test code uses resetSubmitConfigCache() to start fresh between tests.
 */
export async function getSubmitConfig(): Promise<SubmitConfig> {
  const now = Date.now();
  if (cached && now - cached.loadedAt < CACHE_TTL_MS) return cached.config;
  const m = await getSettingsByPrefix("submit.");
  const config: SubmitConfig = {
    ...FALLBACK,
    DAILY_LIMIT: numFrom(m, "submit.daily_limit", FALLBACK.DAILY_LIMIT),
    DEMOTED_LIMIT: numFrom(m, "submit.demoted_daily_limit", FALLBACK.DEMOTED_LIMIT),
    DEMOTE_THRESHOLD: numFrom(m, "submit.demote_threshold", FALLBACK.DEMOTE_THRESHOLD),
    MAX_IMAGES_PER_SUBMISSION: numFrom(m, "submit.max_images_per_submission", FALLBACK.MAX_IMAGES_PER_SUBMISSION),
    MIN_IMAGES_PER_SUBMISSION: numFrom(m, "submit.min_images_per_submission", FALLBACK.MIN_IMAGES_PER_SUBMISSION),
    MAX_IMAGE_SIZE_BYTES: numFrom(m, "submit.max_image_size_bytes", FALLBACK.MAX_IMAGE_SIZE_BYTES),
    ALLOWED_MIME: arrFrom(m, "submit.allowed_mime", FALLBACK.ALLOWED_MIME),
    MAX_TAGS: numFrom(m, "submit.max_tags", FALLBACK.MAX_TAGS),
    PRESIGN_TTL_SECONDS: numFrom(m, "submit.presign_ttl_seconds", FALLBACK.PRESIGN_TTL_SECONDS),
    GUIDELINES_VERSION: numFrom(m, "submit.guidelines_version", FALLBACK.GUIDELINES_VERSION),
    DAILY_RESET_TIMEZONE: strFrom(m, "submit.daily_reset_timezone", FALLBACK.DAILY_RESET_TIMEZONE),
    REJECT_REASON_MIN_CHARS: numFrom(m, "submit.reject_reason_min_chars", FALLBACK.REJECT_REASON_MIN_CHARS),
    REJECT_REASON_MAX_CHARS: numFrom(m, "submit.reject_reason_max_chars", FALLBACK.REJECT_REASON_MAX_CHARS),
  };
  cached = { config, loadedAt: now };
  return config;
}

/** Test-only: wipe cache so next getSubmitConfig() re-reads DB. */
export function resetSubmitConfigCache(): void {
  cached = null;
}

function numFrom(m: Map<string, unknown>, k: string, fallback: number): number {
  const v = m.get(k);
  return typeof v === "number" ? v : fallback;
}
function strFrom(m: Map<string, unknown>, k: string, fallback: string): string {
  const v = m.get(k);
  return typeof v === "string" ? v : fallback;
}
function arrFrom<T>(m: Map<string, unknown>, k: string, fallback: T[]): T[] {
  const v = m.get(k);
  return Array.isArray(v) ? (v as T[]) : fallback;
}

/**
 * Compile-time MIME union (kept for backward compat in routes that still
 * narrow to the legacy three). Runtime validation should use
 * (await getSubmitConfig()).ALLOWED_MIME.includes(actualMime).
 */
export type AllowedMime = "image/jpeg" | "image/png" | "image/webp";
```

- [ ] **Step 2: 改 daily-limit.ts**

整体替换 `apps/api/src/lib/daily-limit.ts` 为:

```ts
import { getSubmitConfig } from "./submit-config.ts";

export async function dailyLimitFor(user: { rejectedCount: number }): Promise<number> {
  const cfg = await getSubmitConfig();
  return user.rejectedCount >= cfg.DEMOTE_THRESHOLD ? cfg.DEMOTED_LIMIT : cfg.DAILY_LIMIT;
}
```

(注意函数签名从同步变成 async — 接下来调用方也要 await。)

- [ ] **Step 3: 改 submissions.ts 调用方**

修改 `apps/api/src/routes/submissions.ts`:

3a. 把 import 改成:
```ts
import { getSubmitConfig } from "../lib/submit-config.ts";
```

3b. 在每个 handler 内,第一次用到 `SUBMIT_CONFIG.XXX` 时先 await 读 config:
```ts
const cfg = await getSubmitConfig();
// 然后下面所有 SUBMIT_CONFIG.XXX 都改成 cfg.XXX
```

具体的 3 处:

(a) presign handler(line 75 附近)— `SUBMIT_CONFIG.PRESIGN_TTL_SECONDS` 改成 `cfg.PRESIGN_TTL_SECONDS`

(b) submit handler 内 guidelines 检查(line 134 附近)— `SUBMIT_CONFIG.GUIDELINES_VERSION` 改成 `cfg.GUIDELINES_VERSION`

(c) submit handler 内文件大小检查(line 189 附近)— `SUBMIT_CONFIG.MAX_IMAGE_SIZE_BYTES` 改成 `cfg.MAX_IMAGE_SIZE_BYTES`

每个 handler 顶部加一行 `const cfg = await getSubmitConfig();`(如果一个 handler 用了多个 key,只读一次)。

3d. `dailyLimitFor()` 调用方加 await:`const limit = await dailyLimitFor(user);`(daily-limit.ts 也 export 给路由用过,搜一下 `dailyLimitFor` 出现的地方都补 await)。

- [ ] **Step 4: 找 dailyLimitFor 的全部调用方**

```bash
grep -rn "dailyLimitFor" apps/api/src apps/api/test 2>&1
```

每个调用方都改成 `await dailyLimitFor(...)`。

- [ ] **Step 5: 写 submit-config cache 测试**

创建 `apps/api/src/lib/submit-config.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { getSubmitConfig, resetSubmitConfigCache } from "./submit-config.ts";
import { setSetting } from "../repositories/site-settings.ts";

describe("getSubmitConfig", () => {
  beforeEach(() => {
    resetSubmitConfigCache();
  });

  it("reads DAILY_LIMIT from site_settings", async () => {
    await setSetting("submit.daily_limit", 42, null);
    resetSubmitConfigCache();
    const cfg = await getSubmitConfig();
    expect(cfg.DAILY_LIMIT).toBe(42);
    // restore so we don't pollute downstream tests
    await setSetting("submit.daily_limit", 10, null);
    resetSubmitConfigCache();
  });

  it("falls back to defaults when key missing", async () => {
    // Delete the key entirely
    const { db } = await import("../db/client.ts");
    const { siteSettings } = await import("../db/schema/index.ts");
    const { eq } = await import("drizzle-orm");
    await db.delete(siteSettings).where(eq(siteSettings.key, "submit.daily_limit"));
    resetSubmitConfigCache();
    const cfg = await getSubmitConfig();
    expect(cfg.DAILY_LIMIT).toBe(10); // fallback
    // restore
    await setSetting("submit.daily_limit", 10, null);
    resetSubmitConfigCache();
  });

  it("caches across calls within TTL", async () => {
    await setSetting("submit.daily_limit", 7, null);
    resetSubmitConfigCache();
    const a = await getSubmitConfig();
    // Change DB underneath; cached snapshot should not see it
    await setSetting("submit.daily_limit", 99, null);
    const b = await getSubmitConfig();
    expect(b.DAILY_LIMIT).toBe(a.DAILY_LIMIT);
    expect(b.DAILY_LIMIT).toBe(7);
    // restore
    await setSetting("submit.daily_limit", 10, null);
    resetSubmitConfigCache();
  });

  it("re-reads after resetSubmitConfigCache()", async () => {
    await setSetting("submit.daily_limit", 7, null);
    resetSubmitConfigCache();
    const a = await getSubmitConfig();
    expect(a.DAILY_LIMIT).toBe(7);
    await setSetting("submit.daily_limit", 99, null);
    resetSubmitConfigCache();
    const b = await getSubmitConfig();
    expect(b.DAILY_LIMIT).toBe(99);
    // restore
    await setSetting("submit.daily_limit", 10, null);
    resetSubmitConfigCache();
  });
});
```

- [ ] **Step 6: 跑全部测试**

```bash
pnpm --filter @ip/api test
```

Expected: 全绿。注意因为 submissions.ts 的签名没变(只是内部用 await 了),existing submissions.test.ts 应该不受影响,但留意。

- [ ] **Step 7: 4 gate + commit**

```bash
pnpm typecheck && pnpm lint
git add apps/api/src/lib/submit-config.ts apps/api/src/lib/submit-config.test.ts apps/api/src/lib/daily-limit.ts apps/api/src/routes/submissions.ts
git commit -m "refactor(m10a): submit-config → DB-backed cache (60s TTL, owner-mutable)"
```

---

## Task 6: owner-stats repository(dashboard metrics)

**Spec ref:** §5.1 概览 / Dashboard

**Why:** Dashboard 显示 4-8 个 metric 数 + recent audit log。把 SQL 集中到一个 repo,routes 层只是薄包装。

**Files:**
- Create: `apps/api/src/repositories/owner-stats.ts`
- Create: `apps/api/src/repositories/owner-stats.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/api/src/repositories/owner-stats.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getOwnerDashboard } from "./owner-stats.ts";

describe("owner-stats repository", () => {
  it("returns dashboard payload with all top-level fields", async () => {
    const r = await getOwnerDashboard();
    expect(typeof r.metrics.publishedPrompts).toBe("number");
    expect(typeof r.metrics.totalUsers).toBe("number");
    expect(typeof r.metrics.pendingSubmissions).toBe("number");
    expect(typeof r.metrics.totalViews).toBe("number");
    expect(typeof r.metrics.totalLikes).toBe("number");
    expect(typeof r.metrics.totalFavorites).toBe("number");
    expect(typeof r.metrics.totalSubmissions).toBe("number");
    expect(typeof r.metrics.totalR2UsedBytes).toBe("number");
    expect(Array.isArray(r.recentActivity)).toBe(true);
  });

  it("publishedPrompts matches manual count", async () => {
    const r = await getOwnerDashboard();
    // Just sanity check: must be >= seeded count
    expect(r.metrics.publishedPrompts).toBeGreaterThan(0);
  });

  it("recentActivity items have required shape", async () => {
    const r = await getOwnerDashboard();
    for (const a of r.recentActivity) {
      expect(typeof a.id).toBe("string");
      expect(typeof a.action).toBe("string");
      expect(a.createdAt instanceof Date).toBe(true);
      // actorId/targetType/targetId can be null
    }
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

```bash
pnpm --filter @ip/api test -- repositories/owner-stats
```

Expected: "./owner-stats.ts" 找不到。

- [ ] **Step 3: 实现 repository**

创建 `apps/api/src/repositories/owner-stats.ts`:

```ts
import { and, count, desc, eq, isNull, sum, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  prompts,
  users,
  submissions,
  likes,
  favorites,
  r2Accounts,
  auditLog,
} from "../db/schema/index.ts";

export type DashboardActivity = {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  payload: unknown;
  createdAt: Date;
};

export type DashboardMetrics = {
  publishedPrompts: number;
  totalUsers: number;
  pendingSubmissions: number;
  totalViews: number;
  totalLikes: number;
  totalFavorites: number;
  totalSubmissions: number;
  totalR2UsedBytes: number;
};

export type DashboardPayload = {
  metrics: DashboardMetrics;
  recentActivity: DashboardActivity[];
};

/**
 * One-shot dashboard read. Runs 8 small COUNT/SUM queries + 1 audit_log
 * SELECT in parallel. Each query is O(rows) with covering indexes, well
 * under 100ms total at MVP scale. If/when we have millions of rows, add
 * materialized counters or replace with cached snapshots — premature now.
 */
export async function getOwnerDashboard(): Promise<DashboardPayload> {
  const [
    [pubRow],
    [usersRow],
    [pendingRow],
    [viewsRow],
    [likesRow],
    [favsRow],
    [subsRow],
    [r2Row],
    activityRows,
  ] = await Promise.all([
    db
      .select({ n: count() })
      .from(prompts)
      .where(and(eq(prompts.status, "published"), isNull(prompts.deletedAt))),
    db.select({ n: count() }).from(users),
    db
      .select({ n: count() })
      .from(submissions)
      .where(eq(submissions.status, "pending")),
    db
      .select({ s: sum(prompts.viewCount).mapWith(Number) })
      .from(prompts)
      .where(eq(prompts.status, "published")),
    db.select({ n: count() }).from(likes),
    db.select({ n: count() }).from(favorites),
    db.select({ n: count() }).from(submissions),
    db
      .select({ s: sum(r2Accounts.usedBytes).mapWith(Number) })
      .from(r2Accounts)
      .where(isNull(r2Accounts.deletedAt)),
    db
      .select({
        id: auditLog.id,
        actorId: auditLog.actorId,
        actorName: users.name,
        action: auditLog.action,
        targetType: auditLog.targetType,
        targetId: auditLog.targetId,
        payload: auditLog.payload,
        createdAt: auditLog.createdAt,
      })
      .from(auditLog)
      .leftJoin(users, eq(users.id, auditLog.actorId))
      .orderBy(desc(auditLog.createdAt))
      .limit(20),
  ]);

  return {
    metrics: {
      publishedPrompts: Number(pubRow?.n ?? 0),
      totalUsers: Number(usersRow?.n ?? 0),
      pendingSubmissions: Number(pendingRow?.n ?? 0),
      totalViews: Number(viewsRow?.s ?? 0),
      totalLikes: Number(likesRow?.n ?? 0),
      totalFavorites: Number(favsRow?.n ?? 0),
      totalSubmissions: Number(subsRow?.n ?? 0),
      totalR2UsedBytes: Number(r2Row?.s ?? 0),
    },
    recentActivity: activityRows,
  };
}
```

**注意**:
- `prompts.viewCount` / `prompts.likeCount` / `prompts.favoriteCount` 都是聚合列,M5/M9 已 sync 过。如果发现 schema 字段名不一致(比如 `view_count` 而非 `viewCount`),修正到实际名。
- `auditLog` 表已有(M0 建)— 名字可能是 `auditLogs`(复数);check `apps/api/src/db/schema/audit.ts`。
- 如果 `submissions` 表没有直接 export(从 `index.ts`),检查 schema 导出。

实现前先 verify schema 字段名:`grep -E "viewCount|view_count|usedBytes" apps/api/src/db/schema/*.ts`

- [ ] **Step 4: 跑测试通过**

```bash
pnpm --filter @ip/api test -- repositories/owner-stats
```

Expected: 3 passing。

- [ ] **Step 5: 4 gate + commit**

```bash
pnpm typecheck && pnpm lint
git add apps/api/src/repositories/owner-stats.ts apps/api/src/repositories/owner-stats.test.ts
git commit -m "feat(m10a): owner-stats repository (dashboard metrics + recent activity)"
```

---

## Task 7: /api/owner.ts 路由(dashboard + settings + r2 read-only)

**Spec ref:** §5.1 §5.2 §5.3

**Why:** 统一一个 `/api/owner/**` 路由文件,所有 endpoints 都过 `requireOwner`。M10a 范围:dashboard 一个 GET、settings GET 一个 + PUT 一个、R2 accounts 两个只读 GET。

**Files:**
- Create: `apps/api/src/routes/owner.ts`
- Create: `apps/api/src/routes/owner.test.ts`
- Modify: `apps/api/src/server.ts` — 挂载 `/api/owner` route
- Modify: `apps/api/src/repositories/r2-accounts.ts` — 加 `listAllR2Accounts()` 和 `getR2AccountById()` 给 owner 用(public 那个只列 enabled)

- [ ] **Step 1: 扩展 r2-accounts repo**

修改 `apps/api/src/repositories/r2-accounts.ts`,在 `listR2PoolPublic()` 后面加:

```ts
import { desc } from "drizzle-orm";

export async function listAllR2AccountsForOwner() {
  const rows = await db
    .select({
      id: r2Accounts.id,
      name: r2Accounts.name,
      accountId: r2Accounts.accountId,
      endpoint: r2Accounts.endpoint,
      bucket: r2Accounts.bucket,
      publicUrl: r2Accounts.publicUrl,
      priority: r2Accounts.priority,
      enabled: r2Accounts.enabled,
      usedBytes: r2Accounts.usedBytes,
      lastSyncedAt: r2Accounts.lastSyncedAt,
      deletedAt: r2Accounts.deletedAt,
      createdAt: r2Accounts.createdAt,
    })
    .from(r2Accounts)
    .orderBy(desc(r2Accounts.priority), desc(r2Accounts.createdAt));
  return rows;
}

export async function getR2AccountForOwner(id: string) {
  const [row] = await db
    .select({
      id: r2Accounts.id,
      name: r2Accounts.name,
      accountId: r2Accounts.accountId,
      endpoint: r2Accounts.endpoint,
      bucket: r2Accounts.bucket,
      publicUrl: r2Accounts.publicUrl,
      priority: r2Accounts.priority,
      enabled: r2Accounts.enabled,
      usedBytes: r2Accounts.usedBytes,
      lastSyncedAt: r2Accounts.lastSyncedAt,
      deletedAt: r2Accounts.deletedAt,
      createdAt: r2Accounts.createdAt,
    })
    .from(r2Accounts)
    .where(eq(r2Accounts.id, id))
    .limit(1);
  return row ?? null;
}
```

**注意**:若 `r2Accounts.usedBytes` / `lastSyncedAt` 列名不一致,以 schema 实际名为准 — `grep -E "used_bytes|last_synced" apps/api/src/db/schema/images.ts`。

- [ ] **Step 2: 写失败测试**

创建 `apps/api/src/routes/owner.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import ownerRoute from "./owner.ts";

function buildApp(authUser: unknown) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("authUser", authUser);
    await next();
  });
  app.route("/api/owner", ownerRoute);
  return app;
}

const OWNER_SESSION = {
  session: { user: { id: "owner-1", role: "admin", email: "owner@example.com" } },
};
const NON_OWNER = {
  session: { user: { id: "u-1", role: "user", email: "x@y.com" } },
};

describe("owner routes — auth gate", () => {
  const origEnv = process.env.OWNER_EMAILS;
  beforeEach(() => {
    process.env.OWNER_EMAILS = "owner@example.com";
  });
  afterEach(() => {
    process.env.OWNER_EMAILS = origEnv;
  });

  it("dashboard 403 for non-owner", async () => {
    const app = buildApp(NON_OWNER);
    const res = await app.request("/api/owner/dashboard");
    expect(res.status).toBe(403);
  });

  it("settings GET 403 for non-owner", async () => {
    const app = buildApp(NON_OWNER);
    const res = await app.request("/api/owner/settings");
    expect(res.status).toBe(403);
  });

  it("settings PUT 403 for non-owner", async () => {
    const app = buildApp(NON_OWNER);
    const res = await app.request("/api/owner/settings/submit.daily_limit", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: 99 }),
    });
    expect(res.status).toBe(403);
  });

  it("r2-accounts GET 403 for non-owner", async () => {
    const app = buildApp(NON_OWNER);
    const res = await app.request("/api/owner/r2-accounts");
    expect(res.status).toBe(403);
  });
});

describe("owner routes — happy path", () => {
  const origEnv = process.env.OWNER_EMAILS;
  beforeEach(() => {
    process.env.OWNER_EMAILS = "owner@example.com";
  });
  afterEach(() => {
    process.env.OWNER_EMAILS = origEnv;
  });

  it("dashboard 200 for owner with metrics shape", async () => {
    const app = buildApp(OWNER_SESSION);
    const res = await app.request("/api/owner/dashboard");
    expect(res.status).toBe(200);
    const j = (await res.json()) as { metrics: Record<string, number> };
    expect(typeof j.metrics.publishedPrompts).toBe("number");
    expect(typeof j.metrics.totalUsers).toBe("number");
  });

  it("settings GET 200 returns array of settings", async () => {
    const app = buildApp(OWNER_SESSION);
    const res = await app.request("/api/owner/settings");
    expect(res.status).toBe(200);
    const j = (await res.json()) as { items: Array<{ key: string }> };
    expect(Array.isArray(j.items)).toBe(true);
    const keys = j.items.map((i) => i.key);
    expect(keys).toContain("submit.daily_limit");
    expect(keys).toContain("translator.enabled");
  });

  it("settings PUT 200 updates value and returns new", async () => {
    const app = buildApp(OWNER_SESSION);
    const res = await app.request("/api/owner/settings/submit.daily_limit", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: 17 }),
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as { key: string; value: number };
    expect(j.key).toBe("submit.daily_limit");
    expect(j.value).toBe(17);
    // restore baseline
    await app.request("/api/owner/settings/submit.daily_limit", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: 10 }),
    });
  });

  it("settings PUT rejects unknown key with 400", async () => {
    const app = buildApp(OWNER_SESSION);
    const res = await app.request("/api/owner/settings/totally.bogus.key", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: 1 }),
    });
    expect(res.status).toBe(400);
  });

  it("r2-accounts GET 200 returns list including disabled", async () => {
    const app = buildApp(OWNER_SESSION);
    const res = await app.request("/api/owner/r2-accounts");
    expect(res.status).toBe(200);
    const j = (await res.json()) as { items: Array<{ id: string; enabled: boolean }> };
    expect(Array.isArray(j.items)).toBe(true);
    expect(j.items.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: 跑测试确认失败**

```bash
pnpm --filter @ip/api test -- routes/owner
```

Expected: 模块不存在 / route 不挂载,全失败。

- [ ] **Step 4: 实现 owner 路由**

创建 `apps/api/src/routes/owner.ts`:

```ts
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { softAuth, requireUserId } from "../middleware/auth.ts";
import { requireOwner } from "../middleware/owner.ts";
import { zv } from "../lib/validate.ts";
import { getOwnerDashboard } from "../repositories/owner-stats.ts";
import {
  listAllSettings,
  getSetting,
  setSetting,
} from "../repositories/site-settings.ts";
import {
  listAllR2AccountsForOwner,
  getR2AccountForOwner,
} from "../repositories/r2-accounts.ts";
import { resetSubmitConfigCache } from "../lib/submit-config.ts";

const app = new Hono();

// All /api/owner routes require admin role + OWNER_EMAILS whitelist.
app.use("*", softAuth(), requireOwner());

// ── Dashboard ────────────────────────────────────────────────────────────
app.get("/dashboard", async (c) => {
  const r = await getOwnerDashboard();
  return c.json(r);
});

// ── Site settings ────────────────────────────────────────────────────────
app.get("/settings", async (c) => {
  const rows = await listAllSettings();
  return c.json({ items: rows });
});

const SettingKeyParamSchema = z.object({ key: z.string().min(1).max(120) });
const SettingPutBodySchema = z.object({
  value: z.unknown(),
});

/**
 * Allow-list of writable setting keys. Adding a key here is an explicit
 * decision — random keys (e.g., experimental flags, leftover seed values)
 * shouldn't be silently mutated through the owner UI. M10b adds more.
 */
const WRITABLE_SETTING_KEYS = new Set<string>([
  "submit.daily_limit",
  "submit.demoted_daily_limit",
  "submit.demote_threshold",
  "submit.guidelines_version",
  "submit.max_images_per_submission",
  "submit.min_images_per_submission",
  "submit.max_image_size_bytes",
  "submit.allowed_mime",
  "submit.max_tags",
  "submit.presign_ttl_seconds",
  "submit.reject_reason_min_chars",
  "submit.reject_reason_max_chars",
  "submit.daily_reset_timezone",
  "community_guidelines.body",
  "view_count.dedup_hours",
  "translator.enabled",
  "translator.base_url",
  "translator.api_key",
  "translator.model",
  "translator.system_prompt",
  "translator.max_chars_per_request",
  "translator.rate_limit_per_user_hour",
  "site.maintenance_mode",
  "site.maintenance_message",
]);

app.put(
  "/settings/:key",
  zv("param", SettingKeyParamSchema),
  zv("json", SettingPutBodySchema),
  async (c) => {
    const { key } = c.req.valid("param");
    const { value } = c.req.valid("json");
    if (!WRITABLE_SETTING_KEYS.has(key)) {
      throw new HTTPException(400, { message: "key_not_writable" });
    }
    const ownerId = requireUserId(c);
    await setSetting(key, value, ownerId);
    // Invalidate the submit-config cache so the change is observable on the
    // next request without waiting up to 60s. (M10b will broadcast over a
    // pub/sub if we ever go multi-process — single-process now, fine.)
    if (key.startsWith("submit.")) resetSubmitConfigCache();
    return c.json({ key, value });
  },
);

// ── R2 accounts (read-only in M10a) ──────────────────────────────────────
app.get("/r2-accounts", async (c) => {
  const items = await listAllR2AccountsForOwner();
  return c.json({ items });
});

const UuidParamSchema = z.object({ id: z.string().uuid() });
app.get("/r2-accounts/:id", zv("param", UuidParamSchema), async (c) => {
  const r = await getR2AccountForOwner(c.req.valid("param").id);
  if (!r) throw new HTTPException(404, { message: "not_found" });
  return c.json(r);
});

export default app;
```

- [ ] **Step 5: 挂载路由**

修改 `apps/api/src/server.ts`,在已有的 `import` 区域加:

```ts
import ownerRoute from "./routes/owner.ts";
```

在 createServer() 内,**在 `app.route("/api/admin", adminRoute);` 后面**加:

```ts
  app.route("/api/owner", ownerRoute);
```

- [ ] **Step 6: 跑测试通过**

```bash
pnpm --filter @ip/api test -- routes/owner
```

Expected: 10 passing(4 个 403 case + 6 个 happy path)。

- [ ] **Step 7: 4 gate + commit**

```bash
pnpm typecheck && pnpm lint
git add apps/api/src/routes/owner.ts apps/api/src/routes/owner.test.ts apps/api/src/server.ts apps/api/src/repositories/r2-accounts.ts
git commit -m "feat(m10a): /api/owner — dashboard + settings GET/PUT + r2 read-only"
```

---

## Task 8: 前端路由树 + Owner guard

**Spec ref:** §4

**Why:** SPA 加 `/:locale/rosekhlifa/*` 路由组,owner guard 包裹,未授权显示 403 占位页。Owner-only 导航入口先不加(Sidebar 不放,owner 自己记 URL — M10b 可以加 ProfileMenu 链接)。

**Files:**
- Modify: `apps/web/src/routes/index.tsx` — 加 owner 路由组
- Create: `apps/web/src/routes/owner-guard.tsx`
- Create: `apps/web/src/pages/owner/ForbiddenPage.tsx`(403 占位)

- [ ] **Step 1: 建 ForbiddenPage**

创建 `apps/web/src/pages/owner/ForbiddenPage.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { isLocale, type Locale } from "@ip/shared";
import { withLocale } from "../../lib/locale";

export default function ForbiddenPage() {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  return (
    <div className="flex min-h-dvh items-center justify-center bg-zinc-950 text-zinc-100">
      <div className="text-center">
        <div className="text-6xl font-bold text-emerald-500">403</div>
        <div className="mt-4 text-xl">{t("owner.forbidden_title")}</div>
        <div className="mt-2 text-sm text-zinc-400">{t("owner.forbidden_body")}</div>
        <Link
          to={withLocale(locale, "/")}
          className="mt-6 inline-block rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400"
        >
          {t("owner.forbidden_back")}
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 建 OwnerGuard 组件**

创建 `apps/web/src/routes/owner-guard.tsx`:

```tsx
import { Outlet } from "react-router";
import { useSession } from "../lib/hooks/useSession";
import ForbiddenPage from "../pages/owner/ForbiddenPage";

/**
 * Gate /:locale/rosekhlifa/* — only render children when the session's
 * isOwner derived flag is true. Loading state shows a minimal placeholder
 * (避免 flash of forbidden);hard 403 page shown on confirmed non-owner.
 *
 * This is UX gating only — the API still enforces server-side via
 * requireOwner. A user who hand-edits the SPA state would just hit 403s
 * from the network calls.
 */
export default function OwnerGuard() {
  const session = useSession();
  if (session.isLoading) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-zinc-950 text-zinc-400">
        …
      </div>
    );
  }
  const isOwner = (session.data?.user as { isOwner?: boolean } | undefined)?.isOwner ?? false;
  if (!isOwner) return <ForbiddenPage />;
  return <Outlet />;
}
```

- [ ] **Step 3: 扩展路由树**

修改 `apps/web/src/routes/index.tsx`,**整体替换**为(基于现有,加 owner 路由组):

```tsx
import { createBrowserRouter, RouterProvider } from "react-router";
import LocaleRedirect from "./locale-redirect";
import LocaleLayout from "./locale-layout";
import OwnerGuard from "./owner-guard";
import HomePage from "../pages/HomePage";
import PromptListPage from "../pages/PromptListPage";
import PromptDetailPage from "../pages/PromptDetailPage";
import AboutPage from "../pages/AboutPage";
import ProfilePage from "../pages/ProfilePage";
import SubmitPage from "../pages/SubmitPage";
import UserPage from "../pages/UserPage";
import AdminSubmissionsPage from "../pages/AdminSubmissionsPage";
import NotFoundPage from "../pages/NotFoundPage";
import OwnerLayout from "../pages/owner/OwnerLayout";
import DashboardPage from "../pages/owner/DashboardPage";
import ConfigPage from "../pages/owner/ConfigPage";
import R2Page from "../pages/owner/R2Page";
import SubmissionsBridgePage from "../pages/owner/SubmissionsBridgePage";

export const router = createBrowserRouter([
  { path: "/", element: <LocaleRedirect /> },
  {
    path: "/:locale",
    element: <LocaleLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "prompts", element: <PromptListPage /> },
      { path: "prompts/:slug", element: <PromptDetailPage /> },
      { path: "categories/:slug", element: <PromptListPage /> },
      { path: "about", element: <AboutPage /> },
      { path: "profile", element: <ProfilePage /> },
      { path: "submit", element: <SubmitPage /> },
      { path: "users/:id", element: <UserPage /> },
      { path: "admin/submissions", element: <AdminSubmissionsPage /> },
      { path: "admin/submissions/:id", element: <AdminSubmissionsPage /> },
      {
        path: "rosekhlifa",
        element: <OwnerGuard />,
        children: [
          {
            element: <OwnerLayout />,
            children: [
              { index: true, element: <DashboardPage /> },
              { path: "config", element: <ConfigPage /> },
              { path: "r2", element: <R2Page /> },
              { path: "submissions", element: <SubmissionsBridgePage /> },
            ],
          },
        ],
      },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
  { path: "*", element: <LocaleRedirect /> },
]);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
```

- [ ] **Step 4: 加 i18n 占位 strings(为 ForbiddenPage)**

修改 `apps/web/src/i18n/zh.json`,加 owner namespace(若已存在 owner 就在内部加):

```json
  "owner": {
    "forbidden_title": "你没有访问权限",
    "forbidden_body": "/rosekhlifa 仅对项目所有者开放。",
    "forbidden_back": "返回首页"
  }
```

修改 `apps/web/src/i18n/en.json` 加对应英文:

```json
  "owner": {
    "forbidden_title": "Access denied",
    "forbidden_body": "/rosekhlifa is for project owners only.",
    "forbidden_back": "Back home"
  }
```

(后续 task 还会往 owner 里加 keys。)

- [ ] **Step 5: 4 gate**

```bash
pnpm typecheck
```

Expected:报错说找不到 OwnerLayout / DashboardPage / ConfigPage / R2Page / SubmissionsBridgePage(下一 task 会建)。**typecheck 暂时挂着,下个 task 收尾。**

跳过 commit,留到 Task 10 一起。

---

## Task 9: OwnerLayout shell(深色主题 + sidebar + topbar)

**Spec ref:** §4

**Why:** 所有 /rosekhlifa 子页共用的 shell:左 sidebar 分组导航、顶部 breadcrumb + OWNER badge、深色背景。

**Files:**
- Create: `apps/web/src/pages/owner/OwnerLayout.tsx`
- Create: `apps/web/src/components/owner/OwnerSidebar.tsx`
- Create: `apps/web/src/components/owner/OwnerTopbar.tsx`

- [ ] **Step 1: OwnerTopbar**

创建 `apps/web/src/components/owner/OwnerTopbar.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import { Link, useLocation, useParams } from "react-router";
import { isLocale, type Locale } from "@ip/shared";
import { withLocale } from "../../lib/locale";

const SEGMENT_LABELS: Record<string, string> = {
  rosekhlifa: "owner.nav.root",
  config: "owner.nav.config",
  r2: "owner.nav.r2",
  submissions: "owner.nav.submissions",
};

export default function OwnerTopbar() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";

  // /zh/rosekhlifa/config → ["rosekhlifa", "config"]
  const segments = pathname
    .replace(`/${locale}`, "")
    .split("/")
    .filter(Boolean);

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-zinc-800 bg-zinc-950/95 px-6 backdrop-blur">
      <nav className="flex items-center gap-2 text-sm text-zinc-400">
        {segments.map((s, i) => {
          const labelKey = SEGMENT_LABELS[s];
          const label = labelKey ? t(labelKey) : s;
          const isLast = i === segments.length - 1;
          if (isLast) return <span key={s} className="text-zinc-100">{label}</span>;
          return (
            <span key={s} className="flex items-center gap-2">
              <Link
                to={withLocale(locale, "/rosekhlifa")}
                className="hover:text-zinc-200"
              >
                {label}
              </Link>
              <span className="text-zinc-600">/</span>
            </span>
          );
        })}
      </nav>
      <div className="flex items-center gap-3">
        <span className="rounded-md bg-emerald-500/15 px-2 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-400">
          OWNER
        </span>
        <Link
          to={withLocale(locale, "/")}
          className="text-sm text-zinc-400 hover:text-zinc-200"
        >
          ← {t("owner.nav.back_to_site")}
        </Link>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: OwnerSidebar**

创建 `apps/web/src/components/owner/OwnerSidebar.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import { NavLink, useParams } from "react-router";
import { LayoutDashboard, Settings, HardDrive, Inbox } from "lucide-react";
import { isLocale, type Locale } from "@ip/shared";
import { withLocale } from "../../lib/locale";

type Item = { to: string; label: string; icon: React.ComponentType<{ size?: number }>; end?: boolean };

export default function OwnerSidebar() {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";

  const items: Item[] = [
    { to: withLocale(locale, "/rosekhlifa"), label: t("owner.nav.dashboard"), icon: LayoutDashboard, end: true },
    { to: withLocale(locale, "/rosekhlifa/config"), label: t("owner.nav.config"), icon: Settings },
    { to: withLocale(locale, "/rosekhlifa/r2"), label: t("owner.nav.r2"), icon: HardDrive },
    { to: withLocale(locale, "/rosekhlifa/submissions"), label: t("owner.nav.submissions"), icon: Inbox },
  ];

  return (
    <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-56 shrink-0 self-start border-r border-zinc-800 bg-zinc-950 md:flex md:flex-col">
      <div className="px-4 py-5">
        <div className="px-2 pb-3 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
          {t("owner.nav.section_admin")}
        </div>
        <nav className="flex flex-col gap-1">
          {items.map((it) => {
            const Icon = it.icon;
            return (
              <NavLink
                key={it.to}
                to={it.to}
                end={it.end}
                className={({ isActive }) =>
                  [
                    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition",
                    isActive
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100",
                  ].join(" ")
                }
              >
                <Icon size={16} aria-hidden />
                <span className="truncate">{it.label}</span>
              </NavLink>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
```

- [ ] **Step 3: OwnerLayout 主壳**

创建 `apps/web/src/pages/owner/OwnerLayout.tsx`:

```tsx
import { Outlet } from "react-router";
import OwnerSidebar from "../../components/owner/OwnerSidebar";
import OwnerTopbar from "../../components/owner/OwnerTopbar";

export default function OwnerLayout() {
  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100">
      <OwnerTopbar />
      <div className="flex">
        <OwnerSidebar />
        <main className="min-w-0 flex-1 px-6 py-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 加 i18n keys**

`apps/web/src/i18n/zh.json` owner 段扩展:

```json
  "owner": {
    "forbidden_title": "你没有访问权限",
    "forbidden_body": "/rosekhlifa 仅对项目所有者开放。",
    "forbidden_back": "返回首页",
    "nav": {
      "section_admin": "管理",
      "dashboard": "概览",
      "config": "全局配置",
      "r2": "R2 池",
      "submissions": "审核队列",
      "root": "站长后台",
      "back_to_site": "回主站"
    }
  }
```

`apps/web/src/i18n/en.json` 对应:

```json
  "owner": {
    "forbidden_title": "Access denied",
    "forbidden_body": "/rosekhlifa is for project owners only.",
    "forbidden_back": "Back home",
    "nav": {
      "section_admin": "Admin",
      "dashboard": "Overview",
      "config": "Settings",
      "r2": "R2 Pool",
      "submissions": "Submissions",
      "root": "Owner Console",
      "back_to_site": "Back to site"
    }
  }
```

- [ ] **Step 5: typecheck**

```bash
pnpm typecheck
```

Expected: 还是会报 DashboardPage / ConfigPage / R2Page / SubmissionsBridgePage 不存在 — 留到 Task 10。

跳过 commit。

---

## Task 10: DashboardPage + ConfigPage + R2Page + SubmissionsBridgePage + hooks + 收尾

**Spec ref:** §5.1 §5.2 §5.3

**Why:** 四个页面 + 数据 hooks + 最终 4 gate。各页只读为主,UI 简洁清晰。

**Files:**
- Create: `apps/web/src/lib/hooks/useOwnerDashboard.ts`
- Create: `apps/web/src/lib/hooks/useSiteSettings.ts`
- Create: `apps/web/src/lib/hooks/useOwnerR2.ts`
- Create: `apps/web/src/pages/owner/DashboardPage.tsx`
- Create: `apps/web/src/pages/owner/ConfigPage.tsx`
- Create: `apps/web/src/pages/owner/R2Page.tsx`
- Create: `apps/web/src/pages/owner/SubmissionsBridgePage.tsx`

- [ ] **Step 1: 数据 hooks**

创建 `apps/web/src/lib/hooks/useOwnerDashboard.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api";

export type OwnerDashboardActivity = {
  id: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  payload: unknown;
  createdAt: string;
};
export type OwnerDashboard = {
  metrics: {
    publishedPrompts: number;
    totalUsers: number;
    pendingSubmissions: number;
    totalViews: number;
    totalLikes: number;
    totalFavorites: number;
    totalSubmissions: number;
    totalR2UsedBytes: number;
  };
  recentActivity: OwnerDashboardActivity[];
};

export function useOwnerDashboard() {
  return useQuery({
    queryKey: ["owner", "dashboard"],
    queryFn: () => apiFetch<OwnerDashboard>("/api/owner/dashboard"),
    staleTime: 30_000,
  });
}
```

创建 `apps/web/src/lib/hooks/useSiteSettings.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../api";

export type SiteSetting = {
  key: string;
  value: unknown;
  description: string | null;
  updatedAt: string;
  updatedBy: string | null;
};

export function useSiteSettings() {
  return useQuery({
    queryKey: ["owner", "settings"],
    queryFn: () => apiFetch<{ items: SiteSetting[] }>("/api/owner/settings"),
    staleTime: 30_000,
  });
}

export function useUpdateSetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { key: string; value: unknown }) => {
      return apiFetch<{ key: string; value: unknown }>(
        `/api/owner/settings/${encodeURIComponent(input.key)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ value: input.value }),
        },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["owner", "settings"] });
    },
  });
}
```

创建 `apps/web/src/lib/hooks/useOwnerR2.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "../api";

export type OwnerR2Account = {
  id: string;
  name: string;
  accountId: string;
  endpoint: string;
  bucket: string;
  publicUrl: string;
  priority: number;
  enabled: boolean;
  usedBytes: number | null;
  lastSyncedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
};

export function useOwnerR2Accounts() {
  return useQuery({
    queryKey: ["owner", "r2-accounts"],
    queryFn: () => apiFetch<{ items: OwnerR2Account[] }>("/api/owner/r2-accounts"),
    staleTime: 30_000,
  });
}
```

- [ ] **Step 2: DashboardPage**

创建 `apps/web/src/pages/owner/DashboardPage.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import { useOwnerDashboard } from "../../lib/hooks/useOwnerDashboard";

function fmtNumber(n: number): string {
  return n.toLocaleString();
}
function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const q = useOwnerDashboard();

  const cards: { key: string; label: string; value: string; tone?: string }[] = [];
  if (q.data) {
    const m = q.data.metrics;
    cards.push(
      { key: "pub", label: t("owner.dashboard.published_prompts"), value: fmtNumber(m.publishedPrompts) },
      { key: "users", label: t("owner.dashboard.total_users"), value: fmtNumber(m.totalUsers) },
      { key: "pending", label: t("owner.dashboard.pending_submissions"), value: fmtNumber(m.pendingSubmissions), tone: m.pendingSubmissions > 0 ? "warn" : undefined },
      { key: "views", label: t("owner.dashboard.total_views"), value: fmtNumber(m.totalViews) },
      { key: "likes", label: t("owner.dashboard.total_likes"), value: fmtNumber(m.totalLikes) },
      { key: "favs", label: t("owner.dashboard.total_favorites"), value: fmtNumber(m.totalFavorites) },
      { key: "subs", label: t("owner.dashboard.total_submissions"), value: fmtNumber(m.totalSubmissions) },
      { key: "r2", label: t("owner.dashboard.r2_used"), value: fmtBytes(m.totalR2UsedBytes) },
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">{t("owner.dashboard.title")}</h1>
      <p className="mt-1 text-sm text-zinc-400">{t("owner.dashboard.subtitle")}</p>

      {q.isLoading && <div className="mt-6 text-zinc-400">…</div>}
      {q.isError && <div className="mt-6 text-rose-400">{t("common.error_load")}</div>}

      {q.data && (
        <>
          <section className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
            {cards.map((c) => (
              <div
                key={c.key}
                className="rounded-lg border border-zinc-800 bg-zinc-900 p-4"
              >
                <div className="text-xs uppercase tracking-wider text-zinc-500">
                  {c.label}
                </div>
                <div
                  className={`mt-2 text-2xl font-semibold ${
                    c.tone === "warn" ? "text-amber-400" : "text-zinc-100"
                  }`}
                >
                  {c.value}
                </div>
              </div>
            ))}
          </section>

          <section className="mt-8">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
              {t("owner.dashboard.recent_activity")}
            </h2>
            <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900">
              {q.data.recentActivity.length === 0 ? (
                <div className="px-4 py-6 text-sm text-zinc-500">
                  {t("owner.dashboard.no_activity")}
                </div>
              ) : (
                <ul className="divide-y divide-zinc-800">
                  {q.data.recentActivity.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center gap-3 px-4 py-3 text-sm"
                    >
                      <span className="font-mono text-xs text-zinc-500">
                        {new Date(a.createdAt).toLocaleString()}
                      </span>
                      <span className="text-zinc-300">
                        {a.actorName ?? a.actorId ?? "system"}
                      </span>
                      <span className="font-mono text-xs text-emerald-400">
                        {a.action}
                      </span>
                      {a.targetType && (
                        <span className="text-xs text-zinc-500">
                          {a.targetType}/{a.targetId?.slice(0, 8)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 3: ConfigPage(inline edit)**

创建 `apps/web/src/pages/owner/ConfigPage.tsx`:

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSiteSettings, useUpdateSetting, type SiteSetting } from "../../lib/hooks/useSiteSettings";

export default function ConfigPage() {
  const { t } = useTranslation();
  const q = useSiteSettings();

  return (
    <div>
      <h1 className="text-2xl font-semibold">{t("owner.config.title")}</h1>
      <p className="mt-1 text-sm text-zinc-400">{t("owner.config.subtitle")}</p>

      {q.isLoading && <div className="mt-6 text-zinc-400">…</div>}
      {q.isError && <div className="mt-6 text-rose-400">{t("common.error_load")}</div>}

      {q.data && (
        <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-800 text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-3 text-left">{t("owner.config.col_key")}</th>
                <th className="px-4 py-3 text-left">{t("owner.config.col_value")}</th>
                <th className="px-4 py-3 text-left">{t("owner.config.col_description")}</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {q.data.items.map((s) => (
                <SettingRow key={s.key} setting={s} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SettingRow({ setting }: { setting: SiteSetting }) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(stringifyValue(setting.value));
  const [error, setError] = useState<string | null>(null);
  const mut = useUpdateSetting();

  const dirty = draft !== stringifyValue(setting.value);

  function onSave() {
    try {
      const parsed = parseValue(draft);
      setError(null);
      mut.mutate({ key: setting.key, value: parsed });
    } catch {
      setError(t("owner.config.parse_error"));
    }
  }

  return (
    <tr>
      <td className="px-4 py-2 font-mono text-xs text-zinc-300">{setting.key}</td>
      <td className="px-4 py-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
        />
        {error && <div className="mt-1 text-xs text-rose-400">{error}</div>}
      </td>
      <td className="px-4 py-2 text-xs text-zinc-500">{setting.description}</td>
      <td className="px-4 py-2 text-right">
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty || mut.isPending}
          className="rounded-md bg-emerald-500 px-3 py-1 text-xs font-medium text-zinc-950 hover:bg-emerald-400 disabled:opacity-40"
        >
          {mut.isPending ? "…" : t("owner.config.save")}
        </button>
      </td>
    </tr>
  );
}

function stringifyValue(v: unknown): string {
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}
function parseValue(s: string): unknown {
  // Try JSON first; fall back to bare string when it doesn't parse.
  // (Lets users type 17 or true or ["a","b"] or "literal text".)
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}
```

- [ ] **Step 4: R2Page(只读列表)**

创建 `apps/web/src/pages/owner/R2Page.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import { useOwnerR2Accounts } from "../../lib/hooks/useOwnerR2";

function fmtBytes(n: number | null): string {
  if (n === null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function R2Page() {
  const { t } = useTranslation();
  const q = useOwnerR2Accounts();

  return (
    <div>
      <h1 className="text-2xl font-semibold">{t("owner.r2.title")}</h1>
      <p className="mt-1 text-sm text-zinc-400">{t("owner.r2.subtitle_readonly")}</p>

      {q.isLoading && <div className="mt-6 text-zinc-400">…</div>}
      {q.isError && <div className="mt-6 text-rose-400">{t("common.error_load")}</div>}

      {q.data && (
        <div className="mt-6 overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-800 text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-3 py-3 text-left">{t("owner.r2.col_name")}</th>
                <th className="px-3 py-3 text-left">{t("owner.r2.col_endpoint")}</th>
                <th className="px-3 py-3 text-left">{t("owner.r2.col_bucket")}</th>
                <th className="px-3 py-3 text-right">{t("owner.r2.col_priority")}</th>
                <th className="px-3 py-3 text-left">{t("owner.r2.col_enabled")}</th>
                <th className="px-3 py-3 text-right">{t("owner.r2.col_used")}</th>
                <th className="px-3 py-3 text-left">{t("owner.r2.col_synced")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {q.data.items.map((r) => (
                <tr key={r.id} className={r.deletedAt ? "opacity-50" : ""}>
                  <td className="px-3 py-2 text-zinc-100">{r.name}</td>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-400">
                    {truncate(r.endpoint, 32)}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-400">{r.bucket}</td>
                  <td className="px-3 py-2 text-right text-zinc-300">{r.priority}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`rounded px-2 py-0.5 text-xs ${
                        r.enabled
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-zinc-700/60 text-zinc-400"
                      }`}
                    >
                      {r.enabled ? t("owner.r2.enabled_yes") : t("owner.r2.enabled_no")}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right text-zinc-300">
                    {fmtBytes(r.usedBytes)}
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-500">
                    {r.lastSyncedAt
                      ? new Date(r.lastSyncedAt).toLocaleString()
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-xs text-zinc-500">
        {t("owner.r2.crud_coming_in_b")}
      </p>
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}
```

- [ ] **Step 5: SubmissionsBridgePage**

创建 `apps/web/src/pages/owner/SubmissionsBridgePage.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { ArrowRight } from "lucide-react";
import { isLocale, type Locale } from "@ip/shared";
import { withLocale } from "../../lib/locale";

export default function SubmissionsBridgePage() {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  return (
    <div>
      <h1 className="text-2xl font-semibold">{t("owner.submissions.title")}</h1>
      <p className="mt-1 text-sm text-zinc-400">{t("owner.submissions.subtitle")}</p>
      <Link
        to={withLocale(locale, "/admin/submissions")}
        className="mt-6 inline-flex items-center gap-2 rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400"
      >
        {t("owner.submissions.go")}
        <ArrowRight size={16} aria-hidden />
      </Link>
    </div>
  );
}
```

- [ ] **Step 6: 加齐 i18n keys**

`apps/web/src/i18n/zh.json` owner 段最终版:

```json
  "owner": {
    "forbidden_title": "你没有访问权限",
    "forbidden_body": "/rosekhlifa 仅对项目所有者开放。",
    "forbidden_back": "返回首页",
    "nav": {
      "section_admin": "管理",
      "dashboard": "概览",
      "config": "全局配置",
      "r2": "R2 池",
      "submissions": "审核队列",
      "root": "站长后台",
      "back_to_site": "回主站"
    },
    "dashboard": {
      "title": "概览",
      "subtitle": "最近活动 + 关键指标",
      "published_prompts": "已发布提示词",
      "total_users": "总用户数",
      "pending_submissions": "待审核",
      "total_views": "总浏览",
      "total_likes": "总点赞",
      "total_favorites": "总收藏",
      "total_submissions": "总投稿",
      "r2_used": "R2 已用",
      "recent_activity": "最近操作",
      "no_activity": "暂无活动"
    },
    "config": {
      "title": "全局配置",
      "subtitle": "改完即时生效(submit.* 缓存 60 秒)",
      "col_key": "键",
      "col_value": "值",
      "col_description": "说明",
      "save": "保存",
      "parse_error": "JSON 解析失败"
    },
    "r2": {
      "title": "R2 池",
      "subtitle_readonly": "只读视图(M10b 加 CRUD + sync)",
      "col_name": "名称",
      "col_endpoint": "Endpoint",
      "col_bucket": "Bucket",
      "col_priority": "优先级",
      "col_enabled": "状态",
      "col_used": "已用",
      "col_synced": "上次同步",
      "enabled_yes": "启用",
      "enabled_no": "禁用",
      "crud_coming_in_b": "新增 / 编辑 / 同步等写操作将在 M10b 加入。"
    },
    "submissions": {
      "title": "审核队列",
      "subtitle": "投稿审核入口跟 /admin/submissions 共用,这里只是一个链接。",
      "go": "前往审核队列"
    }
  }
```

`apps/web/src/i18n/en.json` 对应:

```json
  "owner": {
    "forbidden_title": "Access denied",
    "forbidden_body": "/rosekhlifa is for project owners only.",
    "forbidden_back": "Back home",
    "nav": {
      "section_admin": "Admin",
      "dashboard": "Overview",
      "config": "Settings",
      "r2": "R2 Pool",
      "submissions": "Submissions",
      "root": "Owner Console",
      "back_to_site": "Back to site"
    },
    "dashboard": {
      "title": "Overview",
      "subtitle": "Recent activity + key metrics",
      "published_prompts": "Published prompts",
      "total_users": "Total users",
      "pending_submissions": "Pending review",
      "total_views": "Total views",
      "total_likes": "Total likes",
      "total_favorites": "Total favorites",
      "total_submissions": "Total submissions",
      "r2_used": "R2 used",
      "recent_activity": "Recent activity",
      "no_activity": "No activity yet"
    },
    "config": {
      "title": "Site settings",
      "subtitle": "Changes go live immediately (submit.* cached 60 s)",
      "col_key": "Key",
      "col_value": "Value",
      "col_description": "Description",
      "save": "Save",
      "parse_error": "JSON parse error"
    },
    "r2": {
      "title": "R2 Pool",
      "subtitle_readonly": "Read-only view (CRUD + sync ship in M10b)",
      "col_name": "Name",
      "col_endpoint": "Endpoint",
      "col_bucket": "Bucket",
      "col_priority": "Priority",
      "col_enabled": "Enabled",
      "col_used": "Used",
      "col_synced": "Last synced",
      "enabled_yes": "Enabled",
      "enabled_no": "Disabled",
      "crud_coming_in_b": "Create / edit / sync ship in M10b."
    },
    "submissions": {
      "title": "Submission queue",
      "subtitle": "Owner shares /admin/submissions — this is a deep link.",
      "go": "Open submission queue"
    }
  }
```

- [ ] **Step 7: 全套 4 gate**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected:
- typecheck 绿(所有 owner page 都建好了)
- lint 绿
- test 全绿:之前 baseline + Task 1-7 新加的 ~25 测试 ≈ 345+
- build 成功

- [ ] **Step 8: commit Task 8-10 合并**

```bash
git add apps/web/src/routes/index.tsx \
        apps/web/src/routes/owner-guard.tsx \
        apps/web/src/pages/owner/ForbiddenPage.tsx \
        apps/web/src/pages/owner/OwnerLayout.tsx \
        apps/web/src/pages/owner/DashboardPage.tsx \
        apps/web/src/pages/owner/ConfigPage.tsx \
        apps/web/src/pages/owner/R2Page.tsx \
        apps/web/src/pages/owner/SubmissionsBridgePage.tsx \
        apps/web/src/components/owner/OwnerSidebar.tsx \
        apps/web/src/components/owner/OwnerTopbar.tsx \
        apps/web/src/lib/hooks/useOwnerDashboard.ts \
        apps/web/src/lib/hooks/useSiteSettings.ts \
        apps/web/src/lib/hooks/useOwnerR2.ts \
        apps/web/src/i18n/zh.json \
        apps/web/src/i18n/en.json
git commit -m "feat(m10a): owner console UI — layout + dashboard + config + r2 + submissions bridge"
```

---

## 收尾

完成所有 task 之后:

- [ ] **Step 1: 全套 4 gate**

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

Expected: 全绿。新测试 ~25 个左右(Task 1 owner email 6 + Task 2 owner middleware 6 + Task 3 site-settings repo 7 + Task 5 submit-config 4 + Task 6 owner-stats 3 + Task 7 owner routes 10 ≈ 36;最终视实际可能 ±5)。总数 ≥ baseline + 25。

- [ ] **Step 2: 浏览器手测重点**

(参考 spec §9 manual matrix A-I)

启动 dev:
```bash
pnpm --filter @ip/api dev   # 后端 :3000
pnpm --filter @ip/web dev   # 前端 :5173
```

测试用例:
- **A**:非 owner 用户(role=user 或 admin 但 email 不在 OWNER_EMAILS)访问 `/zh/rosekhlifa` → ForbiddenPage(403 占位,深色,emerald 按钮)
- **B**:owner email 登录 → 访问 `/zh/rosekhlifa` → 看到 dashboard:8 个 metric 卡 + recent activity feed(若有数据)
- **C**:metric 数值跟 SQL 抽样核对(随便挑几个 SELECT COUNT(*) 看)
- **D**:点 sidebar **全局配置** → /rosekhlifa/config → 列出 25 个 settings 行
- **E**:改 `submit.daily_limit` 为 7 → 保存 → 看不到立即 error → 后端验证已生效:`curl localhost:3000/api/me/submission-quota`(若有此 endpoint)看 daily_limit 反映 7;或者改完后立刻给一个普通用户跑 submit 流程,看 limit 是 7
- **F**:改回 10
- **G**:改 `submit.allowed_mime` 为 `["image/jpeg"]` → 保存 → 上传 png 报错
- **H**:改回原数组
- **I**:`/zh/rosekhlifa/r2` 列出全部 R2 账号(含 disabled / deleted),没有写按钮,有"M10b 加 CRUD"文案
- **J**:`/zh/rosekhlifa/submissions` 显示卡片 + "前往审核队列"按钮 → 点击跳 /admin/submissions
- **K**:logout → 再点 /rosekhlifa → 重定向 OAuth 后回来 → 若 email 在 OWNER_EMAILS,正常进 dashboard

- [ ] **Step 3: 用 finishing-a-development-branch 收尾**

提示 user 4 选项(merge / PR / keep / discard)。

---

## 完成定义

- 10 个 task 全部 commit 到 `feat/m10a-owner-infra`
- 4 gate 全绿
- 测试数 ≥ baseline + 25(新增 owner middleware / site-settings repo / submit-config cache / owner-stats / owner routes 各自独立测试)
- spec §9 manual matrix A-I 项全过
- 无 schema 变更 / 无 migration(M10a 只用现有 site_settings 表)
- worktree cleanup

---

## 不在本 sprint 范围(留 M10b)

- R2 池 CRUD(新增 / 编辑 / 删除 / test connection / sync usage)
- 用户管理 + Ban + Audit log viewer
- Announcements CRUD + 前台 banner
- AI 翻译端到端(submitter 触发 → /api/translate → SubmitWizard 按钮)
- 翻译 keys 加密存储 / 速率限制 / 翻译 system_prompt 内置 fallback
- ProfileMenu 加 owner 入口(可放 M10b 一起)
- Dashboard 图表(spec 默认 MVP 不做)

---

## Self-review 已完成

1. **Spec 覆盖**(§5.x → task):
   - §5.1 概览 → Task 6(stats repo)+ Task 7(/dashboard 路由)+ Task 10(DashboardPage)
   - §5.2 R2 池只读 → Task 7(/r2-accounts 路由 + r2-accounts repo 扩展)+ Task 10(R2Page)
   - §5.3 全局配置 + DB-backed config → Task 3(site-settings repo)+ Task 4(seed)+ Task 5(submit-config 改造)+ Task 7(/settings 路由)+ Task 10(ConfigPage)
   - §3 路由保护 → Task 1(env + session callback)+ Task 2(requireOwner)+ Task 8(SPA 路由 + Guard)+ Task 9(OwnerLayout)
   - §5.4-5.8 用户/日志/公告/翻译/设置 → 全部留 M10b

2. **No placeholders**:每 step 有具体代码块或精确命令。
   - Task 6 owner-stats 提醒 verify schema 字段名(viewCount vs view_count)— Drizzle 习惯用 camelCase TS,SQL 是 snake_case,以实际为准。
   - Task 7 Step 1 r2-accounts 扩展提醒 verify usedBytes/lastSyncedAt 列名。

3. **Type 一致性**:
   - `Setting` type(repo 内)/ `SiteSetting` type(web hook)字段一致:key/value/description/updatedAt/updatedBy
   - `DashboardMetrics` 字段在 repo / route / web hook / DashboardPage 全部 8 项 publishedPrompts/totalUsers/pendingSubmissions/totalViews/totalLikes/totalFavorites/totalSubmissions/totalR2UsedBytes 一致
   - `OwnerR2Account` 字段在 repo / hook / R2Page 都用 id/name/accountId/endpoint/bucket/publicUrl/priority/enabled/usedBytes/lastSyncedAt/deletedAt/createdAt 一致
   - `isOwner` 在 session.user(API)/ Session.user(web 类型)/ OwnerGuard 三处用同名
   - `WRITABLE_SETTING_KEYS` Set 跟 DEMO_SITE_SETTINGS 的 keys 一一对应(都是 25 个)

4. **Scope 完整性**:M10a 单独可 ship(deployable)— owner 能登录 + 浏览所有只读视图 + 改 site_settings(包括 translator.enabled 提前 toggle)。审稿入口指向已有的 /admin/submissions。
