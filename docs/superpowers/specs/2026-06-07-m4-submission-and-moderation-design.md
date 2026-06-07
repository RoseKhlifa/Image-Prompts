# M4: 投稿 + R2 池 + 审核 Design Spec

**Date:** 2026-06-07
**Status:** Approved, ready for plan
**Prior milestones:** M1 (skeleton), M3 (Auth + Send to Studio), M5 (likes/favorites/views)
**Project root:** `D:\Image-Prompts`

## 1. Goal

Let logged-in users submit new prompts (bilingual text + 1-5 images uploaded directly to a Cloudflare R2 bucket via presigned PUT). Admins/moderators review submissions in a queue. On approval, images are moved from a `submissions/` prefix to a `prompts/` prefix, a new `prompts` row is created, and the contributor gets an in-site notification. On rejection, the contributor gets a notification with a reason. M4 ships the full M1 spec for this surface — community guidelines modal with 30s timer, daily limits, demote-on-reject, edit-then-approve, audit log, in-site notifications, AES-256-GCM encrypted R2 secrets — minus the `site_settings` and `announcements` infrastructure (M7).

## 2. Non-Goals

- Cross-account R2 migration (spec §8.6 explicitly excludes from MVP).
- Email/push notifications (in-site only).
- Real-time updates (no SSE/WebSocket). Bell polls on route change.
- A general notification center page. Only a popover/dropdown over the bell.
- Per-user notification preferences. Every status change creates a notification.
- Image processing (no EXIF strip, no thumbnail generation, no transcoding). R2 has on-the-fly transforms if needed later.
- New-tag introduction by users at submission time. The existing `tags` table is the whitelist; users pick from it. Admins, during edit-then-approve, can also only pick from existing tag slugs. New tag creation = manual DB insert in M4, or via the (M7) tag suggestion / tag admin UI.
- `tag_suggestions` UI (the table exists from M1, but the contributor-submit + admin-approve UI for it is M7).
- `reports` / `announcements` / `site_settings` tables (M7).
- Automatic retry queue for failed R2 image migration on approve (M7). M4 surfaces the error, leaves dirty state, logs.

## 3. Roles & Permissions

| Role | Marker | Capabilities |
|---|---|---|
| guest | no session | browse only; clicking Submit opens SignInModal |
| user | `session.user.role = 'user'` | submit (subject to daily limit); read own submissions + notifications; like/favorite (M5); send to studio (M3) |
| moderator | `session.user.role = 'moderator'` | everything `user` can + view admin queue + approve / reject (no edits) |
| admin | `session.user.role = 'admin'` | everything `moderator` can + edit-then-approve + manage `r2_accounts` rows |

### 3.1 Admin promotion (ADMIN_EMAILS)

`.env` adds:
```
ADMIN_EMAILS=you@example.com,colleague@example.com
```

Comma-separated, case-insensitive. In Auth.js `session` callback:
```ts
const adminEmails = (env.ADMIN_EMAILS ?? "")
  .split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
if (user.email
    && adminEmails.includes(user.email.toLowerCase())
    && currentRole === "user") {
  await db.update(users).set({ role: "admin" }).where(eq(users.id, user.id));
  currentRole = "admin";
}
session.user.role = currentRole;
```

Properties:
- Idempotent (only writes when role is still 'user').
- Promotion happens at next sign-in, not retroactively.
- Demotion (removing from `ADMIN_EMAILS`) does NOT auto-revert; manual DB edit needed.
- Empty / missing `ADMIN_EMAILS` skips the block entirely.

## 4. User Journeys

### 4.1 Contributor flow

```
1. Click "投稿" nav (any locale).
   - guest → SignInModal → on success, navigate to /:locale/submit
   - logged-in → /:locale/submit directly

2. SubmitPage mounts → CommunityGuidelinesGate checks:
   - if user.communityGuidelinesVersion < GUIDELINES_VERSION (constant = 1)
     → CommunityGuidelinesModal opens, form is disabled behind it
   - else → modal skipped, form active

3. CommunityGuidelinesModal:
   - 30-second read timer (countdown shown on the agree button)
   - intersection observer on a bottom sentinel — must scroll to bottom
   - checkbox "我已阅读并同意" — disabled until timer ends AND scroll-to-bottom
   - Click "我同意" → PATCH /api/me/community-guidelines { version: 1 }
     → on success, modal closes, form unlocks
   - Click cancel → navigate back; no DB write

4. Form fields:
   - titleZh, titleEn (≥1 of zh|en must have BOTH a title AND a prompt; same language pair)
   - promptZh, promptEn
   - negativePromptZh, negativePromptEn (optional)
   - notesZh, notesEn (optional — published bilingual notes shown on the detail page after approval, NOT a moderator-only message; see existing prompts.notes JSONB column)
   - aspectRatio (optional; same enum as prompts.aspectRatio in M5)
   - categoryId (required, picked from /api/categories)
   - tagSlugs (0-6, picked from /api/tags?q= autocomplete; only existing entries in the `tags` table)
   - images (1-5)

5. For each image:
   a. user picks file → client-side validate (≤10MB, MIME in JPEG/PNG/WebP)
   b. POST /api/submissions/presign { filename, contentType, size }
      → returns { r2AccountId, r2Key, uploadUrl, expiresAt }
   c. browser PUT uploadUrl ← file (with progress)
   d. on success: show thumbnail (resolved via existing /api/public/r2-pool + r2Key)
                  + delete button

6. Submit button enabled when: at-least-1 bilingual complete + category + ≥1 image done.
   → POST /api/submissions { ...form, images: [{r2AccountId, r2Key, altText?}] }
   → on success: navigate /:locale/profile?tab=submissions, toast 已提交

7. Form state in sessionStorage so 401 mid-flow + re-login restores progress.
```

