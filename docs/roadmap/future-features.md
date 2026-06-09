# Future Features — Roadmap

> 上线后陆续会做的 10 个功能 + 一组「值得记但不挤进 10」的小项。
> 排序按"建议落地顺序",不是按重要性。
>
> 维护者:RoseKhlifa · 起稿:2026-06-09

---

## 优先级建议

| 第一批(MVP+) | 第二批(社区引擎) | 第三批(质感) |
|---|---|---|
| 1 全文检索 | 8 Remix Tree | 2 语义相似 |
| 7 每日精选 | 3 收藏夹分组 | 6 Studio 双向同步 |
| 4 评论 | 10 灯箱 / 对比 | 9 徽章 / 成就 |
|               |                   | 5 公开 API + RSS |

第一批做完站基本"能用且有粘性",第二批做完"有社区",第三批做完"有差异化护城河"。

---

## 功能向 — 提升内容利用率

### 1. 全文检索 + 中英分词排序 · S-M / 极高

**问题**:当前 `/api/prompts?q=X` 走 `ILIKE %q%`,无法分词、无法权重排序、对中文几乎是字面匹配。

**做法**:
- Postgres `tsvector` 列 + GIN 索引(分别给 zh / en / tags 各一列)
- 中文走 `zhparser`(基于 SCWS)或 `pgroonga` 做分词,英文走默认 `english` configuration
- 排序权重:`title (A) > tag.name (B) > prompt body (C) > negative (D)`
- 双语都齐的条目给 `+0.1` boost,让 quality 自然浮上
- API 用 `tsquery` + `ts_rank_cd` 排序

**Migration**:加 3 列 + 3 个 GIN 索引,触发器在 INSERT/UPDATE 时更新。

**前端**:无大改,搜索结果按 score 排即可。

---

### 2. 语义相似 / "看了又看" · M-L / 高 + 差异化

**问题**:详情页"相关推荐"只按同分类 + likeCount 兜底,语义维度缺失。

**做法**:
- pgvector 扩展,加 `prompts.embedding vector(1536)` 列 + HNSW 索引
- 嵌入用 OpenAI `text-embedding-3-small`(便宜)或 Cohere `embed-multilingual-v3`(更适合中英混)
- 写一个 worker job:新 prompt 入库时计算嵌入异步落库;存量 batch 跑一次
- 详情页查询 `ORDER BY embedding <=> $1 LIMIT 6`
- 成本估算:1536 维 × 4 字节 × 35K prompts ≈ 215 MB,可接受

**差异化点**:目前 prompt 聚合站基本都按 tag 推荐,语义推荐是断层级别提升。

---

### 3. 收藏夹分组(Boards) · M / 高

**问题**:收藏目前是平铺一个列表,用户多了之后没法组织。

**做法**:
- 新表 `collections (id, user_id, name, slug, visibility: public|unlisted|private, cover_prompt_id, created_at)`
- `collection_prompts (collection_id, prompt_id, position, added_at)`
- 现有 `favorites` 表保留,改成「默认收藏夹」的语义糖
- Profile 页:`/users/<id>/collections/<slug>` 路由
- 详情页"加入收藏"按钮 → 弹一个 board picker

**社交向**:public board 可被分享,unlisted 链接可见,private 只 owner 可见。

---

### 4. 评论 + 回复树 · M / 高

**问题**:用户只能 like/favorite,没有任何对话渠道。

**做法**:
- 新表 `comments (id, prompt_id, user_id, parent_id, body, created_at, edited_at, deleted_at)`
- 自引用 `parent_id` 实现 1 层回复(简单起见不做嵌套树)
- 详情页底部分页加载,作者评论加角标
- 管理:置顶、删除、举报队列接进现有 mod queue
- Mention `@username` 解析 + 站内通知

**反滥用**:新用户(注册 < 7 天)限速 + 关键词软封禁 + 报告按钮 + 软删除。

---

### 5. 公开 API + RSS · S-M / 中(开发者辐射强)

**问题**:`/api/prompts` 已经存在但没正式对外公布。

**做法**:
- 给注册用户发 API key(在 `/profile/api-keys`),按 key rate-limit(60 req/min)
- OpenAPI 3.0 文档,Swagger UI 挂 `/api/docs`
- RSS feed:
  - `/feeds/all.xml` — 全站新增
  - `/feeds/category/<slug>.xml` — 按分类
  - `/feeds/user/<id>/favorites.xml` — 我关注的(需 auth token)
- 设计上限:1000 req/day 免费,后续考虑付费 tier

**生态价值**:LangGraph、n8n、Comfy 节点等都能直接拉。

---

### 6. Image-Studio 双向同步 · M / 极高(生态闭环)

**现状**:Image-Prompts → Studio 单向(import token,24h TTL)。

**做法**:
- Studio 端加「发布到 Image-Prompts」按钮,带原始 prompt + 生成参数 + 输出图
- 走 webhook + signed payload(类似 Studio import token,反方向)
- 落 Prompts 的 submission queue(不直接公开,过 mod)
- Studio 端记 `published_to_prompts: { prompt_id, slug }` 用于反向链接

**意义**:形成「Prompts(找灵感)→ Studio(生图)→ Prompts(贡献)」闭环。这是站点叙事的关键。

---

## 趣味 / 社区向 — 让用户回来

