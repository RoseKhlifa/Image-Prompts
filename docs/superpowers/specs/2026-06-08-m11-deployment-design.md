# Sprint 4 / M11 — 部署 + nanobanana 种子迁移

**Date:** 2026-06-08
**Status:** Brainstorm 完成,执行前需 user 确认 VPS 选型
**Scope:** 把 Image-Prompts 跑上海外 VPS,Cloudflare DNS + SSL,把 M1 seed 的 2380 张 nanobanana 图迁到自己的 R2
**Baseline:** main(M10 之后)

---

## 1. Goal

把 Image-Prompts 从本地开发部署到一个海外 VPS,有 SSL、有备份、有监控,可以让真实用户访问。同时把现在 prompt_images 表里指向 placeholder URL 的 2380 张 nanobanana 种子图,实际下载 + 上传到自己的 R2,让首页瀑布流不再裂图。

## 2. Non-Goals

- CDN 优化 / 边缘缓存(MVP 不做)
- 多区域部署(单 VPS)
- 自动伸缩 / 容器编排(MVP 不引入 K8s,docker-compose 够)
- 日志聚合(MVP 用文件 + 简单 `tail -f`)
- APM / tracing(MVP 不要)
- 蓝绿部署(MVP 直接 down-up)

---

## 3. VPS 选型(ASK USER)

| 厂商 | 价格(2C/4G) | 优势 | 劣势 |
|---|---|---|---|
| Hetzner Cloud | €6/月 ~ ¥50 | 性价比最高 / 欧洲多机房 | 国内访问稍慢(欧洲到中国延迟 200ms+) |
| Vultr | $6/月 | 日本/新加坡/韩国机房,国内访问快 | 比 Hetzner 略贵 |
| Linode (Akamai) | $5/月 | 类似 Vultr | 同 |
| OVH VPS | €4/月 | 加拿大/欧洲 | 国内访问慢 / 反 spam 严格 |
| 阿里云 ECS 国际版 | ¥80+/月 | 香港/东京机房,体验最好 | 价格高,实名 |
| **推荐**:Vultr 东京 / 新加坡 4G 节点 |  |  |  |

**ASK USER**:确定 VPS 厂商 + 区域。

---

## 4. 架构

```
                            ┌──────── Cloudflare ────────┐
                            │  DNS:image-prompts.xyz     │
                            │  SSL:Universal / proxied   │
                            │  CDN:passthrough           │
                            └─────────────┬──────────────┘
                                          │
                                          ▼
                              ┌─────── VPS ────────┐
                              │  nginx :443        │
                              │   ├─ /api → :3000  │
                              │   ├─ / → :80 静态  │
                              │   └─ ws? n/a       │
                              │                    │
                              │  docker compose:   │
                              │   ├─ postgres :5432│
                              │   └─ api :3000     │
                              │                    │
                              │  web 静态文件      │
                              │  (vite build → /var/www) │
                              └────────────────────┘
                                          │
                                          ▼
                              ┌─── Cloudflare R2 ────┐
                              │  bucket: image-prompts-1 │
                              │  存 prompts/* + submissions/* │
                              └──────────────────────────────┘
```

**关键决策**:
- Web 是 SPA,vite build → 静态文件 → nginx 直接 serve
- API 是 Hono node-server,docker 跑
- DB 是 Postgres,docker 跑,数据卷挂宿主机
- R2 在 Cloudflare(已有)
- 不用 K8s,纯 docker-compose

---

## 5. 部署步骤

### 5.1 域名 + Cloudflare

- [ ] 买域名(`image-prompts.xyz` / `imagepromp.ts` / 任意,ASK USER)
- [ ] DNS 指向 Cloudflare(NS records)
- [ ] Cloudflare 启用 proxied 模式(橙色云朵)
- [ ] SSL/TLS → Full (strict)
- [ ] 在 R2 CORS 加上 prod 域名:`https://image-prompts.xyz`

### 5.2 VPS 准备

