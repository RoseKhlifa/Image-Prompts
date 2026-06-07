# M5 设计:点赞 / 收藏 / 浏览次数 + Copy/More

> **状态:** 设计中(已与用户对齐 scope / UI / API / DB)
> **依赖:** M1 (skeleton) + M3 (Auth + Send to Studio + SignInModal)
> **后续:** M6 = AI 翻译;M7 = 真举报功能(本 spec 留 More→举报占位)
> **关联 spec:** [M1 总体设计](./2026-06-06-image-prompts-design.md) §7.4(冗余字段维护)、§4.1(投稿/互动概览)、[M3 设计](./2026-06-07-m3-auth-and-send-to-studio-design.md) §6(SignInModal 复用)

---

## 1. 目标与范围

### 1.1 一句话目标

点亮 M3 留下的 4 个 disabled 按钮(详情页 Copy / Favorite / More + 卡片 hover Heart),新增 Like 按钮,记录浏览次数,在 `/profile` 加"我的收藏"tab。

### 1.2 范围内

- DB:新增 `view_log` 表(24h 去重)
- 后端:`likes` / `favorites` / `views` 3 套 endpoint + `/me/favorites` 列表 + extend GET prompts response (session-aware `userLiked` / `userFavorited`)
- 前端:
  - 详情页 4 个按钮:**Copy / Like / Favorite**(grid-cols-3) + **More**(右侧 icon-only 菜单,只占位"举报")
  - 卡片 hover Heart 从只读升级为可点 like toggle
  - `/profile` 改成 tab(资料 + 我的收藏)
- View 自动追踪:每次详情页加载触发 POST,后端去重
- Optimistic UI + 失败回滚
- 单测 + 集成测试

### 1.3 不在 M5 (YAGNI / 留后续)

| 功能 | 何时 |
|---|---|
| 真举报功能(写入 `reports` 表 + 管理后台审核) | M7 |
| 分享 / 引用 / 屏蔽(More 菜单的其他项) | M7+ |
| 通知系统(被点赞通知) | post-MVP |
| 收藏夹分类(folder / collection) | post-MVP |
| 排行榜独立页 | post-MVP(sort=liked 已够) |
| 真浏览 batch 累加(view_log → 异步 cron) | post-MVP(M5 直接同步 UPDATE) |

### 1.4 已锁定决策

| 决策 | 选定方案 |
|---|---|
| Copy 按钮 | 纯前端 `navigator.clipboard`,**无需登录**,toast 反馈 |
| Like / Favorite | 登录要求,未登录点击 → SignInModal(复用 M3 已有组件) |
| 卡片 hover Heart | 升级为可点 toggle(详情页 + 卡片状态同步) |
| More 按钮 | icon-only dropdown,M5 阶段只占位"举报"(点 → toast "即将上线") |
| View 计数策略 | 游客 + 登录都算,24h dedup;游客按 `sha256(ip).slice(0,16)`,登录按 `user_id` |
| Like 状态读取 | extend `GET /api/prompts` + `GET /api/prompts/:slug` 响应,登录时附带 `userLiked` / `userFavorited` |
| 收藏列表 | `/profile` 加 `?tab=favorites` query 切 tab,GET `/api/me/favorites` 分页 |
| UI 反馈 | Optimistic update;失败 401 弹 SignInModal,其它错误 toast + 回滚 |
| Like 已 like / unlike 未 like | 静默忽略(409 / 404 都不报错) |

---

## 2. 数据库

M1 已建好:
- `likes (user_id, prompt_id, created_at)` 复合 PK,index on `prompt_id`
- `favorites (user_id, prompt_id, created_at)` 复合 PK,index on `(user_id, created_at DESC)`
- `prompts.like_count` / `favorite_count` / `view_count` 冗余整型字段

M5 新增 **`view_log`** 表:

```ts
// apps/api/src/db/schema/interactions.ts (append)
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
    dedupIdx: uniqueIndex("view_log_dedup_idx").on(
      t.promptId,
      sql`coalesce(${t.userId}::text, ${t.ipHash})`,
      t.bucketDate,
    ),
    promptIdx: index("view_log_prompt_idx").on(t.promptId),
  }),
);
```

写入语义:
```sql
INSERT INTO view_log (prompt_id, user_id, ip_hash, bucket_date)
VALUES (?, ?, ?, CURRENT_DATE)
ON CONFLICT (prompt_id, coalesce(user_id::text, ip_hash), bucket_date) DO NOTHING
RETURNING id;
```
- 返回非空 → 新访问 → 同事务 `UPDATE prompts SET view_count = view_count + 1`
- 返回空 → 重复访问 → 什么都不做

