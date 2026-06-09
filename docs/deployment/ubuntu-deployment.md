# Image-Prompts 部署指南(Ubuntu + 1Panel)

> 目标域名:`https://prompts.sorry.ink`
> 反向代理:1Panel 自带 OpenResty(本文不细配,只说监听口)
> 数据库:同机 PostgreSQL
> 进程管理:systemd(推荐)

---

## 0. 前置假设

- 一台干净的 Ubuntu 22.04 / 24.04 LTS VPS,4 GB RAM + 2 vCPU 起步,40 GB 系统盘
- root / sudo 权限
- 域名 `prompts.sorry.ink` 已经在 DNS 解析到这台 VPS
- 1Panel 已经安装并能正常使用
- Cloudflare R2 桶已经创建好,有 access key + secret + endpoint + public URL

---

> **运行身份**:本文所有命令都以 **root** 直接执行(配合 1Panel 的使用习惯)。如果你介意安全性想换成专用用户,把所有 `/root/Image-Prompts` 路径改为 `/home/<user>/Image-Prompts`,systemd 单元的 `User=root` 改成 `User=<user>`,其余完全一致。

## 1. 系统准备

```bash
# 基础工具
apt update && apt upgrade -y
apt install -y curl git build-essential ca-certificates

# Node 22 (官方 NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v   # 应该输出 v22.x

# pnpm
npm install -g pnpm@9
pnpm -v
```

### PostgreSQL 16

```bash
apt install -y postgresql-16 postgresql-client-16
systemctl enable --now postgresql

# 建库 + 建用户
sudo -u postgres psql <<EOF
CREATE USER imageprompts WITH PASSWORD '<生成一个 32 字符随机串>';
CREATE DATABASE imageprompts OWNER imageprompts ENCODING 'UTF8' TEMPLATE template0;
GRANT ALL PRIVILEGES ON DATABASE imageprompts TO imageprompts;
\c imageprompts
GRANT ALL ON SCHEMA public TO imageprompts;
EOF
```

> **关于 LC_COLLATE**:不需要指定 `LC_COLLATE='zh_CN.UTF-8'`。本站没有任何 query 按中文字符串排序(列表按时间戳 / 计数排,标签和分类按 URL-safe ASCII slug 排),`UTF8` encoding 加默认 `C.UTF-8` collation 足够。强行指定 `zh_CN.UTF-8` 在 PG16 上还会因为缺 ICU 配置而报 `invalid LC_COLLATE locale name`。
>
> 如果你已经执行过(或者像日志里那样报错过)别担心 —— 第一次只是 user 建好了,DB 没建;第二次成功建 DB + GRANT 之后状态已经干净。

记下 DB password,后面 `.env` 要用。

---

## 2. 拉代码 + 安装依赖

```bash
cd /root
git clone https://github.com/RoseKhlifa/Image-Prompts.git
cd Image-Prompts
pnpm install --frozen-lockfile
```

---

## 3. 环境变量

```bash
cp apps/api/.env.example apps/api/.env
nano apps/api/.env
```

需要填的关键字段(以 `prompts.sorry.ink` 为域名):

```ini
# ── 应用基础 ────────────────────────────────────
NODE_ENV=production
API_PORT=3001                              # 后端监听口,1Panel 反代 /api → 这里
WEB_PORT=4173                              # 前端 vite preview 监听口(或交给 nginx 直接服务静态)
PUBLIC_SITE_URL=https://prompts.sorry.ink  # ★ OAuth callback 拼接基地址

# ── 数据库 ───────────────────────────────────────
DATABASE_URL=postgres://imageprompts:<password>@localhost:5432/imageprompts

# ── Better Auth(会话签名密钥) ─────────────────
BETTER_AUTH_SECRET=<openssl rand -hex 32 生成>
BETTER_AUTH_URL=https://prompts.sorry.ink  # ★ 同 PUBLIC_SITE_URL

# ── Google OAuth ────────────────────────────────
GOOGLE_CLIENT_ID=<console 拿>
GOOGLE_CLIENT_SECRET=<console 拿>

# ── GitHub OAuth ────────────────────────────────
GITHUB_CLIENT_ID=<开发者设置 拿>
GITHUB_CLIENT_SECRET=<开发者设置 拿>

# ── Cloudflare R2 ───────────────────────────────
R2_ACCOUNT_ID=<your r2 account id>
R2_ACCESS_KEY_ID=<key>
R2_SECRET_ACCESS_KEY=<secret>
R2_BUCKET=image-prompts-1
R2_PUBLIC_URL=https://<your-public-url>     # bucket 的 public dev url 或 custom domain

# ── 站长授权 ────────────────────────────────────
OWNER_EMAILS=rosekhlifa@gmail.com
ADMIN_EMAILS=rosekhlifa@gmail.com

# ── 站点资源根目录(import 用) ────────────────
IMPORT_DATA_ROOT=/root/import-data   # 后面把要导入的 JSONL 放这里
```

