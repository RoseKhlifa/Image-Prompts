# M3 设计:Auth + Send to Studio

> **状态:** 设计中(已与用户对齐架构 + DB + API + UI + 错误 + 测试)
> **依赖:** M1 (skeleton + public browsing)
> **后续:** M4 = 用户投稿流程 + R2 池 + 管理后台
> **关联 spec:** [M1 总体设计](./2026-06-06-image-prompts-design.md)(本文是 M1 §6 与 §9 的展开实现规范)

---

## 1. 目标与范围

### 1.1 一句话目标

把 M1 留下的 Auth 数据库结构与 PromptDetailPage 上 disabled 的 "Send to Studio" 按钮真正点亮:Google + GitHub OAuth 上齐,登录后可生成一次性 import token,通过 `image-studio://` URI scheme 把提示词送到 Image-Studio 桌面端。

### 1.2 与 M1 spec 关系

本 spec 在 M1 spec(`2026-06-06-image-prompts-design.md`)的基础上做"展开":

- **§6 Send to Studio 集成核心** → 本 spec §4-§5 实现规范
- **§9 认证与权限** → 本 spec §2-§3 Auth 实现(仅落地 §9.1-§9.2,§9.3 准则门 / §9.4 投稿限流留到 M4)

### 1.3 范围内

- Auth.js + Hono adapter 上齐
- Google OAuth + GitHub OAuth Provider
- DB session 持久化(沿用 M1 已建好的 `sessions` 表)
- 顶部 Header 加 SignIn / ProfileMenu
- 极简 ProfilePage(头像 + 邮箱 + 退出)
- `POST /api/import-tokens` (登录态门控)
- `GET /api/import-tokens/:token` (Image-Studio 消费,UA 软校验)
- `SendToStudioButton` 状态机化
- `StudioNotInstalledModal`(1500ms 检测 + GitHub releases 跳转 + 复制提示词 fallback)
- send_count 冗余字段同事务自增
- 单元测试 + 集成测试 + 手测覆盖矩阵

### 1.4 不在 M3(YAGNI / 留 M4+)

| 功能 | 何时 |
|---|---|
| 用户投稿表单 | M4 |
| R2 账户池 + 上传 | M4 |
| 管理后台审核队列 | M4 |
| 社区准则门(§9.3) | M4(投稿前才用) |
| 投稿每日上限(§9.4) | M4 |
| 收藏 / 点赞 | M5 |
| Profile 详情(投稿列表 / 收藏列表) | M5+ |
| 邮箱密码登录 / Magic Link | 不做 |
| 双 OAuth Provider 合并账号(Account Linking) | 不做(同邮箱判同人) |
| Image-Studio 桌面端实现 | 在 Image-Studio 仓里做,本仓只定契约 |

### 1.5 已锁定决策

| 决策 | 选定方案 |
|---|---|
| Auth 库栈 | `@auth/core` + `@hono/auth-js` + Drizzle adapter |
| Session 存储 | DB (postgres sessions 表) |
| OAuth Provider | Google + GitHub |
| 未登录时 Send 按钮 | Disabled + tooltip "请先登录" |
| Studio 未装 fallback | 硬编 GitHub releases URL + 复制提示词 |
| 限流 | 60/min/user_id + 200/min/IP(import-tokens POST) |
| UA 校验 | 软校验(不含 `Image-Studio/` 允许 + warn 日志) |
| Token 长度 | 8 位 base62(沿用 M1 spec) |
| Token 有效期 | 24h(沿用 M1 spec) |

---

## 2. Auth 架构

### 2.1 库选型

```jsonc
// apps/api/package.json — 新增依赖
{
  "@auth/core": "^0.37.x",          // Auth.js 框架无关核心
  "@hono/auth-js": "^1.x",          // Hono 适配器
  "@auth/drizzle-adapter": "^1.x"   // sessions/accounts 持久化适配
}
```

### 2.2 Provider 配置(`apps/api/src/auth/index.ts`)

