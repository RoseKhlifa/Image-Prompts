# M4 Follow-ups

> Tracked from the M4 final holistic reviewer + per-task reviewers. M4 itself was merged to main at `7b19e10` with all 4 gates green and 283 tests passing. Nothing below is blocking the merge — these are quality / coverage / polish items to chew through next.

**Source of truth**: each item links to the file/line it touches. As items land, strike them out (don't delete — keeps the trail for retrospectives).

---

## P1 — Correctness & test coverage

### P1.1 Composite cursor for notifications (kill the 2ms test sleep)
- **Why**: current cursor is `WHERE createdAt < $cursor`. Two notifications inserted in the same millisecond would have ambiguous ordering — page2 with that cursor would exclude BOTH (strict `lt`), losing items. Worked around with a `setTimeout(2)` in `notifications.test.ts:81`.
- **Fix**: change cursor to composite `(createdAt, id)`. Pagination query becomes `WHERE (createdAt, id) < (cursorTs, cursorId)`. Cursor string encodes both (e.g. `${iso}#${uuid}`).
- **Touches**: `apps/api/src/repositories/notifications.ts`, the test file (remove the sleep + assert no flake).

### P1.2 Test the parallel approve race
- **Why**: fix in `f85a885` moved the precheck into the transaction with `WHERE status='pending'` as the race gate. The code is now safe but there's no test asserting it.
- **Fix**: in `apps/api/src/repositories/submissions.test.ts`, add a test that fires two `Promise.all([approveSubmission(x), approveSubmission(x)])` and asserts exactly one succeeds + the other throws `AlreadyResolvedError` (and only one prompt row + one notification + one audit row exist).
- **Touches**: `submissions.test.ts`.

### P1.3 Test image-migration failure path
- **Why**: spec accepts that approve's post-tx R2 copy/delete may leave dirty state. The 500 `image_migration_failed` branch in `admin.ts` is uncovered.
- **Fix**: in `apps/api/src/routes/admin.test.ts`, mock `CopyObjectCommand` to reject; assert response is 500 with `image_migration_failed`; assert prompt row still exists (dirty state per spec).
- **Touches**: `admin.test.ts`.

### P1.4 Test the `image_too_large` HEAD-rejection path
- **Why**: shared schema rejects size > 10MB at the input, but the server also checks `head.contentLength > MAX_IMAGE_SIZE_BYTES` after the actual upload. The latter branch has no test.
- **Fix**: mock `HeadObjectCommand` to return `ContentLength: 11 * 1024 * 1024`. Assert 400 `image_too_large:<key>`.
- **Touches**: `apps/api/src/routes/submissions.test.ts`.

### P1.5 Throttle `useNotificationCount` refetch on route change
- **Why**: currently `staleTime: 0` + `invalidateQueries` on every `location.pathname` change. For chatty SPAs (e.g. tab-clicking in profile) this can hammer the server.
- **Fix**: bump `staleTime` to ~30_000 (30s) so route changes within the window are cache hits. Keep `refetchOnWindowFocus: true` as the primary freshness signal.
- **Touches**: `apps/web/src/lib/hooks/useNotificationCount.ts`.

### P1.6 Test isolation — interaction tests pollute dev counters
- **Why**: `interactions.test.ts` (and import-tokens / prompts session-aware tests) call `anyPrompt()` / `latestPromptForTest()` against **the first real prompt in the dev DB**, then bump its `like_count` / `favorite_count` / `view_count` / `send_count` via `toggleLike` etc. `beforeEach` deletes the fact-table rows (`likes`, `favorites`, `view_log`) but **does not roll back the denormalized counter columns** on `prompts`. After running the suite N times the counters drift by 10s-50s. User-visible: fresh prompts appear to have "几十个赞" out of nowhere. Workaround applied 2026-06-08: `apps/api/scripts/resync-prompt-counters.ts` rebuilds counters from source tables.
- **Fix options** (any one is enough):
  - **A.** Each interaction test creates its own throwaway prompt instead of reusing `anyPrompt()`. Cleanest. ~30 lines per test file.
  - **B.** Wrap test bodies in a savepoint / sub-transaction that rolls back at the end (Drizzle has limited support — may not fit).
  - **C.** `afterEach` snapshot counters before each test, restore after. Brittle.
- **Touches**: `apps/api/src/repositories/interactions.test.ts`, `apps/api/src/routes/interactions.test.ts`, `apps/api/src/repositories/import-tokens.test.ts`, `apps/api/src/repositories/prompts.test.ts`.

---

## P2 — Code cleanup

### P2.1 Remove dead code
- `apps/api/src/repositories/tags.ts:5-17` — `listTags()`. No callers since Task 25's route swap to `searchTags`.
- `apps/api/src/repositories/tags.ts:74-80` — `bumpUsage()`. Only its own test calls it. The approve transaction uses inline `tx.update(tags).set({usageCount: sql\`+1\`})` instead.
- `apps/api/src/repositories/audit.ts:14-23` — `recordAudit()`. Only its own test calls it. The approve/reject transactions use `tx.insert(auditLog)` directly.
- **Fix**: delete the unused exports + their now-obsolete tests. OR convert the approve/reject transactions to actually call `recordAudit` (cleaner — but check if `bumpUsage` can sit inside a `tx` context).
- **Touches**: 2-3 repository files + their test files.

### P2.2 Extract R2 account-map building helper
- **Why**: `admin.ts:144-145` and `admin.ts:220-221` both do:
  ```ts
  const accRows = await db.select().from(r2Accounts);
  const accMap = new Map(accRows.map((a) => [a.id, a]));
  ```
  Same pattern also in `submissions.ts:185-186`. Three copies.
- **Fix**: extract `loadR2AccountMap()` to `apps/api/src/lib/r2-accounts.ts` or `r2-client-cache.ts`.

### P2.3 Fix `eslint-plugin-react-hooks` config gap
- **Why**: `ImageSlot.tsx` had a `// eslint-disable-next-line react-hooks/exhaustive-deps` referencing a rule eslint can't find (no `eslint-plugin-react-hooks` configured). We removed the disable comment to clear the error, but the deeper issue is the rule should be available.
- **Fix**: install `eslint-plugin-react-hooks` + wire into `apps/web/eslint.config.js` (or root). Re-evaluate whether the original disable was correct, or whether the dep should be added properly.
- **Touches**: `package.json` + `eslint.config.js` + revisit ImageSlot's useEffect.

### P2.4 Consolidate role-reading helpers
- **Why**: `requireUserId(c)`, `getRole(c)`, and similar context readers in `middleware/auth.ts` share a casting pattern. Not duplicate, but adjacent.
- **Fix**: extract a typed `getSessionUser(c)` that returns `{id, role}` once. Smaller follow-up.

---

## P3 — UX polish: i18n hardcoded strings

5 places leak English to the zh locale. Adding the missing key + replacing the literal is small per site.

- `apps/web/src/components/admin/AdminSubmissionPreview.tsx:~43` — `<h3>Prompt</h3>` → `t("submit.section_prompt")` (already in locale).
- `apps/web/src/components/admin/AdminSubmissionList.tsx:~39` — `"Load more"` → `t("common.load_more")` (key missing — add to both locales: zh "加载更多" / en "Load more").
- `apps/web/src/components/profile/MySubmissionsTab.tsx:~44` — already uses `t("common.load_more", { defaultValue: "Load more" })` but the key isn't in either locale → always falls back. Add the key (above) and drop the defaultValue.
- `apps/web/src/components/notifications/NotificationsBell.tsx:~24` — `aria-label="Notifications"` → `t("notifications.title")` (already in locale).
- `apps/web/src/components/submit/TagPicker.tsx:~28` — `aria-label="Remove"` → add `common.remove` key (zh "移除" / en "Remove") and reference it.

Single small commit: `i18n(web): localize 5 hardcoded strings + add common.load_more / common.remove`.

---

## P4 — Spec drift / documented tradeoffs (not worth fixing)

Documenting these here so future readers don't think they were missed.

- **SubmissionForm uses `useState` + `safeParse` instead of `react-hook-form`** (spec §9.1). Functionally equivalent for the form's complexity; switching would be churn without benefit.
- **Per-route rate limits on admin approve/reject not implemented** (spec §8.1: "60/min · 120/min"). The admin paths are gated by `requireRole(admin/moderator)`, so abuse vectors are limited to insider scenarios; rate-limiting trusted roles adds little. Accepted drift.
- **Daily-count "burn" on INSERT failure** (`submissions.ts` create-route). The atomic increment lands BEFORE the INSERT (deferred AFTER all read-only validation in Task 19's fix, but still before the INSERT itself). If the INSERT fails for any reason, the user's slot is consumed. Documented in route header; accepted tradeoff for race-safety.
- **Image migration partial failure leaves dirty state**. Approve transaction commits, then the post-tx R2 copy loop can fail halfway through. Spec accepts this — operator cleanup via lifecycle rule + manual repair. Auto-retry queue is M7.
- **AdminEditPanel `useState(initial ?? {})` stale across submission selection**. Only reads `initial` on mount. In current flow ActionBar passes its own local state so this never bites; latent issue if EditPanel were ever reused across submissions without remount.

---

## P5 — Optional refinements (cosmetic)

- TagPicker test #3 uses `if (portraitBtn)` conditional assertion — weak; should `expect(button).toBeInTheDocument()` then `.toBeDisabled()`.
- RejectReasonModal: no Escape-key close, no focus trap. Standard a11y modal niceties.
- RejectReasonModal char counter uses `reason.trim().length` — jumps when user adds trailing spaces (cosmetic).
- AdminSubmissionRow: missing `title` attribute on truncated title for hover-reveal.
- Submission draft writes to sessionStorage per keystroke (no debounce). Form is small enough this doesn't matter; debounce 500ms for cleanliness if touched.

---

## P6 — Carry to M7

Cross-reference for future planners — these were noted in passing but properly belong to M7:

- Real `reports` table + UI (M5 More menu's report placeholder triggers a toast; M7 wires the actual flow).
- `site_settings` table — currently `SUBMIT_CONFIG` constants in `apps/api/src/lib/submit-config.ts`. M7 moves these to DB so admins can tweak limits without redeploys.
- `announcements` table + UI.
- Auto-retry queue for failed R2 image migration.
- Tag suggestion submit + approve UI (`tag_suggestions` table exists from M1; flow doesn't).
- Admin tag management UI (creating new tag slugs without SQL).
- Demote-reversal admin tool (clear `users.rejectedCount`).
- Real notification center page (current popover only shows last 20).
- Email/push notifications (M4 is in-site only).
