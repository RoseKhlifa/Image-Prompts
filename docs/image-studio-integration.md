# Image-Studio ↔ Image-Prompts 对接文档

> 本仓 (Image-Prompts) 已在 M3 (2026-06-07) 把对接面落地。本文档面向 **Image-Studio 仓的实现者**,描述需要在 Image-Studio 端做的所有改造,以及本仓提供的契约。
>
> **状态:** Image-Prompts 端已上线 production-ready (含限流、CAS、send_count、UA 软校验、24h TTL、user_id 绑定、StudioNotInstalledModal fallback)。**Image-Studio 端为零** — 本文是从零开始的实现指南。
>
> **参考源:**
> - 设计 spec: `docs/superpowers/specs/2026-06-07-m3-auth-and-send-to-studio-design.md`
> - 实现 plan: `docs/superpowers/plans/2026-06-07-m3-auth-and-send-to-studio.md`
> - 后端实现: `apps/api/src/routes/import-tokens.ts`, `apps/api/src/repositories/import-tokens.ts`
> - 前端实现: `apps/web/src/components/PromptDetail/SendToStudioButton.tsx`
> - 共享契约: `packages/shared/src/schemas/api.ts` (`ImportTokenPayloadSchema` 等)

---

## 1. 一句话

用户在 Image-Prompts 网页详情页点 **"Send to Image-Studio"** → 网页拿到一个 8 位 base62 的 token → 浏览器跳 `image-studio://import?token=XXXXXXXX` → OS 把 token 转给 Image-Studio → Image-Studio 用这个 token 反查 Image-Prompts API,拿到 prompt 内容,填进生成界面。

整个握手是 **一次性的 + 24 小时内有效 + 与登录用户绑定**;Image-Studio 端是无状态消费方,不需要登录、不需要 cookie、不存任何用户身份。

---

## 2. 时序总览

```
浏览器 SPA                 Image-Prompts API                    Image-Studio 桌面端
   │                            │                                       │
1. 用户点 [Send to Studio] (登录态)                                     │
   │                            │                                       │
2. POST /api/import-tokens (cookie auth)                                │
   │ ─────────────────────────→ │                                       │
                                │ verifyAuth + bodyLimit 4KB            │
                                │ 限流 60/min/user + 200/min/ip         │
                                │ INSERT import_tokens                  │
                                │   token=8位base62, user_id, payload,  │
                                │   expires_at=now()+24h                │
3. ← 201 { token, expires_at }                                          │
   │                            │                                       │
4. location.href = "image-studio://import?token=k7Bx2QzR"               │
   │                            │                                       │
   │ ╔═══════════════════════════════════════════════════════╗          │
   │ ║ OS 弹 "打开 Image-Studio?"  (Mac/Win/Linux)           ║          │
   │ ╚═══════════════════════════════════════════════════════╝          │
   │                            │                                       │
5. setTimeout(1500ms, () => {                                           │
     if (document.visibilityState==="visible")                          │
       → 弹 StudioNotInstalledModal (下载链接 + 复制提示词)             │
   })                                                                   │
   │                            │                                       │
   │                            │   6. 启动 / 已运行实例接收 argv        │
   │                            │      解析 image-studio:// 里的 token   │
   │                            │                                       │
                                │ ← GET /api/import-tokens/k7Bx2QzR     │
                                │     User-Agent: Image-Studio/0.1.0    │
                                │                                       │
                                │ SELECT FOR UPDATE → 校验 used/expired │
                                │ CAS UPDATE used=true                   │
                                │ UPDATE prompts SET send_count++       │
                                │ COMMIT                                │
                                │ ─→ 200 { prompt, negative_prompt?, aspect_ratio? }
                                │                                       │
                                │              7. Studio 把 payload 写入  │
                                │                 生成器表单,弹 toast    │
                                │                 "已从 Image-Prompts    │
                                │                  导入提示词"           │
```

---

## 3. URI Scheme 注册

### 3.1 协议规范

| 项 | 值 |
|---|---|
| Scheme | `image-studio` |
| Host (action) | `import` |
| Query 参数 | `token=<8位base62>` |
| 完整示例 | `image-studio://import?token=k7Bx2QzR` |