```ts
import { initAuthConfig } from "@hono/auth-js";
import Google from "@auth/core/providers/google";
import GitHub from "@auth/core/providers/github";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "../db/client.ts";

export const authConfig = initAuthConfig((c) => ({
  secret: c.env.AUTH_SECRET,
  adapter: DrizzleAdapter(db),
  session: { strategy: "database" },        // ← 用 sessions 表
  providers: [
    Google({
      clientId: c.env.GOOGLE_CLIENT_ID,
      clientSecret: c.env.GOOGLE_CLIENT_SECRET,
    }),
    GitHub({
      clientId: c.env.GITHUB_CLIENT_ID,
      clientSecret: c.env.GITHUB_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      // 同邮箱 = 同人:Drizzle adapter 默认基于 email 合并,无需自定义
      return true;
    },
    async session({ session, user }) {
      session.user.id = user.id;            // ← 暴露 user.id 给前端
      session.user.role = (user as any).role ?? "user";
      return session;
    },
  },
}));
```

### 2.3 中间件挂载(`apps/api/src/server.ts`)

```ts
import { authHandler, verifyAuth } from "@hono/auth-js";
import { authConfig } from "./auth/index.ts";

// 在 createServer() 内,顺序很重要:
app.use("*", logger());
app.use("*", secureHeaders());
app.use("*", cors({ /* M1 配置 + 加 credentials: true */ }));
app.use("*", authConfig);                          // 注入 c.var.authUser
app.use("/api/auth/*", authHandler());             // /signin /signout /callback /session /csrf

// import-tokens 仅 POST 需登录,GET 是 Image-Studio 调用不挂
const importTokensRoute = new Hono();
importTokensRoute.use("/", verifyAuth());          // 只保护根路径(即 POST /api/import-tokens)
importTokensRoute.post("/", /* ... */);
importTokensRoute.get("/:token", /* ... */);       // 不受 verifyAuth 保护
app.route("/api/import-tokens", importTokensRoute);
```

### 2.4 环境变量(M3 新增 `.env`)

```bash
# Auth.js secret(JWT/CSRF/state 签名)
AUTH_SECRET=<openssl rand -base64 32>

# Google OAuth(Google Cloud Console 创建)
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# GitHub OAuth(GitHub Settings > Developer settings > OAuth Apps 创建)
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...

# OAuth callback base URL(本地 http://localhost:3000,生产 https://image-prompts.your-domain.com)
AUTH_URL=http://localhost:3000
```

**OAuth 应用注册 callback URL**:
- Google: `${AUTH_URL}/api/auth/callback/google`
- GitHub: `${AUTH_URL}/api/auth/callback/github`

---

## 3. 数据库变更

M1 已经建好 4 张 Auth.js 表(`users` / `accounts` / `sessions` / `verification_tokens`) + `import_tokens` 表。M3 只做 **一处增量**:

### 3.1 `import_tokens` 增加 `user_id` NOT NULL

```ts
// apps/api/src/db/schema/system.ts
export const importTokens = pgTable("import_tokens", {
  token: text().primaryKey(),
  payload: jsonb().notNull(),
  promptId: uuid("prompt_id").references(() => prompts.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),   // ★ 新增
  used: boolean().notNull().default(false),
  usedAt: timestamp("used_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  createdIp: text("created_ip"),
}, (t) => ({
  expiresIdx: index("import_tokens_expires_idx").on(t.expiresAt),
  userIdx: index("import_tokens_user_idx").on(t.userId, t.createdAt.desc()),  // ★ 新增
}));
```

### 3.2 迁移

```bash
pnpm db:generate    # drizzle-kit 生成新 migration
pnpm db:migrate     # 本地 + CI + 生产首次跑前 import_tokens 表无数据,直接 ADD COLUMN NOT NULL 安全
```

迁移 SQL(由 drizzle-kit 生成,大致):
```sql
ALTER TABLE import_tokens
  ADD COLUMN user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX import_tokens_user_idx ON import_tokens(user_id, created_at DESC);
```

> **NOTE:** M1 spec §13.3 提到 "import_tokens 事务 + CAS 防双花" —— CAS 在 §5.2 落实。

---

## 4. API 接口契约

### 4.1 端点清单