### 4.2 Contributor: viewing own submissions

`/:locale/profile?tab=submissions`:
- Tabs: 资料 / 我的收藏 / **我的投稿**
- List of `SubmissionCard`:
  - thumbnail of first image
  - title (preferred locale, falls back)
  - status badge: pending=灰、approved=绿、rejected=红
  - submitted_at (relative)
  - if rejected: reject_reason in card body
  - if approved: link "查看" → /:locale/prompts/:slug

Pagination: 20/page cursor-based.

Deep link `?tab=submissions&highlight={subId}` (from a rejected-notification click): on mount the tab scrolls the matching `SubmissionCard` into view and pulses a `border-accent` ring for ~2s. If the row isn't on the first page, the page fetches until it appears (max 5 pages, then no-op).

### 4.3 Admin/moderator: queue

Nav additions when role ∈ {admin, moderator}:
- top-right header: NotificationsBell + UserMenu (existing)
- UserMenu dropdown shows "管理 → 待审核 ({pending count})" extra item

`/:locale/admin/submissions`:
- Status tabs: 待审核 / 已通过 / 已拒绝, defaults pending
- Two-column layout (desktop), stacked (mobile):
  - Left 40%: `AdminSubmissionList` — Masonry of thumbs with title/contributor/date
  - Right 60%: `AdminSubmissionPreview` — empty state until row selected or `:id` in URL
- Clicking a row updates URL to `/admin/submissions/:id` (deep link)
- Preview shows the submission rendered as if it were a public prompt (read-only) + admin action bar

### 4.4 Admin: approve

In `AdminSubmissionPreview`:
- Default action bar: [Approve] [Reject] [关闭]
- Admin only: "编辑后批准" toggle → expands an EditPanel with overrides for title_zh/en, prompt_zh/en, neg_zh/en, category, tag_slugs, aspect_ratio
- Click Approve → `POST /api/admin/submissions/:id/approve { edits? }`
  - moderator with non-empty edits → 403 `edits_require_admin`
  - server runs transaction (see §6.6)
  - then runs image migration (copy + delete)
  - returns `{ promptId, slug }`
  - on success: toast "已批准,提示词已发布", refetch queue, advance to next pending

### 4.5 Admin: reject

Click Reject → `RejectReasonModal`:
- textarea, required, ≥10 chars, ≤500 chars
- "确认拒绝" → `POST /api/admin/submissions/:id/reject { reason }`
- server runs reject transaction (§6.7), async-deletes R2 objects
- on success: toast "已拒绝,投稿人将收到通知", refetch queue

### 4.6 In-site notifications

`NotificationsBell` in AppShell:
- Always rendered
- Polls `GET /api/me/notifications/count` on route change + on window focus
- If unread > 0: red badge with number
- Click → Popover with up to 20 most-recent items
- Click item:
  - submission_approved → mark read, navigate to `/:locale/prompts/{slug}`
  - submission_rejected → mark read, navigate to `/:locale/profile?tab=submissions&highlight={subId}`
- "全部已读" link in popover header

## 5. Constants (M4 hardcoded; M7 migrates to site_settings)

```ts
// apps/api/src/lib/submit-config.ts
export const SUBMIT_CONFIG = {
  DAILY_LIMIT: 10,
  DEMOTED_LIMIT: 5,
  DEMOTE_THRESHOLD: 3,                 // users.rejectedCount ≥ this → halve daily limit
  MAX_IMAGES_PER_SUBMISSION: 5,
  MIN_IMAGES_PER_SUBMISSION: 1,
  MAX_IMAGE_SIZE_BYTES: 10 * 1024 * 1024,
  ALLOWED_MIME: ["image/jpeg", "image/png", "image/webp"] as const,
  MIME_TO_EXT: { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const,
  MAX_TAGS: 6,
  PRESIGN_TTL_SECONDS: 15 * 60,
  GUIDELINES_VERSION: 1,
  GUIDELINES_READ_SECONDS: 30,
  DAILY_RESET_TIMEZONE: "Asia/Shanghai",
  REJECT_REASON_MIN_CHARS: 10,
  REJECT_REASON_MAX_CHARS: 500,
} as const;
```

`computeDailyLimit(user)` = `user.rejectedCount ≥ DEMOTE_THRESHOLD ? DEMOTED_LIMIT : DAILY_LIMIT`. Re-computed on every presign + create (no caching).

## 6. Architecture

### 6.1 New backend modules

```
apps/api/src/
├── lib/
│   ├── crypto.ts                  AES-256-GCM encrypt/decrypt for R2 secrets
│   ├── r2-client-cache.ts         S3Client LRU keyed by r2_account.id
│   ├── r2-scheduler.ts            pickWriteAccount() — priority desc, enabled, not deleted
│   ├── r2-ops.ts                  presignPut, headObject, copyObject, deleteObject
│   ├── r2-keys.ts                 buildSubmissionKey, buildPromptKey, mimeToExt
│   ├── submit-config.ts           constants
│   ├── daily-limit.ts             computeDailyLimit, resetDailyCountIfNeeded
│   └── shanghai-date.ts           startOfTodayShanghai() helper for daily reset
├── middleware/
│   └── role.ts                    requireRole(...roles)
├── repositories/
│   ├── submissions.ts             create / approve / reject / listForUser / listForAdmin
│   ├── notifications.ts           create / list / countUnread / markRead / markAllRead
│   ├── audit.ts                   record(actorId, action, target, payload)
│   ├── tags.ts (extend)           searchTags(q, limit), getTagsBySlugs(slugs[]), incrementUsage(slugs[])
│   └── users.ts (extend)          getUserForSubmission, incrementDailyCount, etc.
├── routes/
│   ├── submissions.ts             POST /presign, POST /
│   ├── admin.ts                   GET/POST /admin/submissions/*
│   └── (extend) me.ts             /me/submissions, /me/notifications/*, /me/community-guidelines
└── scripts/
    └── seed-r2-account.ts         one-shot dev R2 account seeder
```

