# Sprint 3 / M10 — `/rosekhlifa` Owner Console

**Date:** 2026-06-08
**Status:** Brainstorm 完成,可能拆 M10a / M10b 实现
**Scope:** 仅项目所有者可访问的超级管理控制台
**Visual reference:** 用户提供"晚归管理端"截图 — 深色主题 + 绿色 accent + 卡/列表切换 + 左 sidebar 分组
**Baseline:** main(M9 之后)

---

## 1. Goal

给项目所有者(就是你)一个集中控制台,看全局数据 / 管 R2 池 / 调全局配置 / 管用户 / 看日志 / 发公告。所有"管理整个网站"的操作都从这里走,跟普通审核员的 `/admin/submissions`(只审稿)严格分离。

## 2. Non-Goals

- 自动化运维(如自动备份、自动伸缩)— 留给 M11
- 实时报警(短信/邮件)— 太重,不做
- 多 owner 协作(版本控制、操作 review)— YAGNI,只你一人用
- 公开 API / webhook — 不做
- 客服 / 工单 — 不做

---

## 3. 路由保护

**新 env**:`OWNER_EMAILS=2221542777@qq.com`(可逗号分隔,跟 ADMIN_EMAILS 同结构,但更严)

**路由保护策略 ASK USER**:

**方案 A**(推荐):**新 role 'owner'**
- 改 `userRoleEnum` enum:`'user' | 'moderator' | 'admin' | 'owner'`(需要 ALTER TYPE migration)
- Auth.js session callback 顺序:OWNER_EMAILS 命中 → role='owner';其次 ADMIN_EMAILS 命中 → 'admin';否则 keep DB role
- `requireRole('owner')` 中间件保护 `/api/owner/**`
- 优点:数据库可查询所有 owner 用户 / 角色层级明确
- 缺点:多一次 migration

**方案 B**:**保留 admin role + email 白名单**
- `OWNER_EMAILS` 单独检查,session callback 不动 role
- 新中间件 `requireOwnerEmail()` 读 env,跟 session.email 比对
- 优点:无 schema 变更
- 缺点:role 字段不反映实际权限层级

**默认 A**(更干净,后续扩展性强)。

---

## 4. UI / 布局

### 4.1 视觉风格(对齐用户参考截图)

- **主题**:深色(`bg-zinc-900` / `bg-zinc-950`)+ 绿色 accent(`emerald-500` 系)。完全独立于主站的 Apple HIG 浅色主题。
- **顶部**:左侧 logo + 副标题"仅供运维",右上 "OWNER" badge,中间 breadcrumb/搜索
- **左侧 sidebar**:分组的导航(下方详列)
- **主区**:数据展示,支持卡 / 列表 双视图切换(右上 toggle)
- **响应式**:桌面优先,手机降级(sidebar collapse 成 hamburger)

### 4.2 Sidebar 分组

```
管理
├── 概览          /rosekhlifa
├── R2 池         /rosekhlifa/r2
├── 全局配置      /rosekhlifa/config
├── 用户          /rosekhlifa/users
├── 审核队列      /rosekhlifa/submissions      ← 链到 /admin/submissions(M4)
├── 日志          /rosekhlifa/audit
├── 公告          /rosekhlifa/announcements
└── 设置          /rosekhlifa/settings
```

---

## 5. 子系统详细设计

### 5.1 概览 / Dashboard(`/rosekhlifa`)

**Metrics 卡(4-8 个)**:
- 总 prompts 数(已发布)
- 总用户数
- 待审核投稿数(直接链到审核队列)
- 总浏览数 / 总赞数 / 总收藏数 / 总投稿数
- 已用 R2 存储(字节,按 `r2_accounts.used_bytes` SUM)
- 近 7 天日活(去重 view_log 的 user_id + ip_hash 数,按 day)

**图表(可选,不强制 MVP)**:
- 投稿提交趋势(近 30 天,line chart)
- 最受欢迎 prompts top 10(按 likes desc)
- 最活跃用户 top 10(按发布数)

**Recent activity feed**(最近 audit_log 20 条):
- 时间 + actor + action + target 一行
- 链到日志 viewer 查详情

**Files:**
- `apps/api/src/repositories/owner-stats.ts` — 大查询
- `apps/api/src/routes/owner.ts` — GET /api/owner/dashboard
- `apps/web/src/pages/owner/DashboardPage.tsx`

### 5.2 R2 池管理(`/rosekhlifa/r2`)

**列表视图**(默认表格):
- 列:name / account_id / endpoint(截断)/ bucket / priority / enabled / used_bytes(字节 → 易读)/ created_at
- 行操作:编辑 / 禁用 / 启用 / 软删