`ip_hash` 算法:`crypto.createHash("sha256").update(ip + AUTH_SECRET).digest("hex").slice(0, 16)`
- 用 `AUTH_SECRET` 作 salt 防 rainbow table
- 16 字符前缀够区分(2^64 hash space)
- 隐私上不存原 IP

**实现备注**:Drizzle 0.38 的 `uniqueIndex(...).on(sql\`coalesce(...)\`)` 在某些版本下可能跑不通(表达式索引列推断不稳)。如遇到,plan 里 fall back:**手写迁移 SQL** 像 M3 Task 2 那样添加 unique 约束,Drizzle TS schema 里只声明`promptIdx`(普通索引),`dedup` 约束作为 SQL-only migration。功能等价。

---

## 3. API 接口契约

### 3.1 端点清单

| Method | Path | Auth | 说明 |
|---|---|:-:|---|
| POST | `/api/prompts/:id/like` | session | 创建 like + `like_count++`,409 if 已 like |
| DELETE | `/api/prompts/:id/like` | session | 删 like + `like_count--`,404 if 未 like |
| POST | `/api/prompts/:id/favorite` | session | 同 like 模式 |
| DELETE | `/api/prompts/:id/favorite` | session | 同 like 模式 |
| POST | `/api/prompts/:id/view` | 公开 | 异步去重 + view_count++(总是 204) |
| GET | `/api/me/favorites` | session | 我的收藏分页列表 |

不写 `/api/likes` / `/api/favorites` 平级路径 — 以 prompts 为根更清晰。

### 3.2 POST/DELETE `/api/prompts/:id/like`

```ts
// Request: no body
// Response 201 (POST success)
{ liked: true, like_count: number }

// Response 204 (DELETE success) — no body

// Errors
401 { error: "unauthorized" }
404 { error: "prompt_not_found" } | { error: "like_not_found" }  // DELETE 时未 like
409 { error: "already_liked" }                                    // POST 时已 like
422 { error: "validation_error", issues: [...] }                  // promptId 非 UUID
```

实现要点:
- `db.transaction`: INSERT/DELETE likes + UPDATE prompts.like_count + 1 / - 1
- INSERT 用 `ON CONFLICT DO NOTHING` + `returning("id")` — 返回空说明已 like → 409
- DELETE 用 `returning("user_id")` — 返回空说明未 like → 404

### 3.3 POST/DELETE `/api/prompts/:id/favorite`

完全对称,字段名换 `favorited` / `favorite_count`,错误码 `already_favorited` / `favorite_not_found`。

### 3.4 POST `/api/prompts/:id/view`

```ts
// Request: no body
// Response 204 always (异步去重)
```

实现:
- 无登录则 `userId = null`, `ipHash = hashIp(c.req.header("x-forwarded-for"))`
- 有登录则 `userId = session.user.id, ipHash = null`(不需要 IP)
- 执行 INSERT view_log + 条件 UPDATE prompts.view_count(见 §2)
- 不阻塞响应 — 用 `c.executionCtx?.waitUntil?.(...)` 或简单 `void asyncFn()`,直接返 204
- 失败静默(`console.warn`)— view 不重要

**前端调用时机**:`PromptDetailPage` 加载完成后(useEffect, depends on detail.data.id),fire-and-forget。

### 3.5 GET `/api/me/favorites?page=1&pageSize=24`

```ts
// Response 200
{
  items: PromptSummary[],
  total: number,
  page: number,
  pageSize: number,
  hasMore: boolean
}
```

字段同 `GET /api/prompts` response。底层 query 用 LEFT JOIN favorites WHERE user_id = $me ORDER BY favorites.created_at DESC LIMIT/OFFSET。

### 3.6 Extension: `GET /api/prompts` + `GET /api/prompts/:slug` 加 user state

**Behavior change** — 已登录时,每个 prompt 多两个字段:

```ts
// GET /api/prompts response item (logged in):
{
  ...PromptSummary fields,
  userLiked: boolean,
  userFavorited: boolean
}

// Same shape extension on /api/prompts/:slug
```

未登录:这两个字段 **不出现**(Zod schema 设 `.optional()`)。

实现:repo 函数加可选 `currentUserId?: string` 参数。如果非空,SELECT 时多两个子查询:
```ts
sql`EXISTS (SELECT 1 FROM likes WHERE likes.prompt_id = prompts.id AND likes.user_id = ${userId})`.as("user_liked"),
sql`EXISTS (SELECT 1 FROM favorites WHERE ...)`.as("user_favorited"),
```

路由层从 `c.get("authUser")?.session?.user?.id` 取 currentUserId 传下去。