> Token 正则 `^[0-9A-Za-z]{8}$`,大小写敏感。任何不匹配的请求一律视为 404,**不要** trim、不要 toLowerCase、不要 URL-decode (token 只含 base62 字符,本身就 URL-safe)。

### 3.2 macOS (Wails)

`wails.json` 或 `build/darwin/Info.plist`:

```xml
<key>CFBundleURLTypes</key>
<array>
  <dict>
    <key>CFBundleURLName</key>
    <string>com.rosekhlifa.image-studio</string>
    <key>CFBundleURLSchemes</key>
    <array>
      <string>image-studio</string>
    </array>
    <key>CFBundleTypeRole</key>
    <string>Editor</string>
  </dict>
</array>
```

启动参数走 `application:openURLs:` 回调 (macOS 不通过 `os.Args` 传 URL,而是给 AppDelegate 的 URL 事件)。Wails 已封装 `runtime.OnURLOpen` 之类的钩子 — 如果版本不支持,需要走 Objective-C bridge 接 `NSAppleEventManager`。

### 3.3 Windows (Wails / NSIS / MSI)

注册表写入 (NSIS 安装脚本里):

```nsis
WriteRegStr HKCR "image-studio" "" "URL:Image-Studio Prompt Import"
WriteRegStr HKCR "image-studio" "URL Protocol" ""
WriteRegStr HKCR "image-studio\DefaultIcon" "" "$INSTDIR\image-studio.exe,1"
WriteRegStr HKCR "image-studio\shell\open\command" "" '"$INSTDIR\image-studio.exe" "%1"'
```

启动时 token 出现在 `os.Args[1]`。

### 3.4 Linux

放一份 `.desktop` 文件 (打包到 `/usr/share/applications/image-studio.desktop`):

```ini
[Desktop Entry]
Name=Image-Studio
Exec=/usr/bin/image-studio %u
Type=Application
MimeType=x-scheme-handler/image-studio;
Categories=Graphics;
```

然后 `xdg-mime default image-studio.desktop x-scheme-handler/image-studio` (安装后脚本自动跑)。

---

## 4. API 契约

### 4.1 Image-Studio 唯一关心的端点

**`GET {API_BASE}/api/import-tokens/{token}`**

| 项 | 值 |
|---|---|
| Method | `GET` |
| Auth | **不需要任何 cookie / Bearer / API key**。Token 本身就是凭据 |
| 推荐 Header | `User-Agent: Image-Studio/<semver>` (软校验 — 缺失只是 warn 日志,不会拒绝) |
| 推荐 Header | `Accept: application/json` |
| CORS | 桌面 fetch 没有 Origin (或 `tauri://` / `wails://`),后端不做 CORS 限制 |
| 幂等性 | **非幂等。一次性消费**,第二次 GET 同 token 一定 410 |

#### 4.1.1 成功响应 200

```json
{
  "prompt": { "zh": "森林里的猫", "en": "a cat in the forest" },
  "negative_prompt": { "zh": "模糊", "en": "blurry" },
  "aspect_ratio": "3:2"
}
```

字段:

| 字段 | 类型 | 必填 | 说明 |
|---|---|:-:|---|
| `prompt` | `{ zh?: string, en?: string }` | ★ | 双语正向提示词。`zh` / `en` 至少一个非空字符串。两边 trim 后空字符串会被规范化为缺失 (key 不出现) |
| `negative_prompt` | `{ zh?: string, en?: string }` | ○ | 双语反向提示词,可整体缺失。两个语种也可分别缺失 |
| `aspect_ratio` | `string` enum | ○ | 见 §4.3 枚举值 |

> 单字段长度上限 **4000 字符** (后端 Zod schema)。Image-Studio 解析时不需要再校验,信任 server。

#### 4.1.2 错误响应