**编辑/新增模态**:
- 字段:name / account_id / endpoint / access_key_id / **secret(写入时,显示后立刻 mask)** / bucket / public_url / priority / enabled
- secret 加密前端发明文,后端用 R2_ENCRYPTION_KEY 加密后写入(复用 `encryptSecret`)
- 新增 ≠ seed:r2 — seed 脚本会被废弃,后续都通过 UI

**Test connection 按钮**:
- HEAD 一个不存在的 key,看返回 4xx 状态。200/4xx 都算 OK(说明能连);超时/5xx 算失败。

**Sync usage stats 按钮**:
- 触发后端跑 ListObjectsV2 + sum sizes → 写回 `r2_accounts.used_bytes` + `last_synced_at`
- 异步任务(setTimeout 内跑或简单 enqueue,M10 不引入 job queue)

**新 API**:
- `GET /api/owner/r2-accounts` — 列出全部(含 disabled / soft-deleted)
- `POST /api/owner/r2-accounts` — 新增
- `PATCH /api/owner/r2-accounts/:id` — 编辑
- `DELETE /api/owner/r2-accounts/:id` — 软删
- `POST /api/owner/r2-accounts/:id/test` — test connection
- `POST /api/owner/r2-accounts/:id/sync-usage` — 重新计算 usedBytes

**Files:**
- `apps/api/src/repositories/r2-accounts.ts`(扩展现有)— add/update/softDelete/syncUsage
- `apps/api/src/routes/owner.ts` — 上述 endpoints
- `apps/web/src/pages/owner/R2Page.tsx`

### 5.3 全局配置 / Site Settings(`/rosekhlifa/config`)

**新表 `site_settings`**:
```sql
CREATE TABLE site_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES users(id)
);
```

**初始 keys**(seed 脚本插入):
```
submit.daily_limit                  10
submit.demoted_daily_limit          5
submit.demote_threshold             3
submit.guidelines_version           1
submit.max_images_per_submission    5
submit.max_image_size_bytes         10485760  (10 MB)
submit.allowed_mime                 ["image/jpeg","image/png","image/webp"]
submit.max_tags                     6
submit.presign_ttl_seconds          900
submit.reject_reason_max_chars      500
submit.daily_reset_timezone         "Asia/Shanghai"
```

**改造**:把现有 `apps/api/src/lib/submit-config.ts` 的硬编码常量改成 **lazy-loaded cache from DB**。
- `getSubmitConfig()` 异步函数,从 DB 读所有 `submit.*` keys,缓存 60 秒
- 现有路由调用 `SUBMIT_CONFIG.DAILY_LIMIT` 全部改成 `(await getSubmitConfig()).dailyLimit`
- 或者更保险:启动时一次读到内存,owner 改完后自动 invalidate cache(简单实现:每 60 秒 refresh)

**UI**:
- 列表显示所有 `site_settings` 行,key 加 description 提示
- 行内 inline edit + 保存按钮(类型按 JSONB 推断 — number / string / array / boolean)

**新 API**:
- `GET /api/owner/settings` — 全部
- `PUT /api/owner/settings/:key` — 改一个

**Files:**
- 新 migration:`0008_site_settings.sql`
- `apps/api/src/db/schema/site-settings.ts`
- `apps/api/src/repositories/site-settings.ts`
- `apps/api/src/lib/submit-config.ts` — 重写成 DB-backed cache
- `apps/api/src/routes/owner.ts` — settings endpoints
- `apps/web/src/pages/owner/ConfigPage.tsx`

### 5.4 用户管理(`/rosekhlifa/users`)

**列表视图(默认 列表 view,可切卡片 view)**:
- 列:头像+name+id / email / role / 已发布 / 已投稿 / 被拒次数 / 加入时间 / 状态(active/banned)
- 顶部:搜索框(name/email/id)+ 筛选(role / banned / 有过 submission)
- 顶部:卡片/列表切换 toggle(模仿截图)
- 行点击 → 右侧 drawer 显示详细 + 操作