> 生成 secrets:`openssl rand -hex 32`

如果 web 有自己的 `.env`(检查 `apps/web/.env.example`),也要把 `VITE_PUBLIC_SITE_URL=https://prompts.sorry.ink` 这类配上。

---

## 4. 关键!OAuth 回调 URL 同步

**Google Cloud Console**(https://console.cloud.google.com/apis/credentials):
- 找到现有的 OAuth 2.0 Client
- **Authorized JavaScript origins** 加:`https://prompts.sorry.ink`
- **Authorized redirect URIs** 加:`https://prompts.sorry.ink/api/auth/callback/google`
- 保留 localhost 那条以防本地继续开发

**GitHub OAuth Apps**(https://github.com/settings/developers):
- 找到对应 app 或新建一个
- **Homepage URL**:`https://prompts.sorry.ink`
- **Authorization callback URL**:`https://prompts.sorry.ink/api/auth/callback/github`
- (注:GitHub 一个 OAuth app 只允许一个 callback URL。如果想保留 dev,新建一个 production-only 的 app,把 prod credentials 写 production `.env`,dev 用另一份)

**Cloudflare R2**(如果用了 CORS):
- R2 Bucket → Settings → CORS Policy
- 把 `https://prompts.sorry.ink` 加到 `AllowedOrigins`

---

## 5. 数据库迁移 + Seed

```bash
cd /root/Image-Prompts

# 跑 4 个 migration apply 脚本(顺序很重要)
pnpm -F api exec tsx scripts/apply-0010-display-mode.ts
pnpm -F api exec tsx scripts/apply-0011-original-prompt.ts
pnpm -F api exec tsx scripts/apply-0012-profile-enrich.ts
pnpm -F api exec tsx scripts/apply-0013-import.ts

# 种 NSFW 分类 + nsfw tag
pnpm -F api exec tsx scripts/seed-nsfw-category.ts
```

每个脚本都幂等,重复跑无害。

---

## 6. 构建

```bash
cd /root/Image-Prompts
pnpm -F shared build
pnpm -F api build       # 如果 api 有 build step;没有就跳
pnpm -F web build       # 产物在 apps/web/dist/
```

`apps/web/dist/` 就是静态文件,后面交给 1Panel OpenResty 直接 serve。

---

## 7. systemd 服务(后端)

```bash
nano /etc/systemd/system/image-prompts-api.service
```

```ini
[Unit]
Description=Image-Prompts API server
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=/root/Image-Prompts
Environment=NODE_ENV=production
EnvironmentFile=/root/Image-Prompts/apps/api/.env
ExecStart=/usr/bin/node /root/Image-Prompts/node_modules/.pnpm/tsx@*/node_modules/tsx/dist/cli.mjs apps/api/src/index.ts
Restart=always
RestartSec=5
StandardOutput=append:/var/log/image-prompts-api.log
StandardError=append:/var/log/image-prompts-api.log

[Install]
WantedBy=multi-user.target
```

> 如果 `apps/api` 有编译产物(比如 `dist/index.js`),把 `ExecStart` 换成 `/usr/bin/node /root/Image-Prompts/apps/api/dist/index.js` 更稳。

启动:

```bash
systemctl daemon-reload
systemctl enable --now image-prompts-api
systemctl status image-prompts-api    # 看日志
journalctl -u image-prompts-api -f    # 实时跟
```

后端应该已经监听在 `127.0.0.1:3001`。

---

## 8. 1Panel OpenResty 反代

在 1Panel 控制台:

1. **网站 → 新建网站 → 反代类型**
2. 主域名填 `prompts.sorry.ink`
3. 代理目标:
   - `/api/` → `http://127.0.0.1:3001`(后端)
   - `/` → 静态目录 `/root/Image-Prompts/apps/web/dist`
   - 或者全部反代到 `http://127.0.0.1:4173`(如果你跑 `pnpm -F web preview` 起服务)
4. SSL → 通过 1Panel 申请 Let's Encrypt
5. **务必勾上** `HTTP → HTTPS 强制跳转`

> WebSocket / SSE 需要的话,反代规则里加上 `proxy_http_version 1.1` + `Upgrade/Connection` 头(1Panel 一般有勾选项)。

---

## 9. R2 公开访问

production 的 R2 bucket 公开 URL 推荐挂个自定义子域(`cdn.sorry.ink` / `prompts-cdn.sorry.ink`):

1. R2 → 桶 → Settings → Custom Domains → 添加
2. CF DNS 自动加 CNAME
3. 把 `R2_PUBLIC_URL` 改成这个自定义域

不挂自定义域用默认 `r2.dev` URL 也行,但不推荐(rate limit + 没 cache 控制)。

---

## 10. 部署完最后一步:登录 + 创建 R2 账户

1. 浏览器开 `https://prompts.sorry.ink`,Google 登录用 `rosekhlifa@gmail.com`
2. 自动判断为 OWNER → 右上角能进 `/zh/rosekhlifa`
3. **R2 池**:`/zh/rosekhlifa/r2` 加一个 production R2 账户(填 account ID / access key / secret / public URL)
4. **网站设置**:`/zh/rosekhlifa/config` 改 `import.data_root` 为 `/root/import-data`(如果要在 production 上传 JSONL)

---

## 11. 上传数据(可选)

把本地 JSONL 文件丢到服务器:

```bash
# 本地
scp -r G:/promptsandimages/exports/* root@<vps-ip>:/root/import-data/
```

然后 `/zh/rosekhlifa/import` 页面拖文件上传(走 admin API,会落到 `/tmp/ip-import-*` 临时目录处理,处理完自动清掉)。

---

## 故障排查

| 症状 | 检查 |
|---|---|
| 502 Bad Gateway | `systemctl status image-prompts-api` + `tail -f /var/log/image-prompts-api.log` |
| OAuth 跳转回来 redirect_uri_mismatch | OAuth 控制台 callback URL 没加全;PUBLIC_SITE_URL / BETTER_AUTH_URL 跟实际访问域不一致 |
| 图片 404 | R2_PUBLIC_URL 错;R2 桶 CORS 没配 |
| 数据库连不上 | `sudo -u postgres psql -c "\du"` 看用户在不在;`pg_hba.conf` 的 `local` 行是不是 `peer` 改成 `md5` |
| systemd 启动失败 | tsx 路径变了(pnpm 升级会变),换成编译后的 `apps/api/dist/index.js` 更稳 |

---

## 备份

```bash
# 每日 4 点备份数据库到本地
crontab -e
0 4 * * * sudo -u postgres pg_dump -Fc imageprompts > /var/backups/imageprompts-$(date +\%Y\%m\%d).dump

# 7 天后清理
0 5 * * * find /var/backups/imageprompts-*.dump -mtime +7 -delete
```

R2 数据 R2 自己做 versioning + lifecycle,这里不管。

---

## 上线 checklist

- [ ] DNS A 记录已生效(`dig prompts.sorry.ink`)
- [ ] 1Panel SSL 已经申请且 auto-renew 开启
- [ ] `https://prompts.sorry.ink` 能打开首页
- [ ] Google OAuth 能登录
- [ ] GitHub OAuth 能登录
- [ ] `/zh/rosekhlifa` 能进
- [ ] 投稿 → 审核 → 上架 一条走通
- [ ] R2 缩略图正常显示
- [ ] `/zh/about` 数字非 0
- [ ] systemd 自启 OK(`sudo reboot` 后还活着)
- [ ] 数据库每日备份 cron 启动
- [ ] 邮箱告警:rosekhlifa@gmail.com 收得到(测下 mod queue / 注册通知)