| Method | Path | Auth | 说明 |
|---|---|:-:|---|
| GET | `/api/auth/signin` | 公开 | Auth.js 内置,显示 provider 选择(我们走自定义前端,这个端点不直接给用户) |
| GET | `/api/auth/signin/:provider` | 公开 | 重定向到 Google/GitHub 授权页 |
| GET | `/api/auth/callback/:provider` | 公开 | OAuth 回调,Auth.js 处理 |
| POST | `/api/auth/signout` | session | 销毁 session + 清 cookie + 重定向 |
| GET | `/api/auth/session` | 公开(读) | 返回当前 session 或 null |
| GET | `/api/auth/csrf` | 公开 | Auth.js 内置,CSRF token(form 提交用) |
| POST | `/api/import-tokens` | **session ★** | 创建一次性 token |
| GET | `/api/import-tokens/:token` | 公开 (UA 软查) | Image-Studio 消费 token |

### 4.2 `POST /api/import-tokens`(浏览器调用)

```ts
// Headers
Cookie: ip.session-token=<auth.js session cookie>

// Request body (Zod)
{
  prompt: { zh?: string, en?: string },         // 至少一个非空
  negative_prompt?: { zh?: string, en?: string },
  aspect_ratio?: "auto" | "1:1" | "3:2" | "2:3" | "16:9" | "9:16",
  prompt_id?: string,                            // UUID,可选,用于 send_count 自增
}

// Response 201
{
  token: string,           // 8 位 base62
  expires_at: string,      // ISO 8601
}

// 错误
401 { error: "unauthorized" }                    // 未登录或 session 过期
413 { error: "payload_too_large" }               // payload > 4 KB
422 { error: "validation_error", issues: [...] } // Zod 校验失败
429 { error: "rate_limit" }                      // 60/min/user 或 200/min/IP
500 { error: "internal_error" }
```

**限流**:
- `60` 次/分钟/`user_id`(已认证主限)
- `200` 次/分钟/`ip`(防同账号多端并发 / 兜底)
- 用 `hono-rate-limiter` 内存 LRU,key = `userId || ip`

**Payload 大小**:
- Hono `bodyLimit({ maxSize: 4096 })` middleware 在路由前置

**幂等性**:不强求,每次都生成新 token(同一 prompt 可以重复发送,只是各占一行)。

### 4.3 `GET /api/import-tokens/:token`(Image-Studio 调用)

```ts
// Headers (推荐)
Authorization: "Image-Studio/0.x.y"              // 软校验

// Response 200
{
  prompt: { zh?: string, en?: string },
  negative_prompt?: { zh?: string, en?: string },
  aspect_ratio?: string,
}

// 错误
404 { error: "token_not_found" }                 // token 不存在
410 { error: "token_used" }                      // 已用过(CAS 失败)
410 { error: "token_expired" }                   // 当前时间 > expires_at
```

**UA 软校验**:
- 含 `Image-Studio/` → 直接放行,UA 入审计日志
- 不含 → 仍然放行(dev 友好),但 `logger.warn({ ua, token: token.slice(0,3) + "***" })`

**CORS**:此端点是桌面 app fetch,无 Origin 头或 Origin=`tauri://` / `wails://`,不做 CORS 限制。

### 4.4 `GET /api/auth/session` 响应形态

```ts
// 已登录
200 {
  user: {
    id: string,
    name: string | null,
    email: string,
    image: string | null,
    role: "user" | "moderator" | "admin",
  },
  expires: string,     // ISO 8601
}

// 未登录
200 null
```

---

## 5. Send to Studio 流程实现

### 5.1 时序(沿用 M1 §6.1,补 Auth 门控)

