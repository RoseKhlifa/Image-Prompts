# M4 手测清单(Submission + R2 Pool + Moderation)

> 从零到完成全套 M4 验证。预计 60-90 分钟,前 30 分钟是 Cloudflare R2 一次性配置,后 60 分钟是 25 行测试矩阵。每完成一项打勾。

**前提**:本地代码已在 `main` @ `6a9dde4`(M4 合并 + follow-ups 文档)。`pnpm test` 283/283 全过。

---

## 0. 先决条件

- [ ] **0.1** 你的代理已开(Cloudflare R2 dashboard 在国内访问会卡)
- [ ] **0.2** Postgres 已跑(`docker compose ps` 看 `image_prompts_dev` 服务在跑;或者 `psql "postgres://ip_app:devpassword@localhost:5432/image_prompts_dev" -c 'SELECT 1'` 返回 1)
- [ ] **0.3** `apps/api/.env` 已有 M3 的 OAuth 凭证(Google + GitHub)且 OAuth 登录 demo 还能跑

---

## 1. Cloudflare R2 一次性配置(30 分钟)

### 1.1 注册/登录 Cloudflare

- [ ] **1.1.1** 浏览器打开 https://dash.cloudflare.com
- [ ] **1.1.2** 没有账号就 Sign Up;有就 Log In。注册需要邮箱 + 密码 + 邮件验证。
- [ ] **1.1.3** 登录后左下角能看到 "Account ID"(32 位 hex)。记下来,后面要用。例:`a1b2c3d4e5f6...`

### 1.2 订阅 R2(免费档)

- [ ] **1.2.1** 左侧导航点 **R2 Object Storage**(如果没看到,展开 "Storage & Databases")
- [ ] **1.2.2** 首次进入会提示 "Subscribe to R2"。点 Subscribe。
- [ ] **1.2.3** **需要绑卡**(Cloudflare 要求,但免费档下不会扣费 — 月 10GB 存储 + 1M Class A ops + 10M Class B ops 完全够 dev/小规模生产用)。
  - 用支持外币的银行卡(VISA / Mastercard;**国内储蓄卡很多不行,推荐**:招行/中信外币信用卡 / 虚拟卡如 wildcard / 也可以拿别人的卡)
  - 不想绑卡的话:M4 跑不起来。考虑用 MinIO 本地替代(超出本文档范围)。
- [ ] **1.2.4** 订阅成功后进入 R2 dashboard

### 1.3 创建 Bucket

- [ ] **1.3.1** 点 **Create bucket**
- [ ] **1.3.2** Bucket name:`image-prompts-dev`(随便起,记下来)
- [ ] **1.3.3** Location:**Asia-Pacific (APAC)** — 国内访问最快
- [ ] **1.3.4** Default storage class:Standard
- [ ] **1.3.5** 点 Create bucket
- [ ] **1.3.6** 创建完会跳到 bucket 详情页

### 1.4 开启 Public Development URL

- [ ] **1.4.1** 在 bucket 详情页,顶部切到 **Settings** 标签
- [ ] **1.4.2** 找到 "Public Development URL" 区域,点 **Enable**
- [ ] **1.4.3** 弹框确认后会显示一个 URL,形如 `https://pub-1a2b3c4d5e6f....r2.dev`
- [ ] **1.4.4** 复制这个 URL,后面要写进 `.env` 的 `R2_DEV_PUBLIC_URL`

### 1.5 配置 CORS

