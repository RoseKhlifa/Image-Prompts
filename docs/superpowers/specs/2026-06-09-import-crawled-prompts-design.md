# Import Crawled Prompts — Design Spec

**Date:** 2026-06-09
**Source:** chat-approved design from the session that immediately precedes this doc — recorded here so the implementation plan has a referenceable source of truth.

## 1. Goal

Ingest 33,234 third-party-crawled prompts from `G:\promptsandimages\exports\by_category\*.jsonl` into the Image-Prompts dev DB. Records carry **remote image URLs** (no local files, no R2 uploads); the site must render those directly in cards and detail pages. The owner triggers imports per category from the existing `/rosekhlifa` admin console.

The 33,234 records are the canonical seed for moving the site from "user-submission only" to "browseable library" before launch. Without this step the homepage shows ~7 demo + 1 user prompt.

## 2. Data shape (from `IMPORT_GUIDE.md` §4-5)

```json
{
  "id":              "20260607_235015_nanobanana_d9e0ba9d450e_05eefd",
  "title":           "Deconstructed Seblak Broth",
  "category":        { "slug": "food", "name": "美食餐饮" },
  "normalized_tags": ["美食餐饮", "美食", "Food", "Surreal", "Dynamic"],
  "tags":            ["Food", "Surreal", "Dynamic", "NanoBanana", "NanoBananaPrompt"],
  "prompts":         { "zh": "",  "en": "Use uploaded photo as absolute main reference…" },
  "image_url":       "https://cdn.nanobananaprompt.co/prompt-images/twitter-…jpg",
  "source_url":      "https://nanobananaprompt.co/zh/prompts/deconstructed-seblak-broth",
  "source_site":     "NanoBananaPrompt",
  "source_id":       "d9e0ba9d-450e-4571-9677-c242378f5c05"
}
```

Field guarantees confirmed from `IMPORT_GUIDE.md` §6:
- Top-level field set 100% consistent across all 33,234 records.
- No duplicate `id`.
- Every record has at least one of `prompts.zh` / `prompts.en` non-empty.
- `source_id` is sometimes numeric (1,913 records in AI2Image set) — must be coerced to string on ingest.
- `image_url` is always remote https URL.

16 categories ranging from 51 (`food`) to 5,725 (`graphic_design`) records.

## 3. Schema decisions

### 3.1 Remote image storage on `prompt_images`

Add `remote_url text` column. Make `r2_account_id` + `r2_key` nullable. Replace the existing `unique(r2_account_id, r2_key)` constraint with a **partial unique** that only fires when both are non-null. Add a CHECK that at least one storage form is set per row:

```sql
ALTER TABLE prompt_images
  ALTER COLUMN r2_account_id DROP NOT NULL,
  ALTER COLUMN r2_key        DROP NOT NULL,
  ADD COLUMN remote_url      text;

ALTER TABLE prompt_images DROP CONSTRAINT IF EXISTS prompt_images_account_key_uq;

CREATE UNIQUE INDEX prompt_images_account_key_uq
  ON prompt_images (r2_account_id, r2_key)
  WHERE r2_account_id IS NOT NULL AND r2_key IS NOT NULL;

ALTER TABLE prompt_images ADD CONSTRAINT prompt_images_storage_chk CHECK (
  (r2_account_id IS NOT NULL AND r2_key IS NOT NULL) OR remote_url IS NOT NULL
);
```

Rationale: single table, no parallel hierarchy. `resolveImageUrl` in the frontend just checks `remote_url` first, falls back to R2 resolution.

### 3.2 Source columns on `prompts`

```sql
ALTER TABLE prompts
  ADD COLUMN external_id  text,
  ADD COLUMN source_url   text,
  ADD COLUMN source_site  text;

CREATE UNIQUE INDEX prompts_external_id_uq
  ON prompts (external_id) WHERE external_id IS NOT NULL;
CREATE INDEX prompts_source_site_idx ON prompts (source_site) WHERE source_site IS NOT NULL;
```