### 7. 每日精选(Daily) · S / 高(留存)

**问题**:首页是按 sort 排,但没有"今天值得看哪条"的钩子。

**做法**:
- 首页 Hero 一个 `<DailyHero />`,带「昨日 / 前日」小箭头
- 选举算法:`SELECT prompt FROM prompts WHERE NOT in_last_30_days_daily ORDER BY (likes_24h * 2 + views_24h + tag_diversity_boost) DESC LIMIT 1`
- 加一个 `daily_picks (date, prompt_id, picked_by: 'auto' | user_id, manual_note)` 表,允许站长手动置顶
- 历史归档页 `/daily` 看所有过往精选

**衍生**:做成 RSS feed(配合功能 5)。

---

### 8. Prompt 衍生关系 / Remix Tree · M / 高(社区引擎)

**问题**:好 prompt 别人改一改更适合自己场景,但目前无法表达「这条改自那条」。

**做法**:
- 详情页加「Remix」按钮 → 跳转 `/submit?from=<slug>`,投稿表单 prefill 当前 prompt
- 投稿表 `submissions.parent_id` + 通过后 `prompts.parent_id`(已有 `originalPromptId` 但语义是 self-edit,需要区分)
- 详情页画 「forked from X」 + 「Y, Z 改编自此」的双向链接
- 衍生树视图 `/prompts/<slug>/tree`:graphviz 风格的纵向树

**奖励机制**:被 N 次 remix 给原作者一个徽章(配合功能 9)。

---

### 9. 用户徽章 / 成就 · S-M / 中(UGC 质量)

**问题**:无 gamification,新用户没有成就感。

**做法**:
- 新表 `badges (slug, name, description, icon, criteria_json)`
- `user_badges (user_id, badge_slug, earned_at, evidence_json)`
- 后台 cron(凌晨 4 点)按 criteria 结算
- 初版徽章:
  - `first_submission` — 首次投稿
  - `100_likes` — 单条 prompt 累计 100 like
  - `streak_7` / `streak_30` — 连续登录
  - `bilingual` — 投稿 5 条以上中英双语齐全
  - `polymath` — 投稿覆盖 5 个不同分类
  - `nsfw_clean_10` — NSFW 投稿 10 条 0 拒
  - `early_adopter` — 注册时间 ≤ 2026-07-01
- Profile 页徽章墙;新获得时站内通知 + 可选邮件

**注意**:不要做成"必须打卡"的设计。让徽章变奖励、不变义务。

---

### 10. 图片灯箱 + 多图横向对比 · S / 中(UX 即得)

**问题**:详情页点图无反应;多图 prompt 只能看缩略图切换。

**做法**:
- 灯箱组件(基于 `react-zoom-pan-pinch` 或自写):点图全屏、键盘 ←/→ 切换、滚轮缩放、ESC 关
- 多图模式加「并排对比」开关:屏幕分 2 列,左右独立滚动,适合看「同 prompt 不同 seed / 不同 weight」差异
- 移动端:简化为左右滑动 + 双指缩放

**SEO**:OG image 截图也能从这套灯箱组件复用预览。

---

## 没挤进 10 但值得记的

| 功能 | 一句话 |
|---|---|
| **SEO 三件套** | `sitemap.xml`(按分类切片) + JSON-LD `CreativeWork` schema + 动态 OG 图(每 prompt 一张专属)。**上线必备**,不做自然流量基本为零。 |
| **单语 → 双语翻译投稿** | imported 数据很多只有 zh 或 en,允许社区贡献翻译 + 审核,补齐双语覆盖。 |
| **PWA + 离线缓存** | Service Worker 缓存 R2 缩略图 + 本地 favorites。Cloudflare Workers KV 撑 manifest。 |
| **键盘快捷键** | `j` / `k` 翻列表 + 详情页, `?` 唤 cheatsheet, `/` 聚焦搜索。给 power user 用的。 |
| **夜读模式** | 暗色基础上加纯黑底 + 极弱动效的"夜读"开关,夜间长时间阅读用。 |
| **数据导出** | `/me/export` 一键下载自己所有投稿 + 收藏 + board 为 JSON。GDPR 预防针,正式上线后越早做越好。 |
| **OAuth 增强** | 加 Twitter / Discord 登录,降低注册门槛(尤其海外用户)。 |
| **多账户管理** | 同一邮箱挂多 OAuth 提供方(目前 Better Auth 默认支持,验一下没踩坑) |

---

## 待商榷的"也许做"

- **付费墙 / 会员**:大量爬取数据是用别人 IP,做付费墙伦理上不站得住。仅考虑给 API key 高频付费(企业用户)。
- **AI 自动生成 prompt 提示**:从用户的图反推 prompt(GPT-4V 之类)。趣味性强但容易劣化数据池(每个人都灌一堆"派生 prompt"),需要严格 mod。
- **Discord / Telegram 机器人**:订阅每日精选、热门 prompt 推送。门槛低但维护成本高,考虑做 webhook 让社区自己写。

---

## 设计哲学(别忘了)

每加一个功能,先问三次:

1. 它服务于「围绕 Image-Studio 搭生态」吗?
2. 它增加 prompt 的**可复用性**还是只是好玩?
3. 它对**贡献者**和**消费者**有平衡的回报吗?

如果三个都"yes",加。任何一个"no",降级或缓做。