| HTTP | body | 触发条件 | Image-Studio 应做 |
|:-:|---|---|---|
| 404 | `{ "error": "token_not_found" }` | token 不存在 / 格式不合法 (非 8 位 base62) | 弹错误 toast: "提示词链接无效或已被清理,请回网页重新发送" |
| 410 | `{ "error": "token_used" }` | token 已被消费过 (大概率是用户反复点 scheme 或 OS 重放) | 弹 toast: "这个提示词已经导入过了" — **不要**当作错误,可以静默成功 (因为提示词可能已经在表单里) |
| 410 | `{ "error": "token_expired" }` | 距离创建超过 24 小时 | 弹错误 toast: "导入链接已过期,请回网页重新发送" |
| 5xx | (varies) | 后端故障 / 网络抖动 | 退避重试 (建议 3 次,间隔 500ms / 1s / 2s)。最终失败 toast: "导入服务暂时不可用" |

> **不要**对 4xx 做重试。这些都是终态。

### 4.2 不要调用的端点 (仅给浏览器用)

- `POST /api/import-tokens` — 需要 Auth.js cookie + CSRF,Image-Studio 不需要也不应该发。
- `/api/auth/**` — Auth.js OAuth 流程,与 Image-Studio 无关。
- 任何 `/api/me/**`, `/api/owner/**`, `/api/admin/**` — 都需要登录态。

### 4.3 `aspect_ratio` 枚举值 (固定 10 个)

```
"auto" | "1:1"
"3:2"  | "2:3"
"16:9" | "9:16"
"4:3"  | "3:4"
"21:9" | "9:21"
```

源:`packages/shared/src/types/domain.ts` 的 `ASPECT_RATIOS`。如果 Image-Studio 内部用不同的字符串 (例如 `landscape_3_2`),需要建立一张映射表。`"auto"` = 让 Studio 用自己默认的比例。

---

## 5. Image-Studio 端实现指南

### 5.1 单实例 + URL 转发

`image-studio://` 通常由 OS 启动 **一个新进程** 来处理。要避免每次点都开新窗口:

1. 启动时先抢一把锁 (`flock` / `LockFile` / 自定义命名 mutex)。
2. 抢到锁的进程 = 主实例。把 token 处理掉,继续运行。
3. 抢不到锁的进程 = 副实例。通过本地 IPC (Unix socket / Windows Named Pipe / TCP loopback) 把 token 转发给主实例,然后 `os.Exit(0)`。

主实例的 IPC server 收到 token 后,等同于自己启动时收到 token 的逻辑。

### 5.2 Go (Wails) 参考代码

```go
// main.go
package main

import (
  "net/url"
  "os"
)

func main() {
  pendingToken := extractTokenFromArgs(os.Args)

  if !acquireSingleInstanceLock() {
    if pendingToken != "" {
      forwardToRunningInstance(pendingToken)
    }
    os.Exit(0)
  }

  app := NewApp()
  app.PendingToken = pendingToken
  // ... wails.Run(...) — App.OnStartup 里读 PendingToken 触发导入
}

func extractTokenFromArgs(args []string) string {
  for _, a := range args[1:] {
    u, err := url.Parse(a)
    if err != nil || u.Scheme != "image-studio" || u.Host != "import" {
      continue
    }
    tok := u.Query().Get("token")
    if isValidToken(tok) {
      return tok
    }
  }
  return ""
}

var tokenRe = regexp.MustCompile(`^[0-9A-Za-z]{8}$`)

func isValidToken(s string) bool { return tokenRe.MatchString(s) }
```

### 5.3 反查 API + 写入表单

```go
type ImportPayload struct {
  Prompt         BilingualText      `json:"prompt"`
  NegativePrompt *BilingualText     `json:"negative_prompt,omitempty"`
  AspectRatio    *string            `json:"aspect_ratio,omitempty"`
}

type BilingualText struct {
  Zh *string `json:"zh,omitempty"`
  En *string `json:"en,omitempty"`
}

func (a *App) ImportPromptByToken(token string) (*ImportPayload, error) {
  base := a.Config.ImagePromptsBaseURL // 见 §6
  reqURL := fmt.Sprintf("%s/api/import-tokens/%s", base, url.PathEscape(token))

  req, _ := http.NewRequestWithContext(a.ctx, "GET", reqURL, nil)
  req.Header.Set("User-Agent", fmt.Sprintf("Image-Studio/%s", a.Version))
  req.Header.Set("Accept", "application/json")

  client := &http.Client{ Timeout: 10 * time.Second }
  resp, err := client.Do(req)
  if err != nil { return nil, fmt.Errorf("network: %w", err) }
  defer resp.Body.Close()

  var body struct {
    ImportPayload
    Error string `json:"error,omitempty"`
  }
  if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
    return nil, fmt.Errorf("decode: %w", err)
  }

  switch resp.StatusCode {
  case 200:
    return &body.ImportPayload, nil
  case 404:
    return nil, ErrTokenNotFound
  case 410:
    if body.Error == "token_expired" { return nil, ErrTokenExpired }
    return nil, ErrTokenUsed
  default:
    return nil, fmt.Errorf("server %d", resp.StatusCode)
  }
}
```