- [ ] **1.5.1** 还在 Settings 标签,找到 **CORS Policy** 区域
- [ ] **1.5.2** 点 **Edit CORS policy**
- [ ] **1.5.3** 粘贴下面的 JSON(把 `YOUR-PROD-DOMAIN` 改成空字符串或你以后准备用的域名;dev 阶段后两个不用动):

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:5173",
      "http://localhost:3000"
    ],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type", "Content-Length"],
    "MaxAgeSeconds": 3600
  }
]
```

- [ ] **1.5.4** 保存。验证方式:回到 Overview 后再回 Settings,CORS 区域应该显示已配置的 JSON。

### 1.6 配置 Lifecycle Rule(自动清过期上传)

- [ ] **1.6.1** Settings → **Object lifecycle rules** → Add rule
- [ ] **1.6.2** Rule name:`expire-submissions`
- [ ] **1.6.3** Object prefix(scope filter):`submissions/`(末尾的斜杠**重要**)
- [ ] **1.6.4** Action:**Delete uploaded parts**(或在 Cloudflare 用语里叫 **Expire current versions of objects**)after `7` days
- [ ] **1.6.5** 保存

### 1.7 创建 API Token

- [ ] **1.7.1** 回到 R2 dashboard 主页,左侧或顶部找 **Manage R2 API Tokens**(或直接访问 https://dash.cloudflare.com/?to=/:account/r2/api-tokens)
- [ ] **1.7.2** 点 **Create API token**
- [ ] **1.7.3** Token name:`image-prompts-dev-rw`
- [ ] **1.7.4** Permissions:**Object Read & Write**
- [ ] **1.7.5** Specify bucket(s):勾选 "Apply to specific buckets only" → 选刚创建的 `image-prompts-dev`
- [ ] **1.7.6** TTL:Forever(或随意,但记着到期要换)
- [ ] **1.7.7** Client IP Address Filtering:留空(国内 IP 不固定)
- [ ] **1.7.8** Create API Token
- [ ] **1.7.9** **关键一步:页面会显示 3 个值**,**离开页面就再也看不到 Secret**,**立刻**复制保存到 notepad:
  - **Token value**(整个 token 字符串,**不用**)
  - **Access Key ID**(20+ 字符,要)
  - **Secret Access Key**(40+ 字符,要)
  - **Endpoint URL for S3 clients**(形如 `https://<account-id>.r2.cloudflarestorage.com`,要)
- [ ] **1.7.10** 关掉页面前再确认你复制了 3 个东西。

### 1.8 生成加密 key

R2 secret 在数据库里以 AES-256-GCM 加密存储。需要一个 32 字节随机 key,以 64 字符 hex 表示。

- [ ] **1.8.1** Windows PowerShell 跑:
  ```powershell
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
  或者 Git Bash:
  ```bash
  openssl rand -hex 32
  ```
- [ ] **1.8.2** 输出形如 `5f4e3a2c1b9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f`(64 个 hex 字符)
- [ ] **1.8.3** 复制,准备写到 `.env`

### 1.9 填 `.env`

- [ ] **1.9.1** 打开 `apps/api/.env`(如果没有,从 `apps/api/.env.example` 复制)
- [ ] **1.9.2** 填入或修改这几行(其他变量保留 M3 的值):

  ```ini
  R2_ENCRYPTION_KEY=5f4e3a2c1b9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0e9f8a7b6c5d4e3f
  
  R2_DEV_ENDPOINT=https://<你的-account-id>.r2.cloudflarestorage.com
  R2_DEV_ACCESS_KEY_ID=<step 1.7.9 复制的 Access Key ID>
  R2_DEV_ACCESS_KEY_SECRET=<step 1.7.9 复制的 Secret Access Key>
  R2_DEV_BUCKET=image-prompts-dev
  R2_DEV_PUBLIC_URL=https://pub-<step 1.4.3 复制的 hash>.r2.dev
  
  ADMIN_EMAILS=你的_OAuth_登录_邮箱@example.com
  ```

  > `ADMIN_EMAILS` 用你的 Google 或 GitHub 账号的 primary email。大小写不敏感。多个用逗号分隔。

- [ ] **1.9.3** 保存。`.env` 在 `.gitignore` 里,不会被 commit。

### 1.10 应用迁移 + 写入 R2 账号行

- [ ] **1.10.1** 跑迁移(把 M4 的 notifications + audit_log + agreed_guidelines_version 应用到数据库):
  ```bash
  pnpm --filter @ip/api db:migrate
  ```
  期望输出:`migrating 0006_m4_submission ... ✅`(如果 0006 已经应用过,会显示 "nothing to migrate")

- [ ] **1.10.2** Seed R2 账号行(把刚才填的 `R2_DEV_*` 加密写进 `r2_accounts` 表):
  ```bash
  pnpm --filter @ip/api seed:r2
  ```
  期望输出:`R2 account seeded: <uuid>`。如果显示 "r2_accounts already has a row, skipping" 也是 OK 的 — 说明 M3 的 dev 数据已经有了。
  
  > 如果想强制重新 seed:`psql ... -c "DELETE FROM r2_accounts;"` 再跑 seed。

- [ ] **1.10.3** 用 psql 验证写入:
  ```bash
  psql "$DATABASE_URL" -c "SELECT id, name, endpoint, bucket, enabled FROM r2_accounts;"
  ```
  应该看到一行,`enabled=t`。

### 1.11 启动

- [ ] **1.11.1** 顶级跑 dev:
  ```bash
  pnpm dev
  ```
  期望:`apps/api` 在 `:3000` 跑,`apps/web` 在 `:5173` 跑,没报错。
- [ ] **1.11.2** 浏览器开 `http://localhost:5173/zh/`,首页能正常加载(瀑布流 + 卡片显示)。
- [ ] **1.11.3** 头像菜单 → Sign In → OAuth(Google 或 GitHub)登录成功。
- [ ] **1.11.4** **重要:登录后立刻退出再重登**(`ADMIN_EMAILS` 自动提升只在登录 session callback 里跑,需要触发一次)。然后用 psql 验证你已经是 admin:
  ```bash
  psql "$DATABASE_URL" -c "SELECT email, role FROM users WHERE email = '你的邮箱';"
  ```
  应该看到 `role = admin`。
  
  > 没成功提升?检查 `.env` 里 `ADMIN_EMAILS` 的邮箱大小写、空格、有没有引号(不要加引号)。