- [ ] 开 VPS,选 Ubuntu 24.04
- [ ] SSH key 配置
- [ ] `apt update && apt install docker.io docker-compose-plugin nginx certbot python3-certbot-nginx`
- [ ] 配 firewall:仅开 22 / 80 / 443
- [ ] **关闭** root 密码登录,只用 ssh key

### 5.3 部署目录结构

```
/opt/image-prompts/
├── docker-compose.yml
├── .env.production
├── postgres-data/        # docker volume
├── nginx/
│   ├── image-prompts.conf
│   └── ssl/              # certbot 写入
└── web/                  # vite build 出来的静态文件
```

### 5.4 docker-compose.yml

```yaml
services:
  postgres:
    image: postgres:16
    restart: always
    environment:
      POSTGRES_USER: ip_app
      POSTGRES_PASSWORD: <strong-from-env>
      POSTGRES_DB: image_prompts_prod
    volumes:
      - ./postgres-data:/var/lib/postgresql/data
    ports:
      - "127.0.0.1:5432:5432"   # 仅本机访问

  api:
    build:
      context: ./
      dockerfile: apps/api/Dockerfile
    restart: always
    env_file: .env.production
    depends_on:
      - postgres
    ports:
      - "127.0.0.1:3000:3000"   # 仅本机,nginx 代理
```

### 5.5 nginx 配置

```nginx
server {
    listen 443 ssl http2;
    server_name image-prompts.xyz;
    
    ssl_certificate /etc/letsencrypt/live/image-prompts.xyz/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/image-prompts.xyz/privkey.pem;
    
    # API
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP $remote_addr;
    }
    
    # Web SPA
    location / {
        root /opt/image-prompts/web;
        try_files $uri $uri/ /index.html;
    }
}

server {
    listen 80;
    server_name image-prompts.xyz;
    return 301 https://$host$request_uri;
}
```

### 5.6 .env.production

```
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
SITE_URL=https://image-prompts.xyz
API_URL=https://image-prompts.xyz/api

LOG_LEVEL=info

DATABASE_URL=postgres://ip_app:<password>@postgres:5432/image_prompts_prod

AUTH_SECRET=<新生成,跟 dev 不同>
AUTH_URL=https://image-prompts.xyz/api/auth

R2_ENCRYPTION_KEY=<新生成,跟 dev 不同>

ADMIN_EMAILS=2221542777@qq.com
OWNER_EMAILS=2221542777@qq.com  # M10 后

GOOGLE_CLIENT_ID=<prod 用,在 Google Console 配新 OAuth client,redirect_uri 改 prod>
GOOGLE_CLIENT_SECRET=<>
GITHUB_CLIENT_ID=<>
GITHUB_CLIENT_SECRET=<>

# 不需要 HTTPS_PROXY(海外 VPS 直连 Google/GitHub)

# R2 不需要在 .env 写,因为 seed 后从 DB 读
# 但 R2_ENCRYPTION_KEY 必须保留,要解密 DB 里的密文
```

### 5.7 Google / GitHub OAuth 重新配

- Google Console:新建一个 OAuth Client(或加 redirect_uri 到现有的)
  - Authorized redirect URIs: `https://image-prompts.xyz/api/auth/callback/google`
- GitHub OAuth Apps:同
  - Authorization callback URL: `https://image-prompts.xyz/api/auth/callback/github`

### 5.8 部署 pipeline(MVP 手动)

每次部署:
```bash
# 本地
git pull
pnpm install
pnpm --filter @ip/web build         # 输出到 apps/web/dist
pnpm --filter @ip/api build         # 输出到 apps/api/dist

# 上传到 VPS
rsync -avz apps/web/dist/ user@vps:/opt/image-prompts/web/
rsync -avz apps/api/ user@vps:/opt/image-prompts/api-src/    # 或者 docker image push

# VPS 上
cd /opt/image-prompts
docker compose pull && docker compose up -d
docker compose exec api pnpm db:migrate
```

后续可以加 GitHub Actions 自动跑,但 MVP 手动。

### 5.9 备份策略

**Postgres 每天 02:00 dump 一份到 R2**:
```bash
# crontab
0 2 * * * /opt/image-prompts/scripts/backup-db.sh
```

