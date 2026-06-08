# Roadmap: M4 收尾 → M9 → M10 → M11

**Date:** 2026-06-08
**Status:** Brainstorm 完成,待 user 压缩上下文后逐 sprint 执行
**Trigger:** M4 合并后 user 手测发现 14 个开放项 + 提出"超级管理端 /rosekhlifa" 需求(共 15 项)
**Strategy:** 拆 4 个 sprint,先小后大,先用户侧后所有者侧

---

## Sprint 摘要

| Sprint | 暂命名 | Spec 文件 | 项数 | 工作量估 |
|---|---|---|---|---|
| 1 | M4 polish | `2026-06-08-m4-polish-design.md` | 5 | 1 天(半天 brainstorm + 半天执行) |
| 2 | M9 用户侧补完 | `2026-06-08-m9-user-side-completion-design.md` | 8 | 3-4 天(brainstorm + spec + plan + 执行) |
| 3 | M10 owner console `/rosekhlifa` | `2026-06-08-m10-owner-console-design.md` | 1 大块 / 多子系统 | 5-7 天(可能拆 M10a/M10b) |
| 4 | M11 部署 + 种子迁移 | `2026-06-08-m11-deployment-design.md` | 部署相关 | 2-3 天 |

---

## 待办项映射

### A 类 → Sprint 1 (M4 polish)

- #4 准则 modal 30s→5s + 内容加长
- #5 已通过卡片缩略图裂图
- #9 审核 edit 面板字段太少
- #10 提交失败不告诉哪项错
- #11 拒绝理由 ≥10 字限制 + 无提示

### B + C 类 → Sprint 2 (M9)

- #2 显眼"投稿"按钮
- #6 卡片真实上传者头像 + 用户名
- #7 详情页 uploader + 用户主页
- #8 点赞/收藏触发通知
- #14 搜索功能
- #3 投稿页 → modal
- #12 首页 tabs 重组("画廊/我的收藏/我的投稿/关于" + logo 副标题)
- #13 个人主页数据卡片

### D 类 → Sprint 3 (M10)

- 概览/数据面板
- R2 池管理
- 全局配置(`site_settings` 表,原 M7 内容)
- 用户管理
- 日志(`audit_log` viewer)
- 公告(`announcements` 表,原 M7 内容)
- AI 翻译辅助(原 M6,缩成管理端工具)
- 设置 / Misc
- 路由保护 + `OWNER_EMAILS` env

### Sprint 4 (M11)

- 海外 VPS 部署 + Cloudflare DNS + SSL
- Postgres + R2 备份策略
- nanobanana 2380 张种子图实际下载 + 上传到自己的 R2

---

## 跟原 M6/M7/M8 的归并

| 原计划 | 命运 |
|---|---|
| M6 AI 翻译辅助 | 缩进 M10 的"管理端工具集"(approve 时按钮"AI 帮我翻译 zh→en") |
| M7 reports + announcements + site_settings | 全部并入 M10(reports 表暂时不做,只在 M5 More menu 留 placeholder) |
| M8 部署 + 种子迁移 | 改名 M11,保留 |

---

## 决策原则(各 sprint 都遵守)

1. **小步快跑**:每个 task 一个 commit + 一次 review。任何 task 超过 30 分钟实现就拆。
2. **TDD 优先**:仓库层 + 路由层 + 关键 hook 必须有测试;UI component 测试可选(但 critical paths 必有)。
3. **现有架构优先**:能复用就不重写。`requireRole`、`zv`、`apiFetch`、`pickBilingual`、`resolveImageUrl`、`useSession`、`useR2PoolMap` 都已经稳定,复用。
4. **i18n 默认 zh + en 双语**:所有用户可见字符串走 i18n,新增 key 同步两个 locale。
5. **schema 变更必须 migration**:任何新表/新列走 `pnpm db:generate`。M0 audit_log 的"empty 表可以直接 reshape"那种豁免到此结束 — 后续表都假设有真实数据。
6. **manual test matrix**:每个 sprint 的 spec 末尾必须有手测清单(模仿 M4 spec §12)。

---

## 暂未决策(ASK USER 处)

- M9 #7 用户主页 URL:`/zh/users/:id`(用 UUID)vs `/zh/u/:slug`(需要给用户加 slug 字段)
- M9 #8 点赞/收藏通知:每次 like 都发 vs 批量(每天一次"X 个人赞了你的 Y")。决定影响 schema + UX
- M9 #12 首页 tabs:`/profile` 页保留吗?保留只放数据卡 + 资料 + 退出,还是直接弃用 → 资料卡放到首页或 sidebar?
- M10 路由保护:新建 `role='owner'` enum 值 vs 复用 `role='admin'` + 单独 OWNER_EMAILS 白名单
- M10 是否拆成 M10a/M10b
- M11 VPS 选型:Hetzner / Vultr / Linode / OVH(国外友好);CF Workers + D1 不行(我们有 Postgres)

每个 spec 文件内详述。

---

## 后续动作

1. user 压缩当前 conversation 上下文
2. user 选 sprint 起点(推荐:Sprint 1)
3. 我读对应 spec → 走 writing-plans skill → 写 plan → subagent-driven-development 执行
4. 完一个 sprint merge 一次,然后下一个