✅ 准备工作完成。下面是真正的测试矩阵。

---

## 2. 测试矩阵(spec §12 共 25 行)

每行尽量准确执行,通过后打勾。如果失败:先回看 §1 的 setup,确认 R2 凭证、ADMIN_EMAILS 等;不是 setup 问题就抓 console + network panel 的截图发给我。

### 2.1 投稿前置(A-E)

#### A. 未登录访问 /zh/submit 应该弹 SignInModal
- [ ] **A.1** 隐身窗口打开 `http://localhost:5173/zh/submit`
- [ ] **A.2** 页面应该立即弹 SignInModal(M3 的那个登录窗口)
- [ ] **A.3** 关闭 modal(点 X 或 ESC)→ 自动跳转回 `/zh/`(首页)

#### B. 已登录但首次投稿 → 弹社区准则 modal(30 秒计时)
- [ ] **B.1** 用你的 admin 账号登录
- [ ] **B.2** 访问 `/zh/submit`
- [ ] **B.3** 页面下面那个表单出现但被遮罩(opacity-50 不能交互)
- [ ] **B.4** 顶部弹一个 modal,标题"投稿须知"
- [ ] **B.5** 底部"我同意"按钮显示 "再阅读 30 秒后可勾选同意",数字从 30 倒数
- [ ] **B.6** 复选框 disabled(灰)

#### C. 30 秒未到 + 没滚到底 → 复选框还是 disabled
- [ ] **C.1** 等 5 秒,按钮文字应该变成 "再阅读 25 秒后可勾选同意"
- [ ] **C.2** 不滚动,等到 30 秒满,按钮文字变 "请滚动到底部以表明已阅读"
- [ ] **C.3** 复选框仍 disabled

#### D. 滚到底 + 30 秒满 + 勾选 → 同意按钮启用
- [ ] **D.1** 滚 modal 内容到最底
- [ ] **D.2** 按钮文字变 "我同意"
- [ ] **D.3** 复选框可点,勾上
- [ ] **D.4** 点 "我同意"
- [ ] **D.5** modal 关闭,表单遮罩消失,表单可交互
- [ ] **D.6** psql 验证:`SELECT community_guidelines_version FROM users WHERE email = '你的'` 应该是 1

