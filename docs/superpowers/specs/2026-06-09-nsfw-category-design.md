# NSFW Category — Design Spec

**Date:** 2026-06-09
**Source:** chat-approved design from the session that immediately precedes this doc — recorded here so the implementation plan has a referenceable source of truth.

## 1. Goal

Introduce a single dedicated `nsfw` category for content that may cause distress or visceral revulsion (gore, violence, body-horror, etc.). Listings everywhere on the site exclude NSFW prompts by default. The category landing page (`/:locale/prompts?category=nsfw`) gates entry behind a GitHub-delete-repo-style acknowledgment modal where the visitor must type `我已了解` / `I understand` to proceed. The acknowledgment lasts the current browser session only. Submission to this category is locked to the single shared `nsfw` tag and requires the same acknowledgment inline before submit.

## 2. Decisions taken in chat

| # | Decision | Choice |
|---|----------|--------|
| 1 | Gate scope | **Category page only.** Direct prompt detail URL is reachable without modal. |
| 2 | Mixed-listing visibility | **Fully hidden** from homepage / search / profile / tag pages / related. Only the dedicated category page surfaces them. |
| 3 | Acknowledgment persistence | **sessionStorage** — fresh tab or browser restart re-prompts. |
| 4 | Confirmation phrase | Localized — `我已了解` (zh) / `I understand` (en). |
| 5 | Submission tag selector | Hidden when category=nsfw. Server forces `tags=['nsfw']`. |
| 6 | Detail page tag chip | The `nsfw` tag is filtered out of the displayed tag list (internal marker). A small NSFW badge is shown in the metadata area instead. |
| 7 | Import (`importCategoryJsonl`) | Hard-reject `categorySlug === 'nsfw'` — JSONL batch imports cannot target this category. |
| 8 | Mod queue thumbnail | NSFW-category submissions render with blurred thumbnail + "Click to reveal" affordance to protect reviewers. |

## 3. Data model

### 3.1 Category seed

A single new row in `categories`. Note the `name` / `description` columns are jsonb `{zh, en}` (not separate columns), and the order column is named `order` (not `sort_order`).

```sql
INSERT INTO categories (slug, name, description, "order")
VALUES (
  'nsfw',
  '{"zh":"敏感内容","en":"NSFW"}'::jsonb,
  '{"zh":"可能引起不适或生理厌恶的内容,访问需确认免责声明。","en":"Content that may cause distress or visceral revulsion. Acknowledgment required to view."}'::jsonb,
  9999  -- sort to the end of the category list
)
ON CONFLICT (slug) DO NOTHING;
```

The seed runs via a one-shot script `apps/api/scripts/seed-nsfw-category.ts` (mirrors the pattern of other one-shot scripts under `apps/api/scripts/`). Idempotent.

### 3.2 No schema migration needed

The `nsfw` tag is created on first use via the existing tag-upsert path in `apps/api/src/repositories/owner-prompts.ts` / `submissions.ts`. We do NOT pre-seed it — the first NSFW prompt insertion creates the row through normal tag resolution.

### 3.3 Validation rule (API)

A new helper `assertNsfwTagInvariant(categoryId, tagNames)` lives in `apps/api/src/lib/nsfw.ts`:

```ts
export async function assertNsfwTagInvariant(
  tx: DbOrTx,
  categoryId: string,
  tagNames: string[],
): Promise<void> {
  const category = await tx.query.categories.findFirst({
    where: eq(categories.id, categoryId),
    columns: { slug: true },
  });
  if (category?.slug !== "nsfw") return;
  const normalized = tagNames.map((t) => t.trim().toLowerCase());
  if (normalized.length !== 1 || normalized[0] !== "nsfw") {
    throw new ValidationError("nsfw_category_tags_locked");
  }
}
```

Called from:
- `apps/api/src/repositories/submissions.ts` — on submission insert
- `apps/api/src/repositories/owner-prompts.ts` — on owner prompt create/update
- Mod-queue approve path — when approving a submission into a prompt

The mod queue approve handler additionally re-asserts when promoting (since the moderator can change category).

## 4. Listing-filter rules

A single helper `excludeNsfw(qb)` is added to `apps/api/src/repositories/_filters.ts` (new file):

```ts
// Joins categories (aliased) and applies WHERE categories.slug != 'nsfw'.
// Idempotent — no-op if the join is already applied.
export function excludeNsfw<Q extends QueryBuilder>(qb: Q): Q { ... }
```