`backup-db.sh`:
```bash
#!/bin/bash
DATE=$(date +%Y%m%d-%H%M%S)
docker compose -f /opt/image-prompts/docker-compose.yml exec -T postgres pg_dump -U ip_app image_prompts_prod | gzip > /tmp/db-$DATE.sql.gz
# 上传到 R2 — 用 rclone 配 R2 endpoint
rclone copy /tmp/db-$DATE.sql.gz r2:image-prompts-backups/
rm /tmp/db-$DATE.sql.gz
# 删 R2 上 30 天之前的备份
rclone delete --min-age 30d r2:image-prompts-backups/
```

**R2 数据不需要备份**(本来就在 Cloudflare,有自身冗余;真要的话可以另外开个 backup bucket 做 cross-bucket sync)。

---

## 6. nanobanana 2380 张种子图迁移

### 6.1 现状

- M1 seed 在 `apps/api/src/db/seed.ts` 里插了 2380 个 prompts 行
- 每个 prompt 关联的 prompt_images 行,`r2_key` 是什么?
  - **需要检查**:M1 seed 的 r2_key 是 nanobanana 原 URL 路径(类似 `https://nanobanana.com/static/abc.jpg`)还是别的?
  - 如果是 nanobanana CDN URL,M1 seed 的 `r2_account.public_url` 应该是 `https://nanobanana.com/static`,加上 r2_key 就是完整 URL
- 当前 dev 数据库里,placeholder r2_account 已经被 UPDATE 成新的 R2 账号了。所以 prompt_images.r2_key + 新 public_url 拼出来的 URL **是错的**(新 R2 没有这些路径的文件)

### 6.2 迁移目标

把 2380 张图,从 nanobanana 原 URL 下载,上传到新 R2 的 `prompts/{promptId}/0.<ext>` 路径,然后 UPDATE prompt_images.r2_key + r2_account_id。

### 6.3 迁移脚本 `apps/api/scripts/migrate-nanobanana-seeds.ts`