`external_id` is the record's `id` from the JSONL. Unique-when-set so re-running an import is idempotent (insert-if-absent, else skip). User-submitted prompts and demo seed leave it NULL.

### 3.3 Extend `prompt_source` enum

Add `'imported'` value to the existing enum so we can distinguish at-a-glance between `'site'` (user submissions), `'nanobanana_seed'` (legacy demos), and `'imported'` (this batch).

`ALTER TYPE prompt_source ADD VALUE IF NOT EXISTS 'imported'` — must run **outside** a transaction in Postgres. The apply script will issue it as a standalone statement before the BEGIN block.

### 3.4 `import_batches` table

```sql
CREATE TABLE import_batches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_slug   text NOT NULL,
  source_file     text NOT NULL,
  total           integer NOT NULL DEFAULT 0,
  inserted        integer NOT NULL DEFAULT 0,
  skipped_duplicate integer NOT NULL DEFAULT 0,
  failed          integer NOT NULL DEFAULT 0,
  failed_records  jsonb   NOT NULL DEFAULT '[]'::jsonb,
  status          text    NOT NULL DEFAULT 'pending',
  dry_run         boolean NOT NULL DEFAULT false,
  started_by      uuid    REFERENCES users(id) ON DELETE SET NULL,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);

CREATE INDEX import_batches_started_at_idx ON import_batches (started_at DESC);
```

`status` ∈ `'pending' | 'running' | 'done' | 'failed'`. `failed_records` keeps the first N (cap 50) failed payloads + error messages for the audit feed.

## 4. Tags

The 33K records use ~tens of thousands of distinct tag strings, many in Chinese. The existing `tags.slug` regex (zod-layer only — DB column is plain text + UNIQUE) is `^[a-z0-9-]+$`, which would reject everything Chinese.

**Decision:** Accept Chinese characters in slugs at the DB layer, generate slugs deterministically from the normalized name:

- Lowercase the input.
- Strip emoji / control chars (regex `/[\p{Emoji_Presentation}\p{Cf}]/gu`).
- Collapse whitespace + punctuation runs to single `-`.
- Trim leading/trailing `-`.
- If result is empty, fall back to `t-<sha1(name)[:8]>`.

Examples:
- `摄影写真` → `摄影写真`
- `Realistic` → `realistic`
- `AI绘画` → `ai绘画`
- `🔥 Qwen · 爆款海报` → `qwen-爆款海报`
- `   ` → `t-da39a3ee` (degenerate fallback)

URLs become `?tag=%E6%91%84%E5%BD%B1%E5%86%99%E7%9C%9F` — that's fine, the browser and Hono router handle UTF-8 query params transparently. The existing owner-side tag CRUD slug regex stays strict; the import path uses a separate slug helper. Display name is bilingual `{ zh, en }` — for now we set both sides to the same string (Chinese-or-English source name) and let `pickBilingual` fall back.