```
浏览器 SPA                  Hono API                        Image-Studio (Wails)
   │                            │                                    │
1. 用户在详情页点 [Send to Studio]                                    │
   │                            │                                    │
2. const sess = useSession()                                          │
   │   if (!sess.user) → tooltip "请先登录" (按钮其实是 disabled)     │
   │   if (sess.user) → 进入 3                                       │
   │                            │                                    │
3. POST /api/import-tokens (with cookie)                              │
   │ { prompt, negative_prompt, aspect_ratio, prompt_id }             │
   │ ──────────────────────→    │                                    │
4.                              │ verifyAuth() → c.var.user.id        │
                                │ Zod 校验 + bodyLimit                │
                                │ 限流 check (LRU)                    │
                                │ INSERT import_tokens                │
                                │   token = base62(8), user_id, ...   │
                                │   expires_at = now() + 24h          │
5. ←──────────────  201 { token, expires_at }                         │
   │                            │                                    │
6. window.location.href = "image-studio://import?token=k7Bx2QzR"      │
   │                            │                                    │
   │ ╔═══════════════════════════════════════════════════════╗       │
   │ ║ OS 弹窗:"打开 Image-Studio?"  (Mac/Win/Linux 一致)   ║       │
   │ ╚═══════════════════════════════════════════════════════╝       │
   │                            │                                    │
7. setTimeout(1500ms, () => {                                         │
     if (document.visibilityState === "visible") {                     │
       // 没装 / 用户点了"取消" → 弹 fallback modal                   │
     } else {                                                          │
       // 假定已跳到 Studio,什么都不做                                │
     }                                                                 │
   })                                                                  │
   │                                                                  │
   │                            │     8. (Studio 启动 / 已运行实例    │
   │                            │         接收 args)                 │
   │                            │                                    │
9.                              │  ← GET /api/import-tokens/k7Bx2QzR  │
                                │     Authorization: Image-Studio/0.1.0
                                │  10. SELECT FOR UPDATE              │
                                │      CHECK expires_at > now()       │
                                │        ELSE 410 token_expired       │
                                │      CAS UPDATE used=TRUE           │
                                │        WHERE used=FALSE             │
                                │        ELSE 410 token_used          │
                                │      UPDATE prompts                 │
                                │        SET send_count = send_count+1│
                                │        WHERE id = prompt_id         │
                                │      COMMIT                         │
11.                             │  ──→ 200 { prompt, neg, aspect }    │
                                │                                    │
                                │            12. Studio 弹 toast      │
                                │               "已从 Image-Prompts   │
                                │                导入提示词"          │
```

### 5.2 CAS + send_count 同事务(`apps/api/src/repositories/import-tokens.ts`)

```ts
export async function consumeImportToken(token: string) {
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(importTokens)
      .where(eq(importTokens.token, token))
      .for("update");                              // SELECT FOR UPDATE

    if (!row) throw new ApiError(404, "token_not_found");
    if (row.used) throw new ApiError(410, "token_used");
    if (row.expiresAt < new Date()) throw new ApiError(410, "token_expired");

    // CAS:WHERE used=FALSE 防止并发竞争
    const upd = await tx
      .update(importTokens)
      .set({ used: true, usedAt: new Date() })
      .where(and(eq(importTokens.token, token), eq(importTokens.used, false)))
      .returning();

    if (upd.length === 0) throw new ApiError(410, "token_used");

    if (row.promptId) {
      await tx
        .update(prompts)
        .set({ sendCount: sql`${prompts.sendCount} + 1` })
        .where(eq(prompts.id, row.promptId));
    }

    return row.payload as ImportPayload;
  });
}
```

### 5.3 前端组件:`SendToStudioButton`

```tsx
type ButtonState =
  | "loading"        // session 加载中
  | "guest"          // 未登录 → disabled + tooltip
  | "idle"           // 已登录 → 可点
  | "creating"       // POST 中 → loading spinner
  | "launching"      // scheme 已触发,等 1500ms 检测 → loading
  | "error";

export function SendToStudioButton({ prompt }: Props) {
  const { data: session, isLoading } = useSession();
  const [state, setState] = useState<ButtonState>("idle");
  const [showFallback, setShowFallback] = useState(false);

  const buttonState: ButtonState =
    isLoading ? "loading"
    : !session?.user ? "guest"
    : state;

  async function handleClick() {
    if (buttonState !== "idle") return;
    setState("creating");
    try {
      const { token } = await apiFetch("/api/import-tokens", {
        method: "POST",
        body: JSON.stringify({ ... }),
      });
      setState("launching");
      window.location.href = `image-studio://import?token=${token}`;

      setTimeout(() => {
        if (document.visibilityState === "visible") {
          setShowFallback(true);
        }
        setState("idle");
      }, 1500);
    } catch (e) {
      setState("error");
      toast.error(/* ... */);
      setTimeout(() => setState("idle"), 3000);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={buttonState !== "idle"}
        title={buttonState === "guest" ? t("auth.signin_required") : undefined}
        onClick={handleClick}
        className={/* Apple Blue 主按钮,disabled 半透明 */}
      >
        {(buttonState === "creating" || buttonState === "launching") && <Spinner />}
        {t("detail.send_to_studio")}
      </button>

      {showFallback && (
        <StudioNotInstalledModal
          prompt={prompt}
          onClose={() => setShowFallback(false)}
        />
      )}
    </>
  );
}
```

### 5.4 `StudioNotInstalledModal`

```tsx
const RELEASES_URL = "https://github.com/RoseKhlifa/Image-Studio/releases";
const SUPPRESS_KEY = "ip:studio_install_suppressed";