**Drawer 内容**:
- 用户基础信息
- 累计数据(同 M9 #7 的 stats)
- 此用户的 submissions 列表(最近 10 条)
- 操作:
  - 改 role:user / moderator / admin / **owner**(只能 owner 改)
  - 重置 `rejected_count` 为 0
  - **Ban / Unban**(需要新列)
  - 强制登出(invalidate sessions)
  - 删除账户(谨慎,留 audit log)

**Ban 实现**:
- `users` 表加新列 `banned_at TIMESTAMPTZ NULL` 和 `banned_reason TEXT`
- 任何被 ban 的用户访问需要登录的路由 → 401 + 客户端登出
- middleware:在 `requireUserId` 之前/之后查 banned_at,非 null 时 throw 403 + 强制登出

**新 API**:
- `GET /api/owner/users?q=&role=&banned=&cursor=&limit=` — 列表
- `GET /api/owner/users/:id` — 详细 + stats + recent submissions
- `PATCH /api/owner/users/:id` — 改 role / banned / rejected_count
- `POST /api/owner/users/:id/ban` — `{reason: string}`
- `POST /api/owner/users/:id/unban`
- `DELETE /api/owner/users/:id` — 软删(置 banned_at 远古时间 + 加 deleted_at)

**Files:**
- 新 migration:`0009_user_ban_fields.sql`
- schema update
- 新 middleware:`apps/api/src/middleware/ban-check.ts`
- 新 repository:`apps/api/src/repositories/owner-users.ts`
- 路由扩展
- `apps/web/src/pages/owner/UsersPage.tsx`
- `apps/web/src/components/owner/UserListRow.tsx` / `UserCardItem.tsx`(支持视图切换)
- `apps/web/src/components/owner/UserDrawer.tsx`

### 5.5 日志 / Audit Log Viewer(`/rosekhlifa/audit`)

- 列表显示 audit_log 行
- 列:时间 / actor(头像+name)/ action(submission.approve 等)/ target(类型+id+slug?)/ payload(展开 JSON)
- 筛选:actor / action prefix / target_type / time range
- 排序:newest first(默认)

**API**:
- `GET /api/owner/audit?actor=&action=&target=&from=&to=&cursor=`

**Files:**
- `apps/api/src/repositories/audit.ts`(扩展现有 — 加 list 函数)
- `apps/api/src/routes/owner.ts` — endpoint
- `apps/web/src/pages/owner/AuditPage.tsx`

### 5.6 公告(`/rosekhlifa/announcements`)

**新表 `announcements`**:
```sql
CREATE TABLE announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title_zh TEXT,
  title_en TEXT,
  body_zh TEXT,
  body_en TEXT,
  severity TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  target_roles TEXT[] DEFAULT ARRAY[]::TEXT[],   -- 空 = 所有人
  published_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  dismissible BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Owner UI**:
- 列表所有公告(published / draft / expired)
- 新建 / 编辑表单:双语 title + body(支持 markdown?MVP 不支持,纯文本)+ severity + target_roles 多选 + publish/expire 时间 + dismissible
- 公告 lifecycle:草稿 → 发布(写 published_at)→ 过期(写 expires_at;或自动判断)→ 软删

**前端显示**(用户侧):
- 任何 page 的 AppShell 顶部,有 active 公告就显示 banner
- banner 颜色按 severity 区分
- 用户点 X 关闭(dismissible 时) → 写入 localStorage 不再显示该公告
- 已读状态可选用 DB(`announcement_reads` 表)— MVP 用 localStorage

**API**:
- `GET /api/owner/announcements` — 全部(owner)
- `POST /api/owner/announcements` — 新建
- `PATCH /api/owner/announcements/:id` — 改
- `DELETE /api/owner/announcements/:id` — 软删
- `GET /api/announcements` — 公开 endpoint,只返回 active(published + 未过期 + 匹配 role)

**Files:**
- migration `0010_announcements.sql`
- schema + repo + routes
- `apps/web/src/components/layout/AnnouncementsBanner.tsx`(挂在 AppShell)
- `apps/web/src/pages/owner/AnnouncementsPage.tsx`
- `apps/web/src/lib/hooks/useAnnouncements.ts`(用户侧) + `useOwnerAnnouncements.ts`(owner)

### 5.7 AI 翻译辅助(原 M6,缩成工具)

集成在 `/admin/submissions/:id` 的 "编辑后批准" 面板里:
- 中英文 textarea 边上加 ["AI 翻译" 按钮]
- 点击 → POST `/api/admin/translate` `{ text, fromLocale, toLocale }`
- 后端调外部翻译 API(DeepL / OpenAI / Anthropic — `ASK USER`)
- 结果填入对面的 textarea(admin 还可继续编辑)

**Files:**
- `apps/api/src/lib/translator.ts`(新)— 抽象层,内部调 DeepL 或 OpenAI
- `apps/api/src/routes/admin.ts` — 加 POST /translate
- env:`TRANSLATOR_API_KEY` + `TRANSLATOR_PROVIDER`(deepl / openai)
- UI:`AdminEditPanel` 加按钮

**ASK USER**:用 DeepL(便宜专业)还是 OpenAI(已经有 token 余额?)— 暂搁置,M10 plan 阶段决策

### 5.8 设置 / Misc(`/rosekhlifa/settings`)

低优先级,MVP 可以是空页或者一个简单的 "site name / site description" 编辑(站点元信息)。

可包含:
- 站点标题 / 描述(SEO 用)
- 默认 locale
- 主题 logo(上传)
- 备份按钮:触发 pg_dump 一次

---

## 6. Schema 变更总览

| 改动 | Migration |
|---|---|
| `user_role` enum 加 'owner' 值 | 0007 |
| `site_settings` 新表 | 0008 |
| `users` 加 `banned_at`, `banned_reason` | 0009 |
| `announcements` 新表 | 0010 |
| (M9 已加的)`notification_type` enum 加 'prompt_liked'/'favorited' | 在 M9 阶段 |

---

## 7. 拆 M10a / M10b 建议

如果觉得一次性 M10 太重,拆:

**M10a — 路由 + 核心数据面板**:
- 路由保护(role='owner' + OWNER_EMAILS)
- Owner Console 布局 + 深色主题
- 概览 dashboard(metrics + recent activity)
- 全局配置 site_settings(MVP 只调几个关键 key,不全)
- R2 池管理(read-only 列出现有,write 留 M10b)

**M10b — 用户/日志/公告 + R2 写 + 翻译**:
- 用户管理 + ban 系统
- Audit log viewer
- Announcements CRUD + 前台 banner
- R2 池 CRUD(新增 / 编辑 / 删除 / sync usage)
- AI 翻译工具

**默认**:拆。M10a 先做,验证整套架构后,M10b 跟进。

---

## 8. Open Questions

1. **路由保护方案**:A(新 owner role)or B(email 白名单)?**默认 A**
2. **M10 vs M10a/M10b**:一次干完 vs 拆?**默认 拆**
3. **公告 markdown 支持**:MVP 用纯文本 vs 上 markdown?**默认 纯文本**
4. **翻译 provider**:DeepL / OpenAI / Anthropic / Google?**ASK USER**
5. **owner 也能直接审稿吗**:还是只通过 `/admin/submissions` 走?**默认 owner 可以走 /admin 路径(role inherit)**
6. **数据面板图表库**:Chart.js / Recharts / 不做?**默认 MVP 不做,只列 metrics 数字**
7. **R2 sync-usage 多大账号会慢?**:listObjects 分页,小账号几秒,大账号数分钟。需要异步任务 + 状态 反馈。MVP 可同步阻塞(几秒到几分钟 — 显示 loading)
8. **announcements 国际化**:必须双语都填 vs 其中一个为空也行?**默认 双语都必填,但可以是同一文字**
9. **多 R2 账号迁移 prompts 之间**:owner console 要不要支持"从 A 账号迁到 B 账号"?**默认 不做 — 这是 M11 内容**

---

## 9. Manual test matrix(M10 收尾后)

```
A. 非 owner 用户访问 /rosekhlifa/* → 403
B. owner 访问 /rosekhlifa → dashboard 显示
C. dashboard 显示 4-8 个 metric card,数值合理(跟 SQL 查询对比)
D. dashboard recent activity 显示最近 audit log
E. /rosekhlifa/r2 列出 r2_accounts,有 + 按钮
F. 新增 R2 账号 → 表单 → 提交 → 列表出现新行
G. 改 R2 账号优先级 → 保存 → 列表更新
H. 软删 R2 → 列表标记 disabled,但 prompt_images 仍能加载(账号没真删)
I. /rosekhlifa/config 显示 11 个 site_settings,改 daily_limit 为 20 → 立刻生效(普通用户日限额变 20)
J. /rosekhlifa/users 列表 25+ 用户(种子 + 测试创建),搜索 / 筛选 work
K. 切到卡片 view → 显示模式变化
L. 点用户 → 右侧 drawer,有详细 + 操作按钮
M. Ban 用户 → drawer 关闭 → 该用户 session 失效;用户访问需要登录的页 → 强制登出
N. Unban → 该用户可正常登录
O. /rosekhlifa/audit 显示 audit log,filter by action 'submission.approve' → 只剩这些行
P. /rosekhlifa/announcements 新建公告(双语 + warning severity + dismissible)→ published
Q. 普通用户登录看到顶部 banner,点 X 关闭 → localStorage 记录 → 刷新不再显示
R. owner 编辑公告 expires_at 改成已过期 → 普通用户不再显示
S. /admin/submissions/:id 编辑面板加"AI 翻译"按钮 → 点击 → 自动填入对面 textarea
```

---

## 10. 完成定义

- M10a / M10b 全部 task merge 到 main(或一次 M10 干完)
- 4 gate 全绿
- 4 个新 migration(0007-0010)安全应用
- §9 Manual test matrix 全过
- owner 能从 /rosekhlifa 操作所有内容(包括跟 /admin 重复的审稿入口)
- 路由保护对 admin / moderator 用户也生效(他们看不到 /rosekhlifa)