伪代码:
```ts
import { db } from "../src/db/client.ts";
import { prompts, promptImages, r2Accounts } from "../src/db/schema/index.ts";
import { copyObject } from "../src/lib/r2-ops.ts";
// ...

async function main() {
  // 1. 找到 nanobanana 来源(可能在 seed 里有元信息标记 source='nanobanana_seed')
  const seedPrompts = await db.select().from(prompts).where(eq(prompts.source, 'nanobanana_seed'));
  
  // 2. 找到目标 R2 账号
  const [targetR2] = await db.select().from(r2Accounts).where(eq(r2Accounts.enabled, true)).orderBy(desc(r2Accounts.priority)).limit(1);
  
  // 3. 对每个 prompt 的每张图
  for (const p of seedPrompts) {
    const images = await db.select().from(promptImages).where(eq(promptImages.promptId, p.id));
    for (const [idx, img] of images.entries()) {
      // 3.1 推断 nanobanana 原 URL
      const originalUrl = `https://nanobanana-cdn-domain/${img.r2_key}`;  // 根据实际 seed 数据形式调整
      
      // 3.2 用 fetch 下载到内存
      const r = await fetch(originalUrl);
      if (!r.ok) { console.warn(`skip ${originalUrl}: ${r.status}`); continue; }
      const buffer = await r.arrayBuffer();
      
      // 3.3 推断扩展名
      const ext = inferExt(r.headers.get("content-type")); // image/jpeg → jpg
      
      // 3.4 上传到新 R2 — 用 S3 PutObject
      const newKey = `prompts/${p.id}/${idx}.${ext}`;
      const client = getS3Client(targetR2);
      await client.send(new PutObjectCommand({
        Bucket: targetR2.bucket,
        Key: newKey,
        Body: Buffer.from(buffer),
        ContentType: r.headers.get("content-type"),
      }));
      
      // 3.5 UPDATE prompt_images
      await db.update(promptImages).set({
        r2AccountId: targetR2.id,
        r2Key: newKey,
      }).where(eq(promptImages.id, img.id));
      
      console.log(`migrated ${p.id}/${idx}`);
    }
  }
}
```

### 6.4 限速 + 失败处理

- 串行执行,每张图前 sleep 100ms,避免被 nanobanana 限流
- 失败的图记到 log,跑完后整理一份"失败列表"人工 review
- 可重入:已经迁移的图(`r2Account.id == targetR2.id` 且 `r2Key` 以 `prompts/` 开头)自动跳过

### 6.5 估时

2380 张 × ~3 秒(下载 + 上传 + DB update)= ~120 分钟。可后台跑,不阻塞。

### 6.6 验收

- 跑完后用 SQL 抽 100 张随机 prompts 的图 URL,手动浏览器打开,看是否 200 返回
- 首页瀑布流不再裂图
- R2 dashboard 看 `prompts/*` 下有 2380+ 张图

---

## 7. 监控(简化版)

- VPS 自带 SSH access(`htop` / `df -h`)
- Docker `docker compose logs -f api`
- nginx access log → `/var/log/nginx/access.log`
- Postgres 慢查询:`log_min_duration_statement = 1000` 写到 docker volume

不引入 Sentry / Datadog / Grafana。MVP 阶段没人看就别开账户。

---

## 8. 测试 / staging

**ASK USER**:要不要先开一个 staging 小机器跑一遍部署流程?
- **推荐**:不开,直接 prod。VPS ¥50/月再开一台 staging 浪费;数据库备份保底,出问题回滚就是。
- **保守**:开 1 个月 staging,验证完关掉。

---

## 9. Open Questions

1. **VPS 厂商 + 区域**:Vultr Tokyo / Vultr Singapore / Hetzner EU / 其他?
2. **域名**:你已经买过 `image-prompts.xyz` 之类的吗?新买的话买哪个?
3. **prod 数据库:从空起 vs 从 dev 迁数据?**
   - 空起:全新 prod DB,从 0 数据增长
   - 迁数据:把你 dev 库里 M1-M5 的种子+测试数据 dump 一份到 prod
   - **默认**:**空起**(M1 seed 跑一次,清掉 dev 期间随手测试创建的 user/submission)
4. **nanobanana 源 URL 是啥**:需要先读 M1 `seed.ts` 看 r2_key 结构,确认能从某个公开 URL 下载
5. **staging 环境**:开还是不开?**默认 不开**
6. **CI/CD**:GitHub Actions 自动部署 vs 手动 rsync?**默认 手动**(M11 之后视心情)
7. **OAuth provider 共用 dev / 区分 prod?**:推荐 区分 — Google Console 新建一个 prod OAuth client,redirect URI 是 prod 域名

---

## 10. Manual test matrix(部署完后)

```
A. 浏览器访问 https://image-prompts.xyz → 200,显示首页
B. SSL cert 有效(浏览器锁标志)
C. /api/health → 200 {"status":"ok"}
D. OAuth Google 登录 → 跳 Google → 同意 → 回 prod 域名 → 登录成功
E. OAuth GitHub 同
F. 首页瀑布流 → 所有种子图能加载(2380 张 90%+ 成功)
G. 投稿一个 prompt 走完整个流程 → 落 prod R2
H. owner 用 OWNER_EMAILS 邮箱登录 → 访问 /rosekhlifa → 200
I. 数据备份 cron job 手动跑一次 → R2 backup bucket 多了 .sql.gz
J. 24 小时后:cron 真的跑了 → 有今天的 backup
K. 重启 VPS / docker compose down + up → 数据无丢失,服务自动恢复
L. nginx access log 看到合理流量
```

---

## 11. 完成定义

- VPS 在线 + SSL 有效 + DNS 指向正确
- prod 数据库初始化 + 跑了 M1 seed
- 2380 张种子图迁移完成(允许 5% 失败率,做好 log)
- OAuth 在 prod 域名 work
- 备份脚本在 cron 跑
- §10 Manual test matrix 全过
- VPS 总月成本 ≤ $20(VPS + 域名 prorated + R2 + 任何 backup)
- 文档:`docs/deployment/vps-runbook.md` 写好(MVP 简单):部署步骤、备份步骤、如何登录 VPS、如何 hotfix、紧急回滚