export function StudioNotInstalledModal({ prompt, onClose }: Props) {
  const [copied, setCopied] = useState(false);

  if (localStorage.getItem(SUPPRESS_KEY) === "1") {
    onClose();
    return null;
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(pickBilingual(prompt, locale) ?? "");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback: 隐藏 textarea + execCommand("copy")
    }
  }

  return (
    <Modal onClose={onClose}>
      <h3>{t("studio_modal.title")}</h3>
      <p>{t("studio_modal.body")}</p>
      <div className="flex gap-2">
        <a
          href={RELEASES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary"
        >
          {t("studio_modal.download")}
        </a>
        <button onClick={handleCopy} className="btn-secondary">
          {copied ? t("studio_modal.copied") : t("studio_modal.copy_prompt")}
        </button>
      </div>
      <label className="text-xs text-ink-muted mt-4 flex gap-2">
        <input
          type="checkbox"
          onChange={(e) => {
            if (e.target.checked) localStorage.setItem(SUPPRESS_KEY, "1");
            else localStorage.removeItem(SUPPRESS_KEY);
          }}
        />
        {t("studio_modal.dont_ask_again")}
      </label>
    </Modal>
  );
}
```

### 5.5 安全边界(继承 M1 §6.4,补 Auth 后变化)

| # | 边界 | M3 落实 |
|---|---|---|
| 1 | Token 熵 8 位 base62 ≈ 47.6 bit | M1 已有 `generateBase62Token` |
| 2 | 限流 | 60/user + 200/IP (M3 收紧) |
| 3 | Payload 大小 ≤ 4 KB | `bodyLimit({ maxSize: 4096 })` |
| 4 | UA 软校验 | M3 §4.3 实现 |
| 5 | CORS 严格 | POST 仅自家域名;GET 无限制 |
| 6 | HTTPS only + scheme 严格 | 前端硬编 `image-studio://import?token=`,后端 token 永远不含特殊字符 |
| 7 | Payload 不含敏感数据 | M3 payload 字段固定 4 个,不塞 user_id / email |
| 8 ★ | **Token 与 user_id 绑定** | M3 新增 `import_tokens.user_id NOT NULL` |
| 9 ★ | **限流 key 优先 user_id** | 避免共用 IP 被一人薅 |

---

## 6. UI Surface

### 6.1 Header(`AppShell.tsx` 改造)

```
┌─────────────────────────────────────────────────────────────────────┐
│ [Logo] [Browse] [About] [Search...]    [中/En] [🌙] [SignIn/Avatar] │
└─────────────────────────────────────────────────────────────────────┘
```

**未登录**:
- 显示 `<SignInButton />`:Apple Blue outline 风格,文本 `t("auth.sign_in")`
- 点击 → 弹小 modal:`[Google] [GitHub]`,各自 `<a href="/api/auth/signin/google">`

**已登录**:
- 显示 `<ProfileMenu />`:头像圆形(`user.image` 兜底首字母圆形 + Apple Blue 底色)
- 下拉:
  - 头像 + name + email(只读)
  - 分隔线
  - `Profile` → `/profile`(M3 只显示头像+邮箱+退出)
  - `Sign Out` → POST `/api/auth/signout`

### 6.2 详情页 `PromptDetailPage` 改造

把现在 `disabled` 的占位按钮替换为 `<SendToStudioButton prompt={...} />`(详见 §5.3)。

### 6.3 ProfilePage(`/profile`)