Applied at the SQL-build site of every public list query. Coverage list:

| Function | File | Behavior |
|----------|------|----------|
| `listPrompts` | `prompts.ts` | Apply `excludeNsfw` UNLESS `filters.categorySlug === 'nsfw'` |
| `listRecentPrompts` (homepage) | `prompts.ts` | Apply unconditionally |
| `searchPrompts` | `prompts.ts` | Apply unconditionally |
| `listUserPrompts` (profile) | `users-public.ts` | Apply unconditionally |
| `listPinnedPrompts` | `users-public.ts` or `me-profile.ts` | Apply unconditionally |
| `listRelatedPrompts` | `prompts.ts` | Apply unconditionally |
| `listPromptsByTag` (tag page) | `prompts.ts` | Apply unconditionally — even `/tags/nsfw` returns empty |
| `getPromptStats` (homepage counter) | `stats.ts` | Apply unconditionally — NSFW prompts don't count toward "X prompts" badge |

Detail page (`getPromptBySlug`) does NOT filter — direct URL access is allowed per Decision #1.

User-side mutations (like/favorite/comment) on NSFW prompts are allowed normally (server doesn't second-guess intent once the user knows the URL).

## 5. Frontend gate

### 5.1 Component

`apps/web/src/components/NsfwGateModal.tsx` — a new component:

```tsx
type Props = {
  onConfirm: () => void;
  onCancel: () => void;
};

export function NsfwGateModal({ onConfirm, onCancel }: Props) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState("");
  const expected = t("nsfw.gate.confirm_phrase");
  const matches = typed.trim() === expected;
  // GitHub-danger styling: rose-700 border, rose-500 confirm button, dark backdrop
  // Confirm button disabled until `matches`
  // ESC / backdrop click → onCancel
  // Enter when matches → onConfirm
}
```

Visual:
- Backdrop: `bg-zinc-950/85` full-viewport
- Card: `border-rose-700 bg-zinc-900 max-w-md rounded-lg p-6`
- Title row: `⚠️` icon (lucide `AlertTriangle`) + `text-rose-300` heading
- Body paragraph: `text-zinc-200 text-sm leading-relaxed` with bulleted clauses
- Input field: `font-mono`, placeholder is the expected phrase
- Buttons row: 取消 (secondary, zinc) on left, 进入 (rose-500 danger) on right, disabled until match

### 5.2 Integration

`apps/web/src/pages/PromptListPage.tsx` (or wherever `?category=nsfw` resolves):

```tsx
const isNsfwCategory = currentCategory?.slug === "nsfw";
const [acked, setAcked] = useState(
  () => isNsfwCategory && sessionStorage.getItem("nsfw-ack") === "1",
);

if (isNsfwCategory && !acked) {
  return (
    <NsfwGateModal
      onConfirm={() => {
        sessionStorage.setItem("nsfw-ack", "1");
        setAcked(true);
      }}
      onCancel={() => navigate(-1) /* or fallback /prompts */ }
    />
  );
}
```

The page body is NOT rendered until ack'd — modal is the only visible thing. (Avoids the "you can read content behind the modal" anti-pattern.)

### 5.3 Session key

`sessionStorage["nsfw-ack"] === "1"`. Plain string. No expiry — session = lifetime of the tab.

## 6. Submission form changes

`apps/web/src/pages/SubmitPage.tsx`:

When the user changes the category dropdown to `nsfw`:

1. **Clear any selected tags.** Set `tags` state to `["nsfw"]`.
2. **Hide the tag selector.** Replace it with a read-only note: `t("nsfw.submit.tag_locked_note")` — *此分类下所有作品仅共享 "nsfw" 标签 / All works in this category share the single "nsfw" tag*.
3. **Show inline acknowledgment card.** Same disclaimer body as the modal, shorter framing. Contains the same `<input type="text">` that must match `我已了解` / `I understand` exactly.
4. **Disable submit button** until the inline acknowledgment matches.

When the user changes category away from `nsfw`:
- Clear `tags` state to `[]`
- Hide the acknowledgment card
- Re-enable submit per existing rules

Server-side check still enforces `assertNsfwTagInvariant` — frontend can't be the only guard.

## 7. Detail page treatment

`apps/web/src/pages/PromptDetailPage.tsx`:

1. **Filter the displayed tag list** — if a tag's slug is `nsfw`, drop it from the chip list:
   ```ts
   const visibleTags = prompt.tags.filter((tag) => tag.slug !== "nsfw");
   ```
   The category itself is shown normally (as a category chip).

2. **Add NSFW badge in the metadata column**, next to the category chip:
   ```tsx
   {prompt.category.slug === "nsfw" && (
     <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-rose-300">
       {t("nsfw.badge")}
     </span>
   )}
   ```

3. **No modal gate** — direct link is intentionally reachable.

## 8. Import path guard

`apps/api/src/repositories/imports.ts` — at the top of `importCategoryJsonl`:

```ts
if (categorySlug === "nsfw") {
  throw new ValidationError("nsfw_import_forbidden");
}
```

JSONL batch import is meant for SFW crawled data only. The owner upload UI surfaces this as an error toast.

## 9. Mod queue treatment

`apps/web/src/pages/owner/SubmissionsPage.tsx`:

For a submission whose target category is `nsfw`:
- Thumbnail `<img>` wrapped in a container with `filter: blur(24px)` initially
- Overlay: `点击查看 / Click to reveal` button on top of the blur
- Once clicked → un-blur for the session (state in component, no need to persist)
- NSFW badge shown next to submission metadata

Approval / rejection actions work identically — no extra confirmation. (Moderator already opted into looking by clicking through.)

## 10. Disclaimer copy (final)

### Modal — Chinese (`nsfw.gate.body_zh`)

> 此分类下的内容可能令人不适或引起生理厌恶 —— 包括但不限于暴力、血腥、惊悚画面,以及其他可能对部分观看者造成心理或生理负面反应的视觉元素。
>
> 继续访问意味着:
> • 您已成年并自愿浏览;
> • 您理解可能引发的不适并自行承担风险;
> • 您不会因此向本站或其他用户追究任何责任。
>
> 如确认继续,请在下方输入「我已了解」。

### Modal — English (`nsfw.gate.body_en`)

> Content in this category may be distressing or physically revolting — including but not limited to violence, gore, horror, and other visuals that may cause psychological or physical adverse reactions in some viewers.
>
> By continuing you confirm that:
> • You are of legal age and viewing voluntarily;
> • You understand the potential discomfort and accept the risk;
> • You will not hold the site or other users liable.
>
> To proceed, type "I understand" below.

### Inline submission card

Shorter variant (~3 lines): identifies that the category is for distressing content, that the submitter takes responsibility for the upload, and ends with the same `我已了解` field.

```
您正在向「敏感内容」分类投稿。此分类专门收纳可能引起不适的图像 ——
您声明对所投稿内容的性质知情、自愿且对其承担全部责任。
如确认提交,请在下方输入「我已了解」。
```

## 11. i18n keys (additions)

All under `nsfw.*` and `owner.modqueue.*`:

| Key | zh | en |
|-----|----|----|
| `nsfw.badge` | NSFW | NSFW |
| `nsfw.gate.title` | 内容警告 | Content Warning |
| `nsfw.gate.body` | (multi-line, §10) | (multi-line, §10) |
| `nsfw.gate.confirm_phrase` | 我已了解 | I understand |
| `nsfw.gate.confirm_placeholder` | 请输入「我已了解」 | Type "I understand" |
| `nsfw.gate.enter` | 进入 | Enter |
| `nsfw.gate.cancel` | 取消 | Cancel |
| `nsfw.submit.tag_locked_note` | 此分类下所有作品仅共享 "nsfw" 标签 | All works in this category share the single "nsfw" tag |
| `nsfw.submit.ack_body` | (§10 inline) | (§10 inline) |
| `nsfw.submit.ack_placeholder` | 请输入「我已了解」 | Type "I understand" |
| `owner.modqueue.reveal_nsfw` | 点击查看 | Click to reveal |
| `nsfw.errors.tags_locked` | NSFW 分类下作品只能使用 "nsfw" 标签 | NSFW category prompts may only carry the "nsfw" tag |
| `nsfw.errors.import_forbidden` | NSFW 分类不支持批量导入 | NSFW category does not support bulk import |

## 12. Files touched

### New

- `apps/api/scripts/seed-nsfw-category.ts` — one-shot seed
- `apps/api/src/lib/nsfw.ts` — `assertNsfwTagInvariant`
- `apps/api/src/repositories/_filters.ts` — `excludeNsfw` helper
- `apps/web/src/components/NsfwGateModal.tsx` — modal component
- `apps/web/src/components/NsfwSubmitAck.tsx` — inline submission acknowledgment

### Modified — API

- `apps/api/src/repositories/prompts.ts` — apply `excludeNsfw` in 5 list queries; preserve `?category=nsfw` bypass
- `apps/api/src/repositories/users-public.ts` — apply `excludeNsfw` in profile + pinned queries
- `apps/api/src/repositories/me-profile.ts` — apply `excludeNsfw` if it has any prompt-list functions
- `apps/api/src/repositories/stats.ts` — exclude from homepage counter
- `apps/api/src/repositories/submissions.ts` — call `assertNsfwTagInvariant` on insert
- `apps/api/src/repositories/owner-prompts.ts` — call `assertNsfwTagInvariant` on create/update
- `apps/api/src/repositories/imports.ts` — reject `categorySlug === 'nsfw'` early
- `apps/api/src/routes/owner.ts` — mod queue approve handler re-asserts on promote
- `apps/api/src/middleware/error.ts` — map `nsfw_category_tags_locked` / `nsfw_import_forbidden` to 400 with i18n error key

### Modified — Web

- `apps/web/src/pages/PromptListPage.tsx` — gate logic + render modal when category=nsfw
- `apps/web/src/pages/PromptDetailPage.tsx` — filter `nsfw` tag chip + show NSFW badge
- `apps/web/src/pages/SubmitPage.tsx` — category change → clear tags + show ack card; submit gated on ack match
- `apps/web/src/pages/owner/SubmissionsPage.tsx` — blurred thumbnail + reveal button for NSFW submissions
- `apps/web/src/i18n/locales/zh.json` — 13 new keys (§11)
- `apps/web/src/i18n/locales/en.json` — same 13 keys

## 13. Edge cases & rules of thumb

| Case | Behavior |
|------|----------|
| User has 2 tabs, ack's tab A | Tab B still gates — sessionStorage is per-tab in modern browsers (verified: it is, per spec, scoped to the tab — different tabs of the same origin get independent storage). |
| User changes prompt category to NSFW via edit | Existing tags wiped server-side; tag selector hidden in edit UI; ack card shown. |
| User changes prompt category FROM NSFW to SFW via edit | `nsfw` tag dropped; tag selector re-enabled empty. |
| Direct visit to `/prompts/:slug` where prompt is NSFW | Renders normally (no gate per Decision #1). NSFW badge visible. |
| Search query that matches NSFW prompt | Excluded — search result list applies `excludeNsfw`. |
| Tag URL `/tags/nsfw` | Returns empty list. (The tag exists, but the filter excludes NSFW prompts; net result is empty.) Don't redirect — just show empty state. |
| API client (non-browser) hits `/api/prompts?category=nsfw` | Server returns NSFW prompts. No server-side gate per Decision #1. |
| Anonymous user submits NSFW | Same flow — submission still requires login (existing behavior). NSFW category is selectable in the dropdown. |
| Moderator rejects NSFW submission | Standard rejection flow; no extra treatment. |

## 14. Out of scope

- Age verification beyond the acknowledgment field (no birthday entry, no ID upload).
- Per-user "always show NSFW" preference toggle.
- Server-side gating (cookie / API-level enforcement) — frontend modal is the gate.
- Multiple NSFW sub-categories (e.g., violence vs. body horror). Single bucket only.
- Blurred thumbnails on public-facing pages (only mod queue blurs).
- Reporting flow for NSFW content miscategorized as SFW (or vice versa). Existing report flow covers this.

## 15. Acceptance criteria

A working implementation is verified when:

1. Navigating to `/zh/prompts?category=nsfw` in a fresh tab shows the modal, with the page content invisible behind it.
2. Typing exactly `我已了解` enables the **进入** button; pressing it reveals the listing.
3. Opening a new tab to the same URL re-shows the modal (session-scoped).
4. The homepage `/zh/prompts` shows zero NSFW prompts even after several are inserted.
5. `/zh/users/<owner>` profile shows zero NSFW prompts even if the user has authored them.
6. Submitting a new prompt with category=`nsfw` and tags=`['a','b']` returns 400 with `nsfw_category_tags_locked`.
7. Calling `importCategoryJsonl({ categorySlug: 'nsfw', ... })` throws `nsfw_import_forbidden`.
8. A detail page for an NSFW prompt shows the NSFW badge and does NOT list `nsfw` as a clickable tag chip.
9. Mod queue card for an NSFW submission shows a blurred thumbnail with reveal-on-click.
10. EN locale shows `I understand` as the type-to-confirm phrase; type-string mismatch (e.g., `i understand` lowercase or stripped) does NOT enable the button — exact match only.