### 5.4 前端 (React) 钩子

```ts
// useStudioImport.ts
import { useEffect } from "react";
import { EventsOn } from "wailsjs/runtime/runtime";
import { ImportPromptByToken } from "wailsjs/go/main/App";

export function useStudioImport(setForm: (p: ImportPayload) => void) {
  useEffect(() => {
    const off = EventsOn("import-token", async (token: string) => {
      try {
        const payload = await ImportPromptByToken(token);
        setForm({
          prompt: pickLocale(payload.prompt),
          negative_prompt: payload.negative_prompt ? pickLocale(payload.negative_prompt) : "",
          aspect_ratio: payload.aspect_ratio ?? "auto",
        });
        toast.success("已从 Image-Prompts 导入提示词");
      } catch (e) {
        if (e === "TOKEN_USED") toast("这个提示词已经导入过了");
        else if (e === "TOKEN_EXPIRED") toast.error("导入链接已过期,请回网页重新发送");
        else if (e === "TOKEN_NOT_FOUND") toast.error("提示词链接无效");
        else toast.error("导入服务暂时不可用");
      }
    });
    return off;
  }, [setForm]);
}
```

Go 侧在 `OnStartup` 里如果检测到 `PendingToken`,通过 `runtime.EventsEmit(ctx, "import-token", PendingToken)` 把 token 推到前端。后续 IPC 转发的 token 也走同一条事件总线。

### 5.5 双语挑选策略

Payload 是双语的。Image-Studio 选哪个语种?建议:

1. 如果用户在 Image-Studio 里已经选过界面语言 (例如设置里有 `locale=zh`),用那个。
2. 都填到表单里 (一些 Studio 已经有"中/英"分开输入框),展示给用户由他自己挑。
3. 兜底:优先 `zh`,缺失则用 `en`。

> 不要去翻译。Image-Prompts 的 AI 翻译能力是 M10b 才在站内提供 (`POST /api/translate`),不暴露给桌面端。

---

## 6. 环境 / 配置

### 6.1 Image-Studio 需要一个配置项

```bash
# Image-Studio 仓的 .env / config 文件
IMAGE_PROMPTS_BASE_URL=https://image-prompts.your-domain.com
```

- **本地开发** (跟着本仓的 dev server 跑): `http://localhost:3000`
- **生产**: 部署上线后 (M11 计划),会给出 `https://image-prompts.<owner-domain>`。届时 Image-Studio 端需要发版改默认值,或者做"先试 prod → 失败回退 dev"。

> 让用户能改这个值 (隐藏设置),方便开发者 / 自托管用户对接私有部署。

### 6.2 Image-Prompts 端环境 (供参考,不需要 Image-Studio 配)

| 变量 | 用途 | Image-Studio 是否关心 |
|---|---|:-:|
| `SITE_URL` | SPA 域名 (浏览器侧) | ✗ |
| `API_URL` | API 域名 = `IMAGE_PROMPTS_BASE_URL` 应该指向这里 | ✓ (只是名字别搞混) |
| `AUTH_URL`, `GOOGLE_*`, `GITHUB_*`, `AUTH_SECRET` | OAuth | ✗ |
| `DATABASE_URL`, `R2_*` | 服务端基建 | ✗ |

---

## 7. 边界情况 & UX 建议