#### E. 再次访问 /zh/submit → 不再弹 modal
- [ ] **E.1** 关闭再打开 `/zh/submit`(或刷新)
- [ ] **E.2** 直接看到表单,不弹 modal

### 2.2 表单 + 上传(F-L)

#### F. 仅填中文(英文留空)+ 1 张图能提交
- [ ] **F.1** 标题(中文):`F-测试中文标题`
- [ ] **F.2** 提示词(中文):`A beautiful landscape, golden hour`
- [ ] **F.3** 中文标签搜索 "肖像" 或者随便一个种子数据里有的标签,选 1 个
- [ ] **F.4** 分类:随便选一个(下拉里应该有 M1 seed 进来的几个分类)
- [ ] **F.5** 图片:准备一张本地 jpg / png / webp,**大小 < 10MB**(用浏览器或 Photoshop 缩放到 1024x1024 就够小)
  - 点空 slot → 选文件
  - 状态:点击后立刻显示 "上传中..." 几秒,然后变成缩略图
  - **检查 Network 面板**:应该看到 POST `/api/submissions/presign` 返回 200,然后 PUT 到 `*.r2.cloudflarestorage.com/*?...` 也是 200
- [ ] **F.6** 点 "提交审核" 按钮
- [ ] **F.7** Toast 显示 "审核中"(或类似),URL 跳到 `/zh/profile?tab=submissions`
- [ ] **F.8** 我的投稿 tab 显示刚提交的卡片,状态 "审核中",有缩略图

#### G. 仅填英文(中文留空)+ 1 张图能提交
- [ ] **G.1** 同 F,但只填 Title (English) + Prompt (English)
- [ ] **G.2** 应该成功,流程同 F

#### H. 中英都空 / 一边只填标题 → 提交按钮失败
- [ ] **H.1** 重新打开 `/zh/submit`,只填中文 Title 不填中文 Prompt(英文都空)
- [ ] **H.2** 选分类 + 1 张图
- [ ] **H.3** 点提交
- [ ] **H.4** Toast 报错 "请至少填写一种语言的完整标题 + 提示词"
- [ ] **H.5** **不**跳转,表单还在原页

#### I. 6MB JPG 能上传
- [ ] **I.1** 准备一张约 6MB 的 jpg(可以用相机原图)
- [ ] **I.2** 添加到 form
- [ ] **I.3** "上传中..." 持续可能 5-10 秒(取决于你的网络 + 代理)
- [ ] **I.4** 完成后显示缩略图(从 R2 public URL 加载,Network 看会有一个 GET `https://pub-*.r2.dev/...` 请求)

#### J. 12MB PNG 应该被拒绝
- [ ] **J.1** 准备一张 > 10MB 的图(可以用 Photoshop 导出大尺寸 png,或者下个 4K 桌面截图)
- [ ] **J.2** 拖入/选择
- [ ] **J.3** **应该不进入上传流程**,而是 inline 显示 "图片超过 10MB"
- [ ] **J.4** Network 面板:**不**应该有 `/api/submissions/presign` 请求被发出 — 客户端先拦截

#### K. GIF 文件应该被拒绝
- [ ] **K.1** 找张 .gif 文件
- [ ] **K.2** 选择上传
- [ ] **K.3** inline 报错 "仅支持 JPG / PNG / WebP"
- [ ] **K.4** 没有 presign 请求

#### L. 选完图但没点提交就关掉页面 → R2 上 7 天后被 lifecycle 清掉
- [ ] **L.1** F 步骤选了图但不点提交,直接关浏览器
- [ ] **L.2** Cloudflare R2 dashboard → bucket → Objects → `submissions/<your-user-id>/` 下应该看到那个孤儿对象
- [ ] **L.3** (无法立刻验证)7 天后回来看,应该被 lifecycle 删除。先记下 key 名留作 7 天后核查。

### 2.3 限额(M-N)