### 3.7 限流

像 M3 一样加 rate limiter:
- Like/Favorite POST/DELETE:60/min/user_id + 200/min/IP
- View POST:120/min/IP(无 user 区分)

复用 M3 的 `createRateLimiter`。

---

## 4. 数据流时序

### 4.1 用户点 like(详情页)

```
浏览器                          API
   │                              │
1. 点击 Heart                     │
2. Optimistic: setUserLiked(true) │
3. setLikeCount(c => c + 1)       │
4. ─POST /api/prompts/:id/like──→ │
                                  │ verifyAuth → user.id
                                  │ tx { INSERT likes ON CONFLICT DO NOTHING
                                  │      RETURNING id;
                                  │      if id: UPDATE prompts.like_count++;
                                  │      else: throw 409 }
5. ←──201 { liked, like_count }──
6. 用 server like_count 校准本地 state(防并发 + 多 tab)
```

**失败路径**:
- 401:回滚 state,弹 SignInModal
- 409:服务器说"已 like",保留 optimistic 状态(`liked=true`),只校准 like_count
- 5xx:回滚 state,toast 错误

### 4.2 用户点 unlike

对称,DELETE → 204 → 已回滚的 optimistic 保持。404 静默(已不在 like 状态)。

### 4.3 View tracking

```
浏览器                          API
   │                              │
1. PromptDetailPage 加载完成     │
   useEffect [d.id]               │
2. ─POST /api/prompts/:id/view─→ │
                                  │ 提取 ip / userId
                                  │ INSERT view_log ON CONFLICT DO NOTHING
                                  │ if inserted: UPDATE prompts.view_count++
3. ←─204─────────────────────────
   (前端忽略响应)
```

**dev 同一会话多次访问**:24h dedup → 同 user 当天只算一次。换匿名窗口可重算(因为 ip_hash 不变,所以游客不行。但 user_id 变了或没了,所以登录用户也每天只能 +1 一次)。

---

## 5. 前端 UI

### 5.1 详情页布局(右侧 CTA 区)

```tsx
<aside>
  ...
  <SendToStudioButton ... />     {/* M3 已有 */}
  
  <div className="grid grid-cols-3 gap-2">
    <CopyPromptButton prompt={d.prompt} />
    <LikeButton promptId={d.id} initialState={{ liked: d.userLiked, count: d.likeCount }} />
    <FavoriteButton promptId={d.id} initialState={{ favorited: d.userFavorited }} />
  </div>
  
  <div className="flex justify-end">
    <MoreMenu promptId={d.id} />   {/* 28×28 icon-only,展开"举报"占位 */}
  </div>
  
  <SuggestedParams ... />
  ...
</aside>
```

### 5.2 LikeButton

状态机:
- `guest` — outline Heart + count(M3 一致),点 → 弹 SignInModal
- `idle:not-liked` — outline Heart + count,点 → `creating` → POST → `idle:liked`
- `idle:liked` — filled Heart(红 `--danger`) + count,点 → `creating` → DELETE → `idle:not-liked`
- `creating` — disabled + opacity,防双击

视觉:
```tsx
<button className={liked ? "text-danger" : "text-ink-muted"}>
  <Heart size={14} fill={liked ? "currentColor" : "none"} />
  {likeCount}
</button>
```

复用率:**详情页 + 卡片 hover** 都用这个组件(props 兼容)。

### 5.3 FavoriteButton

同 LikeButton 但用 `Star` icon,filled 时用 inline style `style={{ color: "#ffcc00" }}`(Apple Yellow,无 token,M5 不开新 token)。

### 5.4 CopyPromptButton

```tsx
const text = pickBilingual(prompt, locale) ?? "";
await navigator.clipboard.writeText(text);
toast.success(t("detail.copied"));
// fallback: textarea + execCommand("copy") + toast 同
// catch: toast.error(t("detail.copy_failed"))
```

无登录、无 backend、无 mutation。

### 5.5 MoreMenu

`useState(open)` + `useRef` + click-outside(复用 ProfileMenu 模式)。展开内容:

```tsx
<button onClick={() => toast.info(t("detail.report_coming_soon"))}>
  <Flag size={14} />
  {t("detail.report")}
</button>
```

M7 这个 onClick 改成"打开 ReportModal"。

### 5.6 卡片 hover Heart 改可点

`PromptCard` 现在 hover overlay 里:
```tsx
<span><Heart size={12} /> {prompt.likeCount}</span>
```

改成:
```tsx
<LikeButton
  promptId={prompt.id}
  initialState={{ liked: prompt.userLiked ?? false, count: prompt.likeCount }}
  variant="compact"
/>
```

