# Sprint 2 / M9 — 用户侧补完(B + C 类)

**Date:** 2026-06-08
**Status:** Brainstorm 完成,待 user 决策开放问题后写 plan
**Scope:** 8 项历史漏功能 + 产品架构调整,所有非所有者用户能直接感受到的体验
**Baseline:** main(M4 polish 之后)

---

## 1. Goal

把 M1-M5 中漏掉的"对真实非自己用户而言核心"的功能补完:用户主页、上传者信息、点赞/收藏通知、搜索、显眼投稿入口、个人主页统计、首页 tabs 重组、投稿 modal 化。让普通用户访问体验完整。

## 2. Non-Goals

- 任何管理端功能(留给 M10)
- 部署 / 种子迁移(留给 M11)
- 关注/粉丝系统(超出范围,M12+ 再说)
- 用户头像上传(M9 复用 OAuth provider 头像)
- 评论 / 转发(无)

## 3. 待修项细化设计

### 3.1 显眼投稿按钮(#2)

**问题**:现在只有 sidebar 有个 "投稿" 文字链。新用户根本看不到。

**方案**(选 1):

**A.**(推荐)**Header 顶部右侧加 CTA 按钮** + **Sidebar 链接保留**
- 位置:AppShell 顶部右侧,在通知 bell 左边、ProfileMenu 右边
- 样式:bg-accent text-white,加 `Plus` lucide icon + 文字"投稿"
- 行为:点击 → 打开投稿 modal(#3 改了的)
- 未登录:点击 → SignInModal,登录后回到当前页 +(可选)弹投稿 modal

**B.** Floating "+" FAB(右下角悬浮按钮)
- 移动端友好,桌面端也可
- 跟小红书/Instagram 一致
- 桌面端可能跟 ScrollToTop / Help 按钮挤,需要 z 顺序设计

**C.** A + B 一起做 — 桌面端 header CTA + 移动端 FAB

**决策**:A(简单可靠,跟 Apple HIG 风格一致)。如果后续移动端表现差再加 B。

**Files:**
- `apps/web/src/components/layout/AppShell.tsx` — 加新 button
- 复用 `Plus` icon from lucide-react

### 3.2 卡片真实头像 + 用户名(#6)

**问题**:PromptCard hover 显示 "匿名" + 空头像。`PromptSummary` 没带 contributor 信息。

**Schema 改**:`PromptSummarySchema` 加:
```ts
contributor: z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  image: z.string().url().nullable(),
}).nullable(),  // null 表示种子数据(no contributor)
```

`PromptDetailSchema` 自动继承。

**仓库改**:`apps/api/src/repositories/prompts.ts` 的 `listPrompts` + `getPromptBySlug` 加 `leftJoin(users, eq(prompts.contributorId, users.id))`,select 出 user 的 id/name/image。

**前端改**:
- `PromptCard.tsx` 的 hover overlay:
  - 把"匿名"硬编码改成 `prompt.contributor?.name ?? t("common.anonymous")`
  - 把空 div 头像改成 `<img src={contributor.image} />` 或占位 SVG
  - 把名字 + 头像包成 `<Link to={withLocale(locale, `/users/${contributor.id}`)}>` (跳用户主页 #7)
  - 种子数据(contributor=null)继续显示"匿名"占位

**头像 fallback**:用户 image 为 null(OAuth 没返回头像)时,用首字母圆形占位:
- 取 name 的首字符
- 背景颜色按 user.id hash 出确定颜色
- 工具函数:`apps/web/src/lib/avatar.ts`

**Files:**
- `packages/shared/src/schemas/prompt.ts` — schema 扩展
- `apps/api/src/repositories/prompts.ts` — join users
- `apps/api/src/routes/prompts.test.ts` — 测试新字段
- `apps/web/src/components/PromptCard.tsx` — 显示 + 链接
- `apps/web/src/components/Avatar.tsx`(新)— 头像 component(image + fallback)
- `apps/web/src/lib/avatar.ts` — 颜色 hash + 首字符提取

### 3.3 详情页 uploader + 用户主页(#7)

**两块**:详情页加 uploader 信息 + 新建用户主页路由。

#### 3.3.1 详情页 uploader

**改 PromptDetailPage**:
- 在 prompt 内容区(标题之下、prompt 文本之上),加一个 "by <Avatar + Name>" 行
- 点 → 跳用户主页 `/zh/users/{id}`
- 显示 uploader 的累计统计("X 篇投稿 · Y 总浏览 · Z 总赞"):
  - 需要新 API:`GET /api/users/:id/stats` 返回 `{publishedCount, totalViews, totalLikes, totalFavorites}`
  - 或者一次性塞到 PromptDetailSchema 里(profile 字段大):`uploaderStats: { publishedCount, ... }`
  - **决策**:单独 API,缓存友好,且用户主页也用同一个 endpoint。

#### 3.3.2 用户主页 `/zh/users/:id`

**URL ASK USER**:`/zh/users/:id`(UUID)vs `/zh/u/:slug`(username slug)。
- UUID:简单,无需新表字段,URL 不友好(看不出谁)
- Slug:友好 URL,但要给 users 表加 username slug + 唯一约束 + 注册时生成 + 允许用户改
- **默认**:UUID(YAGNI,先简后扩)。如果后续需要 SEO 友好 URL,再加。

**页面结构**:
- 顶部 hero:大头像 + 用户名 + 加入时间 + 角色 badge(admin/moderator/user)
- 数据卡(下 #13 一样的):发布、浏览、赞、收藏
- Tabs:
  - **作品**:此用户已发布的 prompts(waterfall 同首页)
  - **收藏**(可选,**ASK USER**):此用户公开的收藏。隐私默认是 — 仅自己可见。

**隐私默认**:
- 已发布 prompts:**公开**(本来就是公开的 prompts)
- 数据卡 counts:**公开**
- 收藏:**仅自己可见**(在自己的用户主页可看,别人看不到这个 tab)
- 邮箱:**永远不公开**

**新 API**:
- `GET /api/users/:id` → `{id, name, image, role, joinedAt}`(去掉 email)
- `GET /api/users/:id/stats` → `{publishedCount, totalViews, totalLikes, totalFavorites}`
- `GET /api/users/:id/prompts?cursor=&limit=` → 此用户的 published prompts
- `GET /api/users/:id/favorites` → **只有 :id == currentUser 时返回**;否则 403。

**Files:**
- 新仓库 `apps/api/src/repositories/users-public.ts` — getUserPublic / getUserStats / listUserPrompts
- 扩展 `apps/api/src/routes/users.ts`(新文件)— 3 个 GET endpoints
- 新 hook `apps/web/src/lib/hooks/useUser.ts` + `useUserStats.ts` + `useUserPrompts.ts`
- 新 page `apps/web/src/pages/UserPage.tsx`
- 新 component `apps/web/src/components/profile/StatsCard.tsx`(共享给 #13)
- Route in `apps/web/src/routes/index.tsx`:`users/:id`(嵌套在 `:locale/` 下)

**详情页改**:
- `apps/web/src/pages/PromptDetailPage.tsx` 加 uploader 行,复用 Avatar + StatsCard 缩略版

### 3.4 点赞 / 收藏触发通知(#8)

**Schema 改**:扩展 `notification_type` enum,加两个值:
```sql
ALTER TYPE notification_type ADD VALUE 'prompt_liked';
ALTER TYPE notification_type ADD VALUE 'prompt_favorited';
```

**Payload 类型(TS)**:
```ts
type NotificationPayload =
  | { submissionId, promptId, promptSlug, titleZh, titleEn }
  | { submissionId, reason, titleZh, titleEn }
  | { promptId, promptSlug, titleZh, titleEn, actorId, actorName }  // liked / favorited 共用
```

**触发点**:
- `apps/api/src/routes/interactions.ts` 的 `POST /:id/like` 路由,toggleLike 成功且是 "新增 like"(不是 undo)时,**给 prompt 的 contributor 插 notification**。
- 同样 favorite。
- 不给自己发(actor === contributor 跳过)
- 防 spam:同一对 (actor, prompt, type) 只发一次(去重通过 notifications.payload->>actorId + 唯一索引)。或者每次都发 — 大型应用会按时间窗 collapse,但 MVP 每次都发也行。
  - **决策**:每次都发,简单。**ASK USER**:你想要"小红 1"还是聚合成"3 人赞了你的 X"?
  - **默认**:每次都发,通知列表显示"<actor> 赞了你的《X》"。

**Files:**
- 新 migration:`0007_notification_types_for_interactions.sql` — ALTER TYPE
- `apps/api/src/db/schema/notifications.ts` — `notificationTypeEnum` 加值 + payload 类型 union 扩展
- `apps/api/src/repositories/notifications.ts` — `createNotification` 接受新 type
- `apps/api/src/routes/interactions.ts` — 触发 createNotification(在 toggleLike/toggleFavorite 成功且 is_new=true 时)
- `apps/web/src/i18n/locales/*.json` — 加 `notifications.prompt_liked` / `prompt_favorited` 文案
- `apps/web/src/components/notifications/NotificationsList.tsx` — 加新 type 的渲染分支 + 点击跳 prompt 详情

**测试**:
- routes/interactions.test.ts:like 一个别人的 prompt → assert notification 写入;like 自己的 → 不写。
- 同 favorite。

### 3.5 搜索功能(#14)

**当前**:M1 有搜索框但后端 noop。

**实现方案**:Postgres 全文索引 vs ILIKE substring。

**决策**:MVP 用 ILIKE + 简单的 ORDER BY 综合分(usageCount + viewCount + likeCount)。Postgres `tsvector` 中文分词麻烦,需要装 `zhparser` 插件。等数据规模上来再升级。

**API**:
- `GET /api/prompts?q=<keyword>&...`(扩展现有 listPrompts)
- 后端 WHERE 条件加:`(title->>'zh' ILIKE %q% OR title->>'en' ILIKE %q% OR prompt->>'zh' ILIKE %q% OR prompt->>'en' ILIKE %q%)`
- 同时支持 tag 匹配(`EXISTS (SELECT 1 FROM prompt_tags pt JOIN tags t ON pt.tag_id = t.id WHERE pt.prompt_id = prompts.id AND (t.slug ILIKE %q% OR t.name->>'zh' ILIKE %q% OR t.name->>'en' ILIKE %q%))`)
- 排序:有 q 时按相关度?MVP 按现有(approvedAt DESC),后续看搜索词在不同字段加权。

**前端**:
- `apps/web/src/components/layout/Header.tsx`(或现有搜索框位置)— input 输入后 debounce 300ms,触发 `useSearchParams({ q: trimmed })`
- HomePage `useListPrompts` 读 `searchParams.get('q')` 传给 API
- 加"清空" X 按钮
- (可选)输入框右边显示"找到 X 条结果"

**Files:**
- `apps/api/src/repositories/prompts.ts` — listPrompts 加 q 参数
- `apps/api/src/routes/prompts.ts` — query schema 加 q
- `apps/api/src/routes/prompts.test.ts` — 加搜索测试
- `apps/web/src/lib/hooks/useListPrompts.ts` 或类似 — 传 q
- `apps/web/src/components/SearchBox.tsx`(新或改现有)

### 3.6 投稿页 → modal(#3)

**当前**:`SubmitPage` 是整页(`/zh/submit` 单独路由)。

**改成**:
- 投稿是 modal,从 header 那个新加的 CTA 按钮(#2)触发
- modal 内仍包 `CommunityGuidelinesGate` + `SubmissionForm`
- 关闭 modal = 用户主动关或者投稿成功 → 自动关
- 路由 `/zh/submit` **保留**为 deep-link 入口:访问该 URL → 自动打开 modal,关闭时回到首页(替换 URL)

**实现细节**:
- 把 `SubmitPage` 重构成 `SubmitModal`,放进 AppShell 层(或全局 layout)由全局 `useUiStore` 控制开关
- Header CTA 按钮点击 → `useUiStore.openSubmitModal()`
- `/zh/submit` 路由对应一个空 page,onMount 调 `openSubmitModal()`,onUnmount 调 `closeSubmitModal()`

**Files:**
- `apps/web/src/components/submit/SubmitModal.tsx`(改造自 `SubmitPage`)
- `apps/web/src/state/uiStore.ts` — 加 submitModal 状态
- `apps/web/src/pages/SubmitPage.tsx` — 缩成 trigger-only(打开 modal + replace URL)
- AppShell 加全局 `<SubmitModal />` 挂载

### 3.7 首页 tabs 重组 + logo 副标题(#12)

**新结构**(HomePage 顶部):
```
LOGO Image-Prompts
本站已收录 2384 条图片提示词
[ 画廊 ] [ 我的收藏 ] [ 我的投稿 ] [ 关于 ]
```

- **画廊**(default,匿名也能看):当前 HomePage 的瀑布流
- **我的收藏**(仅登录):用户收藏的 prompts,瀑布流,内容跟 M5 FavoritesTab 一样
- **我的投稿**(仅登录):用户发布过的 prompts(只 approved 的,展示给"作品"导向),瀑布流。**注意**:这不是"我的所有 submissions"(pending/rejected 不在这里);pending/rejected 留在 `/profile?tab=submissions` 给用户自己看状态。
- **关于**:现有 AboutPage 内容

**URL 处理**:`/zh/?tab=collection` / `/zh/?tab=my-submissions` / `/zh/?tab=about` / 默认 `/zh/` 是画廊

**logo 副标题**:
- 数据来源:新 API `GET /api/stats/summary` 返回 `{publishedCount}`(也可以聚合更多:`{publishedCount, userCount, totalViews}`)
- 副标题文本:`t("home.subtitle_published_count", { count: data.publishedCount })`
- 加 cache:30 分钟

**Files:**
- `apps/web/src/pages/HomePage.tsx` — 加 tabs + URL 同步
- `apps/api/src/routes/stats.ts`(新)— GET /api/stats/summary
- `apps/api/src/repositories/stats.ts`(新)
- `apps/web/src/lib/hooks/useStats.ts`(新)
- 现有 `ProfilePage` 的 "我的收藏" / "我的投稿(approved)" 这两个 tab 的内容**搬到** HomePage tabs;原 tabs **保留**用于显示 pending/rejected 状态。
- `apps/web/src/i18n/locales/*.json` — 加 `home.tab_*` keys + `home.subtitle_published_count`

**ProfilePage 的命运**:
- 不弃用,但缩简
- 留 "资料"(基础信息,可改 name?)、"我的收藏"(改成 — 仅显示)、"我的投稿"(状态列表,所有状态)、数据卡(#13)
- **ASK USER**:首页 tabs 跟 profile tabs 内容重叠会不会冗余?要不要直接把"我的收藏"完全搬到首页 tab,profile 里去掉这个 tab?
  - **默认**:首页 tabs 是"作品库"视角(只看 approved 内容),profile tab 是"我的全部状态"视角。两者并存。

### 3.8 个人主页数据卡片(#13)

**`/zh/profile` 加数据卡区**(在标签上方或下方):

```
┌─────────────┬─────────────┬─────────────┬─────────────┐
│ 已发布      │ 总浏览       │ 总赞        │ 总收藏       │
│   34        │   12,453    │   872       │   215        │
└─────────────┴─────────────┴─────────────┴─────────────┘
```

**数据来源**:复用 #7 的 `GET /api/users/:id/stats`(传 current user id)。

**复用**:用户主页(#7)和个人主页都用同一个 `<StatsCard>` 组件。

**Files**:跟 #7 共享。

---

## 4. 路由结构(M9 之后)

```
/                              → /zh
/:locale                       → HomePage(tabs: 画廊/收藏/投稿/关于)
/:locale/prompts/:slug         → PromptDetailPage
/:locale/users/:id             → UserPage(新)
/:locale/profile               → ProfilePage(缩简,留 资料/状态/数据卡)
/:locale/submit                → 触发 SubmitModal(URL 保留)
/:locale/admin/submissions     → AdminSubmissionsPage(M4,审核员看)
/:locale/admin/submissions/:id → 同
```

`/:locale/about` 可能不存在了(并入首页 tab),但保留 redirect 到 `/zh/?tab=about` 也行。

---

## 5. Schema 变更总览

新表:**无**(用户主页用 users 表即可)

新列:**无**

ENUM 扩展:
- `notification_type` 加 `prompt_liked` / `prompt_favorited`

新 schema(@ip/shared):
- `PromptSummarySchema.contributor`(扩展)
- `UserPublicSchema`、`UserStatsSchema`
- `NotificationPayload` union 扩展

---

## 6. API 变更总览

| 路由 | 新 / 改 | 说明 |
|---|---|---|
| `GET /api/prompts` | 改 | 加 `?q=` 搜索;响应 contributor 字段 |
| `GET /api/prompts/:slug` | 改 | 响应 contributor |
| `GET /api/users/:id` | 新 | 公开用户信息 |
| `GET /api/users/:id/stats` | 新 | 累计统计 |
| `GET /api/users/:id/prompts` | 新 | 此用户发布的 prompts |
| `GET /api/users/:id/favorites` | 新 | **仅 owner 自己** |
| `GET /api/stats/summary` | 新 | 全站统计(首页 logo 副标题) |
| `POST /api/prompts/:id/like` | 改 | 触发 notification |
| `POST /api/prompts/:id/favorite` | 改 | 触发 notification |

---

## 7. 前端模块新增

```
src/
├── pages/
│   ├── UserPage.tsx                   # 新
│   ├── HomePage.tsx                   # 改:加 tabs
│   ├── ProfilePage.tsx                # 改:精简
│   └── SubmitPage.tsx                 # 改:仅作 modal trigger
├── components/
│   ├── Avatar.tsx                     # 新
│   ├── profile/StatsCard.tsx          # 新(共享给 user / profile / detail uploader)
│   ├── submit/SubmitModal.tsx         # 新(从 SubmitPage 改造)
│   └── SearchBox.tsx                  # 新或改现有
├── lib/
│   ├── avatar.ts                      # 新:颜色 + 首字符
│   └── hooks/
│       ├── useUser.ts                 # 新
│       ├── useUserStats.ts            # 新
│       ├── useUserPrompts.ts          # 新
│       └── useStats.ts                # 新(站点 summary)
└── state/
    └── uiStore.ts                     # 改:加 submitModal state
```

---

## 8. Open Questions(ASK USER)

1. **用户主页 URL**:`/zh/users/:id` (UUID)还是 `/zh/u/:slug`(需要 username slug)?**默认 UUID**。
2. **点赞通知频率**:每次都发 vs 按小时聚合("3 人赞了你的 X")?**默认每次都发**。
3. **用户主页 favorites tab**:别人能不能看?**默认仅自己可见**。
4. **ProfilePage 简化策略**:精简后保留哪些 tab?**默认 保留 资料 + 状态 + 数据卡**;首页 tabs 与之并存(不同视角)。
5. **搜索匹配范围**:title + prompt + tag 三层匹配,还是只 title + tag?**默认 三层**。
6. **首页副标题 publishedCount 缓存窗口**:30 分钟够吗?**默认 30 min**。

---

## 9. Manual test matrix(执行后跑)

```
A. 未登录访问 /zh/ → 首页瀑布卡片显示真实头像 + 用户名(种子的显示"匿名")
B. 卡片 hover 看到 Author 链接,点击 → 跳 /zh/users/:id 用户主页
C. 用户主页显示:头像/名字/角色/加入时间/数据卡/作品 tab(瀑布流)
D. 别人的用户主页 收藏 tab → 不可见 / 403
E. 自己的用户主页 收藏 tab → 可见
F. 详情页 prompt → 标题下方显示 "by <头像 + 名字>",点击跳用户主页
G. 详情页显示 uploader 数据卡缩略(发布/浏览/赞)
H. 给别人的 prompt 点赞 → 那位 uploader 应该有新通知 "X 赞了你的《Y》"
I. 给自己 prompt 点赞 → 不发自己通知
J. 给别人 prompt 收藏 → 同 H,type=favorited
K. Header 顶部右侧出现"+ 投稿"按钮,未登录点击 → SignInModal,登录后弹投稿 modal
L. /zh/submit 直接访问 → 投稿 modal 自动打开
M. 投稿 modal 关闭 → URL 退回到关闭前的页(或首页)
N. 首页 tabs:画廊默认;切到 我的收藏 → 仅自己 favorited;切到 我的投稿 → 仅自己 approved
O. 首页 logo 下显示 "本站已收录 XXXX 条图片提示词"
P. 个人主页 /zh/profile 显示数据卡(4 个数字)
Q. 搜索框输入 "肖像",列表过滤到包含"肖像"的卡片(title/prompt/tag 任一命中)
R. 搜索清空(点 X 或 backspace),列表恢复全部
```

---

## 10. 完成定义

- 全部 8 项 lookup 表里的 task 完成 + merge 到 main
- 4 gate(typecheck / lint / test / build)全绿
- 新 Manual test matrix(§9)全过
- 新加的 schema 变更(NotificationType enum)安全 migration 应用
- spec §8 的 Open Questions 都已在 plan 阶段被用户回复
- 用户用一个非 admin 的账号能完整体验"作为内容消费者"的所有路径