#### M. 一天内提 10 次 → 第 11 次返回 429
- [ ] **M.1** 用 F 的步骤连提 10 个(可以都是同样标题、不同图;或都同一图也行)
- [ ] **M.2** psql 验证:`SELECT daily_submission_count FROM users WHERE email = '你的'` 应该 = 10
- [ ] **M.3** 第 11 次点提交时,toast 报错 "今日投稿已达上限"
- [ ] **M.4** Network 看到 POST `/api/submissions` 返回 **429** `daily_limit_reached`
- [ ] **M.5** 如果嫌每次都拼图费劲,可以走 SQL 模拟:
  ```bash
  psql "$DATABASE_URL" -c "UPDATE users SET daily_submission_count = 10, daily_submission_reset_at = now() WHERE email = '你的';"
  ```
  然后再投一次,应该立刻 429。

#### N. ADMIN_EMAILS 提升验证(setup 时已过,但这里再过一遍场景)
- [ ] **N.1** 你的账号 role 现在是 admin
- [ ] **N.2** 顶部 header 的头像菜单点开,应该看到一项 **"管理"**(在 "资料" 下方)
- [ ] **N.3** 点 "管理" → 跳到 `/zh/admin/submissions`

### 2.4 审核流(O-U)

#### O. /zh/admin/submissions/pending 显示队列
- [ ] **O.1** 访问 `/zh/admin/submissions`(默认 `?status=pending`)
- [ ] **O.2** 左侧应该看到刚才 F/G/I 提交的几条 pending 投稿
- [ ] **O.3** 每行:缩略图 + 标题(中或英) + 投稿人邮箱 + 提交时间

#### P. 点一行 → 右侧 preview 出现
- [ ] **P.1** 点队列中第一条
- [ ] **P.2** URL 变成 `/zh/admin/submissions/<uuid>?status=pending`
- [ ] **P.3** 右侧渲染:大标题、图片网格(全部图)、Prompt 内容(代码块)、投稿人邮箱
- [ ] **P.4** 下方有按钮 "批准"(绿色) + "拒绝"(红色)
- [ ] **P.5** **(admin 才有)** 复选框 "编辑后批准"

#### Q. moderator 不能 edit-then-approve(此项需要你先有一个 moderator 账号)
- [ ] **Q.1** psql 创建/降级一个测试用 moderator(或者用另一个 OAuth 账号登录后 SQL 改 role):
  ```bash
  psql "$DATABASE_URL" -c "UPDATE users SET role = 'moderator' WHERE email = '另一个邮箱';"
  ```
- [ ] **Q.2** 用 moderator 账号登录(不是 admin 那个)
- [ ] **Q.3** 访问 `/zh/admin/submissions/<id>`
- [ ] **Q.4** **不应该**有 "编辑后批准" 复选框(只有 admin 能看到)
- [ ] **Q.5** 点 "批准" 按钮(不编辑)
- [ ] **Q.6** Toast "已批准,提示词已发布"
- [ ] **Q.7** 投稿状态变 approved,promoted prompt slug 出现

#### R. moderator 强行带 edit 提 approve → 403(如果 UI 不让操作,这步可以跳;或者用 curl 直接戳)
- [ ] **R.1** 在 moderator 账号下用 DevTools console:
  ```js
  fetch("/api/admin/submissions/<某 pending 的 id>/approve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ edits: { titleZh: "黑客改的" } })
  }).then(r => r.status)
  ```
- [ ] **R.2** 应该返回 **403**

#### S. admin edit + approve → prompt 的 title 是改后的
- [ ] **S.1** 用 admin 账号登录
- [ ] **S.2** 选一条 pending,点开 "编辑后批准" 复选框
- [ ] **S.3** 改一下中文标题(比如加个后缀 "(改)" )
- [ ] **S.4** 点 "编辑并批准" 按钮
- [ ] **S.5** 成功后,访问 `/zh/prompts/<新 slug>`(或在 "我的投稿" 那条 approved 卡片上点 "查看")
- [ ] **S.6** prompt 详情页的标题就是改后的版本
- [ ] **S.7** **核心验证**:R2 dashboard 看 `prompts/<promptId>/0.jpg` 存在,**原** `submissions/<userId>/<uuid>.jpg` **不存在**(已被 deleteObject)