### 6.2 New frontend modules

```
apps/web/src/
├── pages/
│   ├── SubmitPage.tsx
│   ├── AdminSubmissionsPage.tsx
│   └── (extend) ProfilePage.tsx    add "我的投稿" tab
├── components/
│   ├── submit/
│   │   ├── CommunityGuidelinesGate.tsx
│   │   ├── CommunityGuidelinesModal.tsx
│   │   ├── SubmissionForm.tsx
│   │   ├── TitleSection.tsx
│   │   ├── PromptSection.tsx
│   │   ├── OptionalSection.tsx
│   │   ├── CategoryPicker.tsx
│   │   ├── TagPicker.tsx
│   │   ├── ImageUploadGrid.tsx
│   │   ├── ImageSlot.tsx
│   │   └── NotesField.tsx
│   ├── profile/
│   │   └── MySubmissionsTab.tsx
│   ├── admin/
│   │   ├── AdminSubmissionList.tsx
│   │   ├── AdminSubmissionRow.tsx
│   │   ├── AdminSubmissionPreview.tsx
│   │   ├── AdminEditPanel.tsx
│   │   ├── AdminActionBar.tsx
│   │   ├── RejectReasonModal.tsx
│   │   └── SubmissionCard.tsx        (reused by profile tab)
│   ├── notifications/
│   │   ├── NotificationsBell.tsx
│   │   └── NotificationsList.tsx
│   └── layout/
│       └── (extend) AppShell.tsx      mount bell + admin menu entry
└── lib/hooks/
    ├── useCommunityGuidelinesGate.ts
    ├── useAcceptGuidelines.ts
    ├── useCategories.ts
    ├── useTagSuggestions.ts
    ├── useImageUpload.ts
    ├── useCreateSubmission.ts
    ├── useMySubmissions.ts
    ├── useNotifications.ts
    ├── useNotificationCount.ts
    ├── useMarkNotificationRead.ts
    ├── useAdminSubmissions.ts
    ├── useAdminSubmissionDetail.ts
    ├── useApproveSubmission.ts
    └── useRejectSubmission.ts
```

### 6.3 Shared schemas

```
packages/shared/src/schemas/submission.ts  — Zod schemas + inferred types
```

### 6.4 R2 layer key design

```ts
// crypto.ts
export function encryptSecret(plain: string): string;   // base64 of [iv(12) | tag(16) | ct]
export function decryptSecret(b64: string): string;

// r2-client-cache.ts
type CacheEntry = { client: S3Client; accountSnapshot: R2AccountRow };
const cache = new Map<string, CacheEntry>();
const MAX_CACHED = 8;
export function getS3Client(account: R2AccountRow): S3Client;
export function clearR2ClientCache(): void;     // for tests

// r2-scheduler.ts
export async function pickWriteAccount(): Promise<R2AccountRow>;
export class NoR2AccountError extends Error {}

// r2-ops.ts
export async function presignPut(args: {
  account: R2AccountRow; key: string;
  contentType: string; contentLength: number; ttlSeconds: number;
}): Promise<{ uploadUrl: string; expiresAt: Date }>;
export async function headObject(account: R2AccountRow, key: string):
  Promise<{ contentLength: number; contentType: string } | null>;
export async function copyObject(account: R2AccountRow, fromKey: string, toKey: string): Promise<void>;
export async function deleteObject(account: R2AccountRow, key: string): Promise<void>;

// r2-keys.ts
export function buildSubmissionKey(userId: string, ext: string): string;
//   → submissions/{userId}/{uuidv4}.{ext}
export function buildPromptKey(promptId: string, index: number, ext: string): string;
//   → prompts/{promptId}/{index}.{ext}
export function mimeToExt(mime: string): "jpg" | "png" | "webp";
```

**LRU note**: M4 will only ever cache 1 client (single account), but the cache structure is in place so M5+ multi-account works without refactor. Invalidation triggers when `endpoint`, `accessKeyId`, or `secretAccessKeyCiphertext` changes.

**Bucket privacy note**: Cloudflare R2 cannot per-prefix-toggle public read. M4 accepts that the whole bucket is public-readable (since `prompts/*` must be) and relies on UUID obscurity for `submissions/*`. Bucket lifecycle rule expires `submissions/*` after 7 days.

### 6.5 CORS configuration (deployment doc)

