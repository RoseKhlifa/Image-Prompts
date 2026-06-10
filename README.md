<div align="center">
  <img src="apps/web/public/logo.png" alt="Image-Prompts" width="120" />

# Image-Prompts

**一个为 AI 图像创作者打造的中英双语提示词聚合站,Image-Studio 生态的「灵感源」一侧**

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-22+-43853d.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](https://www.typescriptlang.org/)
[![pnpm](https://img.shields.io/badge/pnpm-9+-f69220.svg)](https://pnpm.io/)

[在线访问](https://prompts.sorry.ink) · [关于](https://prompts.sorry.ink/zh/about) · [政策](https://prompts.sorry.ink/zh/about/policy) · [Image-Studio 仓库](https://github.com/RoseKhlifa/Image-Studio)

</div>

---

## 这是什么

Image-Prompts 把**社区投稿**与**公开档案**融为一体,做成一份**可检索、可一键复用、可双向流通**的中英文提示词参考库。

- 任何人可浏览 / 收藏 / 点赞 / 分享
- 登录用户可投稿,管理员审核后入库
- NSFW 内容默认隐藏,进入需明确同意免责声明
- 每条提示词支持「一键导入」到 [Image-Studio](https://github.com/RoseKhlifa/Image-Studio) 直接生图

不是独立产品,是 Image-Studio 生态里专门负责「Prompt 这一侧」的配套站。

## 核心功能

<table>
<tr>
<td valign="top" width="50%">

**🖼 内容侧**
- 中英双语 prompt 索引
- 分类 + 多标签 + 排序(最新/热门/赞/送)
- 详情页一键导入到 Image-Studio
- 完整的来源追溯(每条 imported 数据带原始链接)
- NSFW 分类带 GitHub 风格 acknowledgment 模态

</td>
<td valign="top" width="50%">

**👥 社区侧**
- Google / GitHub OAuth 登录
- 投稿 → 管理员审核 → 入库流程
- 收藏 / 点赞 / 送到 Studio 计数
- Profile 页 + 钉选作品
- 举报队列(用户提交 → 站长处理)

</td>
</tr>
<tr>
<td valign="top">

**⚙️ 站长后台 `/rosekhlifa`**
- Dashboard 概览
- 站点全局配置
- R2 池(多账号)
- 用户管理 + 角色 + 封禁
- 审计日志
- 公告 + 分类 + 标签 + 提示词 CRUD
- 拖拽上传式 JSONL 导入(最多 50 MB)

</td>
<td valign="top">

**🌍 国际化 / UX**
- 完整 zh + en 翻译
- 瀑布流图片预加载 + 贪心列分配算法
- 详情页 ResizeObserver 跟随图片高度
- 暗色主题(基于 zinc/accent token)
- React Router SPA + sticky sidebar

</td>
</tr>
</table>

## 技术栈

| 层 | 技术 |
|---|---|
| **前端** | React 18 · Vite 6 · TypeScript strict · TanStack Query · Tailwind CSS · i18next · lucide-react |
| **后端** | Hono · Drizzle ORM · PostgreSQL 16 · @hono/auth-js · Vitest |
| **存储** | Cloudflare R2(凭据 AES-256-GCM 加密落库) |
| **鉴权** | Auth.js + Google OAuth + GitHub OAuth |
| **架构** | pnpm 9 monorepo · TypeScript strict + exactOptionalPropertyTypes · ESM |
| **CI** | GitHub Actions(typecheck + lint + vitest + 集成测试 PG service container) |

## 仓库结构

```
.
├── apps/
│   ├── api/                     # Hono backend
│   │   ├── src/
│   │   │   ├── routes/          # Hono route modules
│   │   │   ├── repositories/    # Drizzle queries
│   │   │   ├── middleware/      # auth / ban-check / error
│   │   │   ├── db/schema/       # 14 schema files
│   │   │   └── lib/             # shared utilities (R2 ops, tag-normalize, ...)
│   │   ├── drizzle/             # 0000-0013 migration SQL
│   │   └── scripts/             # 一次性 seed / migrate / sync 脚本
│   └── web/                     # React SPA
│       ├── src/
│       │   ├── pages/           # 路由组件
│       │   ├── components/      # 通用组件
│       │   ├── i18n/locales/    # zh.json + en.json
│       │   └── lib/             # API client / hooks
│       └── public/
├── packages/
│   └── shared/                  # Zod schemas + 类型 + i18n util(api 与 web 共用)
└── docs/
    ├── deployment/              # 部署文档(Ubuntu + 1Panel)
    ├── roadmap/                 # 未来功能规划
    ├── image-studio-integration.md
    └── superpowers/             # 内部 spec + plan(brainstorm/writing-plans 流程产物)
```

## 本地开发

### 前置

- **Node.js 22 LTS** — `nvm install 22 && nvm use 22`
- **pnpm 9+** — `npm i -g pnpm@9`
- **PostgreSQL 16** 跑在 `localhost:5432`

建库:
```bash
createdb image_prompts_dev
psql -d image_prompts_dev -c "CREATE USER ip_app WITH PASSWORD 'devpassword' SUPERUSER;"
```

> 不需要 Docker。

### 起服务

```bash
pnpm install
cp apps/api/.env.example apps/api/.env       # 编辑 secrets
pnpm db:migrate                              # 应用所有 0000-0013 migration
pnpm dev                                     # 同时跑 api:3000 + web:5173
```

打开 <http://localhost:5173>,Google 登录后(邮箱在 `OWNER_EMAILS` 里)右上角能进 `/rosekhlifa` 后台。

### OAuth 配置

**Google**:
1. https://console.cloud.google.com → Credentials → 新 OAuth Client(Web)
2. 回调 `http://localhost:3000/api/auth/callback/google`
3. Client ID + Secret 填进 `.env`

**GitHub**:
1. https://github.com/settings/developers → New OAuth App
2. Homepage `http://localhost:5173`,callback `http://localhost:3000/api/auth/callback/github`
3. Client ID + Secret 填进 `.env`

**AUTH_SECRET**: `openssl rand -base64 48`

如果某个 provider 凭据空着,API 仍能起,只是那个 provider 不开放(日志会有 `provider <name> disabled: missing creds`)。

### 常用脚本

```bash
pnpm dev            # api + web 并行
pnpm dev:api        # 仅 api
pnpm dev:web        # 仅 web
pnpm build          # 全包构建
pnpm test           # 全包测试
pnpm typecheck      # 全包类型检查
pnpm check          # typecheck + lint + test
pnpm db:migrate     # 应用未跑的 migration

# ⚠️ 危险 — 会 TRUNCATE prompts / r2_accounts / site_settings
# pnpm db:seed    # 仅 demo dataset 用,production 永远别跑
```

## 生产部署

完整步骤见 [`docs/deployment/ubuntu-deployment.md`](docs/deployment/ubuntu-deployment.md)。

**简版概览**:

1. Ubuntu 22.04+ / 24.04 LTS
2. Node 22 + pnpm 9 + PostgreSQL 16
3. `git clone` + `pnpm install`
4. 编辑 `apps/api/.env`(注意 systemd 不认行尾 `#` 注释)
5. `pnpm -F api exec drizzle-kit migrate` + 补 `ALTER TYPE … ADD VALUE` + 种 NSFW 分类
6. `pnpm -F web build` → `apps/web/dist/` 静态文件
7. systemd 单元用 tsx 运行 `apps/api/src/index.ts`(API 端 `noEmit: true`,production 也走 tsx runtime)
8. 1Panel OpenResty:静态网站指向 dist + 反代规则 `^~ /api/` → `127.0.0.1:8765`
9. 网站设置「伪静态」加 SPA fallback `try_files $uri $uri/ /index.html;`
10. **关键**:Google / GitHub OAuth 必须为 production 域名加 callback URL

## Image-Studio 对接

详情页「一键导入 Image-Studio」按钮 → 生成 24h TTL 的 import token → 跳到 `imagestudio://...` 自定义 scheme(Studio 桌面端)→ Studio 拉取 token 后填表 → 生图。

完整契约见 [`docs/image-studio-integration.md`](docs/image-studio-integration.md)。

## 数据来源

本站内容由三部分组成:

1. **用户投稿(UGC)** — 版权归投稿者,本站获展示与索引非排他许可
2. **站长直投** — 管理员从公开档案归档
3. **公开爬取(已注明来源)**

| 来源 | URL | 条目 |
|---|---|---|
| Liblib Inspiration | https://www.liblib.art/inspiration | 21,826 |
| YouMind GPT Image 2 Prompts | https://youmind.com/zh-CN/gpt-image-2-prompts | 9,303 |
| AI2Image GPT Image 2 | https://www.ai2image.cn/category?cat=gptimage2 | 1,913 |
| Nanobanana Website Vercel | https://nanobanana-website.vercel.app/ | 1,205 |
| NanoBananaPrompt | https://nanobananaprompt.co/zh/prompts | 192 |

每条 `source='imported'` 提示词在详情页明示原始来源链接。下架请求请参照 [政策页](https://prompts.sorry.ink/zh/about/policy) 的版权章节。

## 路线图

短期计划(优先级排序)见 [`docs/roadmap/future-features.md`](docs/roadmap/future-features.md):

1. 全文检索 + 中英分词权重排序
2. 语义相似 / pgvector「看了又看」
3. 收藏夹分组(Boards)
4. 评论 + 回复树
5. 公开 API + RSS 订阅
6. Image-Studio 双向同步
7. 每日精选 Daily
8. Remix Tree / 衍生关系图
9. 用户徽章 / 成就
10. 图片灯箱 + 多图横向对比

## 贡献

Issue + PR 都欢迎。提 PR 前请跑:

```bash
pnpm check          # typecheck + lint + test
```

## 联系

下架请求、版权投诉、技术问题、合作邀约 — 全部走 **rosekhlifa@gmail.com**,承诺 5 个工作日内书面回复。

或在 [Issues](https://github.com/RoseKhlifa/Image-Prompts/issues) 开一条。

## 致谢

每行代码都站在他人肩膀上。核心依赖与基础设施(排名不分先后):

- **运行时**:[React](https://react.dev/) · [Vite](https://vite.dev/) · [Hono](https://hono.dev/) · [TypeScript](https://www.typescriptlang.org/) · [Vitest](https://vitest.dev/)
- **数据**:[Drizzle ORM](https://orm.drizzle.team/) · [PostgreSQL](https://www.postgresql.org/) · [Cloudflare R2](https://www.cloudflare.com/developer-platform/r2/) · [Better Auth](https://www.better-auth.com/)
- **界面**:[Tailwind CSS](https://tailwindcss.com/) · [lucide-react](https://lucide.dev/) · [TanStack Query](https://tanstack.com/query) · [i18next](https://www.i18next.com/) · Inter + Noto Sans SC
- **基础设施**:Cloudflare · GitHub Actions · Google / GitHub OAuth · 1Panel + OpenResty

以及所有在数据来源章节列出的开放档案站点。

## License

[MIT](LICENSE) © 2026 RoseKhlifa