| # | 场景 | Image-Studio 该怎么办 |
|---|---|---|
| 1 | 用户在网页点 Send,Studio **没装** | 不归 Studio 管。网页 1500ms 后弹 `StudioNotInstalledModal` (含 GitHub releases 下载链接 + 复制提示词) |
| 2 | 用户在网页点 Send,Studio **装了但没开** | OS 启动新进程 → §5.1 单实例锁抢到 → 直接进入导入流程 |
| 3 | 用户在网页点 Send,Studio **已经在跑** | OS 启动新进程 → 抢不到锁 → IPC 转发 → 原进程窗口前置 + 触发导入 |
| 4 | 用户在网页连点两次 Send | 网页会生成 **两个** token (后端不去重)。Studio 收到第二个 token 时,第一个可能已经消费完。建议在 Studio 端如果当前导入流程还没完成,排队处理新 token |
| 5 | Token 已被消费 (410 token_used) | 静默 — toast "已经导入过了"。**不要**清空当前表单 |
| 6 | Token 过期 (410 token_expired) | toast 错误 — 引导用户回网页重新发送 |
| 7 | API 请求超时 / 5xx | 退避重试 (建议 3 次)。最终失败 toast,但 **不要崩** |
| 8 | URL 里 token 不是 8 位 base62 | 不要发请求 — 本地直接判 404,toast "无效链接" |
| 9 | Studio 启动时收到多个 URL (`os.Args`) | 只处理第一个合法 token,其余忽略并日志 warn |
| 10 | 用户在 Studio 里禁用了 "允许外部导入" (假设你做这个开关) | 收到 token 时弹确认对话框 |

---

## 8. 安全模型

| 边界 | 已落地 | Image-Studio 端的义务 |
|---|---|---|
| Token 熵 | 8 位 base62 ≈ 47.6 bit,`crypto.getRandomValues` 生成 | 不要在日志/崩溃报告里完整输出 token (只前 3 位 + `***`) |
| 一次性 | DB 事务 + CAS (`WHERE used=FALSE`) 防双花 | 单一进程就够,不要预先并行多次 GET 同 token |
| 24h TTL | 后端 `expires_at` 校验 | 接收到 token 后立即处理,不要存到磁盘留到下次启动 |
| 与登录用户绑定 | `import_tokens.user_id NOT NULL` | Studio 不需要知道是谁 — 信任 token 本身 |
| Payload 不含敏感数据 | 后端 payload 只塞 prompt/neg/aspect | Studio 拿到后视为纯文本,不要当 URL / 命令执行 |
| 限流 | 60/min/user + 200/min/ip (POST 侧) | GET 侧暂未限流 — 也不要狂刷 |
| UA 软校验 | 含 `Image-Studio/` 直放,否则 warn 但仍放行 | **始终带** `User-Agent: Image-Studio/<semver>`,方便运维区分 |
| HTTPS only (生产) | TLS 终结在反向代理 | Studio 必须在生产用 `https://`,本地 dev 才用 `http://localhost` |

> **不要** 把 `image-studio://` URL 写进剪贴板分享。token 一旦泄露,24 小时内任何人都能消费一次 (虽然只能消费一次,但 payload 暴露)。

---

## 9. 开发流程

### 9.1 本仓 dev server 启动 (供 Image-Studio 联调)

```bash
# 在本仓 (Image-Prompts) 根目录
pnpm install
pnpm db:migrate
pnpm db:seed             # 灌 31 条种子 prompt (注意:会 TRUNCATE,见 CLAUDE.md / memory)
pnpm dev                 # api:3000 + web:5173 并行启动
```

OAuth dev creds 配好 (`apps/api/.env` 的 `GOOGLE_*` / `GITHUB_*`) 才能在网页登录,但 **Image-Studio 联调不需要登录** — 直接手造一条 import_tokens 记录就能测 GET 端点:

```bash
# 用 psql 灌一条永不过期的测试 token
psql image_prompts_dev <<'SQL'
-- 先确保有个 user (随便挑一行)
INSERT INTO import_tokens (token, user_id, payload, expires_at, used)
VALUES (
  'TESTTEST',
  (SELECT id FROM users LIMIT 1),
  '{"prompt":{"zh":"测试提示词","en":"test prompt"},"aspect_ratio":"16:9"}'::jsonb,
  NOW() + INTERVAL '7 days',
  false
);
SQL
```

然后从 Image-Studio 里跑:

```bash
curl -H "User-Agent: Image-Studio/dev" http://localhost:3000/api/import-tokens/TESTTEST
```