`docs/deployment/r2-setup.md` (new file in M4):

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:5173",
      "http://localhost:3000",
      "https://YOUR-PROD-DOMAIN"
    ],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["Content-Type", "Content-Length"],
    "MaxAgeSeconds": 3600
  }
]
```

Lifecycle rule:
```
Rule "expire submissions": prefix=submissions/, delete after 7 days
```

### 6.6 Approve transaction (server)

```ts
async function approveSubmission(actorId, role, subId, edits) {
  const hasEdits = Object.keys(edits).length > 0;
  if (hasEdits && role !== "admin") throw new ForbiddenError("edits_require_admin");

  const sub = await getSubmissionRow(subId);
  if (!sub) throw new NotFoundError();
  if (sub.status !== "pending") throw new ConflictError("not_pending");

  const final = mergeSubmissionWithEdits(sub, edits);
  let promptId: string, slug: string;

  await db.transaction(async (tx) => {
    slug = await generateUniqueSlug(tx, final.titleZh ?? final.titleEn);
    // NB: prompts.title / .prompt / .negativePrompt / .notes are JSONB columns
    // shaped { zh?: string; en?: string }. The flat fields from the input schema
    // (titleZh, titleEn, etc.) get folded into that shape here by `bi()` (a small
    // helper that strips undefined keys and returns null if both sides empty).
    const [p] = await tx.insert(prompts).values({
      slug, source: "site",
      title: bi(final.titleZh, final.titleEn)!,         // notNull
      prompt: bi(final.promptZh, final.promptEn)!,       // notNull
      negativePrompt: bi(final.negativePromptZh, final.negativePromptEn), // nullable
      notes: bi(final.notesZh, final.notesEn),           // nullable; see §4.1 note below
      aspectRatio: final.aspectRatio ?? null,
      categoryId: final.categoryId,
      contributorId: sub.contributorId,
      approvedAt: new Date(),
    }).returning({ id: prompts.id });
    promptId = p.id;

    // prompt → tag link via prompt_tags. tag rows already validated at submit-time;
    // we look them up by slug to resolve to tag ids.
    if (final.tagSlugs.length > 0) {
      const tagRows = await tx.select({ id: tags.id })
        .from(tags).where(inArray(tags.slug, final.tagSlugs));
      if (tagRows.length > 0) {
        await tx.insert(promptTags).values(
          tagRows.map(t => ({ promptId, tagId: t.id }))
        );
      }
    }

    await tx.update(submissions).set({
      status: "approved", promotedTo: promptId,
      reviewedBy: actorId, reviewedAt: new Date(),
    }).where(eq(submissions.id, subId));

    await tx.insert(notifications).values({
      userId: sub.contributorId,
      type: "submission_approved",
      payload: { submissionId: subId, promptId, promptSlug: slug,
                 titleZh: final.titleZh, titleEn: final.titleEn },
    });

    await tx.insert(auditLog).values({
      actorId, action: "submission.approve", targetType: "submission", targetId: subId,
      payload: { promptId, hadEdits: hasEdits, edits: hasEdits ? edits : undefined },
    });

    // Bump tag usageCount for every slug that ended up on the prompt.
    if (final.tagSlugs.length > 0) {
      await tx.update(tags)
        .set({ usageCount: sql`${tags.usageCount} + 1` })
        .where(inArray(tags.slug, final.tagSlugs));
    }
  });

  // Image migration is post-transaction (can't atomically span R2 + DB).
  // Failure here leaves dirty state: prompt exists, submissions row marks approved,
  // notification was sent, but images aren't where they should be.
  try {
    await migrateImagesAfterApprove(promptId, slug, sub.imageKeys);
  } catch (e) {
    logger.error("[approve] image migration failed", { subId, promptId, error: e });
    throw new HTTPException(500, { message: "image_migration_failed" });
  }

  return { promptId, slug };
}

async function migrateImagesAfterApprove(promptId, slug, imageKeys) {
  for (const [idx, img] of imageKeys.entries()) {
    const account = await getR2Account(img.r2AccountId);
    const ext = extractExtFromKey(img.r2Key);
    const newKey = buildPromptKey(promptId, idx, ext);
    await copyObject(account, img.r2Key, newKey);
    await db.insert(promptImages).values({
      promptId, r2AccountId: img.r2AccountId, r2Key: newKey,
      altText: img.altText ?? null, order: idx,
    });
    // "primary image" = row with order=0; no isPrimary column.
    // Best-effort delete; failure here doesn't block — lifecycle will clean it.
    try { await deleteObject(account, img.r2Key); } catch (e) {
      logger.warn("[approve] delete original failed", { key: img.r2Key, error: e });
    }
  }
}
```

### 6.7 Reject transaction (server)

```ts
async function rejectSubmission(actorId, subId, reason) {
  const sub = await getSubmissionRow(subId);
  if (!sub) throw new NotFoundError();
  if (sub.status !== "pending") throw new ConflictError("not_pending");

  await db.transaction(async (tx) => {
    await tx.update(submissions).set({
      status: "rejected", rejectReason: reason,
      reviewedBy: actorId, reviewedAt: new Date(),
    }).where(eq(submissions.id, subId));

    await tx.update(users)
      .set({ rejectedCount: sql`${users.rejectedCount} + 1` })
      .where(eq(users.id, sub.contributorId));

    await tx.insert(notifications).values({
      userId: sub.contributorId,
      type: "submission_rejected",
      payload: { submissionId: subId, reason,
                 titleZh: sub.titleZh, titleEn: sub.titleEn },
    });

    await tx.insert(auditLog).values({
      actorId, action: "submission.reject", targetType: "submission", targetId: subId,
      payload: { reason },
    });
  });

  // Async cleanup; best-effort.
  for (const img of sub.imageKeys) {
    try {
      const account = await getR2Account(img.r2AccountId);
      await deleteObject(account, img.r2Key);
    } catch (e) {
      logger.warn("[reject] delete failed", { key: img.r2Key, error: e });
    }
  }
}
```

### 6.8 Daily-limit reset (Asia/Shanghai 0:00)

```ts
// lib/shanghai-date.ts
export function startOfTodayShanghai(now = new Date()): Date {
  // Use Intl with Asia/Shanghai timezone to compute YYYY-MM-DD,
  // then construct the UTC instant for 00:00:00 in Shanghai (UTC+8).
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
  });
  const [{ value: y }, , { value: m }, , { value: d }] = fmt.formatToParts(now);
  return new Date(`${y}-${m}-${d}T00:00:00+08:00`);
}