```
┌──────────────────────────────────┐
│       [Avatar]                   │
│       Name                       │
│       email@example.com          │
│                                  │
│   [Sign Out]                     │
└──────────────────────────────────┘
```

未登录访问 → 重定向到 `/`。

### 6.4 i18n 新增 keys

```jsonc
// apps/web/src/i18n/locales/zh.json
{
  "auth": {
    "sign_in": "登录",
    "sign_in_with": "使用 {provider} 登录",
    "sign_out": "退出",
    "signin_required": "请先登录",
    "profile": "个人资料"
  },
  "detail": {
    "send_to_studio": "Send to Image-Studio",
    "signin_required": "请先登录后使用",     // ← 替换原 coming_in_m2
    "copy_prompt": "复制提示词"
  },
  "studio_modal": {
    "title": "未检测到 Image-Studio",
    "body": "Image-Studio 是配套的桌面端生图客户端,请先下载安装即可一键导入。",
    "download": "下载 Image-Studio",
    "copy_prompt": "复制提示词",
    "copied": "已复制",
    "dont_ask_again": "我已经装了,别再问"
  }
}
```

英文对应 keys 同步更新(`en.json`)。

---

## 7. 错误处理矩阵

| 场景 | 触发 | 用户感知 | 实现 |
|---|---|---|---|
| OAuth 回调失败(用户拒绝授权) | callback URL 带 `error=access_denied` | toast "未授权,登录已取消" | Auth.js error 重定向到 `/?auth_error=denied` |
| OAuth 回调失败(provider 故障) | callback URL 带 `error=server_error` | toast "登录服务暂时不可用" | 同上,error type 区分 |
| Session 过期 | API 返回 401 | toast "登录已过期" + 引导重登 | TanStack Query `onError` |
| POST /api/import-tokens 401 | 用户登出后继续点 | toast "请重新登录" | 同上 |
| POST 429 | 限流 | toast "操作过于频繁,请稍候" | 同上 |
| POST 413 | payload 超大(极端情况,理论上不会发生) | toast "提示词过长" | 同上 |
| POST 5xx | 后端崩 | toast "服务异常,请重试" + 重试按钮 | 全局 errorHandler |
| Scheme 跳转失败 | 1500ms 内 visibilityState==="visible" | 弹 StudioNotInstalledModal | §5.3 |
| Clipboard API 不可用 | 老浏览器 / 非 HTTPS | `execCommand("copy")` fallback | §5.4 |
| Token 已用(Image-Studio 端) | GET 返回 410 token_used | Image-Studio 端 toast | Image-Studio 仓负责 |
| Token 过期(Image-Studio 端) | GET 返回 410 token_expired | 同上 | 同上 |

---

## 8. 测试策略

### 8.1 单元测试(Vitest)

**`apps/api/src/repositories/import-tokens.test.ts`**:
- `createImportToken`:正常创建 / payload 超大 / payload 不含 zh+en → 应被上层 Zod 拦截
- `consumeImportToken`:正常消费 / token 不存在 → 404 / token 已用 → 410 / token 过期 → 410
- **并发 CAS**:同一 token 并行 consume,只有一个成功
- `send_count` 同事务自增 √

**`apps/web/src/components/PromptDetail/SendToStudioButton.test.tsx`**:
- 状态机:loading → guest → idle 切换
- guest 状态按钮 disabled
- idle 状态点击 → 调 API → 跳 scheme
- 1500ms 内仍 visible → 显示 fallback modal
- API 401 → 显示错误状态

**`apps/web/src/components/modals/StudioNotInstalledModal.test.tsx`**:
- 渲染三个按钮
- 复制按钮调 navigator.clipboard.writeText
- "不再提示"勾选写 localStorage,下次组件直接 onClose

### 8.2 集成测试(Vitest + Hono `app.request`)

**`apps/api/src/routes/import-tokens.test.ts`**:
- POST 401 无 cookie
- POST 201 with valid session(测试 helper:直接往 sessions 表 INSERT 一行 + 在 request 上塞对应 cookie,绕过 OAuth)
- POST 422 缺 prompt
- POST 413 超大 payload
- POST 429 触发限流(用真实 LRU)
- GET 200 with valid token + UA `Image-Studio/0.1.0`
- GET 410 token_used(先 POST 拿 token,再 GET 两次,第二次 410)
- GET 410 token_expired(直接 DB 插过期 token,再 GET)
- GET 404 token 不存在
- send_count 在 GET 后真的自增