加 `variant: "compact" | "full"` prop 区分尺寸(compact 小一号,无文字 label,占地小)。

> ⚠️ 点击 Heart 时阻止 `<Link>` 跳转 — `e.stopPropagation()` + `e.preventDefault()`。

### 5.7 ProfilePage tabs

```tsx
const [searchParams, setSearchParams] = useSearchParams();
const tab = searchParams.get("tab") === "favorites" ? "favorites" : "profile";

<nav className="flex gap-4 border-b">
  <button onClick={() => setSearchParams({ tab: "profile" })} className={tab === "profile" ? "border-accent" : ""}>资料</button>
  <button onClick={() => setSearchParams({ tab: "favorites" })} className={tab === "favorites" ? "border-accent" : ""}>我的收藏</button>
</nav>
{tab === "profile" ? <ProfileInfo /> : <FavoritesTab />}
```

**FavoritesTab** 内部用瀑布流(复用 M5 之前的 `Masonry`)+ 分页(复用 PromptListPage 的 Pagination)。

### 5.8 i18n 新增 keys

```jsonc
"detail": {
  "copied": "已复制",                       // 复制成功 toast
  "copy_failed": "复制失败,请手动选择",     // 复制失败 toast
  "report": "举报",                         // More 菜单项
  "report_coming_soon": "举报功能即将上线"   // M5 占位 toast
  // (M3 已有: send_to_studio / signin_required / copy_prompt / favorite / more)
}
"profile": {
  "tab_profile": "资料",
  "tab_favorites": "我的收藏",
  "no_favorites": "暂无收藏",
  "no_favorites_hint": "在任意提示词卡片或详情页点 ⭐ 收藏起来"
}
"interactions": {
  "liked": "已点赞",
  "unliked": "已取消点赞",
  "favorited": "已收藏",
  "unfavorited": "已取消收藏",
  "session_expired": "登录已过期,请重新登录",
  "rate_limited": "操作过频,请稍候",
  "generic_error": "操作失败,请重试"
}
```

英文对应同步。

---

## 6. 错误处理矩阵

| 场景 | 触发 | 用户感知 |
|---|---|---|
| Like / Favorite 未登录 | 401 | 弹 SignInModal,回滚 optimistic |
| Like 已 like / Unlike 未 like | 409 / 404 | 静默(保留客户端状态) |
| Like 限流 | 429 | toast `interactions.rate_limited` + 回滚 |
| Like 5xx | 5xx | toast `interactions.generic_error` + 回滚 |
| View 任何失败 | 任意 | 静默(`console.warn`) |
| Copy clipboard 失败 | throw | toast `detail.copy_failed`,提供 textarea fallback |
| GET /me/favorites 401 | session 过期 | 自动 navigate 回 `/?auth_error=session` |

---

## 7. 安全 / 边界

| # | 边界 | 落实 |
|---|---|---|
| 1 | Like / Favorite session 校验 | `verifyAuth()` middleware(M3 helper) |
| 2 | promptId 注入 | `c.req.param("id")` → Zod UUID 校验 |
| 3 | 限流 | M3 `createRateLimiter` 复用 |
| 4 | View ip_hash 隐私 | `sha256(ip + AUTH_SECRET).slice(0,16)` 不存原 IP |
| 5 | view_count 防作弊 | 24h dedup unique 索引;同一 ip / user 当天最多 +1 |
| 6 | userLiked 越权 | repo 函数显式接受 `currentUserId` 参数,不读其他 user 状态 |
| 7 | 卡片大量请求 | 不打 API — `userLiked` 内嵌在 list response 里,1 次请求拿 24 个 |
| 8 | 收藏私有性 | `favorites_user_idx` 保证查询仅按 user_id;无公开 endpoint 暴露其他人的收藏列表 |

---

## 8. 测试策略

### 8.1 单元(Vitest)

**shared**: `InteractionStateSchema` 加 `userLiked` / `userFavorited` 到 `PromptSummarySchema` 和 `PromptDetailSchema`(.optional())。

**api `repositories/interactions.ts`** 新建:
- `toggleLike(userId, promptId, action: "add" | "remove")` — INSERT/DELETE + count update
- `toggleFavorite(...)` 同上
- `recordView(promptId, dedupKey, isUserId)` — INSERT view_log + 条件 UPDATE
- `listMyFavorites(userId, page, pageSize)`
- 测试:happy path + 并发去重 + already_liked / not_liked errors

### 8.2 集成(Vitest + Hono `app.request`)