期望:

```json
{"prompt":{"zh":"测试提示词","en":"test prompt"},"aspect_ratio":"16:9"}
```

再跑一次 → 410 `token_used`。

### 9.2 端到端联调

1. Image-Studio 启动 (注册好 scheme handler)。
2. 浏览器开 `http://localhost:5173/zh/prompts`,登录,点任意 prompt 详情页。
3. 点 "Send to Image-Studio"。
4. OS 弹"打开 Image-Studio?" → 同意。
5. Image-Studio 主窗口前置,表单已填好 prompt。

### 9.3 测试 checklist (Image-Studio 仓自测)

- [ ] Mac/Win/Linux 各自 scheme 注册成功 (开浏览器手敲 `image-studio://import?token=TESTTEST` 能唤醒)
- [ ] Studio 没在跑时,scheme 触发能启动 + 导入
- [ ] Studio 已在跑时,scheme 触发能 **前置已有窗口** + 导入 (不开新窗口)
- [ ] 同一 token 第二次 GET 收到 410 token_used,UI 友好提示
- [ ] 网络断了 → toast 友好提示 + 不崩
- [ ] 非法 token (例如 `image-studio://import?token=xxx`) → 本地拒绝,不发请求
- [ ] User-Agent 头确实带了 `Image-Studio/<version>`
- [ ] 拿到 payload 后,中文表单填中文,英文表单填英文,aspect_ratio 正确映射
- [ ] `IMAGE_PROMPTS_BASE_URL` 可由用户改 (隐藏设置 / 配置文件)

---

## 10. 不在对接面里的 (FAQ)

| 需求 | 实现位置 | 备注 |
|---|---|---|
| 用户在 Studio 里搜 Image-Prompts 的提示词 | **不做** (M3 范围外) | Studio 是消费方,搜索 / 浏览留给网页 |
| 用户在 Studio 里反向 "发布到 Image-Prompts" | **不做** (没有这条产品线) | 投稿走网页 `/submit` |
| Studio 里看自己已发送过哪些 prompt | 本地存,服务端不暴露 | Image-Prompts 端只在 `prompts.send_count` 做聚合自增,不存 send 历史 |
| AI 翻译 (zh ↔ en) | M10b 在 Image-Prompts 站内提供 (`POST /api/translate`),不开放给桌面端 | Studio 自己接 LLM,不要走本站 |
| 头像 / 用户身份 | Studio 不需要 | Studio 只是消费 token,不知道发送者是谁 |

---

## 11. 版本与变更管理

- 当前契约版本: **v1** (M3 落地时定型,2026-06-07)
- 后续如果要扩字段 (例如新增 `seed` / `steps`),约定:
  - **加字段** = 向后兼容,Image-Studio 老版本忽略未知字段即可
  - **改字段语义 / 删字段** = 破坏性变更,需双方约定窗口期 + 在 payload 里加 `schema_version`
- Image-Studio 端应做"未知 aspect_ratio 退回 auto"的容错,以便本站新增比例 (例如未来加 `5:4`) 不会让老 Studio 报错
- 后端会在 commit log / sprint history 记录契约变更,Image-Studio 升级前查 `packages/shared/src/schemas/api.ts` 里的 `ImportTokenPayloadSchema`

---

## 12. 关联文件速查

```
本仓 (Image-Prompts)
├── docs/superpowers/specs/2026-06-07-m3-auth-and-send-to-studio-design.md   # 详细设计
├── apps/api/src/routes/import-tokens.ts                                    # 路由实现
├── apps/api/src/repositories/import-tokens.ts                              # CAS 事务 + send_count
├── apps/api/src/routes/import-tokens.test.ts                               # 集成测试 (含手造过期 token 的范例)
├── apps/web/src/components/PromptDetail/SendToStudioButton.tsx             # 网页触发 scheme 的入口
├── apps/web/src/components/modals/StudioNotInstalledModal.tsx              # 没装 Studio 的 fallback
├── packages/shared/src/schemas/api.ts                                      # ImportToken* Zod schemas (契约源)
└── packages/shared/src/types/domain.ts                                     # ASPECT_RATIOS 等枚举
```