// lib/daily-limit.ts
export async function resetDailyCountIfNeeded(userId: string): Promise<void> {
  const today = startOfTodayShanghai();
  await db.update(users).set({
    dailySubmissionCount: 0,
    dailySubmissionResetAt: new Date(),
  }).where(and(
    eq(users.id, userId),
    or(isNull(users.dailySubmissionResetAt), lt(users.dailySubmissionResetAt, today)),
  ));
}
```

### 6.9 Atomic daily-limit increment

To prevent races when two presigns hit the same instant:

```ts
async function incrementDailyCountIfUnderLimit(userId: string, limit: number): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE users
    SET daily_submission_count = daily_submission_count + 1
    WHERE id = ${userId}
      AND daily_submission_count < ${limit}
    RETURNING daily_submission_count
  `);
  return result.rowCount === 1;
}
```

The presign route doesn't increment (presign doesn't commit the user to submitting). Only `POST /api/submissions` increments. Presign only *checks* the count.

## 7. Schema Changes (migration 0006_m4_submission)

### 7.1 New tables

```ts
// apps/api/src/db/schema/notifications.ts
export const notificationTypeEnum = pgEnum("notification_type", [
  "submission_approved",
  "submission_rejected",
]);

type NotificationPayload =
  | { submissionId: string; promptId: string; promptSlug: string; titleZh: string | null; titleEn: string | null }
  | { submissionId: string; reason: string; titleZh: string | null; titleEn: string | null };

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: notificationTypeEnum("type").notNull(),
  payload: jsonb("payload").$type<NotificationPayload>().notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  userUnreadIdx: index("notifications_user_unread_idx")
    .on(t.userId, t.createdAt.desc())
    .where(sql`${t.readAt} IS NULL`),
  userAllIdx: index("notifications_user_all_idx")
    .on(t.userId, t.createdAt.desc()),
}));
```

```ts
// apps/api/src/db/schema/audit.ts
export const auditLog = pgTable("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  actorId: uuid("actor_id").notNull().references(() => users.id),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  actorIdx: index("audit_log_actor_idx").on(t.actorId, t.createdAt.desc()),
  targetIdx: index("audit_log_target_idx").on(t.targetType, t.targetId, t.createdAt.desc()),
}));
```

### 7.2 Existing tables to alter

```sql
ALTER TABLE submissions
  ADD COLUMN agreed_guidelines_version INTEGER NOT NULL DEFAULT 0;
```

### 7.3 No changes needed

`users`, `prompts`, `prompt_images`, `r2_accounts`, `categories`, `submissions` (other than the one ALTER above) are already defined sufficiently in earlier milestones.

### 7.4 R2 account seed

`apps/api/scripts/seed-r2-account.ts` (one-shot, run by developer locally):

```ts
import { encryptSecret } from "../src/lib/crypto.js";
import { env } from "../src/lib/env.js";
import { db } from "../src/db/index.js";
import { r2Accounts } from "../src/db/schema/index.js";

const ciphertext = encryptSecret(env.R2_DEV_ACCESS_KEY_SECRET);
await db.insert(r2Accounts).values({
  label: "dev-primary",
  endpoint: env.R2_DEV_ENDPOINT,
  accessKeyId: env.R2_DEV_ACCESS_KEY_ID,
  secretAccessKeyCiphertext: ciphertext,
  bucket: env.R2_DEV_BUCKET,
  publicUrl: env.R2_DEV_PUBLIC_URL,
  priority: 100,
  enabled: true,
}).onConflictDoNothing();
console.log("R2 account seeded.");
```

Wired as `pnpm --filter @ip/api seed:r2` in api package.json scripts.

## 8. API

### 8.1 Routes table

| Method | Path | Auth | Rate limit (user/IP) | Body / Query | Response |
|---|---|---|---|---|---|
| PATCH | `/api/me/community-guidelines` | user | 30/min · 60/min | `{ version: number }` | `{ ok: true }` |
| GET | `/api/me/submissions` | user | — / 600/min | `?status=&cursor=` | `{ items: SubmissionListItem[], nextCursor: string|null }` |
| GET | `/api/me/notifications` | user | — / 600/min | `?cursor=&unread=true\|false` | `{ items: Notification[], nextCursor }` |
| GET | `/api/me/notifications/count` | user | — / 600/min | — | `{ unread: number }` |
| POST | `/api/me/notifications/:id/read` | user | 200/min · 600/min | — | `{ ok: true }` |
| POST | `/api/me/notifications/read-all` | user | 30/min · 60/min | — | `{ ok: true, updated: number }` |
| POST | `/api/submissions/presign` | user | 60/min · 120/min | `PresignRequest` | `PresignResponse` |
| POST | `/api/submissions` | user | 6/hour · 30/hour | `SubmissionInput` | `{ id: string, status: "pending" }` |
| GET | `/api/categories` | public | — / 600/min | — | `Category[]` (existing M1 route, reused) |
| GET | `/api/tags` | public | — / 600/min | `?q=&limit=` (existing route extended with optional `q` for autocomplete) | `TagSummary[]` |
| GET | `/api/admin/submissions` | mod/admin | — / 600/min | `?status=&cursor=` | `{ items: AdminSubmissionListItem[], nextCursor }` |
| GET | `/api/admin/submissions/:id` | mod/admin | — / 600/min | — | `AdminSubmissionDetail` |
| POST | `/api/admin/submissions/:id/approve` | mod/admin | 60/min · 120/min | `{ edits?: Partial<SubmissionFields> }` (edits ⇒ admin only) | `{ promptId, slug }` |
| POST | `/api/admin/submissions/:id/reject` | mod/admin | 60/min · 120/min | `{ reason: string }` | `{ ok: true }` |

### 8.2 Schemas (`packages/shared/src/schemas/submission.ts`)