### 8.3 Auth.js 测试不做 E2E

Auth.js 的 OAuth 回调环节涉及真实 Google/GitHub,集成测试成本高。M3 用手测覆盖:
- 手测 1:Google OAuth signin → 顶部头像出现 → POST import-tokens 成功
- 手测 2:GitHub OAuth signin → 同上
- 手测 3:同邮箱 Google + GitHub 登录 → 合并到同一 user

### 8.4 手测覆盖矩阵

| # | 场景 | 期望结果 |
|---|---|---|
| 1 | 游客访问 `/` | 顶部显示 SignIn,详情页 Send 按钮 disabled |
| 2 | 点 SignIn → Google → 同意 | 跳回 `/`,顶部头像出现,Send 按钮亮 |
| 3 | 已登录,详情页点 Send | 弹 OS "打开 Image-Studio?" 对话框 |
| 4 | OS 对话框点取消 → 等 2s | 弹 StudioNotInstalledModal |
| 5 | 在 StudioNotInstalledModal 点"复制提示词" | clipboard 真有内容,toast "已复制" |
| 6 | 在 StudioNotInstalledModal 勾"不再提示" → 再点 Send → 取消 | 不再弹 modal |
| 7 | 退出登录 → 详情页 Send 变 disabled | √ |
| 8 | 退出登录后立即点 Send(假设 session 已失效) | toast "请重新登录" |
| 9 | Image-Studio 真机 + Mac 注册 scheme handler | scheme 跳成功,Studio toast "已导入" |

### 8.5 CI 配置

M1 已有 GitHub Actions 工作流(lint-typecheck-unit + api-integration with postgres service)。M3 不改 CI 配置 — 新增的 import-tokens / auth 测试自动跑进 `api-integration` job。

唯一变化:需要在 CI secrets 里加 `AUTH_SECRET`(测试用一个固定 32 字节 base64)。`GOOGLE_*` / `GITHUB_*` OAuth credentials 不放 CI(集成测试不真跑 OAuth,只测 session middleware)。

---

## 9. Image-Studio 端契约(只定接口,不实现)

**本仓不实现 Image-Studio 端,但定义清楚 Image-Studio 仓需要做什么**。详见 M1 spec §6.5,本 M3 spec 补一份精简版:

### 9.1 必须做的修改

1. **`wails.json` 注册 scheme**:
   ```jsonc
   {
     "info": {
       "protocols": [
         { "scheme": "image-studio", "role": "Editor", "name": "Image-Studio Prompt Import" }
       ]
     }
   }
   ```

2. **`main.go`(Wails 入口)解析 args + 单实例锁**:
   ```go
   func main() {
       if len(os.Args) > 1 {
           if uri, err := url.Parse(os.Args[1]); err == nil && uri.Scheme == "image-studio" {
               // 单实例:如果已有运行中实例,把 token 转给它,然后退出
               if forwardToRunningInstance(uri) { os.Exit(0) }
               app.PendingImport = uri.Query().Get("token")
           }
       }
       wails.Run(...)
   }
   ```

3. **后端服务方法 `ImportPromptByToken(token string) (Payload, error)`**:
   ```go
   func (a *App) ImportPromptByToken(token string) (Payload, error) {
       url := fmt.Sprintf("%s/api/import-tokens/%s", a.ImagePromptsBaseURL, token)
       req, _ := http.NewRequest("GET", url, nil)
       req.Header.Set("Authorization", fmt.Sprintf("Image-Studio/%s", a.Version))
       // ... fetch + 解析 + 处理 410 / 404
   }
   ```

4. **前端 React 端 hook `useStudioBootstrap`**:
   - 启动时调一次 `runtime.EventsOn("import-prompt", ...)`
   - 收到 payload → 写入 `studioStore.setField`(prompt / negative / aspect)
   - 显示 toast "已从 Image-Prompts 导入提示词"

### 9.2 Image-Studio 团队需要的环境变量

