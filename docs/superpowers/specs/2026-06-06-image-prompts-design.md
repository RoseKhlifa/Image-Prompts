# Image-Prompts 设计文档

> 日期: 2026-06-06
> 项目: Image-Prompts(基于 nanobanana-website 二开,Image-Studio 配套生图提示词聚合站)
> 状态: 设计已敲定,等待评审进入实现计划

---

## 1. 项目概述

### 1.1 是什么

Image-Prompts 是一个**中英双语**的生图提示词聚合站。任何人都能浏览、搜索、收藏、点赞、分享提示词;已登录用户可以投稿;管理员审核后公开展示。**核心差异化**:每一条 prompt 都可以一键 "Send to Image-Studio",自动在桌面客户端打开并填好提示词。

### 1.2 目标用户

- **游客**: 想找一段好用的提示词去任何客户端生图
- **Image-Studio 用户**: 想从聚合站一键导入提示词到本地客户端,免去复制粘贴
- **创作者**: 想分享自己的提示词,获得点赞与影响力
- **管理员**: 维护内容质量、配置系统

### 1.3 与 Image-Studio 的关系

**定位:独立产品 + 深度集成(Steam Workshop 模式)**

- Image-Prompts 是独立站点,有独立价值,任何人都能用
- Image-Studio 是配套桌面端生图客户端
- 通过 **URI Scheme(image-studio://) + 短 token** 联动,详见 §6
- 视觉风格与 Image-Studio 保持一致(Apple HIG 风、暗色为主、Apple Blue 单色品牌)

### 1.4 与上游 nanobanana-website 的关系

本项目基于 [unknowlei/nanobanana-website](https://github.com/unknowlei/nanobanana-website) 二开,**保留并迁移其 2380 条种子提示词数据**,在 About 页明确 attribute。技术上是大重构:
- 从单文件 React + JS 重构为 TS + 多模块 + 路由 + Zustand
- 从 Vercel Serverless + Firebase 改为 VPS 自托管 + Node.js + Postgres + R2

---

## 2. 关键约束与边界

### 2.1 范围内(MVP)

- 双语提示词浏览/搜索/筛选(分类/标签/排序)
- 详情页 + Send to Studio 集成
- 用户投稿 + 管理员审核流程
- 收藏与点赞(分开两套机制)
- AI 翻译辅助(可配置开关)
- R2 账户池 + 调度
- 完整管理后台(投稿审核、tag 管理、R2 池、系统配置)
- 中英双语 UI 与内容
- 暗 / 亮 / 跟随系统 三档主题
- 完整 SEO(sitemap、robots、meta)

### 2.2 不入 MVP(YAGNI)

| 功能 | 原因 |
|---|---|
| 评论/讨论 | 先把"投稿+审核+集成"跑通,占用过多审核精力 |
| GIF 制作模块 | nanobanana 原有,与提示词业务无关 |
| 排行榜独立页 | 列表页排序已能满足 |
| 作者主页(/u/:username) | MVP 仅在详情页显示作者名,后续按需加 |
| 标签云独立页 | 左侧栏标签筛选已够 |
| 邮箱密码登录 | 仅 Google + GitHub OAuth |
| 真实 AI 内容审核 | MVP 仅关键词黑名单 + 管理员审核 |
| 排行榜算法/embedding 相似度 | 相关推荐用"同分类+共享标签",简单够用 |
| 移动 App | 仅响应式 Web |

### 2.3 已确认的关键技术决策

| 决策 | 选定方案 |
|---|---|
| 项目定位 | 独立产品 + 深度集成(Workshop 模式) |
| 数据模型核心字段 | prompt 必填、negative_prompt 与 aspect_ratio 可选 |
| 集成方案 | URI Scheme + 后端短 token |
| 架构幅度 | 中度重构(保留 React + Vite 栈) |
| 后端栈 | Node.js + Hono + PostgreSQL + Auth.js |
| 部署 | VPS + Docker Compose + Nginx + R2 |
| i18n 策略 | 中英双语全量(content 字段 `jsonb {zh, en}`) |
| 登录方式 | Google OAuth + GitHub OAuth |
| 视觉风格 | Apple HIG 风,对标 Image-Studio |
| 字体策略 | Inter + Noto Sans SC self-host |
| 调度策略(R2) | 优先级 + 启用状态 |
| 删除语义(R2 账户) | 软删除 |
| 存储后端范围 | 仅 R2(不做通用 S3 兼容池) |

### 2.4 开发环境约束

| 环境 | Docker 支持 | 说明 |
|---|:-:|---|
| **本地开发**(当前会话所在环境) | ❌ 无 | 不安装 Docker,所有依赖直装在本机 |
| **CI**(GitHub Actions) | ✅ 有 | 用 service containers / 镜像跑测试 |
| **生产 VPS** | ✅ 有 | 用 Docker Compose 部署整套服务 |

**对实现的影响**:
- PostgreSQL 本地直装(`brew install postgresql@16` / Windows installer / 已有 PG 实例),用 `.env.local` 指向本机 `localhost:5432`
- R2 / S3 本地不模拟 MinIO,直接连真实 R2 dev 桶(免费层完全够用,不会花钱);单元测试用 `aws-sdk-client-mock` npm 包
- 本地 dev 启动用 `pnpm dev`(Vite + tsx watch),无需任何容器
- CI 跑 integration test 时用 GitHub Actions 的 service container 起 PG
- 仅生产 VPS 上跑 `docker compose up`

**不在当前会话尝试任何 docker 命令**(用户明确约束)。

---

## 3. 技术栈

### 3.1 前端

| 项 | 选用 | 备注 |
|---|---|---|
| 框架 | React 18 | |
| 语言 | TypeScript 5.7 | 全量 TS,无 JS |
| 构建 | Vite 6 | |
| 包管理 | pnpm | npm → pnpm |
| 样式 | Tailwind CSS 4 | 与 Image-Studio 同版本 |
| 状态管理 | Zustand 4 | 与 Image-Studio 一致,组件可借鉴 |
| 路由 | react-router 7 | |
| 表单 | react-hook-form + Zod | |
| 国际化 | react-i18next | 含双语 URL `/zh/...` `/en/...` |
| 图标 | lucide-react | 与 nanobanana 同 |
| 字体 | Inter (variable woff2) + Noto Sans SC (subset) | self-host |

### 3.2 后端

| 项 | 选用 | 备注 |
|---|---|---|
| Runtime | Node.js 22 LTS | |
| 框架 | Hono | 轻量、TS 优先、跨 Runtime |
| 数据库 | PostgreSQL 16 | |
| ORM/查询 | Drizzle ORM | TS 类型穿透,迁移友好 |
| 数据库迁移 | drizzle-kit | |
| 认证 | Auth.js (core) | Google + GitHub Provider |
| 校验 | Zod | 与前端共享 schema |
| 对象存储客户端 | @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner | S3 兼容,R2 直接用 |
| 限流 | hono-rate-limiter | 内存 LRU,单实例够用 |
| 日志 | pino | JSON 结构化 |
| 监控/上报 | (可选) Sentry | 异常上报 |

### 3.3 部署与基础设施

| 项 | 选用 | 备注 |
|---|---|---|
| 物理 | VPS | 自托管 |
| 编排 | Docker Compose | 单机够用 |
| 反向代理 | Nginx | TLS、静态资源、路由分发 |
| TLS | Let's Encrypt + certbot | 自动续期 |
| 对象存储 | Cloudflare R2 账户池 | 详见 §8 |
| CDN | Cloudflare(R2 自带) | 免出口流量 |
| CI/CD | GitHub Actions → SSH 部署 | 简单实用 |
| 进程管理 | Docker 自带 / restart=always | 不引入 PM2 |

### 3.4 开发工具

| 项 | 选用 | 备注 |
|---|---|---|
| Lint | ESLint + Prettier | |
| 类型检查 | tsc --noEmit (CI) | |
| 单元测试 | Vitest | |
| E2E 测试 | Playwright | 本地浏览器启动,无 Docker |
| 本地 S3 模拟 | `aws-sdk-client-mock` (unit) / 真实 R2 dev 桶 (integration) | **无 MinIO,无 Docker** |
| 本地 DB | 本机直装 PostgreSQL 16 | **无 Docker**,见 §2.4 |
| CI DB | GitHub Actions `services: postgres:16-alpine` | CI 环境支持 Docker |
| 生产 DB | Docker Compose postgres:16-alpine | VPS 支持 Docker |

---

## 4. 架构总览

### 4.1 三大区域

```
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│ 用户浏览器               │  │ VPS (Docker Compose)     │  │ 边缘 / 用户桌面          │
├─────────────────────────┤  ├─────────────────────────┤  ├─────────────────────────┤
│ • Image-Prompts SPA      │  │ • Nginx 反向代理          │  │ • Cloudflare R2 账户池   │
│   (React + TS + Vite)    │  │ • Hono API Server         │  │   - 多账户调度           │
│ • 游客浏览/搜索/筛选     │  │ • Auth.js (OAuth 核心)    │  │   - public_url 直读      │
│ • 登录用户(投稿/收藏/赞)│  │ • PostgreSQL              │  │ • Google OAuth           │
│ • 管理员后台             │  │ • R2 预签名签发           │  │ • GitHub OAuth           │
│ • Send to Studio 触发    │  │ • AI 翻译代理             │  │ • Image-Studio 桌面端    │
└─────────────────────────┘  └─────────────────────────┘  └─────────────────────────┘
```

### 4.2 关键数据流

| 流向 | 内容 | 协议 |
|---|---|---|
| 浏览器 → Nginx → Hono | API 请求 | HTTPS |
| Hono ↔ PostgreSQL | 数据读写 | TCP 内网 |
| Hono ↔ Auth.js → Google/GitHub | OAuth 重定向 | HTTPS |
| 浏览器 ↔ R2 | 图片预签名直传 / 公开读取 | HTTPS |
| 浏览器 → Image-Studio | URI Scheme `image-studio://import?token=xxx` | OS scheme handler |
| Image-Studio → Hono | GET token → payload | HTTPS |
| Hono → 翻译上游 | AI 翻译代理(用户启用时) | HTTPS |

### 4.3 部署拓扑

```
                ┌──────────────────┐
   Internet ──→ │  Cloudflare DNS  │  (cdn.x.com → R2; image-prompts.x.com → VPS)
                └──────────────────┘
                         │
                         ▼
                ┌──────────────────┐
                │ VPS (Linux)       │
                │ ┌──────────────┐  │
                │ │ nginx        │  │  443 → app:3000
                │ ├──────────────┤  │
                │ │ app (Hono)   │  │  Node.js, port 3000
                │ ├──────────────┤  │
                │ │ postgres     │  │  port 5432 (internal only)
                │ └──────────────┘  │
                └──────────────────┘
                         │
                         ▼
                ┌──────────────────┐
                │ Cloudflare R2     │
                │ (账户 1, 2, 3...)│
                └──────────────────┘
```

---

## 5. 页面与路由

### 5.1 路由清单(8 个主页面)

| 路径 | 说明 | 权限 |
|---|---|---|
| `/[zh\|en]` | 首页(Hero + 分类 + 卡片网格) | 公开 |
| `/[zh\|en]/prompts` | 列表页(搜索/筛选/排序) | 公开 |
| `/[zh\|en]/prompts/:slug` | 详情页 | 公开 |
| `/[zh\|en]/categories/:slug` | 分类页 | 公开 |
| `/[zh\|en]/about` | 关于(含 attribution + 开源协议) | 公开 |
| `/[zh\|en]/submit` | 投稿 | 需登录 |
| `/[zh\|en]/me` | 个人(投稿 / 收藏 / 设置) | 需登录 |
| `/[zh\|en]/admin/*` | 管理后台(嵌套路由) | 需 admin/moderator role |

### 5.2 系统路由

| 路径 | 说明 |
|---|---|
| `/api/*` | Hono API |
| `/auth/*` | Auth.js callback / signin / signout |
| `/sitemap.xml` | 动态生成,含所有已审批 prompts 双语版本 |
| `/robots.txt` | 静态 |
| `/` | 检测 Accept-Language → 301 到 `/zh` 或 `/en`(默认 `/zh`) |
| `/fonts/*` | self-host 字体 |

### 5.3 管理后台子路由

| 路径 | 说明 |
|---|---|
| `/[zh\|en]/admin` | 仪表盘(待审核数 / 投稿趋势 / R2 容量) |
| `/[zh\|en]/admin/submissions` | 待审核投稿队列 |
| `/[zh\|en]/admin/prompts` | 已发布管理(可编辑/下架) |
| `/[zh\|en]/admin/users` | 用户管理(role 升降) |
| `/[zh\|en]/admin/categories` | 分类管理 |
| `/[zh\|en]/admin/tags` | 标签管理 + 新标签申请队列 |
| `/[zh\|en]/admin/r2-accounts` | R2 账户池管理 |
| `/[zh\|en]/admin/settings` | 系统配置(AI 翻译、投稿上限、社区准则等) |
| `/[zh\|en]/admin/reports` | 举报队列 |
| `/[zh\|en]/admin/announcements` | 站点公告管理 |
| `/[zh\|en]/admin/audit-log` | 操作日志 |

### 5.4 用户旅程

#### 旅程 A: 游客找一条 prompt 用(最高频)

1. 落地 `/zh` 看 Hero/分类
2. 进 `/zh/prompts` 用标签/比例/分类筛选
3. 点卡片进 `/zh/prompts/cyberpunk-cat`
4. 看图廊 + 读 prompt 文本(可切换语言)
5. 点 "Send to Image-Studio" 主 CTA
6. 浏览器询问 → 用户接受
7. Image-Studio 启动/被唤醒,输入框已填好 prompt + neg + aspect

#### 旅程 B: 登录用户投稿

1. 点导航"投稿" → 未登录 → 走 OAuth(Google/GitHub)
2. 首次投稿:强制读社区准则(30s 倒计时 + 滚到底 + 勾确认)
3. 进 `/zh/submit` 填表单
   - 中英标题(至少一个)
   - 中英 prompt(至少一个)
   - 可选 negative / 比例
   - 选分类(必填)+ 标签(从白名单多选 ≤6)
   - 上传作品图(R2 预签名直传,1-5 张)
   - 备注
4. 提交 → 进入 `submissions` 表 status=pending
5. `/zh/me` 看到"审核中"
6. 管理员批准 → 写入 `prompts` 表 → 投稿者收到通知
7. 公开展示

#### 旅程 C: 管理员审核

1. 登录后导航出现"管理后台"
2. 进 `/zh/admin/submissions` 看 pending 队列
3. 点条目 → 预览(同详情页布局)
4. 三选一:批准 / 驳回(填原因)/ 编辑后批准
5. 操作记录到 audit_log
6. 投稿者站内通知(MVP 仅站内,邮件后续可扩展)

---

## 6. 集成核心: Send to Studio

### 6.1 主流程时序(14 步成功路径)

```
浏览器 SPA       Image-Prompts API     Wails 后端 (Go)        Wails 前端 (React)
   │                  │                      │                      │
1. 用户点 Send         │                      │                      │
   │                  │                      │                      │
2. POST /api/import-tokens                    │                      │
   │ { prompt,        │                      │                      │
   │   negative,      │                      │                      │
   │   aspect }       │                      │                      │
   │ ───────────────→ │                      │                      │
3.                    │ 生成 8 位 base62 token                       │
                      │ INSERT import_tokens                          │
                      │ expires_at = now + 24h                        │
4. ←─────────────────  201 { token, expires_at }                     │
   │                  │                      │                      │
5. window.location.href = "image-studio://import?token=k7Bx2QzR"    │
   │                  │                      │                      │
   │ ╔═══════════════════════════════════╗   │                      │
   │ ║ OS 弹窗:"打开 Image-Studio?"  ║                              │
   │ ╚═══════════════════════════════════╝                          │
   │                  │                      │                      │
6. (用户接受)         │                      │                      │
7.                    │                      │ OS 启动 / 唤起        │
                      │                      │ os.Args[1] = scheme   │
8.                    │                      │ 单实例锁 + 解析 token  │
   │                  │                      │                      │
9.                    │  ←──── GET /api/import-tokens/k7Bx2QzR        │
                      │       Authorization: Image-Studio/0.x.x       │
10.                   │ UPDATE ... SET used=TRUE                       │
                      │   WHERE used=FALSE (CAS)                       │
                      │ UPDATE prompts SET send_count++                │
11.                   │ ────→ 200 { prompt, negative_prompt, aspect } │
                      │                      │                      │
12.                                          │ runtime.EventsEmit ──→│
                                             │ ("import-prompt",     │
                                             │   payload)            │
13.                                          │                      │ useStudioBootstrap
                                             │                      │  hook 监听
                                             │                      │  store.setField(...)
14.                                          │                      │ UI Toast:
                                             │                      │  "已从 Image-Prompts
                                             │                      │   导入提示词"
```

### 6.2 接口契约

#### POST /api/import-tokens (浏览器调用)

```ts
// Request
{
  prompt: { zh?: string, en?: string },        // 至少一个非空
  negative_prompt?: { zh?: string, en?: string },
  aspect_ratio?: "auto" | "1:1" | "3:2" | "2:3" | "16:9" | "9:16",
  prompt_id?: string,                          // 来源 prompt 的 id (可选, 用于统计)
}

// Response 201
{
  token: string,         // 8 位 base62
  expires_at: string,    // ISO 8601
}

// 限流: 同 IP 30 次/分钟
// payload 大小: ≤ 4 KB
```

#### GET /api/import-tokens/:token (Image-Studio 调用)

```ts
// Headers
Authorization: "Image-Studio/<version>"   // 软校验

// Response 200
{
  prompt: { zh?: string, en?: string },
  negative_prompt?: { zh?: string, en?: string },
  aspect_ratio?: string,
}

// Response 410 Gone
{ error: "token_used" }      // 已使用过
{ error: "token_expired" }   // 超过 24h
```

### 6.3 异常分支兜底

| 场景 | 检测 | 处理 |
|---|---|---|
| 用户没装 Image-Studio | `setTimeout(1500ms)` 后 `document.visibilityState === "visible"` | 弹下载引导 modal + "我已经装了,别再问" |
| 用户在系统弹窗点取消 | 同上(JS 看不出区别) | 同上 + localStorage `declined_count`,达 3 提供"复制 prompt"fallback |
| token 已用 | API 返回 410 `token_used` | Image-Studio Toast 红色:此链接已使用,请回 Image-Prompts 重新点击 |
| token 过期 (>24h) | API 返回 410 `token_expired` | Image-Studio Toast 红色:此链接已过期 |
| 网络断 | fetch 失败 | Toast + 重试按钮 |

### 6.4 安全边界(7 条)

1. **token 熵**:8 位 base62 ≈ 47.6 bit,24h 内不会碰撞
2. **限流**:同 IP `POST /api/import-tokens` 30 次/分钟(Hono middleware 内存 LRU)
3. **payload 大小**:≤ 4 KB,拒超大请求
4. **UA 软校验**:`GET /api/import-tokens/:t` 要求 UA 含 `Image-Studio/`
5. **CORS 严格**:仅允许自家域名 POST;GET 走 Image-Studio 无 Origin
6. **HTTPS only** + scheme 字符串严格校验(拒 `javascript:` / `data:` 等)
7. **payload 不含敏感数据**(不塞 user_id / email / 内部 ID)

### 6.5 Image-Studio 端需新增的能力(由 Image-Studio 项目实现,本项目只定接口)

- `wails.json` 加 `info.protocols: [{ scheme: "image-studio", ... }]`
- `main.go` 加 `os.Args[1]` 解析 + 单实例锁(已运行实例接收新 args)
- `backend/dialogs.go` 加 `ImportPromptPayload` 服务方法
- `frontend/src/app/hooks/useStudioBootstrap.ts` 加 import 事件监听
- `frontend/src/state/studioStore.ts` 复用 `setField` 写入

---

## 7. 数据模型(PostgreSQL Schema)

### 7.1 表清单总览(14 张)

| 区 | 表 | 说明 |
|---|---|---|
| Auth.js | users | 用户主表 |
| Auth.js | accounts | OAuth Provider 关联 |
| Auth.js | sessions | 会话 |
| Auth.js | verification_tokens | (Auth.js 要求,未用邮箱) |
| 核心 | prompts | 提示词主表 |
| 核心 | submissions | 待审核投稿 |
| 核心 | categories | 分类(扁平,单层) |
| 核心 | tags | 标签(预设白名单) |
| 核心 | prompt_tags | 提示词-标签多对多 |
| 核心 | prompt_images | 提示词图片(1:N) |
| 互动 | favorites | 收藏(私有) |
| 互动 | likes | 点赞(公开计数) |
| 系统 | import_tokens | Send to Studio 短 token |
| 系统 | audit_log | 管理员操作记录 |
| 系统 | reports | 举报队列 |
| 系统 | tag_suggestions | 新标签申请队列 |
| 系统 | announcements | 站点公告 |
| 系统 | r2_accounts | R2 账户池 |
| 系统 | site_settings | 全局配置(AI 翻译/投稿上限等) |

> 实际是 19 张,但分组清晰。

### 7.2 关键表 DDL

```sql
-- ============ users ============
CREATE TYPE user_role AS ENUM ('user', 'moderator', 'admin');

CREATE TABLE users (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                           TEXT NOT NULL UNIQUE,
  name                            TEXT,
  avatar_url                      TEXT,
  role                            user_role DEFAULT 'user' NOT NULL,
  locale                          TEXT DEFAULT 'zh',
  community_guidelines_version    INT DEFAULT 0,  -- 已读社区准则版本
  daily_submission_count          INT DEFAULT 0,   -- 当日投稿计数(每日 reset)
  daily_submission_reset_at       TIMESTAMPTZ,
  rejected_count                  INT DEFAULT 0,   -- 累计被驳回数,用于降权
  created_at                      TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at                      TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ============ prompts ============
CREATE TABLE prompts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                TEXT NOT NULL UNIQUE,
  title               JSONB NOT NULL,           -- {zh?: string, en?: string}
  prompt              JSONB NOT NULL,           -- {zh?: string, en?: string}
  negative_prompt     JSONB,                    -- {zh?: string, en?: string}
  notes               JSONB,                    -- {zh?: string, en?: string}
  aspect_ratio        TEXT,                     -- enum string
  category_id         UUID NOT NULL REFERENCES categories(id),
  contributor_id      UUID REFERENCES users(id),
  source              TEXT DEFAULT 'site',      -- 'site' / 'nanobanana_seed'
  -- 冗余计数(异步维护,避免每次 COUNT)
  view_count          INT DEFAULT 0,
  favorite_count      INT DEFAULT 0,
  like_count          INT DEFAULT 0,
  send_count          INT DEFAULT 0,
  approved_at         TIMESTAMPTZ DEFAULT now() NOT NULL,
  created_at          TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at          TIMESTAMPTZ DEFAULT now() NOT NULL,
  -- 校验: title 的 zh / en 至少一个非空
  CONSTRAINT title_at_least_one CHECK (
    (title->>'zh' IS NOT NULL AND length(title->>'zh') > 0)
    OR (title->>'en' IS NOT NULL AND length(title->>'en') > 0)
  ),
  CONSTRAINT prompt_at_least_one CHECK (
    (prompt->>'zh' IS NOT NULL AND length(prompt->>'zh') > 0)
    OR (prompt->>'en' IS NOT NULL AND length(prompt->>'en') > 0)
  )
);

CREATE INDEX prompts_category_idx ON prompts(category_id);
CREATE INDEX prompts_approved_at_idx ON prompts(approved_at DESC);
CREATE INDEX prompts_like_count_idx ON prompts(like_count DESC);
CREATE INDEX prompts_view_count_idx ON prompts(view_count DESC);
CREATE INDEX prompts_send_count_idx ON prompts(send_count DESC);
-- 全文检索(中英文)
CREATE INDEX prompts_title_zh_gin ON prompts USING gin ((title->>'zh') gin_trgm_ops);
CREATE INDEX prompts_title_en_gin ON prompts USING gin ((title->>'en') gin_trgm_ops);
CREATE INDEX prompts_prompt_zh_gin ON prompts USING gin ((prompt->>'zh') gin_trgm_ops);
CREATE INDEX prompts_prompt_en_gin ON prompts USING gin ((prompt->>'en') gin_trgm_ops);

-- ============ submissions ============
CREATE TYPE submission_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE submissions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title           JSONB NOT NULL,
  prompt          JSONB NOT NULL,
  negative_prompt JSONB,
  notes           JSONB,
  aspect_ratio    TEXT,
  category_id     UUID NOT NULL REFERENCES categories(id),
  contributor_id  UUID NOT NULL REFERENCES users(id),
  tag_slugs       TEXT[] DEFAULT '{}',
  image_keys      JSONB NOT NULL,    -- [{r2_account_id, r2_key, alt_text}, ...]
  status          submission_status DEFAULT 'pending' NOT NULL,
  reject_reason   TEXT,
  reviewed_by     UUID REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,
  promoted_to     UUID REFERENCES prompts(id),
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  -- 同 prompts 校验
  CONSTRAINT title_at_least_one_sub CHECK (
    (title->>'zh' IS NOT NULL AND length(title->>'zh') > 0)
    OR (title->>'en' IS NOT NULL AND length(title->>'en') > 0)
  ),
  CONSTRAINT prompt_at_least_one_sub CHECK (
    (prompt->>'zh' IS NOT NULL AND length(prompt->>'zh') > 0)
    OR (prompt->>'en' IS NOT NULL AND length(prompt->>'en') > 0)
  )
);
CREATE INDEX submissions_status_idx ON submissions(status);
CREATE INDEX submissions_contributor_idx ON submissions(contributor_id);

-- ============ categories ============
CREATE TABLE categories (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL UNIQUE,
  name        JSONB NOT NULL,    -- {zh, en}
  description JSONB,
  "order"     INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ============ tags ============
CREATE TABLE tags (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        TEXT NOT NULL UNIQUE,
  name        JSONB NOT NULL,    -- {zh, en}
  usage_count INT DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ============ prompt_tags ============
CREATE TABLE prompt_tags (
  prompt_id UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  tag_id    UUID NOT NULL REFERENCES tags(id),
  PRIMARY KEY (prompt_id, tag_id)
);
CREATE INDEX prompt_tags_tag_idx ON prompt_tags(tag_id);

-- ============ prompt_images ============
CREATE TABLE prompt_images (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_id       UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  r2_account_id   UUID NOT NULL REFERENCES r2_accounts(id),  -- 关键: 多账户调度
  r2_key          TEXT NOT NULL,
  "order"         INT DEFAULT 0,
  alt_text        TEXT,
  width           INT,
  height          INT,
  lqip            TEXT,             -- base64 模糊预占位
  created_at      TIMESTAMPTZ DEFAULT now() NOT NULL,
  UNIQUE (r2_account_id, r2_key)
);
CREATE INDEX prompt_images_prompt_idx ON prompt_images(prompt_id, "order");

-- ============ favorites (私有收藏) ============
CREATE TABLE favorites (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt_id  UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (user_id, prompt_id)
);
CREATE INDEX favorites_user_idx ON favorites(user_id, created_at DESC);

-- ============ likes (公开点赞) ============
CREATE TABLE likes (
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  prompt_id  UUID NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  PRIMARY KEY (user_id, prompt_id)
);
CREATE INDEX likes_prompt_idx ON likes(prompt_id);

-- ============ import_tokens (Send to Studio) ============
CREATE TABLE import_tokens (
  token       TEXT PRIMARY KEY,                   -- 8 位 base62
  payload     JSONB NOT NULL,
  prompt_id   UUID REFERENCES prompts(id),
  used        BOOLEAN DEFAULT FALSE NOT NULL,
  used_at     TIMESTAMPTZ,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now() NOT NULL,
  created_ip  TEXT
);
CREATE INDEX import_tokens_expires_idx ON import_tokens(expires_at) WHERE NOT used;

-- ============ audit_log ============
CREATE TABLE audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    UUID REFERENCES users(id),
  action      TEXT NOT NULL,           -- 'approve_submission' / 'reject' / 'edit_prompt' / ...
  target_type TEXT NOT NULL,
  target_id   UUID,
  meta        JSONB,
  ip          TEXT,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE INDEX audit_log_actor_idx ON audit_log(actor_id, created_at DESC);
CREATE INDEX audit_log_action_idx ON audit_log(action, created_at DESC);

-- ============ reports (举报) ============
CREATE TYPE report_status AS ENUM ('open', 'reviewing', 'resolved', 'dismissed');

CREATE TABLE reports (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id  UUID REFERENCES users(id),
  target_type  TEXT NOT NULL,             -- 'prompt' / 'submission' / 'user'
  target_id    UUID NOT NULL,
  reason       TEXT NOT NULL,
  detail       TEXT,
  status       report_status DEFAULT 'open' NOT NULL,
  reviewed_by  UUID REFERENCES users(id),
  reviewed_at  TIMESTAMPTZ,
  action_taken TEXT,
  created_at   TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE INDEX reports_status_idx ON reports(status, created_at);

-- ============ tag_suggestions (新标签申请) ============
CREATE TABLE tag_suggestions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  suggester_id  UUID NOT NULL REFERENCES users(id),
  suggested_name JSONB NOT NULL,    -- {zh, en}
  reason        TEXT,
  status        TEXT DEFAULT 'pending',    -- pending / approved / rejected
  reviewed_by   UUID REFERENCES users(id),
  reviewed_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- ============ announcements (公告) ============
CREATE TYPE announcement_severity AS ENUM ('info', 'warning', 'critical');

CREATE TABLE announcements (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       JSONB NOT NULL,
  body        JSONB NOT NULL,
  severity    announcement_severity DEFAULT 'info' NOT NULL,
  starts_at   TIMESTAMPTZ NOT NULL,
  ends_at     TIMESTAMPTZ,
  created_by  UUID NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE INDEX announcements_period_idx ON announcements(starts_at, ends_at);

-- ============ r2_accounts (账户池) ============
CREATE TABLE r2_accounts (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                        TEXT NOT NULL,
  account_id                  TEXT NOT NULL,
  access_key_id               TEXT NOT NULL,
  access_key_secret_encrypted TEXT NOT NULL,
  bucket                      TEXT NOT NULL,
  endpoint                    TEXT NOT NULL,
  public_url                  TEXT NOT NULL,
  enabled                     BOOLEAN DEFAULT TRUE NOT NULL,
  priority                    INT DEFAULT 100 NOT NULL,
  notes                       TEXT,
  -- 配额监控
  used_bytes                  BIGINT DEFAULT 0,
  monthly_class_a_count       INT DEFAULT 0,
  monthly_class_b_count       INT DEFAULT 0,
  monthly_reset_at            TIMESTAMPTZ,
  last_synced_at              TIMESTAMPTZ,
  -- 软删除
  deleted_at                  TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at                  TIMESTAMPTZ DEFAULT now() NOT NULL
);
CREATE INDEX r2_accounts_pick_idx ON r2_accounts(priority DESC, created_at)
  WHERE enabled = TRUE AND deleted_at IS NULL;

-- ============ site_settings (key-value 全局配置) ============
CREATE TABLE site_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  description TEXT,
  updated_at  TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_by  UUID REFERENCES users(id)
);
-- 预置 key:
-- translation.enabled (bool)
-- translation.base_url (string)
-- translation.api_key_encrypted (string)
-- translation.model (string)
-- translation.system_prompt (jsonb {zh2en, en2zh})
-- submit.daily_limit (int)
-- community_guidelines.version (int)
-- community_guidelines.body (jsonb {zh, en})
-- view_count.dedup_hours (int, 默认 24)
```

### 7.3 fallback 策略

详情页用户选 EN 但 `title.en` 空 → 显示 `title.zh` + 灰色小字 "暂无英文版,显示中文"。所有双语 JSONB 字段统一这一规则。

### 7.4 计数冗余字段维护

- `view_count`: 浏览详情页时异步 INSERT view_log + 24h dedup,定时 batch 累加
- `like_count`: likes 表 INSERT/DELETE 时同事务 +/- 1
- `favorite_count`: favorites 表 INSERT/DELETE 时同事务 +/- 1
- `send_count`: import_tokens CAS used=TRUE 同事务 + 1
- `usage_count` (tags): 异步定时 batch 重算

---

## 8. R2 账户池

### 8.1 调度策略 = 优先级 + 启用状态

```sql
-- 选写入账户
SELECT * FROM r2_accounts
  WHERE enabled = TRUE AND deleted_at IS NULL
  ORDER BY priority DESC, created_at
  LIMIT 1;
```

满了/退役 → 管理员后台禁用 → 系统自动用下一个。**禁用账户不影响已存图片访问**(只要 bucket 还在 R2 上,前端的图都能拉到)。

### 8.2 加密策略

`access_key_secret` 用 AES-256-GCM 加密存 DB:
- env `R2_ENCRYPTION_KEY` (32 字节随机)
- DB 字段 `access_key_secret_encrypted` 是 `{iv}:{ciphertext}:{authTag}` base64
- 运行时 lazy decrypt + 内存缓存 S3Client(每账户一份,按 LRU 淘汰)
- API 返回前端永远 `***` 脱敏后 4 位

### 8.3 使用量监控

后端定时(每 6 小时)调 R2 API 同步真实 `used_bytes` 与月度操作数:
- Cron job 内置在 Hono 进程(轻量,不上 BullMQ)
- 在 `site_settings` 加阈值 key:`r2.warn_threshold_pct` 默认 80
- 接近 80% 时,管理员仪表盘 banner 红色提醒

### 8.4 软删除语义

- DELETE 操作 → `UPDATE SET deleted_at = now()`
- 列表页 + 调度池都过滤 `deleted_at IS NULL`
- prompt_images 表的 r2_account_id 引用不动,图片仍可读
- 真删除从未提供(避免误操作)

### 8.5 测试连通性 endpoint

```ts
// POST /api/admin/r2-accounts/:id/test
// 流程: 写一个 0-byte 测试对象 → 立即读取 → 删除 → 返回成功 / 错误
```

### 8.6 路径前缀策略

```
{bucket}/
├── submissions/{user_id}/{uuid}.{ext}    # 投稿暂存, 私有 (审批前)
├── prompts/{prompt_id}/{index}.{ext}     # 已审批, 公开 (走 CDN)
└── avatars/{user_id}.{ext}                # 用户头像, 公开
```

审批通过时 `CopyObjectCommand` 从 `submissions/` 复制到 `prompts/` + 删原始(同账户内)。**跨账户迁移不在 MVP 范围**(总是用写入时的账户)。

### 8.7 管理后台 UI

完全按用户给的截图实现(对比 §11.x 视觉风格):
- 表格:状态 / 名称 / Account ID(中间脱敏)/ Bucket / Public URL(脱敏)/ 操作
- 操作:**禁用**(切换 `enabled`)/ **删除**(软删除)/ **测试连通性**
- 表单:添加 R2 账户(7 字段:名称 / Account ID / Access Key ID / Bucket / Public URL / Priority / Secret)

---

## 9. 认证与权限

### 9.1 Auth.js Provider

- **Google OAuth**(主)
- **GitHub OAuth**(辅,开发者友好)
- 无邮箱密码、无 Magic Link

### 9.2 Role 模型

```ts
type Role = "user" | "moderator" | "admin";
```

存于 `users.role` 字段。权限矩阵:

| 操作 | user | moderator | admin |
|---|:-:|:-:|:-:|
| 浏览所有公开内容 | ✅ | ✅ | ✅ |
| 收藏/点赞 | ✅ | ✅ | ✅ |
| 投稿 | ✅ | ✅ | ✅ |
| 编辑自己的投稿 | ✅(pending 状态)| ✅ | ✅ |
| 审核投稿 | — | ✅ | ✅ |
| 编辑/下架已发布 prompt | — | ✅ | ✅ |
| 处理举报 | — | ✅ | ✅ |
| 管理 tags / categories | — | — | ✅ |
| 管理 R2 账户池 | — | — | ✅ |
| 系统配置(AI 翻译/上限/准则) | — | — | ✅ |
| 用户 role 调整 | — | — | ✅ |
| 查看 audit_log | — | ✅(自己) | ✅(全部) |

### 9.3 强制读社区准则

- `users.community_guidelines_version` 记录已读版本号
- 投稿前检查 `users.community_guidelines_version < current_version` → 弹模态:
  - 显示完整准则
  - 30 秒倒计时(防秒过)
  - 滚到底才能勾"我已读"
  - 勾选后 `UPDATE users SET community_guidelines_version = current`

### 9.4 投稿限流

- `users.daily_submission_count` + `daily_submission_reset_at`
- 默认上限 `site_settings.submit.daily_limit = 10`(管理员可调)
- 管理员/moderator 无限
- 累计被驳回 ≥3 次 → `rejected_count` 触发降权:每日上限减半 / 投稿排在审核队列末尾

---

## 10. 国际化

### 10.1 双语模型

- **UI 文案**:react-i18next,zh.json + en.json
- **路由**:`/zh/...` `/en/...`,无前缀重定向到默认(`/zh`)
- **内容字段**:`title / prompt / negative_prompt / notes / category.name / tag.name` 都是 `jsonb {zh?, en?}`
- **必填约束**:`prompts.title` 和 `prompts.prompt` 的 zh/en **至少一个非空**(DB CHECK 约束 + 服务端 Zod + 前端表单)

### 10.2 fallback

用户选 EN 但 `field.en` 为空 → 显示 `field.zh` + 灰色标注 `[暂无英文版]`(反之同理)。统一规则,所有双语字段一致。

### 10.3 用户偏好持久化

- 已登录:`users.locale` 字段
- 未登录:`localStorage["locale"]`
- 切换语言:更新偏好 + push 新路由前缀

---

## 11. UI 风格与设计 Token

### 11.1 风格基调

**对标 Image-Studio**(Apple HIG 风格,克制,工具感)。规则:

| 维度 | 规则 |
|---|---|
| 主色 | **单色品牌**(Apple Blue),不用多色辅助 |
| 状态色 | 仅在必要时用 Apple 系统色(错误 `#ff3b30`、成功 `#34c759`)|
| 卡片 | 灰底 + 细 border,**不用 gradient,不用发光阴影** |
| 文字层级 | 透明度做层级(主 100% / 次 78% / 辅 54%)|
| 圆角 | 控件 `999px`(纯圆),卡片 `18px`,输入 `12-14px`|
| Hover | 仅 `border-color` 微变,**不 translate,不放大阴影** |
| 字体 | Inter(英)+ Noto Sans SC(中)self-host |
| 字间距 | `letter-spacing: -0.01em ~ -0.02em`(更紧,Apple 风)|
| 默认主题 | 跟随系统,有 `light / dark / system` 三档|

### 11.2 设计 Token(暗色,亮色对应见 §11.3)

```css
:root.dark {
  /* 品牌色 (单色) */
  --accent: #0a84ff;
  --accent-2: #5eb0ff;
  --accent-soft: rgb(10 132 255 / 0.18);

  /* 背景 */
  --bg: #131315;
  --bg-2: #1c1c1e;
  --panel: #232326;
  --panel-2: #1c1c1f;
  --surface: #2c2c2f;
  --surface-2: #3a3a3d;

  /* 文字 */
  --text: #f5f5f7;
  --text-muted: rgb(235 235 245 / 0.78);
  --text-dim: rgb(235 235 245 / 0.54);

  /* 边框 */
  --border: rgb(84 84 88 / 0.52);
  --border-soft: rgb(84 84 88 / 0.28);

  /* 状态色 (仅必要时用) */
  --danger: #ff453a;
  --success: #30d158;

  /* 圆角 */
  --radius-pill: 999px;
  --radius-card: 18px;
  --radius-control: 12px;

  /* 阴影 (极轻) */
  --shadow-card: 0 18px 46px rgb(0 0 0 / 0.38);
}
```

### 11.3 设计 Token(亮色)

```css
:root {
  --accent: #007aff;
  --accent-2: #409cff;
  --accent-soft: rgb(0 122 255 / 0.1);

  --bg: #f5f5f7;
  --bg-2: #ececf1;
  --panel: #ffffff;
  --panel-2: #fbfbfd;
  --surface: #f2f2f7;
  --surface-2: #e5e5ea;

  --text: #111111;
  --text-muted: rgb(60 60 67 / 0.72);
  --text-dim: rgb(60 60 67 / 0.48);

  --border: rgb(60 60 67 / 0.16);
  --border-soft: rgb(60 60 67 / 0.08);

  --danger: #ff3b30;
  --success: #34c759;

  --shadow-card: 0 10px 30px rgb(15 23 42 / 0.06);
}
```

### 11.4 字体

```css
font-family:
  "Inter", "Noto Sans SC",
  -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei UI",
  sans-serif;
```

- `Inter` variable woff2 (~30 KB,100-900 全字重)
- `Noto Sans SC` subset 常用 3500 字(400/500/700 三个字重,共 ~750 KB)
- 加载方式:`@font-face` + `font-display: swap` + `<link rel="preload">`
- 全部 self-host(`/fonts/` 路径)

### 11.5 间距 / 圆角(沿用 Tailwind 默认 + 上述变量)

- 间距 token:4 / 8 / 12 / 16 / 24 / 32 / 48 px
- 卡片圆角:`var(--radius-card)` 即 18px
- 按钮 / chip / 输入:`var(--radius-pill)` 即 999px

### 11.6 响应式断点

```
mobile      < 640 px      1 列卡片,侧栏 drawer
tablet      < 1024 px     2-3 列卡片,侧栏可折叠
desktop     < 1280 px     3-4 列卡片,侧栏常驻
wide        ≥ 1280 px     4-5 列卡片
```

### 11.7 动效

- 全局 `prefers-reduced-motion` 检测,关闭则禁用所有过渡
- 默认 transition:150 ms ease-out
- 模态入场:fade 150 ms + scale 0.96 → 1
- 卡片 hover:仅 `border-color` 改变(120 ms)

### 11.8 图标

`lucide-react`(与 nanobanana / Image-Studio 一致)。

---

## 12. AI 翻译(可配置)

### 12.1 行为

- 默认**关闭**,投稿表单显示 Google / 百度翻译跳转链接(`target=_blank`,预填当前文本)
- 管理员在 `/admin/settings` 启用 AI 翻译并配置:
  - `translation.enabled` (bool)
  - `translation.base_url` (string,如 `https://generativelanguage.googleapis.com/v1beta`)
  - `translation.api_key`(AES-256-GCM 加密存 `translation.api_key_encrypted`)
  - `translation.model` (string,如 `gemini-2.0-flash`)
  - `translation.system_prompt` (jsonb `{zh2en: string, en2zh: string}`,预设翻译指令)
- 启用后,投稿表单出现 "✨ 中 → 英 AI 翻译" 按钮,点击调 `/api/translate` 后端代理

### 12.2 后端代理 endpoint

```ts
// POST /api/translate
// Body: { text: string, direction: "zh2en" | "en2zh" }
// Response: { translated: string } | { error: "translation_disabled" / "upstream_error" / "rate_limited" }
```

- 限流:每用户 50 次/天
- 上游 timeout 15s,失败 fallback 友好错误
- 不缓存(prompt 多样、缓存命中率低)

### 12.3 安全

- API key 加密同 R2(同一 `R2_ENCRYPTION_KEY` 复用 + DEK 派生)
- 前端永远不接触 key
- 管理员保存配置时回显 `***`

---

## 13. 错误处理策略

详见 §13 在过去对话的呈现。要点:**分层兜底**——前端 / Hono / DB 各层都设兜底,不指望上层完美。

### 13.1 前端层

| 场景 | 处理 |
|---|---|
| API 4xx 校验失败 | 表单字段红 outline + 内联错误,不弹 toast |
| API 5xx | 全局 toast "服务异常,请稍后重试" + (可选) Sentry |
| 网络断 | toast "网络连接中断" + 重试按钮 |
| `image-studio://` 调起失败 | 1.5s 检测可见性 + 弹下载引导 |
| 翻译失败 | 字段下方灰色提示 "翻译服务暂不可用" |
| R2 上传失败 | 单图重试 3 次,全失败让用户重选 |
| 路由 404 | 自定义页 "找不到此提示词" + 返回列表 |
| OAuth 失败 | 回 /login + 错误 banner |
| 顶层渲染崩 | `<ErrorBoundary>` 兜底页 |

### 13.2 Hono 后端层

| 场景 | 响应 |
|---|---|
| Zod 校验失败 | 400 + 字段级错误对象 |
| Auth 缺失/过期 | 401 + 前端跳 /login(保留 returnTo) |
| 权限不足 | 403 |
| 资源不存在 | 404 |
| token 已用/过期 | 410 + reason |
| 限流 | 429 + Retry-After |
| DB 连接失败 | 503 + 维护页 |
| 未捕获异常 | 500 + 不暴露 stack + log + Sentry |
| 翻译上游失败 | 502 + 友好 message |

### 13.3 DB 层

- import_tokens 事务 + CAS 防双花
- 投稿审批 + audit_log 同事务,要么都成功要么都回滚
- 连接池满 → Hono middleware 502 + 限流 backpressure
- mutate 全部 wrap try/catch + log

### 13.4 全局兜底

- 顶层 React `<ErrorBoundary>`
- 全局 `unhandledrejection` / `window.onerror` 上报
- 后端 process `unhandledRejection` → log + 优雅退出(让 Docker restart 重启)

---

## 14. 测试策略

### 14.1 金字塔分布

| 层 | 占比 | 工具 |
|---|---|---|
| Unit | 60% | Vitest |
| Integration | 25% | Vitest + 真 PG + MinIO |
| E2E | 10% | Playwright |
| 视觉回归(可选) | 5% | Chromatic / Percy |

### 14.2 Unit Tests

测:工具函数(slugify、双语 fallback、token 生成、URL 解析、aspectRatio 校验)、Zustand reducers、Zod schema、Hono handler 业务逻辑(mock DB)。

CI 每 push 跑全量,本地秒级反馈。

### 14.3 Integration Tests

测:Hono routes + 真 PG + R2(mock 或真实测试桶)。token lifecycle、投稿 → 审批 → prompts 完整流程、audit_log、限流真实拦截、R2 调度池真实选账户。

环境(按 §2.4 区分):
- **本地开发**:直连本机 PG(每个 suite 用独立 schema 隔离,跑完 drop);R2 用 `aws-sdk-client-mock` 拦截。
- **CI(GitHub Actions)**:用 `services: postgres: image: postgres:16-alpine`,R2 用 mock 或预备的测试桶。
- **不引入 MinIO / Docker Compose**(开发期无 Docker)。

### 14.4 E2E Tests

测 5 个关键旅程:
1. 游客浏览 → 详情 → Send to Studio(mock scheme)
2. 登录用户:OAuth → 投稿 → 草稿恢复
3. 管理员:登录 → 审核队列 → 批准/驳回
4. i18n:zh ↔ en 切换 + 内容 fallback
5. 主题切换 light/dark/system

### 14.5 指标

- Unit 覆盖 ≥ 70% (核心 utils / store / schema)
- Integration 覆盖所有 API endpoint (每个 happy + error 两条 path)
- E2E 5 个旅程
- CI 全量 < 5 分钟

### 14.6 Image-Studio 端测试

由 Image-Studio 项目自己跑 Go test。**两端的接口契约**由本 spec §6.2 固定。

---

## 15. 数据迁移(nanobanana 2380 条种子)

### 15.1 一次性脚本 `scripts/migrate-nanobanana.ts`

1. 拉取 unknowlei/nanobanana-website 的 `public/data.json`
2. 解析 `sections` → 映射到本项目 `categories` 表(扁平,丢弃折叠层级,sections.title 作为 category.name.zh)
3. 解析每条 `prompt` 字段:
   - `title` → `title.zh`
   - `content` → `prompt.zh`
   - `images[]` → 下载并上传到 R2 → 写 `prompt_images`
   - `tags[]` → 映射到 `tags` 表(预先创建白名单)
   - `contributor` → 创建虚拟"nanobanana 贡献者"用户(role=user,locked)
   - `source = 'nanobanana_seed'`
4. **批量机翻**(Gemini Flash 或 GPT-4o-mini):
   - 调上游 API 把所有 `title.zh / prompt.zh / notes.zh` 翻译到 en
   - 速率限制:每秒 5 请求,失败 retry 3 次
   - 写入 `title.en / prompt.en / notes.en`
5. 抽查 100 条质量(人工)
6. **About 页明确 attribution**:`原数据来自 nanobanana-website (作者 unknowlei),按 CC-BY 协议引用`

### 15.2 attribution 范文(放 About 页)

```
本站初始内容(2380 条提示词种子数据)迁移自 unknowlei 的开源项目
nanobanana-website (https://github.com/unknowlei/nanobanana-website),
经 AI 辅助翻译为中英双语后由本站维护与扩展。
原内容版权归 nanobanana 社区贡献者所有,本站按 CC-BY-4.0 精神标注来源。
```

---

## 16. 部署架构

> **范围说明**:本章描述**生产 VPS 部署**,不适用本地开发(本地无 Docker,见 §2.4)。本地开发用 `pnpm dev` 启动 Vite + tsx watch 即可,DB 用本机直装 PG,R2 连真实 dev 桶或 mock。

### 16.1 Docker Compose 服务(仅 VPS)

```yaml
services:
  nginx:
    image: nginx:1.27-alpine
    ports: ["80:80", "443:443"]
    volumes:
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
      - ./certbot/conf:/etc/letsencrypt:ro
      - ./certbot/www:/var/www/certbot:ro
    depends_on: [app]

  app:
    image: image-prompts:latest    # 由 GitHub Actions 构建
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgres://...
      # ... 见 §16.3
    depends_on: [postgres]
    restart: always

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: image_prompts
      POSTGRES_USER: ip_app
      POSTGRES_PASSWORD: ${PG_PASSWORD}
    volumes:
      - pg-data:/var/lib/postgresql/data
      - ./backup:/backup
    restart: always

  certbot:
    image: certbot/certbot
    volumes:
      - ./certbot/conf:/etc/letsencrypt
      - ./certbot/www:/var/www/certbot
    entrypoint: "/bin/sh -c 'trap exit TERM; while :; do certbot renew; sleep 12h & wait $${!}; done;'"

volumes:
  pg-data:
```

### 16.2 Nginx 关键配置要点

- 443 / 80 → HTTPS 重定向
- `/api/*` → `proxy_pass http://app:3000`
- `/auth/*` → `proxy_pass http://app:3000`
- `/` SPA fallback (try_files)
- 静态资源(`/fonts/`, `/assets/*`)长缓存
- gzip + brotli
- 安全 headers: CSP, X-Frame-Options, Referrer-Policy

### 16.3 环境变量清单

```bash
# 基础
NODE_ENV=production
PORT=3000
SITE_URL=https://image-prompts.example.com

# DB
DATABASE_URL=postgres://ip_app:xxx@postgres:5432/image_prompts

# Auth.js
AUTH_SECRET=xxx                   # openssl rand -base64 32
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx
GITHUB_CLIENT_ID=xxx
GITHUB_CLIENT_SECRET=xxx

# 加密 (R2 + AI key)
R2_ENCRYPTION_KEY=xxx             # 32 字节 hex, openssl rand -hex 32

# Sentry (可选)
SENTRY_DSN=
```

### 16.4 CI/CD(GitHub Actions)

- 在 PR 触发:lint + typecheck + unit + integration
- merge 到 main 触发:build Docker image → push to GHCR → SSH 到 VPS → docker compose pull + up
- 数据库迁移:每次部署运行 `drizzle-kit migrate`(幂等)

### 16.5 备份

- pg_dump 每日 cron → 写到 `/backup` 卷 → rclone 同步到 R2 不同 bucket(异地)
- 保留 30 天

---

## 17. SEO

- 每页 `<title>` 与 `<meta name="description">` 双语
- `<link rel="alternate" hreflang="zh-CN" href="/zh/...">` 和 `hreflang="en"`
- 动态 sitemap.xml:含所有 approved prompts 双语版本
- 结构化数据(JSON-LD)详情页:CreativeWork
- OpenGraph:每条 prompt 用首张图作为 og:image
- prerendered HTML(Vite SSG 或 next-style 优化,MVP 用动态生成已可)

---

## 18. 未来路径(post-MVP,不在本期实现)

- 评论 / 回复
- 排行榜独立页(已有按 like/view/send 排序,加专属页)
- 标签云独立页(`/tags`)
- 作者主页(`/u/:username`)
- 真实 AI 内容审核(图像 + 文本)
- Embedding-based 相似推荐(取代当前 "同分类 + 共享 tags")
- 通知系统(站内 + 邮件)
- 第三方 OAuth 增加(微信、Apple)
- Cloudflare Images 自动多尺寸优化
- 移动端 PWA
- 用户互关 / Feed 流
- API 开放给三方(读公开 prompts)

---

## 19. 风险与对应

| 风险 | 影响 | 对应 |
|---|---|---|
| 翻译质量参差 | 用户体验差 | 人工抽查 + 用户报错入口 + 后续人工审校 |
| Send to Studio 在某些浏览器失效 | 核心功能受损 | JS 探测 + 引导下载 + 复制文本 fallback |
| 单个 R2 账户配额耗尽 | 上传失败 | 多账户池 + 监控告警 + 即时切换 |
| OAuth Provider 故障 | 无法登录 | 双 Provider 互为冗余 |
| 凭证泄露 | 安全事件 | 全部加密存 DB + env / DB 不入 git + audit_log |
| 投稿垃圾内容 | 平台质量 | 限流 + 关键词黑名单 + 管理员审核 + 举报系统 |
| 数据库单点 | 单点故障 | pg_dump 异地备份 + 短期内 RPO 24h 接受 |

---

## 20. 已达成的关键确认(澄清问答记录)

| 问题 | 决策 |
|---|---|
| 项目定位 | 独立产品 + Workshop |
| 数据模型 | prompt 必填 + neg/aspect 可选 |
| 集成方案 | URI Scheme + 短 token |
| MVP 保留功能 | 保投稿+审核、下线 GIF、复用 2380 种子 |
| 架构幅度 | 中度重构 |
| 后端栈 | Node.js + Hono + Postgres + Auth.js |
| 部署 | VPS + R2 + Docker Compose |
| i18n | 中英双语全量 |
| 登录 | Google + GitHub |
| Role 模型 | enum 字段 |
| NSFW 表达 | tag 'nsfw' 而非 bool 字段 |
| 2380 种子英文版 | 批量机翻 |
| view_count | 含游客 |
| Tag 模型 | 预设白名单 |
| 新增表 | reports + announcements + tag_suggestions |
| 详情页相关推荐 | 同分类 + 共享 tags |
| send_count | 公开 |
| 评论 | 不入 MVP |
| 点赞 / 收藏 | 分开两张表 |
| AI 翻译 | 可配置开关 + 管理员后台 |
| 每日投稿上限 | 可配置(默认 10) |
| 申请新标签 | 走管理员审批队列 |
| 强制读社区准则 | 是 |
| 图片必填 | 至少 1 张 |
| UI 风格 | 对标 Image-Studio (Apple HIG) |
| 字体 | Inter + Noto Sans SC self-host |
| R2 调度策略 | 优先级 + 启用状态 |
| R2 使用量监控 | 做 |
| R2 删除语义 | 软删除 |
| R2 存储范围 | 仅 R2(不做通用 S3 池) |

---

## 21. 下一步

1. 你审本 spec,提出修改
2. 修改后 commit 锁定
3. 进入 `writing-plans` 撰写实现计划(按 milestone 拆分任务,含工时估算与依赖关系)
4. 执行计划开始 coding