#### T. Reject 流程
- [ ] **T.1** admin 选一条 pending,点 "拒绝"
- [ ] **T.2** 弹 modal,要求填理由(≥10 字)
- [ ] **T.3** 输入 "测试一下拒绝理由"(11 字),点 "确认拒绝"
- [ ] **T.4** Toast "已拒绝,投稿人将收到通知"
- [ ] **T.5** psql 验证:
  ```bash
  psql "$DATABASE_URL" -c "SELECT status, reject_reason FROM submissions WHERE id = '<id>';"
  ```
  应该是 `rejected` + 你填的理由
- [ ] **T.6** 投稿用户(就是你自己)的 `rejected_count` 应该 +1:
  ```bash
  psql "$DATABASE_URL" -c "SELECT email, rejected_count FROM users WHERE email = '你的';"
  ```

#### U. 被拒 3 次后 → 日限额减半
- [ ] **U.1** 用 SQL 模拟:
  ```bash
  psql "$DATABASE_URL" -c "UPDATE users SET rejected_count = 3, daily_submission_count = 5, daily_submission_reset_at = now() WHERE email = '你的';"
  ```
- [ ] **U.2** 现在你的限额应该是 5 而不是 10。再投一次 → 应该立刻 429。
- [ ] **U.3** 完事后重置:
  ```bash
  psql "$DATABASE_URL" -c "UPDATE users SET rejected_count = 0, daily_submission_count = 0 WHERE email = '你的';"
  ```

### 2.5 通知(V-X)

#### V. NotificationsBell 红点
- [ ] **V.1** S 步骤批准了一条 → 你的账号有 1 条未读通知
- [ ] **V.2** Header 右上角的 🔔 应该有红点 + 数字 "1"
- [ ] **V.3** 点 🔔 → 弹 popover,显示一行 "你的投稿《...》已通过审核"
- [ ] **V.4** 点这一行 → 跳转到 `/zh/prompts/<slug>`,同时红点消失
- [ ] **V.5** 已读的通知再次点 🔔 应该 opacity-60(灰)显示

#### W. "全部已读"
- [ ] **W.1** 再多创建几个未读通知(批准/拒绝多几条)
- [ ] **W.2** 红点显示 2 或更多
- [ ] **W.3** 🔔 → popover → "全部已读"
- [ ] **W.4** 立刻所有通知都变灰,红点消失

#### X. 跨标签同步
- [ ] **X.1** 浏览器开 2 个标签:都登录同一个账号
- [ ] **X.2** 标签 A 在某个非 / 页(比如 `/zh/submit`)
- [ ] **X.3** 标签 B 当 admin 拒绝一条投稿(那条投稿是你自己投的)
- [ ] **X.4** 切到标签 A,**导航**到任意其他页(点 sidebar 任意链接)
- [ ] **X.5** 红点应该立刻更新出现(useEffect on location.pathname 触发了 invalidate)

### 2.6 极端 / 失败路径(Y)

#### Y. Image migration 失败模拟(可选 — 难以自然触发)
- [ ] **Y.1** 模拟方式:把 `r2_accounts` 表的 endpoint 改成无效的:
  ```bash
  psql "$DATABASE_URL" -c "UPDATE r2_accounts SET endpoint = 'https://invalid-no-resolve.example.com';"
  ```
- [ ] **Y.2** 现在让 admin 批准一个新的 pending 投稿(确保有图)
- [ ] **Y.3** Toast 报错 "图片迁移失败,需要人工处理" / 500
- [ ] **Y.4** psql 验证:**prompt 行存在,但是 prompt_images 表里关联行不存在**(脏状态)
- [ ] **Y.5** 完事恢复:
  ```bash
  psql "$DATABASE_URL" -c "UPDATE r2_accounts SET endpoint = 'https://你的真实-endpoint.r2.cloudflarestorage.com';"
  ```