```bash
# Image-Studio 仓
IMAGE_PROMPTS_BASE_URL=https://image-prompts.your-domain.com   # 默认值
```

本地开发覆盖为 `http://localhost:3000`。

---

## 10. 部署影响

### 10.1 VPS 环境变量

部署到生产时,在 VPS 的 `.env.production` 加:
```bash
AUTH_SECRET=<openssl rand -base64 32>
AUTH_URL=https://image-prompts.your-domain.com
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
```

### 10.2 OAuth 应用注册步骤(生产)

**Google Cloud Console**:
1. APIs & Services > Credentials > Create OAuth Client ID
2. Application type: Web application
3. Authorized redirect URIs:
   - `https://image-prompts.your-domain.com/api/auth/callback/google`
   - `http://localhost:3000/api/auth/callback/google`(dev 同账号)

**GitHub Settings > Developer settings > OAuth Apps**:
1. New OAuth App
2. Homepage URL: `https://image-prompts.your-domain.com`
3. Authorization callback URL: `https://image-prompts.your-domain.com/api/auth/callback/github`(GitHub 只允许一个 callback,本地开发要单独创建一个 dev app)

### 10.3 Nginx / Hono 注意

- Auth.js 通过 cookie 维护 session,Nginx 反代必须传 `proxy_pass_request_headers on`
- Cookie 是 httpOnly + Secure(生产),local dev 通过 `AUTH_URL=http://localhost:3000` 自动降级为非 Secure

---

## 11. 风险与对应

| 风险 | 影响 | 对应 |
|---|---|---|
| OAuth Provider 故障(Google 挂了) | 部分用户无法登录 | 双 Provider 互为冗余,M1 spec 已纳入 |
| Auth.js v0.x API breaking | 升级痛 | 锁版本 `~0.37.x`,生产前评估再升 |
| Studio scheme 在某些浏览器/系统失效 | 核心功能受损 | M3 fallback modal + 复制提示词 + GitHub releases 链接 |
| 用户共用同一浏览器 → cookie 串号 | 跨用户 token 误用 | session DB 持久化 + httpOnly + sameSite=lax |
| 限流误伤(共用 NAT IP) | 多用户被锁 | 优先按 user_id 限流,IP 是兜底 |
| OAuth callback URL 配错 | 登录回不来 | OAuth 应用注册 step 写进部署 checklist |
| Token 泄露(URL 复制粘贴) | 他人代消费 | 一次性 + 24h + user_id 绑定(M3 ★)  |

---

## 12. 实现顺序提示(给 writing-plans skill)

按依赖排序的任务建议(具体步骤拆分由 writing-plans 输出):

1. **依赖安装** — `@auth/core` + `@hono/auth-js` + `@auth/drizzle-adapter`
2. **Auth schema 校准** — 检查 M1 已建 Auth.js 4 表与 v0.37 期望是否一致(adapter 文档对照)
3. **import_tokens 加 user_id NOT NULL** — schema 改 + drizzle generate + migrate
4. **Auth.js 集成** — authConfig + 中间件挂载 + session callback 暴露 user.id/role
5. **OAuth 应用注册指南** — README 加 dev 部分,引导手动注册 Google/GitHub dev app
6. **POST /api/import-tokens 实现** — Zod schema + repo + 限流 + 路由 + 集成测试
7. **GET /api/import-tokens/:token 实现** — CAS + send_count + UA 软校验 + 集成测试
8. **前端 useSession hook** — 包装 GET /api/auth/session + TanStack Query
9. **Header 改造** — SignInButton + ProfileMenu
10. **OAuth Provider 选择 modal**
11. **ProfilePage**
12. **SendToStudioButton 状态机化** — 替换 PromptDetailPage 占位
13. **StudioNotInstalledModal**
14. **i18n 新增 keys**
15. **手测覆盖矩阵执行**
16. **Spec / 代码 review 收尾**

---

## 13. 下一步

1. 用户 review 本 spec
2. 修改后 commit 锁定
3. 进入 `writing-plans` 撰写 M3 实现计划(按上述 16 步铺成 bite-sized tasks)
4. 主分支拉 `feat/m3-auth-and-send-to-studio` worktree 开始执行