```ts
export const AspectRatioSchema = z.enum(["1:1","3:2","2:3","16:9","9:16","4:3","3:4","21:9","9:21"]);
export const TagSlugSchema = z.string().regex(/^[a-z0-9-]+$/).min(1).max(40);
export const NonEmptyTextSchema = z.string().trim().min(1);

export const SubmissionImageInputSchema = z.object({
  r2AccountId: z.string().uuid(),
  r2Key: z.string().min(1).max(512).regex(/^submissions\//),
  altText: z.string().max(200).optional(),
});

export const SubmissionInputSchema = z.object({
  titleZh: z.string().trim().max(200).optional(),
  titleEn: z.string().trim().max(200).optional(),
  promptZh: z.string().trim().max(8000).optional(),
  promptEn: z.string().trim().max(8000).optional(),
  negativePromptZh: z.string().trim().max(2000).optional(),
  negativePromptEn: z.string().trim().max(2000).optional(),
  notesZh: z.string().trim().max(2000).optional(),
  notesEn: z.string().trim().max(2000).optional(),
  aspectRatio: AspectRatioSchema.optional(),
  categoryId: z.string().uuid(),
  tagSlugs: z.array(TagSlugSchema).max(6).default([]),
  images: z.array(SubmissionImageInputSchema).min(1).max(5),
}).refine(
  (v) => (v.titleZh && v.promptZh) || (v.titleEn && v.promptEn),
  { message: "bilingual_required", path: ["titleZh"] },
);

export const PresignRequestSchema = z.object({
  filename: z.string().max(200),
  contentType: z.enum(["image/jpeg","image/png","image/webp"]),
  size: z.number().int().positive().max(10 * 1024 * 1024),
});

export const PresignResponseSchema = z.object({
  r2AccountId: z.string().uuid(),
  r2Key: z.string(),
  uploadUrl: z.string().url(),
  expiresAt: z.string().datetime(),
});

export const RejectInputSchema = z.object({
  reason: z.string().trim().min(10).max(500),
});

export const ApproveInputSchema = z.object({
  edits: z.object({
    titleZh: z.string().max(200).optional(),
    titleEn: z.string().max(200).optional(),
    promptZh: z.string().max(8000).optional(),
    promptEn: z.string().max(8000).optional(),
    negativePromptZh: z.string().max(2000).optional(),
    negativePromptEn: z.string().max(2000).optional(),
    notesZh: z.string().max(2000).optional(),
    notesEn: z.string().max(2000).optional(),
    aspectRatio: AspectRatioSchema.optional(),
    categoryId: z.string().uuid().optional(),
    tagSlugs: z.array(TagSlugSchema).max(6).optional(),
  }).partial().optional(),
});

export const CommunityGuidelinesAcceptSchema = z.object({
  version: z.number().int().min(1),
});

export const NotificationSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(["submission_approved","submission_rejected"]),
  payload: z.record(z.unknown()),
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

// Output DTOs returned from list endpoints.

export const SubmissionListItemSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["pending", "approved", "rejected"]),
  titleZh: z.string().nullable(),
  titleEn: z.string().nullable(),
  rejectReason: z.string().nullable(),
  primaryImage: z.object({
    r2AccountId: z.string().uuid(),
    r2Key: z.string(),
  }).nullable(),
  promotedTo: z.object({
    promptId: z.string().uuid(),
    slug: z.string(),
  }).nullable(),
  createdAt: z.string().datetime(),
  reviewedAt: z.string().datetime().nullable(),
});

export const AdminSubmissionListItemSchema = SubmissionListItemSchema.extend({
  contributor: z.object({
    id: z.string().uuid(),
    name: z.string().nullable(),
    email: z.string().nullable(),
    rejectedCount: z.number().int(),
  }),
});

export const AdminSubmissionDetailSchema = AdminSubmissionListItemSchema.extend({
  promptZh: z.string().nullable(),
  promptEn: z.string().nullable(),
  negativePromptZh: z.string().nullable(),
  negativePromptEn: z.string().nullable(),
  notesZh: z.string().nullable(),
  notesEn: z.string().nullable(),
  aspectRatio: AspectRatioSchema.nullable(),
  categoryId: z.string().uuid(),
  tagSlugs: z.array(z.string()),
  agreedGuidelinesVersion: z.number().int(),
  images: z.array(z.object({
    r2AccountId: z.string().uuid(),
    r2Key: z.string(),
    altText: z.string().nullable(),
  })),
});

export type SubmissionInput = z.infer<typeof SubmissionInputSchema>;
export type PresignRequest = z.infer<typeof PresignRequestSchema>;
export type PresignResponse = z.infer<typeof PresignResponseSchema>;
export type RejectInput = z.infer<typeof RejectInputSchema>;
export type ApproveInput = z.infer<typeof ApproveInputSchema>;
export type NotificationDTO = z.infer<typeof NotificationSchema>;
export type SubmissionListItem = z.infer<typeof SubmissionListItemSchema>;
export type AdminSubmissionListItem = z.infer<typeof AdminSubmissionListItemSchema>;
export type AdminSubmissionDetail = z.infer<typeof AdminSubmissionDetailSchema>;
```

### 8.3 Error codes

