# Sprint 1 / M4 Polish — Design

**Date:** 2026-06-08
**Status:** Brainstorm 完成,待执行
**Scope:** 5 个 M4 内部 bug / UX 小修
**Baseline:** main @ `6a9dde4`(M4 merged + follow-ups doc)
**Worktree:** `.worktrees/m4-polish` on `feat/m4-polish`(执行时创建)

---

## 1. Goal

清完 M4 手测中暴露的 5 个内部问题,让 M4 本身真正完成。不引入新功能,只修 bug + 改可用性。

## 2. Non-Goals

- 任何新表 / 新路由 / 新 UI 模块
- 不动 M5 的点赞收藏代码(留给 M9)
- 不重做投稿页架构(留给 M9 的 #3)

## 3. 待修项详细设计

### 3.1 准则 modal 时长 + 内容(#4)

**当前**:`CommunityGuidelinesModal` 30s 计时,正文很短(就一段话),无法测试"滚到底"逻辑。

**改成**:
- `READ_SECONDS = 5`(原 30)
- `submit-config.ts` 里 `GUIDELINES_READ_SECONDS: 5`
- 正文加长到 ~6 段,渲染高度 > modal viewport,真正需要滚动。
- 中文版正文涵盖以下要点(每段独立):
  1. **原创/授权**:仅可投稿原创或获得明确授权的内容。AI 生成图也算原创(指 prompt + 参数 + 出图都是你的)。引用他人 prompt 必须注明出处。
  2. **内容禁区**:禁止露骨色情(NSFW)、写实暴力 / 血腥、仇恨/歧视、虚假信息(deepfake 名人/政治人物)、未成年内容、侵犯隐私(真实可识别身份的人物)、明确侵犯版权(知名 IP 角色未授权使用)。
  3. **质量要求**:中英文双语 prompt 至少有一种完整。中文标题/prompt 不要纯英文残留,英文同理。
  4. **标签**:从已有标签库中选,最多 6 个。标签应该准确描述内容(风格/主题/构图/色调)。不要塞营销词或不相关内容。
  5. **审核流程**:管理员人工审核。通常 24 小时内处理。
  6. **违规后果**:被拒 3 次后,日投稿配额从 10 减到 5;严重违规可能临时封号。申诉请发邮件至 (TBD 联系邮箱)。
- 英文版相同结构翻译。

**Files:**
- `apps/api/src/lib/submit-config.ts` — GUIDELINES_READ_SECONDS 改 5
- `apps/web/src/components/submit/CommunityGuidelinesModal.tsx` — `READ_SECONDS` 常量改 5(或从 SUBMIT_CONFIG 导入)
- `apps/web/src/i18n/locales/zh.json` — `guidelines.body` 加长
- `apps/web/src/i18n/locales/en.json` — 同

**测试调整**:`CommunityGuidelinesModal.test.tsx` 现有测试是 `vi.advanceTimersByTime(30_000)`,改成对应新值(或参数化)。

### 3.2 已通过卡片缩略图裂图(#5)

**症状(用户报告)**:`http://localhost:5173/zh/profile?tab=submissions` 上看到"我的投稿"卡片的缩略图加载失败。

**可能成因**(需 debug 时按序排查):

1. **R2 copy 实际失败但被吞了**:approve transaction 之后的 `copyObject` 路径出错,但 `try/catch` 把异常打 console 后只 throw 500,DB 已经 commit,prompt 行已经写了 prompt_images 但实际 R2 上没图。
   - **排查**:R2 dashboard → bucket → Objects → 看 `prompts/{promptId}/0.<ext>` 是否存在
   - **修**:如果不存在,说明 copy 失败。检查 server log 里 `[approve] image migration failed` 行的具体错误。

2. **`resolveImageUrl` 拼路径有 bug**:`prompt_images.r2_key` 是 `prompts/{id}/0.jpg`,`r2_account.public_url` 是 `https://pub-xxx.r2.dev`。期望拼出来:`https://pub-xxx.r2.dev/prompts/{id}/0.jpg`。
   - **排查**:浏览器打开"我的投稿"页,F12 看那个 img 的 src 值。
   - **修**:如果 src 缺斜杠 / 多斜杠 / 缺路径段,改 `apps/web/src/lib/imageUrl.ts`。

3. **CORS 没让 GET 通过**:M4 的 CORS 配置 `AllowedMethods: ["GET", "PUT", "HEAD"]` 包括 GET,但浏览器的 img 标签其实不走 CORS preflight(简单 GET),所以可能不是这个原因。但万一是,需要确认 R2 dashboard CORS。

4. **`r2_account_id` 在 prompt_images 里指向错的 r2 行**:如果用户的 dev DB 之前有 placeholder r2 行,M4 approve 创建的 prompt_images 用了 placeholder 的 publicUrl,但之后我们 UPDATE 了 placeholder 行的 public_url 为新值,缓存有可能不一致。
   - **排查**:`SELECT r.public_url, pi.r2_key FROM prompt_images pi JOIN r2_accounts r ON r.id = pi.r2_account_id WHERE pi.prompt_id = '<id>';`
   - **修**:如果 public_url 是新的、r2_key 是 `prompts/{id}/0.jpg`,就说明 SQL 对,问题在 1 或 2。

**Files**(假设是路径拼接 bug):
- `apps/web/src/lib/imageUrl.ts` — `resolveImageUrl` 函数加 unit test 验证 `(public_url, r2_key)` 拼接逻辑
- 如果是 copy 失败,在 `apps/api/src/routes/admin.ts` 的 approve handler 里加更详细日志

**优先级**:执行时先 debug,定位后 1 commit 修。

### 3.3 审核 edit 面板字段太少(#9)

**当前**:`AdminEditPanel` 只暴露 titleZh / titleEn / categoryId 三个字段。

**改成**:展开到完整投稿字段:
- titleZh / titleEn(已有)
- promptZh / promptEn(新)
- negativePromptZh / negativePromptEn(新)
- notesZh / notesEn(新)
- aspectRatio(新)
- categoryId(已有)
- tagSlugs — 用 `TagPicker` 组件复用(新,需要 admin 也能选/改 tag 集合)

**Schema/路由层**:`ApproveInputSchema` 在 `packages/shared/src/schemas/submission.ts` 已经接收所有这些字段的 partial,只是 UI 没暴露。**API 不用改**,纯前端补全。

**Files:**
- `apps/web/src/components/admin/AdminEditPanel.tsx` — 加 4 个新字段渲染
- 复用现有的 `TagPicker` + `AspectRatio` enum

**UI 布局**:
- 当前 EditPanel 是简单的纵向 input 堆叠,加新字段后纵向加长是 OK 的。
- 把字段分组(2 个 section):"内容覆盖"(title/prompt/negative/notes)+ "元信息覆盖"(aspect/category/tags)。

### 3.4 提交失败要指出哪项错(#10)

**当前**:`SubmissionForm` 把 `safeParse` 失败的第一个 issue 的 message 当作 i18n key 显示 toast。例:bilingual_required → toast.error("请至少填写一种语言的完整标题 + 提示词")。但用户不知道哪个字段需要补。

**改成 — 两层**:

1. **Toast 保留**,改成更具体:"X 项验证失败,请查看表单"。
2. **Field-level error 显示**:safeParse 失败时,提取所有 `issues`,按 `path` 映射到字段,显示在对应 input 下方的红色小字。

**实现**:
- 改 `SubmissionForm.tsx` 的 state shape,加 `errors: Record<string, string>`(键是字段名,值是 i18n key)
- safeParse 失败 → `setErrors(zodErrorsToMap(parsed.error))`
- 每个 input 下方:`{errors.titleZh && <p className="text-xs text-red-600">{t(`submit.error.${errors.titleZh}`)}</p>}`
- 输入框 onChange 时清掉对应 errors key(让 UI 不停留在 stale 错误)

**辅助函数**:
```ts
function zodErrorsToMap(err: z.ZodError): Record<string, string> {
  const map: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".");
    map[key] = issue.message;
  }
  return map;
}
```

**i18n keys 新增**(在 `submit.error.*` 下):
- `field_required`(空必填)
- `too_long`(超长)
- `invalid_format`(格式不对,比如 categoryId 不是 uuid)
- 现有的 bilingual_required / 等保留

**Files:**
- `apps/web/src/components/submit/SubmissionForm.tsx` — errors state + 每个 input 下方错误显示
- `apps/web/src/lib/zod-errors.ts`(可选)— 抽出 zodErrorsToMap
- `apps/web/src/i18n/locales/*.json` — 加 3-4 个新 key

**测试**:
- 加 1-2 个测试:fill in invalid form → submit → assert error 显示在指定字段下

### 3.5 拒绝理由限制(#11)

**当前**:`RejectInputSchema` 是 `z.string().trim().min(10).max(500)`。Modal 显示 char counter `n/500`,但没显示下限。

**用户要求**:不限制字数。

**改成**:
- `packages/shared/src/schemas/submission.ts` → `RejectInputSchema = z.object({ reason: z.string().trim().min(1) })`(只要非空)
- 去掉 `max(500)` 吗?不去 — 数据库还是 text(无上限),但 UI 显示 char counter 留着提示用户"别写小作文"。或者去掉 counter 整个。
- **决定**:**去掉 min, 保留 max=500**(防止滥用 + 数据库友好);UI 的 char counter 改成可选提示而不是强制。
- 把 `submit-config.ts` 的 `REJECT_REASON_MIN_CHARS: 10` 改 `1`,`REJECT_REASON_MAX_CHARS: 500` 保留。

**UI 改:**
- `RejectReasonModal.tsx`:
  - 去掉 `if (reason.trim().length < 10)` 的 disabled 检查 → 只要 `reason.trim().length >= 1` 就启用确认按钮
  - char counter 改成 `{reason.trim().length}/500`(还在)
  - placeholder 加示例:"请填写拒绝原因(将发送给投稿人,如:与平台主题不符 / 图片质量低 / 内容违规等)"

**Files:**
- `packages/shared/src/schemas/submission.ts`
- `apps/api/src/lib/submit-config.ts`
- `apps/web/src/components/admin/RejectReasonModal.tsx`
- `apps/web/src/i18n/locales/*.json` — placeholder 文案改

**测试**:
- `submission.test.ts`:把 "requires ≥ 10 chars" 测试改 "requires ≥ 1 char"。
- Routes test:接受短理由(比如 "x")。

---

## 4. Task 列表(执行时拆 task)

| # | Task | 工作量 | 测试 |
|---|---|---|---|
| 1 | 准则 modal 时长 + 正文加长 | 30 min | 改现有 modal test 的 timer 数值 |
| 2 | 缩略图裂图 debug + 修 | 1-2 hr | 看修哪里加测试 |
| 3 | edit 面板扩展字段 | 1 hr | 跑现有 admin.test.ts 不退化 |
| 4 | 提交错误 field-level 显示 | 1 hr | 加 1-2 个 SubmissionForm 测试 |
| 5 | 拒绝理由去下限 | 30 min | 改 schema test + route test |

每个 task → 1 个 commit + combined review。

## 5. Manual test pass after sprint

跑一遍 `m4_test.md` §2 的 D / J / 2.4-S / 2.4-T 重点项确认:
- D guidelines flow 用新时长 + 新文案
- J/K image size + MIME 边界依然弹错误
- S admin edit-then-approve 现在可以改所有字段
- T reject 现在 1 字也接受

## 6. 完成定义

- 5 个 commit 全部 merge 到 main
- 所有 gate 仍然 green(typecheck / lint / test / build)
- `m4_test.md` 上述重点项手测通过
- `2026-06-08-m4-followups.md` 中对应的 P1.5(throttle)和 P3.1(localize aria-labels)** 不在本 sprint**(留给 M9)