- [ ] **Y.6** 脏 prompt 行手动删:
  ```bash
  psql "$DATABASE_URL" -c "DELETE FROM prompts WHERE slug = '<那条脏的 slug>';"
  ```

---

## 3. 额外手工探索(spec §12 之外)

这些不在 25 行内,但建议过一遍:

- [ ] **3.1** Tag autocomplete:投稿表单输入框里键入 1-2 个字(中文或英文),下拉应该即时显示匹配建议(最多 8 个)
- [ ] **3.2** Tag 最多 6 个:连续点 7 个建议,第 7 个应该被禁(suggestion 按钮 disabled)
- [ ] **3.3** Tag 删除:点 chip 上的 × 应该立刻去掉
- [ ] **3.4** 多图(2-5 张):投稿时上传 3 张,提交后 admin queue 详情 grid 显示 3 张
- [ ] **3.5** 取消上传中:开始 upload 一张大图(等 "上传中" 出现)→ 立刻点 slot 上的 删除 / 或者刷页 → 不会留 zombie state
- [ ] **3.6** Draft 持久化:`/zh/submit` 填了一半,点别处(比如点首页),回来 `/zh/submit` → 表单内容还在(sessionStorage)
- [ ] **3.7** Profile 我的投稿 deep link:点拒绝通知后,URL 变 `?tab=submissions&highlight=<id>`,对应卡片应该有 accent ring + 平滑滚动到中间
- [ ] **3.8** Approve queue 自动前进:批准一条后,右侧 preview 应该回到 empty state(队列里那条消失);如果队列还有下一条,选择不会自动选下一条(用户得手动点)
- [ ] **3.9** Edit 模式只覆盖填了的字段:打开 "编辑后批准",**不填**任何字段,直接点 "批准" → 行为应该等同于不开 edit(零字段 = 零 override)

---

## 4. 测试完毕

- [ ] **4.1** 所有 A-Y 都打勾(可以接受 Y 选做)
- [ ] **4.2** 3.x 额外探索打勾(可以接受跳过)
- [ ] **4.3** Cloudflare R2 dashboard 看 bucket Objects:`submissions/...` 应该有/没有(取决于是否最近 7 天内有未批准的);`prompts/<id>/0.jpg` 应该都在
- [ ] **4.4** 写一句话回报"全过"或者列失败项

## 5. 如果中途崩了

| 症状 | 排查 |
|---|---|
| Presign 返回 503 `no_r2_account` | `r2_accounts` 表为空或全 disabled。跑 `pnpm --filter @ip/api seed:r2` |
| Presign 返回 401 | session 失效。重登。 |
| PUT 到 R2 返回 403 CORS | §1.5 没做或域名不对。回去检查 CORS JSON 的 AllowedOrigins。 |
| PUT 到 R2 返回 401/403 (auth) | Access Key ID / Secret 错了,或加密 key 错了。psql 看 `r2_accounts.access_key_id`,跟你 Cloudflare 上的核对。 |
| Submit 返回 412 `guidelines_not_accepted` | session callback 没把 `communityGuidelinesVersion` 注入到 session,或者你 DB 改了但没重登。重登。 |
| Submit 返回 400 `unknown_tags:...` | tag 不在 `tags` 表里。M4 不允许新建,只能从已有选。 |
| Admin queue 返回 403 | `ADMIN_EMAILS` 没生效。psql 验证 `users.role`,如果还是 user 就检查 `.env` 的拼写、重登。 |
| 通知 popover 一直空 | OAuth 账号是新的,没有任何状态变更。让 admin 用第二个账号 approve 一条你的投稿试试。 |
| 上传中卡住一直转 | 多半是代理问题。打开 Network 看 PUT 请求状态。或者你机器 DNS 看不到 cloudflarestorage.com。 |

---

完事告诉我:**"全过"** / **"X 行失败:..."** — 后者贴 console + network 截图。