| Server `HTTPException.message` | HTTP | Front-end action |
|---|---|---|
| `unauthenticated` | 401 | open SignInModal |
| `forbidden` | 403 | toast "无权限",redirect / |
| `edits_require_admin` | 403 | toast `admin.moderator_no_edit` |
| `guidelines_not_accepted` | 412 | open CommunityGuidelinesModal |
| `daily_limit_reached` | 429 | toast `submit.error.daily_limit` |
| `rate_limited` | 429 | toast `submit.error.rate_limited` |
| `invalid_category` | 400 | inline error on category picker |
| `unknown_tags:slug1,slug2` | 400 | inline error on tag picker (parse out slugs) |
| `image_missing:key` | 400 | mark that ImageSlot as failed, prompt retry |
| `image_too_large:key` | 400 | inline error |
| `image_count` | 400 | inline error |
| `bilingual_required` | 400 | inline error on title row |
| `not_pending` | 409 | toast `admin.error.not_pending`, refetch list |
| `image_migration_failed` | 500 | toast `admin.error.migration` |
| `no_r2_account` | 503 | toast "服务暂时不可用" |
| (other 4xx) | — | toast `submit.error.generic`, log original |

## 9. Frontend Behavior Details

### 9.1 SubmissionForm state model

- Single `react-hook-form` instance with Zod resolver using `SubmissionInputSchema`.
- `useImageUpload(slotIndex)` per slot maintains: `{ state, file, progress, r2AccountId, r2Key, error, abort }`.
- Slot states: `empty → validating → presigning → uploading → done | failed`.
- Form's `images` field syncs from completed slots only.
- Submit button: disabled while any slot is non-`empty` and non-`done`, or while submission mutation is in flight.
- On submit success: `sessionStorage.removeItem("submit-draft")`.
- On every form change: `sessionStorage.setItem("submit-draft", JSON.stringify(values))` (debounced 500ms).
- On mount: read draft from sessionStorage, hydrate.

### 9.2 CommunityGuidelinesModal

- Renders a long-form guidelines body from i18n (`guidelines.body`).
- `useState` for: `secondsRemaining`, `scrolledToBottom`, `agreed`.
- `useEffect` ticks down `secondsRemaining` from 30 to 0.
- IntersectionObserver on a bottom `<div ref={sentinel} />` flips `scrolledToBottom` once.
- The agree button shows: `secondsRemaining > 0 ? "再阅读 {{n}} 秒后可勾选同意" : (!scrolledToBottom ? "请滚动到底部" : "我同意")`.
- Checkbox is disabled until both conditions met; button is disabled until checkbox is checked.
- "我同意" calls `useAcceptGuidelines` mutation. On success → invalidate `["me"]`, close.

### 9.3 TagPicker

- Combobox UI (input + listbox).
- On input, debounce 200ms → `useTagSuggestions(q)` calls `GET /api/tags?q=&limit=8`.
- Results: `TagSummary[]` (id, slug, bilingual name, usageCount) from the `tags` table. Empty query shows top 8 by usageCount.
- Click item → add to selected chip list (max 6, button disabled at 6). Chip shows bilingual name (preferred locale).
- Selected chips removable (X icon).
- No free-text entry: only items from the dropdown can be selected. The form schema enforces slug regex; the server also rejects slugs not present in `tags`.

### 9.4 NotificationsBell + polling

- `useNotificationCount()` returns `{ data: { unread } }` from `GET /api/me/notifications/count`.
- TanStack Query options: `staleTime: 0`, `refetchOnWindowFocus: true`, `refetchOnMount: "always"`.
- A `useEffect` that depends on `useLocation().pathname` calls `queryClient.invalidateQueries({ queryKey: ["me","notifications","count"] })`.
- Bell renders icon always; red badge appears only when `unread > 0`.
- Click opens Popover (Radix UI; install `@radix-ui/react-popover` if not present, else use a simple custom popover).
- Popover loads `useNotifications({ unread: undefined })` lazily (only fetches when popover opens).

### 9.5 AdminSubmissionsPage URL state

- `?status=pending|approved|rejected` (default pending).
- `/:locale/admin/submissions/:id` deep-link selects a row.
- Selection clears when status changes.
- Switching status uses `useSearchParams` not `navigate`.

### 9.6 Approve flow UI

- Default action bar: `[Approve] [Reject] [关闭]`.
- "编辑后批准" toggle (admin only) reveals EditPanel.
- EditPanel mirrors SubmissionForm sections but pre-fills from current submission. Empty input means "no override".
- Click Approve: if EditPanel had values, send them as `edits`; else send `{}`.
- moderator: toggle hidden; pressing Approve sends `{}` always.
- On success, queue refetches; auto-advance to next pending row if any.

### 9.7 Reject flow UI

- Reject opens `RejectReasonModal` (controlled by local state).
- Textarea with char counter; submit disabled below 10 chars.
- On success: modal closes, toast, queue refetches.

## 10. i18n

New top-level keys: `submit`, `my_submissions`, `guidelines`, `admin`, `notifications`. Existing keys (`nav.submit`, `auth.*`) reused.

(Full key list in §5.5 of the brainstorm record; condensed here — implementation should mirror the keys 1:1 in both `zh.json` and `en.json`.)

## 11. Security

| Concern | Mitigation |
|---|---|
| R2 secret leakage from DB dump | AES-256-GCM with `R2_ENCRYPTION_KEY` (64-hex env, validated by Zod), encrypted at rest. Decryption only inside `getS3Client`. Never logged. |
| Submission bypass of community guidelines | Server rechecks `users.communityGuidelinesVersion >= GUIDELINES_VERSION` in create handler, returns 412 if not. |
| Daily limit bypass via parallel requests | Atomic conditional UPDATE (§6.9). |
| Spam via rapid submission | Per-user 6/hour limit + per-IP 30/hour limit + daily limit. |
| Bypass admin role via session forgery | Auth.js sessions are server-side; role is read from DB on every session callback, not from client. |
| presigned URL replay | TTL 15 min. Bucket lifecycle 7 days on `submissions/*` evicts dangling objects. |
| CSRF on Auth.js routes | Auth.js handles natively (existing M3 setup). |
| XSS in user-submitted prompts | All user text rendered as React children (auto-escaped). No `dangerouslySetInnerHTML`. |
| Image abuse (NSFW etc.) | Moderation is the gate; no auto-publish. Out-of-scope for M4 to scan content. |
| Unknown tag injection at admin approve | Admin can set arbitrary slugs (validated against regex); allowed because admin is trusted role. |