**`apps/api/src/routes/interactions.test.ts`** 新建:
- POST `/like` 401 / 201 / 409
- DELETE `/like` 204 / 404
- POST `/favorite` 镜像
- POST `/view` 204 + 第二次仍 204 但 view_count 不增
- POST `/view` 不同 user / IP 各加一次
- GET `/me/favorites` 401 / 200 分页

**`routes/prompts.test.ts`** 扩展:
- 已登录 GET `/api/prompts/:slug` 返回 `userLiked` / `userFavorited`
- 未登录则字段 absent

### 8.3 前端单元

- `LikeButton.test.tsx` — guest 点击弹 modal、idle 点击 → POST + optimistic + 校准、5xx 回滚
- `FavoriteButton.test.tsx` 镜像
- `CopyPromptButton.test.tsx` — clipboard mock + 失败 fallback
- `MoreMenu.test.tsx` — open / outside-click close / report 弹 toast
- `FavoritesTab.test.tsx` — 列表渲染 + 空状态 + 分页

### 8.4 手测覆盖矩阵

| # | 场景 | 期望 |
|---|---|---|
| 1 | 游客详情页点 ❤️ | 弹 SignInModal,Heart 不变 |
| 2 | 游客点 Copy | clipboard 有内容,toast "已复制" |
| 3 | 登录用户点 ❤️ | 立即 filled 红 + count +1,无延迟感 |
| 4 | 登录用户再点 ❤️ | 立即 outline + count -1 |
| 5 | 详情页 ❤️ → 返回列表 | 卡片 hover 上的 ❤️ 也是 filled(状态同步) |
| 6 | 列表卡片点 ❤️ | 立即 filled,不触发 `<Link>` 跳转 |
| 7 | 详情页停留 10s,刷新 | view_count 还是只 +1(同 user 当天 dedup) |
| 8 | 登录 → 收藏几个 → /profile?tab=favorites | 网格瀑布流展示收藏 |
| 9 | More → 举报 | toast "举报功能即将上线" |
| 10 | 慢网络下点 ❤️ | optimistic 立即响应,稍后服务器确认 |
| 11 | 失败 5xx 点 ❤️ | 视觉回滚 + toast 错误 |

---

## 9. 实现顺序提示(给 writing-plans)

1. **DB schema + migration** — `view_log` 表
2. **Shared schemas** — `InteractionStateSchema` 等
3. **`repositories/interactions.ts`** + 单测(TDD)
4. **`utils/ip-hash.ts`** + 单测
5. **`routes/interactions.ts`** + 集成测试(POST/DELETE like/favorite/view)
6. **`routes/me.ts`** — `/api/me/favorites` + 集成测试
7. **Extend prompts repo + routes** 加 `userLiked` / `userFavorited` + 测试
8. **i18n keys**(zh + en)
9. **CopyPromptButton + 测试**
10. **LikeButton(含 variant)+ 测试**
11. **FavoriteButton + 测试**
12. **MoreMenu + 测试**
13. **PromptCard hover overlay 用 LikeButton compact 替换 + e.preventDefault 防 Link**
14. **PromptDetailPage CTA 区接入新组件**(替换 grid-cols-3 disabled 占位)
15. **useView hook + PromptDetailPage 调用**
16. **ProfilePage 拆 ProfileInfo + FavoritesTab + tab 切换**
17. **手测覆盖矩阵**
18. **Spec / 代码 review 收尾**

---

## 10. 风险

| 风险 | 影响 | 对应 |
|---|---|---|
| 卡片瀑布流大量挂载 LikeButton,session hook 多次订阅 | 性能(虽 Zustand-based 还行) | LikeButton 内部 useSession,Zustand 单源,N 个组件订阅成本可控 |
| optimistic + 服务器返 409(已 like)边界 | 状态错乱 | 显式保留客户端状态,只校准 count |
| view_log 高频写入(热门 prompt) | 数据膨胀 | 24h dedup + UNIQUE 拦截,实际写入受控;后续可加 cleanup cron 删 30d 前 |
| ip_hash 用 AUTH_SECRET 做 salt | 重启服务后 hash 变 | view_log 跨重启 dedup 失效一天 — 可接受 |
| 游客 view 无法严格防作弊 | 刷榜风险 | 不在 M5 解决;M6+ 可考虑增加 referer / fingerprint |
| Heart 点击穿透 Link 导致误导航 | 点不到 like | 显式 `e.stopPropagation()` + `e.preventDefault()` |

---

## 11. 下一步

1. 用户 review 本 spec
2. 改完锁定 → 进 `writing-plans` 生成实现计划
3. 主分支拉 `feat/m5-interactions` worktree 执行(M3 模式)