Only `normalized_tags` get associated as `prompt_tags`. Raw `tags` are dropped from the schema (the audit value isn't worth the table bloat). The `import_batches.failed_records` jsonb retains them as fallback evidence.

## 5. Contributor display

Imported prompts have no real contributor. Setting `contributor_id = NULL` and rendering the existing "anonymous" label would conflate them with the demo seed.

**Decision:** Render a **source-attribution chip** on `PromptCard` when `contributor === null && source_site != null`, in lieu of the avatar+name block. The chip shows `"来源 · {source_site}"` and links to `source_url` in a new tab.

For prompts where `contributor` is set, the current avatar/name layout is unchanged. For prompts where `contributor === null && source_site === null` (demo seed), the existing "anonymous" path is preserved.

## 6. Import flow

### 6.1 Server-side import function

Single function `importCategoryJsonl({ filePath, categorySlug, dryRun, limit })` in a new `apps/api/src/repositories/imports.ts`:

1. Open file as a Node readable stream + readline interface — never buffer the whole file (some files are 10 MB).
2. For each line:
   - Parse JSON.
   - Coerce `source_id` to string.
   - Validate via a zod schema reflecting the IMPORT_GUIDE §5 field contract.
   - Try `INSERT … ON CONFLICT (external_id) DO NOTHING` for the prompt row.
   - On insert: ensure category row exists (UPSERT by slug); ensure tag rows exist (UPSERT by slug); insert `prompt_images` row with `remote_url`; insert `prompt_tags` rows.
   - On conflict: increment `skipped_duplicate`.
3. If `dryRun`, the whole sequence runs inside a transaction that's ROLLBACK'd at the end. `inserted` reflects the in-tx number, no rows persist.
4. If `limit` is set, stop after that many lines (used by the admin UI's "试导入 10 条").
5. Update / insert the `import_batches` row throughout. On any uncaught exception, mark `status='failed'`, persist `failed_records`, re-throw.

### 6.2 CLI script

`apps/api/scripts/import-prompts.ts` — thin wrapper around `importCategoryJsonl`. Usage:

```
pnpm exec tsx scripts/import-prompts.ts food --dry-run --limit 10
pnpm exec tsx scripts/import-prompts.ts food
pnpm exec tsx scripts/import-prompts.ts --all   # iterates every category in manifest.json, smallest first
```

Resolves `<data root>` from `site_settings['import.data_root']` (default `G:\\promptsandimages`); reads `<data root>/exports/manifest.json` for the slug → file mapping. Prints a per-category summary table at the end.

### 6.3 Admin endpoint

`POST /api/owner/imports` (gated by `requireOwner`):

```ts
body: {
  categorySlug: string,
  dryRun?:      boolean,
  limit?:       number,  // 1..100 only valid with dryRun
}
```

Returns the completed `import_batches` row + first 5 inserted/skipped sample records for UI display. **Synchronous** — even the biggest category (5,725 records, `graphic_design`) finishes in ~30s with batched inserts.

`GET /api/owner/imports` returns the 50 most recent `import_batches` rows for the history table.

### 6.4 Admin UI

New page `apps/web/src/pages/owner/ImportPage.tsx` at `/rosekhlifa/import`:

- Header: data-root display + "edit in config" button.
- Top section: 16-row table from `manifest.json` (slug, ZH name, total count, "已导入" count via a per-slug query, two action buttons per row: `试导入 10` + `导入此分类`).
- Bottom section: import history table from `GET /api/owner/imports` — batch id (short), category slug, status, total/inserted/skipped/failed counts, started_at, started_by.
- Per-row click expands to show failed_records (if any).

Owner sidebar gets an "导入" link with `Download` lucide icon between "Tags" and "Submissions".

## 7. Out-of-scope (next iteration)

- No bulk all-at-once import button — owner imports per category through the UI, one at a time. CLI `--all` is the unattended path.
- No async background queue — synchronous HTTP for now. If a category times out we revisit.
- No remote-image caching to R2 — render directly. The CDN URLs in the dataset are stable enough for the first launch.
- No tag dedup across import + user-submit. If owner later wants `Realistic` and `realistic` merged, the existing `/rosekhlifa/tags` page handles it manually.
- No category mapping. The 16 imported slugs sit alongside the existing 7 ones; owner can later merge via `/rosekhlifa/categories`.

## 8. Constraints carried over from prior incidents

- `apps/api/scripts/restore-user-prompt.ts` must still successfully reattach `冒险角色设计稿` to its contributor after this work. Verify before and after every step. (See [[counter-drift-is-test-pollution-not-seed]] and [[prompts-test-nulls-latest-contributor]] in memory.)
- `dev-primary` R2 account row (name=`dev-primary`, accountId=`36dca4498d1ed04ce95a50c5277be644`, bucket=`image-prompts-1`) must not be touched. R2 ops are not exercised by this import; verify the row count and the specific row after migration 0013 lands.
- No `pnpm db:seed`. No full `pnpm -F api test --run`. Targeted vitest only. (See [[never-run-pnpm-db-seed-with-user-data]].)