## 12. Manual Test Matrix

```
A. /zh/submit guest         → SignInModal, on success returns to /zh/submit
B. /zh/submit new user       → CommunityGuidelinesModal, 30s timer enforces
C. Scroll-to-bottom required → checkbox disabled until both conditions met
D. Accept guidelines         → modal closes, form unlocks, version persisted
E. Re-visit /zh/submit       → no modal (version match)
F. Form: only zh filled (1 image) → submit succeeds
G. Form: only en filled (1 image) → submit succeeds
H. Form: nothing filled      → submit button disabled
I. Image 6MB JPG             → upload succeeds, thumbnail shown
J. Image 12MB PNG            → inline error before upload starts
K. Image GIF                 → inline error (MIME)
L. Image select + abandon page → AbortController fires; no orphan upload completes
M. Submit 10x in one day     → 11th presign returns 429 daily_limit_reached
N. Add ADMIN_EMAILS=self, re-login → role=admin in session
O. /zh/admin/submissions/pending → row visible (submission from F)
P. Click row                  → preview panel renders prompt-like view
Q. Approve as moderator       → /zh/prompts/{slug} accessible, notification +1 for contributor
R. Try edit-then-approve as moderator → 403, UI prevents
S. Toggle edit, change title, Approve as admin → final prompt reflects edit
T. Reject (reason 12 chars)   → notification with reason, contributor rejectedCount += 1
U. After 3 rejections         → that user's daily limit drops to 5
V. Bell red badge appears     → click → list of unreads → click rejected → navigates to profile?tab=submissions&highlight=
W. "全部已读" link              → bell badge clears
X. Cross-tab: reject in tab A, switch route in tab B → tab B bell count refetches
Y. Image migration fails (kill R2 mid-approve) → admin sees 500 toast, manual cleanup needed
```

## 13. Test Coverage Plan

(Detailed §7 of the brainstorm.) Summary:

| Package | New tests | Cumulative |
|---|---|---|
| shared | +6 | 33 |
| api | +50 | 116 |
| web | +20 | 56 |
| **Total** | **+76** | **~205** |

CI gate unchanged: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all green.

## 14. Dependencies to Install

```jsonc
// apps/api/package.json
{
  "dependencies": {
    "@aws-sdk/client-s3": "^3.x",
    "@aws-sdk/s3-request-presigner": "^3.x"
  },
  "devDependencies": {
    "aws-sdk-client-mock": "^4.x"
  }
}
```

(Optional, only if not already there: `@radix-ui/react-popover` for notifications. Falls back to a custom popover.)

## 15. Deployment / Setup Checklist

1. Create a Cloudflare R2 bucket (free tier).
2. Generate an R2 API token with R/W access to the bucket.
3. Configure CORS on the bucket (§6.5).
4. Configure lifecycle rule on the bucket (§6.5).
5. Set `.env`:
   ```
   R2_ENCRYPTION_KEY=<64 hex chars; openssl rand -hex 32>
   R2_DEV_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
   R2_DEV_ACCESS_KEY_ID=...
   R2_DEV_ACCESS_KEY_SECRET=...
   R2_DEV_BUCKET=image-prompts-dev
   R2_DEV_PUBLIC_URL=https://pub-...r2.dev
   ADMIN_EMAILS=you@example.com
   ```
6. Run migration: `pnpm --filter @ip/api db:migrate`.
7. Seed dev R2 account row: `pnpm --filter @ip/api seed:r2`.
8. Restart api dev server. Log in. Confirm role flip to admin.
9. Run manual test matrix §12.

## 16. Open Questions Closed in Design

- Q: Email notifications? — A: No (M4). In-site only.
- Q: Notification center page? — A: No. Popover only.
- Q: Real-time bell? — A: No. Refetch on route change + window focus.
- Q: 30s read timer for guidelines? — A: Yes, per spec.
- Q: Daily reset timezone? — A: Asia/Shanghai.
- Q: Demote reversible? — A: No (M4). Manual DB tweak required.
- Q: Multiple R2 accounts? — A: Layer supports it, but M4 seeds & uses one.
- Q: Bucket public/private split? — A: One bucket, fully public-readable, UUID obscurity + 7-day lifecycle on `submissions/*`.
- Q: tag_suggestions table? — A: Already in DB (M1). M4 only uses the existing `tags` table as the whitelist for submissions. Tag-suggestion-then-approve UI flow is M7.
- Q: Edit-then-approve permission? — A: admin only; moderator can yes/no only.
- Q: Form draft persistence across re-login? — A: sessionStorage.
- Q: Approve image-migration failure handling? — A: Log + 500 to admin. Manual cleanup. Auto-retry queue in M7.

## 17. Out-of-Scope Carry-overs to M7

- `site_settings` table — daily limit, demote threshold, guidelines version all live in `SUBMIT_CONFIG` constant in M4.
- `announcements` table.
- `reports` table (user-initiated content reports, separate from the M5 More menu placeholder).
- Auto-retry queue for failed R2 migration.
- Tag suggestion submit + approve UI (`tag_suggestions` table already exists, but no contributor or admin flow).
- Admin tag management UI (creating new tag slugs in `tags` table — M4 expects this to be done via SQL/seed).
- Demote-reversal admin tool.
- Real notification center page.
- Email/push.

---

End of spec.
