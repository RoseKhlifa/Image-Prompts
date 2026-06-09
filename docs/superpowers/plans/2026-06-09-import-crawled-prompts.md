# Import Crawled Prompts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest 33,234 third-party crawled prompts (with remote image URLs) from `G:\promptsandimages\exports\by_category\*.jsonl` into the dev DB; render them on the existing browse surface alongside user-submitted prompts.

**Architecture:** `prompt_images` gains a nullable `remote_url` column so the same table carries both R2-hosted images (the existing path) and external URLs (the import path). `prompts` gains `external_id` / `source_url` / `source_site` plus an `'imported'` enum value on `prompt_source`. A streaming JSONL parser feeds a single repo function `importCategoryJsonl` that upserts categories, tags, prompts, and images record-by-record with `ON CONFLICT (external_id) DO NOTHING` for idempotency. The owner triggers per-category imports from a new `/rosekhlifa/import` page; results land in a new `import_batches` history table.

**Tech Stack:** Drizzle ORM + Postgres, Hono + zod, React + Vite + TanStack Query, Node `readline` for streaming JSONL.

**Spec:** [`docs/superpowers/specs/2026-06-09-import-crawled-prompts-design.md`](../specs/2026-06-09-import-crawled-prompts-design.md)

---

## File Structure

| Path | Responsibility |
|---|---|
| `apps/api/drizzle/0013_import_crawled_prompts.sql` | Migration: remote_url + nullable r2 cols + partial unique + storage CHECK; external_id/source_url/source_site cols + indexes; prompt_source enum extension; import_batches table |
| `apps/api/drizzle/meta/_journal.json` | Journal entry idx 13 |
| `apps/api/scripts/apply-0013-import.ts` | Idempotent migration apply (same pattern as `apply-0011-original-prompt.ts`); splits enum ALTER out of the BEGIN/COMMIT block |
| `apps/api/src/db/schema/prompts.ts` | Add `external_id` / `source_url` / `source_site` + `'imported'` to `promptSourceEnum` |
| `apps/api/src/db/schema/images.ts` | Make r2 cols nullable; add `remoteUrl` |
| `apps/api/src/db/schema/imports.ts` (NEW) | `importBatches` table + status type |
| `apps/api/src/db/schema/index.ts` | Re-export `importBatches` |
| `apps/api/src/lib/tag-slug.ts` (NEW) | `tagSlugFromName(name)` helper — chinese-safe, hash fallback |
| `apps/api/src/lib/tag-slug.test.ts` (NEW) | Slug helper unit tests |
| `apps/api/src/repositories/imports.ts` (NEW) | `importCategoryJsonl`, `listRecentImports`, types + zod RawRecord schema |
| `apps/api/src/repositories/imports.test.ts` (NEW) | Repo tests w/ `tw44-` prefix fixtures |
| `apps/api/src/routes/owner.ts` | Add `POST /api/owner/imports` + `GET /api/owner/imports` |
| `apps/api/src/routes/owner.test.ts` | Route tests for imports |
| `apps/api/scripts/import-prompts.ts` (NEW) | CLI wrapper around `importCategoryJsonl` |
| `apps/web/src/lib/imageUrl.ts` | `resolveImageUrl` understands `remoteUrl` |
| `apps/web/src/lib/imageUrl.test.ts` | Add remote-url test cases |
| `apps/web/src/components/PromptCard.tsx` | Render source-attribution chip when contributor null + source_site set |
| `apps/web/src/lib/hooks/useOwnerImports.ts` (NEW) | `useStartImport`, `useImportHistory` |
| `apps/web/src/pages/owner/ImportPage.tsx` (NEW) | Category table + run buttons + history |
| `apps/web/src/components/owner/OwnerSidebar.tsx` | Add "Import" nav |
| `apps/web/src/components/owner/OwnerTopbar.tsx` | Add `import` to breadcrumb labels |
| `apps/web/src/routes/index.tsx` | Add `/rosekhlifa/import` route |
| `apps/web/src/i18n/locales/{zh,en}.json` | `owner.nav.import` + `owner.import.*` namespace |
| `packages/shared/src/schemas/prompt.ts` | `PromptSummary` + `PromptDetail` shapes optionally surface `sourceSite` / `sourceUrl` |
| `packages/shared/src/types/domain.ts` | Type: add `sourceSite?` / `sourceUrl?` |

---

## Critical safety constraints

Every task MUST honor these or risk corrupting the user's data:

1. **NEVER run `pnpm db:seed`.** TRUNCATEs `prompt_images / prompt_tags / likes / favorites / import_tokens / submissions / prompts / tags / categories / r2_accounts / site_settings`. Lost 6 prompts on 2026-06-08; do NOT repeat.
2. **NEVER run `pnpm -F api test --run`** (full suite). Several pre-existing tests still mutate dev data despite the `15d2ada` patch. Run only the test files you touched: `pnpm -F api exec vitest run <file>`.
3. **Verify after every step** that `冒险角色设计稿` still has `contributor_id = 905af5ef-2fd0-4832-8cf1-d9c61f4abd72` (用户 圆滑/rosekhlifa@gmail.com). Use:
   ```bash
   cd apps/api && pnpm exec tsx scripts/restore-user-prompt.ts
   ```
   The `Before` line must show that contributor id. If it shows `null`, STOP — your last step bit user data.
4. **`dev-primary` R2 row** (`name='dev-primary'`, `accountId='36dca4498d1ed04ce95a50c5277be644'`, `bucket='image-prompts-1'`) must survive every step. No tests should touch `r2_accounts`. Verify with a one-line query after schema changes:
   ```bash
   pnpm exec tsx -e "import {db} from './src/db/client.ts'; import {sql} from 'drizzle-orm'; const r=await db.execute(sql\`SELECT name FROM r2_accounts WHERE name='dev-primary'\`); console.log(r.rows); process.exit(0);"
   ```
5. **All test fixtures use prefix `tw44-` / `tw44r-` / `tw44u-`** so cleanup is precise.

---

## Task 1: Migration 0013 — schema changes

**Files:**
- Create: `apps/api/drizzle/0013_import_crawled_prompts.sql`
- Create: `apps/api/scripts/apply-0013-import.ts`
- Modify: `apps/api/drizzle/meta/_journal.json`

- [ ] **Step 1: Write the migration SQL**

Create `apps/api/drizzle/0013_import_crawled_prompts.sql` exactly:

```sql
-- 0013_import_crawled_prompts.sql
-- prompt_images: allow remote-only images
ALTER TABLE "prompt_images"
  ALTER COLUMN "r2_account_id" DROP NOT NULL,
  ALTER COLUMN "r2_key"        DROP NOT NULL,
  ADD COLUMN  "remote_url"     text;

ALTER TABLE "prompt_images" DROP CONSTRAINT IF EXISTS "prompt_images_account_key_uq";

CREATE UNIQUE INDEX IF NOT EXISTS "prompt_images_account_key_uq"
  ON "prompt_images" ("r2_account_id", "r2_key")
  WHERE "r2_account_id" IS NOT NULL AND "r2_key" IS NOT NULL;

ALTER TABLE "prompt_images" ADD CONSTRAINT "prompt_images_storage_chk" CHECK (
  ("r2_account_id" IS NOT NULL AND "r2_key" IS NOT NULL) OR "remote_url" IS NOT NULL
);

-- prompts: source columns
ALTER TABLE "prompts"
  ADD COLUMN "external_id" text,
  ADD COLUMN "source_url"  text,
  ADD COLUMN "source_site" text;

CREATE UNIQUE INDEX IF NOT EXISTS "prompts_external_id_uq"
  ON "prompts" ("external_id") WHERE "external_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "prompts_source_site_idx"
  ON "prompts" ("source_site") WHERE "source_site" IS NOT NULL;

-- import_batches table
CREATE TABLE "import_batches" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "category_slug"       text NOT NULL,
  "source_file"         text NOT NULL,
  "total"               integer NOT NULL DEFAULT 0,
  "inserted"            integer NOT NULL DEFAULT 0,
  "skipped_duplicate"   integer NOT NULL DEFAULT 0,
  "failed"              integer NOT NULL DEFAULT 0,
  "failed_records"      jsonb   NOT NULL DEFAULT '[]'::jsonb,
  "status"              text    NOT NULL DEFAULT 'pending',
  "dry_run"             boolean NOT NULL DEFAULT false,
  "started_by"          uuid    REFERENCES "users"("id") ON DELETE SET NULL,
  "started_at"          timestamptz NOT NULL DEFAULT now(),
  "finished_at"         timestamptz
);

CREATE INDEX IF NOT EXISTS "import_batches_started_at_idx"
  ON "import_batches" ("started_at" DESC);
```

(Note: `prompt_source` enum extension lives in the apply script, NOT this SQL, because `ALTER TYPE … ADD VALUE` cannot run inside a transaction.)

- [ ] **Step 2: Write the apply script**

Create `apps/api/scripts/apply-0013-import.ts`. Follow the exact pattern of `apply-0011-original-prompt.ts` — read it first if you've never touched these scripts, the hash-recording bit needs to match:

```ts
/**
 * Apply migration 0013 (import crawled prompts).
 *
 * drizzle-kit migrate silently swallows new journal entries on Windows so we
 * apply the SQL ourselves and write the SHA256 into drizzle.__drizzle_migrations
 * by hand. Idempotent: re-running after success is a no-op.
 *
 * Special wrinkle: ALTER TYPE … ADD VALUE 'imported' cannot run inside the
 * BEGIN/COMMIT block, so we issue it as a standalone statement first.
 */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client.ts";

const TAG = "0013_import_crawled_prompts";
const SQL_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  `../drizzle/${TAG}.sql`,
);

async function main() {
  const body = await readFile(SQL_PATH, "utf8");
  const hash = createHash("sha256").update(body).digest("hex");

  // Skip if already recorded.
  const existing = await db.execute(sql`
    SELECT hash FROM drizzle.__drizzle_migrations WHERE hash = ${hash}
  `);
  if (existing.rows.length > 0) {
    console.log(`Migration ${TAG} already recorded, skipping.`);
    process.exit(0);
  }

  // 1. Extend the enum OUTSIDE any transaction. IF NOT EXISTS keeps this idempotent.
  console.log("Extending prompt_source enum with 'imported'...");
  await db.execute(sql`ALTER TYPE "prompt_source" ADD VALUE IF NOT EXISTS 'imported'`);

  // 2. Apply the rest inside a transaction.
  console.log(`Applying ${TAG}...`);
  await db.transaction(async (tx) => {
    // Drizzle's `db.execute` accepts the full multi-statement body — Postgres
    // parses on semicolons. If a statement fails the tx rolls back.
    await tx.execute(sql.raw(body));
  });

  // 3. Record in drizzle.__drizzle_migrations so drizzle-kit treats us as caught up.
  const createdAt = Date.now();
  await db.execute(sql`
    INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
    VALUES (${hash}, ${createdAt})
  `);

  console.log(`Migration ${TAG} applied.`);
  console.log(`Hash: ${hash}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 3: Update the drizzle journal**

Open `apps/api/drizzle/meta/_journal.json` and append an entry with idx 13. Match the shape of the idx-12 entry — copy the `when` field as `Date.now()` (just paste a fresh number, e.g. for now `1717880000000`):

```json
{
  "idx": 13,
  "version": "7",
  "when": 1717880000000,
  "tag": "0013_import_crawled_prompts",
  "breakpoints": true
}
```

- [ ] **Step 4: Apply the migration**

```bash
cd apps/api
pnpm exec tsx scripts/apply-0013-import.ts
```

Expected: `Migration 0013_import_crawled_prompts applied.` + a hash.

- [ ] **Step 5: Verify schema landed**

```bash
pnpm exec tsx -e "
import {db} from './src/db/client.ts';
import {sql} from 'drizzle-orm';
const r = await db.execute(sql\`
  SELECT column_name, is_nullable, data_type
  FROM information_schema.columns
  WHERE table_name='prompt_images' AND column_name IN ('r2_account_id','r2_key','remote_url')
  ORDER BY column_name
\`);
console.log('prompt_images cols:', r.rows);
const p = await db.execute(sql\`
  SELECT column_name FROM information_schema.columns
  WHERE table_name='prompts' AND column_name IN ('external_id','source_url','source_site')
  ORDER BY column_name
\`);
console.log('prompts cols:', p.rows);
const e = await db.execute(sql\`
  SELECT unnest(enum_range(NULL::prompt_source))::text AS v
\`);
console.log('prompt_source values:', e.rows);
const t = await db.execute(sql\`
  SELECT COUNT(*)::int AS n FROM information_schema.tables WHERE table_name='import_batches'
\`);
console.log('import_batches exists:', t.rows[0]);
process.exit(0);
"
```

Expected: `r2_account_id` and `r2_key` show `is_nullable='YES'`; `remote_url` exists; `external_id`/`source_url`/`source_site` exist; prompt_source has `'imported'` among its values; `import_batches` exists.

- [ ] **Step 6: Verify dev data intact**

```bash
pnpm exec tsx scripts/restore-user-prompt.ts
```

Expected: `Before` line shows `contributorId: '905af5ef-2fd0-4832-8cf1-d9c61f4abd72'`. If it shows null, STOP and investigate — the migration shouldn't have touched it.

Plus:

```bash
pnpm exec tsx -e "
import {db} from './src/db/client.ts';
import {sql} from 'drizzle-orm';
const r = await db.execute(sql\`SELECT name FROM r2_accounts WHERE name='dev-primary'\`);
console.log(r.rows);
process.exit(0);
"
```

Expected: one row `{name: 'dev-primary'}`.

- [ ] **Step 7: Commit**

```bash
cd /d/Image-Prompts
git add apps/api/drizzle/0013_import_crawled_prompts.sql apps/api/scripts/apply-0013-import.ts apps/api/drizzle/meta/_journal.json
git commit -m "$(cat <<'EOF'
db(import): migration 0013 — remote_url on prompt_images, source cols on prompts, import_batches

- prompt_images.r2_account_id/r2_key become nullable; new remote_url column.
  Partial unique on (account, key) keeps R2 identity intact; CHECK enforces
  at least one storage form per row.
- prompts gains external_id (unique-when-set), source_url, source_site.
- prompt_source enum extended with 'imported' (issued outside the tx).
- New import_batches table for per-category run tracking.
EOF
)"
```

---

## Task 2: Drizzle schema updates

**Files:**
- Modify: `apps/api/src/db/schema/images.ts`
- Modify: `apps/api/src/db/schema/prompts.ts`
- Create: `apps/api/src/db/schema/imports.ts`
- Modify: `apps/api/src/db/schema/index.ts`

- [ ] **Step 1: Update `images.ts`**

Open `apps/api/src/db/schema/images.ts`. The current shape is:

```ts
export const promptImages = pgTable(
  "prompt_images",
  {
    id: uuid().primaryKey().defaultRandom(),
    promptId: uuid("prompt_id").notNull(),
    r2AccountId: uuid("r2_account_id").notNull().references(() => r2Accounts.id),
    r2Key: text("r2_key").notNull(),
    order: integer().notNull().default(0),
    altText: text("alt_text"),
    width: integer(),
    height: integer(),
    lqip: text(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    promptOrderIdx: index("prompt_images_prompt_idx").on(t.promptId, t.order),
    keyUnique: unique("prompt_images_account_key_uq").on(t.r2AccountId, t.r2Key),
  }),
);
```

Change to:

```ts
export const promptImages = pgTable(
  "prompt_images",
  {
    id: uuid().primaryKey().defaultRandom(),
    promptId: uuid("prompt_id").notNull(),
    // Nullable now: imported prompts use remoteUrl instead of R2 storage.
    // The DB-side CHECK constraint enforces at least one of (r2 pair, remoteUrl).
    r2AccountId: uuid("r2_account_id").references(() => r2Accounts.id),
    r2Key: text("r2_key"),
    /** External CDN URL when the image isn't hosted on our R2. */
    remoteUrl: text("remote_url"),
    order: integer().notNull().default(0),
    altText: text("alt_text"),
    width: integer(),
    height: integer(),
    lqip: text(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    promptOrderIdx: index("prompt_images_prompt_idx").on(t.promptId, t.order),
    // Partial unique enforced by migration 0013 (Drizzle can't express WHERE
    // clauses on unique constraints — the SQL is the source of truth).
  }),
);
```

- [ ] **Step 2: Update `prompts.ts`**

Open `apps/api/src/db/schema/prompts.ts`. Find:

```ts
export const promptSourceEnum = pgEnum("prompt_source", ["site", "nanobanana_seed"]);
```

Change to:

```ts
export const promptSourceEnum = pgEnum("prompt_source", [
  "site",
  "nanobanana_seed",
  "imported",
]);
```

In the `prompts = pgTable(...)` block, after the existing `source: promptSourceEnum().notNull().default("site"),` line, add three columns at the same indentation:

```ts
    /** External record id when source='imported'. Unique-when-set so re-imports skip. */
    externalId: text("external_id"),
    /** URL of the original page the import came from (display + audit). */
    sourceUrl: text("source_url"),
    /** Human-facing label of the source site (e.g. "Liblib Inspiration"). */
    sourceSite: text("source_site"),
```

- [ ] **Step 3: Create the imports schema file**

Create `apps/api/src/db/schema/imports.ts`:

```ts
import { pgTable, uuid, text, integer, jsonb, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./auth.ts";

/** Status of a single import_batches run. */
export const IMPORT_BATCH_STATUSES = ["pending", "running", "done", "failed"] as const;
export type ImportBatchStatus = (typeof IMPORT_BATCH_STATUSES)[number];

export const importBatches = pgTable(
  "import_batches",
  {
    id: uuid().primaryKey().defaultRandom(),
    categorySlug: text("category_slug").notNull(),
    sourceFile: text("source_file").notNull(),
    total: integer().notNull().default(0),
    inserted: integer().notNull().default(0),
    skippedDuplicate: integer("skipped_duplicate").notNull().default(0),
    failed: integer().notNull().default(0),
    /**
     * Each entry: { line: number, externalId?: string, error: string }.
     * Capped at 50 entries by the import service.
     */
    failedRecords: jsonb("failed_records")
      .$type<Array<{ line: number; externalId?: string; error: string }>>()
      .notNull()
      .default([]),
    status: text().notNull().default("pending").$type<ImportBatchStatus>(),
    dryRun: boolean("dry_run").notNull().default(false),
    startedBy: uuid("started_by").references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => ({
    startedAtIdx: index("import_batches_started_at_idx").on(t.startedAt.desc()),
  }),
);
```

- [ ] **Step 4: Re-export from the schema barrel**

Open `apps/api/src/db/schema/index.ts` and add:

```ts
export * from "./imports.ts";
```

(Match where other re-exports like `./prompts.ts` live; alphabetical isn't required.)

- [ ] **Step 5: Typecheck**

```bash
cd /d/Image-Prompts && pnpm -F api typecheck
```

Expected: clean. If errors mention `promptImages.r2AccountId` being assumed non-null somewhere, hunt them down — they're real bugs the partial-nullability exposed. Don't widen types unless the call site genuinely allows null.

- [ ] **Step 6: Verify user data intact**

```bash
cd apps/api && pnpm exec tsx scripts/restore-user-prompt.ts
```

Same expected `Before` line as Task 1 Step 6.

- [ ] **Step 7: Commit**

```bash
cd /d/Image-Prompts
git add apps/api/src/db/schema/images.ts apps/api/src/db/schema/prompts.ts apps/api/src/db/schema/imports.ts apps/api/src/db/schema/index.ts
git commit -m "$(cat <<'EOF'
db(import): drizzle schema for remote_url + import_batches

Mirrors migration 0013 at the type layer so repo code can compile against the
new columns. promptImages.r2AccountId/r2Key become nullable; new remoteUrl.
prompts gains externalId/sourceUrl/sourceSite + 'imported' on the source enum.
New importBatches table with failedRecords jsonb cap (50 entries — service
enforces, not the DB).
EOF
)"
```

---

## Task 3: Tag slug helper

**Files:**
- Create: `apps/api/src/lib/tag-slug.ts`
- Create: `apps/api/src/lib/tag-slug.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/lib/tag-slug.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { tagSlugFromName } from "./tag-slug.ts";

describe("tagSlugFromName", () => {
  it("keeps Chinese characters as-is and lowercases ASCII", () => {
    expect(tagSlugFromName("摄影写真")).toBe("摄影写真");
    expect(tagSlugFromName("Realistic")).toBe("realistic");
    expect(tagSlugFromName("AI绘画")).toBe("ai绘画");
  });

  it("strips emoji prefixes and collapses spaces / punctuation to dashes", () => {
    expect(tagSlugFromName("🔥 Qwen · 爆款海报")).toBe("qwen-爆款海报");
    expect(tagSlugFromName("品牌及视觉设计")).toBe("品牌及视觉设计");
    expect(tagSlugFromName("Hello World")).toBe("hello-world");
  });

  it("falls back to t-<sha1[:8]> for degenerate input", () => {
    expect(tagSlugFromName("")).toMatch(/^t-[0-9a-f]{8}$/);
    expect(tagSlugFromName("   ")).toMatch(/^t-[0-9a-f]{8}$/);
    expect(tagSlugFromName("🔥🔥🔥")).toMatch(/^t-[0-9a-f]{8}$/);
  });

  it("is deterministic across runs", () => {
    const a = tagSlugFromName("Realistic");
    const b = tagSlugFromName("Realistic");
    expect(a).toBe(b);
  });

  it("trims leading and trailing dashes", () => {
    expect(tagSlugFromName("---hello---")).toBe("hello");
    expect(tagSlugFromName(".clean.")).toBe("clean");
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
cd apps/api && pnpm exec vitest run src/lib/tag-slug.test.ts
```

Expected: FAIL with "Cannot find module './tag-slug.ts'" or similar.

- [ ] **Step 3: Implement the helper**

Create `apps/api/src/lib/tag-slug.ts`:

```ts
import { createHash } from "node:crypto";

/**
 * Generate a slug for an imported tag name. Accepts ASCII and CJK characters;
 * strips emoji and control codepoints; collapses whitespace + punctuation
 * runs to single dashes. Falls back to a deterministic short hash for
 * degenerate input (empty after stripping).
 *
 * Used only by the import path. The owner-tag CRUD slug regex is unchanged
 * (`^[a-z0-9-]{1,40}$`) so manually-created tags still look clean.
 */
export function tagSlugFromName(name: string): string {
  const lowered = name.toLowerCase();
  // Strip emoji (presentation forms) and format-control characters.
  // \p{Emoji_Presentation} covers the common emoji set; \p{Cf} catches
  // bidi marks and other invisibles.
  const stripped = lowered.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}\p{Cf}]/gu, "");
  // Replace runs of whitespace + ASCII punctuation with a single dash.
  // We keep CJK punctuation out of the swap set so e.g. `品牌·视觉` becomes
  // `品牌-视觉` (the · is U+00B7 — ASCII-range punctuation).
  const dashed = stripped.replace(/[\s!-/:-@[-`{-~·]+/g, "-");
  const trimmed = dashed.replace(/^-+|-+$/g, "");
  if (trimmed.length === 0) {
    const h = createHash("sha1").update(name).digest("hex").slice(0, 8);
    return `t-${h}`;
  }
  return trimmed;
}
```

- [ ] **Step 4: Run the test, confirm it passes**

```bash
cd apps/api && pnpm exec vitest run src/lib/tag-slug.test.ts
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
cd /d/Image-Prompts
git add apps/api/src/lib/tag-slug.ts apps/api/src/lib/tag-slug.test.ts
git commit -m "feat(import): tagSlugFromName — CJK-safe slug derivation w/ hash fallback"
```

---

## Task 4: Import repository

**Files:**
- Create: `apps/api/src/repositories/imports.ts`
- Create: `apps/api/src/repositories/imports.test.ts`

This is the heaviest task. It's a single repo function + supporting types.

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/repositories/imports.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, like, inArray, sql } from "drizzle-orm";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { db } from "../db/client.ts";
import {
  prompts,
  promptImages,
  promptTags,
  tags,
  categories,
  importBatches,
} from "../db/schema/index.ts";
import { users } from "../db/schema/auth.ts";
import {
  importCategoryJsonl,
  listRecentImports,
} from "./imports.ts";

const PREFIX = "tw44r-";
let tmpDir: string;
let ownerId: string;

async function writeJsonl(name: string, records: unknown[]): Promise<string> {
  const path = join(tmpDir, name);
  await writeFile(path, records.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
  return path;
}

function makeRecord(overrides: Partial<{
  id: string; title: string; categorySlug: string; categoryName: string;
  promptZh: string; promptEn: string; imageUrl: string; sourceUrl: string;
  sourceSite: string; sourceId: string | number; normalizedTags: string[]; tags: string[];
}> = {}) {
  return {
    id: overrides.id ?? `${PREFIX}rec-${Math.random().toString(36).slice(2, 10)}`,
    title: overrides.title ?? "Test Title",
    category: {
      slug: overrides.categorySlug ?? `${PREFIX}cat-food`,
      name: overrides.categoryName ?? "测试美食",
    },
    normalized_tags: overrides.normalizedTags ?? [`${PREFIX}tag-realistic`, `${PREFIX}tag-摄影`],
    tags: overrides.tags ?? ["raw1", "raw2"],
    prompts: {
      zh: overrides.promptZh ?? "",
      en: overrides.promptEn ?? "A test prompt",
    },
    image_url: overrides.imageUrl ?? "https://example.com/test.jpg",
    source_url: overrides.sourceUrl ?? "https://example.com/source",
    source_site: overrides.sourceSite ?? "TestSite",
    source_id: overrides.sourceId ?? "src-1",
  };
}

beforeAll(async () => {
  tmpDir = join(tmpdir(), `tw44r-imports-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });
  const [u] = await db
    .insert(users)
    .values({ email: `${PREFIX}owner-${Date.now()}@example.com`, role: "admin" })
    .returning();
  ownerId = u!.id;
});

afterAll(async () => {
  await rm(tmpDir, { recursive: true, force: true });
  // FK chain: prompt_tags + prompt_images cascade off prompts; clean those first.
  const testPromptIds = (
    await db.select({ id: prompts.id }).from(prompts).where(like(prompts.externalId, `${PREFIX}%`))
  ).map((r) => r.id);
  if (testPromptIds.length > 0) {
    await db.delete(promptImages).where(inArray(promptImages.promptId, testPromptIds));
    await db.delete(promptTags).where(inArray(promptTags.promptId, testPromptIds));
    await db.delete(prompts).where(inArray(prompts.id, testPromptIds));
  }
  await db.delete(tags).where(like(tags.slug, `${PREFIX}%`));
  await db.delete(categories).where(like(categories.slug, `${PREFIX}%`));
  await db.delete(importBatches).where(like(importBatches.categorySlug, `${PREFIX}%`));
  await db.delete(users).where(eq(users.id, ownerId));
});

beforeEach(async () => {
  // Wipe between tests to keep counts predictable.
  const ids = (
    await db.select({ id: prompts.id }).from(prompts).where(like(prompts.externalId, `${PREFIX}%`))
  ).map((r) => r.id);
  if (ids.length > 0) {
    await db.delete(promptImages).where(inArray(promptImages.promptId, ids));
    await db.delete(promptTags).where(inArray(promptTags.promptId, ids));
    await db.delete(prompts).where(inArray(prompts.id, ids));
  }
  await db.delete(tags).where(like(tags.slug, `${PREFIX}%`));
  await db.delete(categories).where(like(categories.slug, `${PREFIX}%`));
  await db.delete(importBatches).where(like(importBatches.categorySlug, `${PREFIX}%`));
});

describe("importCategoryJsonl", () => {
  it("inserts a fresh record with category + tags + image", async () => {
    const file = await writeJsonl("single.jsonl", [makeRecord()]);
    const result = await importCategoryJsonl({
      filePath: file,
      categorySlug: `${PREFIX}cat-food`,
      startedBy: ownerId,
    });
    expect(result.inserted).toBe(1);
    expect(result.skippedDuplicate).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.status).toBe("done");

    const [p] = await db.select().from(prompts).where(like(prompts.externalId, `${PREFIX}%`));
    expect(p).toBeDefined();
    expect(p!.source).toBe("imported");
    expect(p!.sourceSite).toBe("TestSite");
    expect(p!.sourceUrl).toBe("https://example.com/source");

    const imgs = await db.select().from(promptImages).where(eq(promptImages.promptId, p!.id));
    expect(imgs).toHaveLength(1);
    expect(imgs[0]!.remoteUrl).toBe("https://example.com/test.jpg");
    expect(imgs[0]!.r2AccountId).toBeNull();
    expect(imgs[0]!.r2Key).toBeNull();

    const tagRows = await db.select().from(tags).where(like(tags.slug, `${PREFIX}%`));
    expect(tagRows.length).toBeGreaterThanOrEqual(2);
  });

  it("is idempotent on re-run (skipped_duplicate increments, no extra rows)", async () => {
    const rec = makeRecord();
    const file = await writeJsonl("dupe.jsonl", [rec]);
    await importCategoryJsonl({
      filePath: file, categorySlug: `${PREFIX}cat-food`, startedBy: ownerId,
    });
    const second = await importCategoryJsonl({
      filePath: file, categorySlug: `${PREFIX}cat-food`, startedBy: ownerId,
    });
    expect(second.inserted).toBe(0);
    expect(second.skippedDuplicate).toBe(1);
    const all = await db.select().from(prompts).where(like(prompts.externalId, `${PREFIX}%`));
    expect(all).toHaveLength(1);
  });

  it("dry-run does NOT write any rows", async () => {
    const file = await writeJsonl("dry.jsonl", [makeRecord(), makeRecord()]);
    const result = await importCategoryJsonl({
      filePath: file, categorySlug: `${PREFIX}cat-food`, startedBy: ownerId, dryRun: true,
    });
    expect(result.inserted).toBe(2);
    expect(result.dryRun).toBe(true);

    const all = await db.select().from(prompts).where(like(prompts.externalId, `${PREFIX}%`));
    expect(all).toHaveLength(0);
    const cats = await db.select().from(categories).where(like(categories.slug, `${PREFIX}%`));
    expect(cats).toHaveLength(0);
    // import_batches row IS written (with dry_run=true) so the audit feed sees it.
    const batch = await db.select().from(importBatches).where(like(importBatches.categorySlug, `${PREFIX}%`));
    expect(batch).toHaveLength(1);
    expect(batch[0]!.dryRun).toBe(true);
  });

  it("limit caps processed lines", async () => {
    const file = await writeJsonl("limited.jsonl", [
      makeRecord({ id: `${PREFIX}a` }),
      makeRecord({ id: `${PREFIX}b` }),
      makeRecord({ id: `${PREFIX}c` }),
    ]);
    const result = await importCategoryJsonl({
      filePath: file, categorySlug: `${PREFIX}cat-food`, startedBy: ownerId, limit: 2,
    });
    expect(result.total).toBe(2);
    expect(result.inserted).toBe(2);
    const all = await db.select().from(prompts).where(like(prompts.externalId, `${PREFIX}%`));
    expect(all).toHaveLength(2);
  });

  it("coerces numeric source_id to string", async () => {
    const file = await writeJsonl("numeric.jsonl", [
      makeRecord({ sourceId: 12345 as unknown as string }),
    ]);
    const result = await importCategoryJsonl({
      filePath: file, categorySlug: `${PREFIX}cat-food`, startedBy: ownerId,
    });
    expect(result.inserted).toBe(1);
    // The repo stores source_id inside the external_id derivation path; just
    // verify the record inserted at all (no error).
  });

  it("records failed_records when a line is unparseable, continues with the rest", async () => {
    const goodA = makeRecord();
    const goodB = makeRecord();
    const path = join(tmpDir, "mixed.jsonl");
    await writeFile(
      path,
      [JSON.stringify(goodA), "not-json", JSON.stringify(goodB)].join("\n") + "\n",
      "utf8",
    );
    const result = await importCategoryJsonl({
      filePath: path, categorySlug: `${PREFIX}cat-food`, startedBy: ownerId,
    });
    expect(result.inserted).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.failedRecords).toHaveLength(1);
    expect(result.failedRecords[0]!.line).toBe(2);
  });

  it("listRecentImports returns rows newest-first", async () => {
    const file = await writeJsonl("recent.jsonl", [makeRecord()]);
    await importCategoryJsonl({
      filePath: file, categorySlug: `${PREFIX}cat-recent-a`, startedBy: ownerId,
    });
    await importCategoryJsonl({
      filePath: file, categorySlug: `${PREFIX}cat-recent-b`, startedBy: ownerId,
    });
    const list = await listRecentImports({ limit: 10 });
    const ourPair = list.filter((r) => r.categorySlug.startsWith(`${PREFIX}cat-recent`));
    expect(ourPair).toHaveLength(2);
    expect(ourPair[0]!.categorySlug.endsWith("recent-b")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
cd apps/api && pnpm exec vitest run src/repositories/imports.test.ts
```

Expected: FAIL with "Cannot find module './imports.ts'".

- [ ] **Step 3: Implement the repository**

Create `apps/api/src/repositories/imports.ts`:

```ts
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  prompts,
  promptImages,
  promptTags,
  tags,
  categories,
  importBatches,
  type ImportBatchStatus,
} from "../db/schema/index.ts";
import { tagSlugFromName } from "../lib/tag-slug.ts";

// ── Wire-format validation ───────────────────────────────────────────────
//
// Mirrors IMPORT_GUIDE.md §4-5. source_id may be number on input — we coerce
// before validation finishes.

const RawRecordSchema = z
  .object({
    id: z.string().min(1).max(128),
    title: z.string().min(1).max(255),
    category: z.object({
      slug: z.string().min(1).max(64),
      name: z.string().min(1).max(64),
    }),
    normalized_tags: z.array(z.string()).min(1).max(32),
    tags: z.array(z.string()),
    prompts: z.object({
      zh: z.string().default(""),
      en: z.string().default(""),
    }),
    image_url: z.string().url().refine((s) => s.startsWith("http"), "must be http(s)"),
    source_url: z.string().url(),
    source_site: z.string().min(1).max(128),
    source_id: z.union([z.string(), z.number()]).transform((v) => String(v)),
  })
  .refine(
    (v) => v.prompts.zh.length > 0 || v.prompts.en.length > 0,
    { message: "prompts.zh and prompts.en both empty" },
  );

export type ImportRawRecord = z.infer<typeof RawRecordSchema>;

// ── Public API ────────────────────────────────────────────────────────────

export type ImportCategoryArgs = {
  /** Absolute path to the JSONL file. */
  filePath: string;
  /** Category slug to attribute the batch to (also used to upsert the category row). */
  categorySlug: string;
  /** User id triggering the import (audit). */
  startedBy: string;
  /** When true, parse + count + record the batch row, but write no prompt rows. */
  dryRun?: boolean;
  /** Stop after this many lines. Used by the admin "试导入" button. */
  limit?: number;
};

export type ImportCategoryResult = {
  batchId: string;
  status: ImportBatchStatus;
  dryRun: boolean;
  total: number;
  inserted: number;
  skippedDuplicate: number;
  failed: number;
  failedRecords: Array<{ line: number; externalId?: string; error: string }>;
};

const MAX_FAILED_RECORDS = 50;

/**
 * Stream-parse a single category's JSONL file and upsert records. Idempotent on
 * (prompts.external_id) — re-running skips records that already inserted.
 *
 * Implementation choices:
 *
 *   - Streaming via createReadStream + readline so we never buffer the whole
 *     file. Even the biggest file (graphic_design at 10.57 MB) finishes quickly.
 *   - In-memory caches (categoryIdBySlug + tagIdBySlug) so we don't requery for
 *     every record. The cache lives for one call.
 *   - INSERT … ON CONFLICT (external_id) DO NOTHING for the prompts row. When
 *     RETURNING returns 0 rows we treat it as skipped_duplicate.
 *   - Tags + categories are UPSERTed lazily: a tag never seen before triggers
 *     an INSERT … ON CONFLICT (slug) DO NOTHING, then a SELECT to grab the id.
 *   - failed_records is capped at MAX_FAILED_RECORDS entries to keep jsonb sane.
 *
 * Dry-run skips ALL writes EXCEPT the import_batches row itself (so the audit
 * feed records the dry-run attempt + its preview counts).
 */
export async function importCategoryJsonl(
  args: ImportCategoryArgs,
): Promise<ImportCategoryResult> {
  const dryRun = args.dryRun ?? false;
  const limit = args.limit ?? Infinity;

  const [batch] = await db
    .insert(importBatches)
    .values({
      categorySlug: args.categorySlug,
      sourceFile: args.filePath,
      status: "running" as const,
      dryRun,
      startedBy: args.startedBy,
    })
    .returning();
  const batchId = batch!.id;

  const counters = {
    total: 0,
    inserted: 0,
    skippedDuplicate: 0,
    failed: 0,
  };
  const failedRecords: Array<{ line: number; externalId?: string; error: string }> = [];
  const categoryIdBySlug = new Map<string, string>();
  const tagIdBySlug = new Map<string, string>();

  try {
    const stream = createReadStream(args.filePath, { encoding: "utf8" });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    let lineNo = 0;
    for await (const rawLine of rl) {
      lineNo += 1;
      if (counters.total >= limit) break;
      if (rawLine.trim() === "") continue;
      counters.total += 1;

      let parsed: unknown;
      try {
        parsed = JSON.parse(rawLine);
      } catch (e) {
        counters.failed += 1;
        if (failedRecords.length < MAX_FAILED_RECORDS) {
          failedRecords.push({
            line: lineNo,
            error: `json_parse: ${(e as Error).message}`,
          });
        }
        continue;
      }

      const result = RawRecordSchema.safeParse(parsed);
      if (!result.success) {
        counters.failed += 1;
        if (failedRecords.length < MAX_FAILED_RECORDS) {
          failedRecords.push({
            line: lineNo,
            externalId: (parsed as { id?: string }).id,
            error: `validate: ${result.error.issues[0]?.message ?? "unknown"}`,
          });
        }
        continue;
      }

      const rec = result.data;
      if (dryRun) {
        counters.inserted += 1;
        continue;
      }

      try {
        await insertOne(rec, categoryIdBySlug, tagIdBySlug);
        counters.inserted += 1;
      } catch (e) {
        if (isDuplicateExternalId(e)) {
          counters.skippedDuplicate += 1;
        } else {
          counters.failed += 1;
          if (failedRecords.length < MAX_FAILED_RECORDS) {
            failedRecords.push({
              line: lineNo,
              externalId: rec.id,
              error: `insert: ${(e as Error).message}`,
            });
          }
        }
      }
    }

    await db
      .update(importBatches)
      .set({
        status: "done" as const,
        total: counters.total,
        inserted: counters.inserted,
        skippedDuplicate: counters.skippedDuplicate,
        failed: counters.failed,
        failedRecords,
        finishedAt: new Date(),
      })
      .where(eq(importBatches.id, batchId));

    return {
      batchId,
      status: "done",
      dryRun,
      ...counters,
      failedRecords,
    };
  } catch (e) {
    await db
      .update(importBatches)
      .set({
        status: "failed" as const,
        total: counters.total,
        inserted: counters.inserted,
        skippedDuplicate: counters.skippedDuplicate,
        failed: counters.failed,
        failedRecords,
        finishedAt: new Date(),
      })
      .where(eq(importBatches.id, batchId));
    throw e;
  }
}

function isDuplicateExternalId(e: unknown): boolean {
  const code = (e as { code?: string }).code;
  return code === "23505";
}

async function insertOne(
  rec: ImportRawRecord,
  categoryIdBySlug: Map<string, string>,
  tagIdBySlug: Map<string, string>,
): Promise<void> {
  // 1. Resolve the category id (UPSERT by slug if first encounter).
  const catSlug = rec.category.slug;
  let catId = categoryIdBySlug.get(catSlug);
  if (!catId) {
    catId = await upsertCategory(catSlug, rec.category.name);
    categoryIdBySlug.set(catSlug, catId);
  }

  // 2. Resolve tag ids (UPSERT each).
  const tagSlugs = rec.normalized_tags.map(tagSlugFromName);
  const tagPairs: Array<{ slug: string; name: string }> = [];
  for (let i = 0; i < tagSlugs.length; i++) {
    const slug = tagSlugs[i]!;
    const name = rec.normalized_tags[i]!;
    tagPairs.push({ slug, name });
  }
  const tagIds: string[] = [];
  for (const pair of tagPairs) {
    let id = tagIdBySlug.get(pair.slug);
    if (!id) {
      id = await upsertTag(pair.slug, pair.name);
      tagIdBySlug.set(pair.slug, id);
    }
    if (!tagIds.includes(id)) tagIds.push(id);
  }

  // 3. Insert the prompt row. ON CONFLICT (external_id) DO NOTHING returns 0
  //    rows when this id was already imported; the caller surfaces that as
  //    `skipped_duplicate`.
  const titleBilingual: { zh?: string; en?: string } = {};
  if (hasContent(rec.prompts.zh) || hasContent(rec.title)) titleBilingual.zh = rec.title;
  titleBilingual.en = rec.title;
  const promptBilingual: { zh?: string; en?: string } = {};
  if (hasContent(rec.prompts.zh)) promptBilingual.zh = rec.prompts.zh;
  if (hasContent(rec.prompts.en)) promptBilingual.en = rec.prompts.en;

  const slugBase = await ensureUniqueSlug(rec.title, rec.id);

  const inserted = await db
    .insert(prompts)
    .values({
      slug: slugBase,
      source: "imported",
      title: titleBilingual,
      prompt: promptBilingual,
      categoryId: catId,
      externalId: rec.id,
      sourceUrl: rec.source_url,
      sourceSite: rec.source_site,
      approvedAt: new Date(),
    })
    .onConflictDoNothing({ target: prompts.externalId })
    .returning({ id: prompts.id });

  if (inserted.length === 0) {
    // Already imported — surface as a duplicate by re-throwing a fake 23505.
    const err = new Error("duplicate external_id");
    (err as { code?: string }).code = "23505";
    throw err;
  }

  const promptId = inserted[0]!.id;

  // 4. Insert the prompt image (remote_url path).
  await db.insert(promptImages).values({
    promptId,
    remoteUrl: rec.image_url,
    order: 0,
  });

  // 5. Insert prompt_tags + bump usage_count.
  if (tagIds.length > 0) {
    await db.insert(promptTags).values(
      tagIds.map((tagId) => ({ promptId, tagId })),
    );
    await db
      .update(tags)
      .set({ usageCount: sql`${tags.usageCount} + 1` })
      .where(sql`${tags.id} = ANY(${tagIds})`);
  }
}

async function upsertCategory(slug: string, displayName: string): Promise<string> {
  await db
    .insert(categories)
    .values({
      slug,
      name: { zh: displayName, en: displayName },
    })
    .onConflictDoNothing({ target: categories.slug });
  const [row] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(eq(categories.slug, slug))
    .limit(1);
  return row!.id;
}

async function upsertTag(slug: string, displayName: string): Promise<string> {
  await db
    .insert(tags)
    .values({
      slug,
      name: { zh: displayName, en: displayName },
    })
    .onConflictDoNothing({ target: tags.slug });
  const [row] = await db
    .select({ id: tags.id })
    .from(tags)
    .where(eq(tags.slug, slug))
    .limit(1);
  return row!.id;
}

function hasContent(s: string | undefined): boolean {
  return typeof s === "string" && s.trim().length > 0;
}

async function ensureUniqueSlug(title: string, externalId: string): Promise<string> {
  // We don't want to round-trip per record looking for collisions — the
  // external_id is unique so it's a safe disambiguator suffix.
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "prompt";
  const suffix = externalId.slice(-8);
  return `${base}-${suffix}`;
}

// ── Listing for the admin history table ─────────────────────────────────

export type ListImportsArgs = { limit?: number };

export type ImportBatchRow = {
  id: string;
  categorySlug: string;
  sourceFile: string;
  total: number;
  inserted: number;
  skippedDuplicate: number;
  failed: number;
  failedRecords: Array<{ line: number; externalId?: string; error: string }>;
  status: ImportBatchStatus;
  dryRun: boolean;
  startedBy: string | null;
  startedAt: string;
  finishedAt: string | null;
};

export async function listRecentImports(
  args: ListImportsArgs = {},
): Promise<ImportBatchRow[]> {
  const limit = Math.min(args.limit ?? 50, 100);
  const rows = await db
    .select()
    .from(importBatches)
    .orderBy(desc(importBatches.startedAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    categorySlug: r.categorySlug,
    sourceFile: r.sourceFile,
    total: r.total,
    inserted: r.inserted,
    skippedDuplicate: r.skippedDuplicate,
    failed: r.failed,
    failedRecords: r.failedRecords,
    status: r.status,
    dryRun: r.dryRun,
    startedBy: r.startedBy,
    startedAt: r.startedAt.toISOString(),
    finishedAt: r.finishedAt ? r.finishedAt.toISOString() : null,
  }));
}
```

- [ ] **Step 4: Run the tests, confirm they pass**

```bash
cd apps/api && pnpm exec vitest run src/repositories/imports.test.ts
```

Expected: 7 passed. If any individual test fails, fix it before moving on.

- [ ] **Step 5: Verify dev data intact**

```bash
pnpm exec tsx scripts/restore-user-prompt.ts
```

Same expected: `Before` line shows `contributor_id` of `905af5ef-...`.

- [ ] **Step 6: Commit**

```bash
cd /d/Image-Prompts
git add apps/api/src/repositories/imports.ts apps/api/src/repositories/imports.test.ts
git commit -m "$(cat <<'EOF'
feat(import): importCategoryJsonl repo — stream JSONL → prompts + images + tags

- Stream parsing via createReadStream + readline (no full-file buffering)
- ON CONFLICT (external_id) DO NOTHING for idempotent re-runs
- categories/tags upserted lazily with per-call in-memory caches
- Numeric source_id coerced to string (AI2Image's 1913 records)
- dry-run records the batch row but writes no prompts (preview-only)
- failed_records capped at 50 entries; runtime exception flips status='failed'
EOF
)"
```

---

## Task 5: CLI script for ad-hoc imports

**Files:**
- Create: `apps/api/scripts/import-prompts.ts`

- [ ] **Step 1: Write the CLI**

Create `apps/api/scripts/import-prompts.ts`:

```ts
/**
 * Import crawled prompts from G:\promptsandimages\exports\by_category\<slug>.jsonl
 * into the dev DB. Owner runs this for ad-hoc imports; the admin /rosekhlifa/import
 * page does the same thing via the API.
 *
 * Examples:
 *   pnpm exec tsx scripts/import-prompts.ts food
 *   pnpm exec tsx scripts/import-prompts.ts food --dry-run --limit 10
 *   pnpm exec tsx scripts/import-prompts.ts --all
 *
 * Reads the data root from site_settings['import.data_root'], falling back to
 * G:\\promptsandimages. The manifest at <root>/exports/manifest.json drives the
 * category → file mapping.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client.ts";
import { users } from "../src/db/schema/auth.ts";
import { getSetting } from "../src/repositories/site-settings.ts";
import { importCategoryJsonl } from "../src/repositories/imports.ts";

type Manifest = {
  categories: Array<{ slug: string; name: string; count: number; jsonl: string }>;
};

const DEFAULT_ROOT = "G:\\promptsandimages";

async function findOwnerId(): Promise<string> {
  // Use the first admin user we find as the audit actor for CLI runs.
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1);
  if (!u) throw new Error("No admin user found — cannot record import audit");
  return u.id;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : undefined;
  const all = args.includes("--all");
  const positional = args.filter((a) => !a.startsWith("--"));

  const dataRoot = (await getSetting("import.data_root")) ?? DEFAULT_ROOT;
  const manifestPath = resolve(dataRoot as string, "exports/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;

  let slugs: string[];
  if (all) {
    // Run smallest first so failures surface fast.
    slugs = manifest.categories
      .slice()
      .sort((a, b) => a.count - b.count)
      .map((c) => c.slug);
  } else if (positional.length > 0) {
    slugs = positional;
  } else {
    console.error("Usage: import-prompts <slug> [--dry-run] [--limit=N]");
    console.error("       import-prompts --all [--dry-run] [--limit=N]");
    process.exit(1);
  }

  const ownerId = await findOwnerId();
  const summary: Array<{ slug: string; inserted: number; skipped: number; failed: number }> = [];

  for (const slug of slugs) {
    const entry = manifest.categories.find((c) => c.slug === slug);
    if (!entry) {
      console.error(`Skipping unknown category slug: ${slug}`);
      continue;
    }
    const filePath = resolve(dataRoot as string, entry.jsonl);
    console.log(`\n=== ${slug} (${entry.name}, ${entry.count} records) ===`);
    console.log(`File: ${filePath}`);
    console.log(`Mode: ${dryRun ? "DRY-RUN" : "LIVE"}${limit ? ` (limit ${limit})` : ""}`);
    const result = await importCategoryJsonl({
      filePath,
      categorySlug: slug,
      startedBy: ownerId,
      ...(dryRun ? { dryRun: true } : {}),
      ...(limit ? { limit } : {}),
    });
    console.log(
      `Done: ${result.inserted} inserted, ${result.skippedDuplicate} skipped, ${result.failed} failed`,
    );
    summary.push({
      slug,
      inserted: result.inserted,
      skipped: result.skippedDuplicate,
      failed: result.failed,
    });
  }

  console.log("\n=== Summary ===");
  for (const s of summary) {
    console.log(`  ${s.slug.padEnd(28)} +${s.inserted.toString().padStart(5)}  ~${s.skipped.toString().padStart(5)}  !${s.failed.toString().padStart(3)}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Smoke-run on the smallest real category (dry-run, limit 5)**

```bash
cd apps/api
pnpm exec tsx scripts/import-prompts.ts food --dry-run --limit=5
```

Expected output: ~5 records processed, "DRY-RUN" mode, `+5 inserted ~0 skipped !0 failed`, no actual DB writes (verify by Step 3 below).

- [ ] **Step 3: Verify dry-run wrote zero prompt rows**

```bash
pnpm exec tsx -e "
import {db} from './src/db/client.ts';
import {prompts} from './src/db/schema/index.ts';
import {eq} from 'drizzle-orm';
const r = await db.select().from(prompts).where(eq(prompts.source, 'imported'));
console.log('imported prompts:', r.length);
process.exit(0);
"
```

Expected: `imported prompts: 0`.

- [ ] **Step 4: Real run on food (51 records)**

```bash
pnpm exec tsx scripts/import-prompts.ts food
```

Expected: `+51 inserted ~0 skipped !0 failed`.

- [ ] **Step 5: Re-run to verify idempotency**

```bash
pnpm exec tsx scripts/import-prompts.ts food
```

Expected: `+0 inserted ~51 skipped !0 failed`.

- [ ] **Step 6: Verify dev data intact**

```bash
pnpm exec tsx scripts/restore-user-prompt.ts
```

Same expected `Before` line.

- [ ] **Step 7: Commit**

```bash
cd /d/Image-Prompts
git add apps/api/scripts/import-prompts.ts
git commit -m "feat(import): CLI script — pnpm exec tsx scripts/import-prompts.ts <slug>"
```

---

## Task 6: Frontend resolveImageUrl + PromptCard source chip

**Files:**
- Modify: `apps/web/src/lib/imageUrl.ts`
- Modify: `apps/web/src/lib/imageUrl.test.ts`
- Modify: `apps/web/src/components/PromptCard.tsx`
- Modify: `packages/shared/src/types/domain.ts`

- [ ] **Step 1: Inspect current `resolveImageUrl` and `PromptSummary`**

```bash
cd /d/Image-Prompts
cat apps/web/src/lib/imageUrl.ts
cat packages/shared/src/types/domain.ts | sed -n '50,90p'
```

Read these into your context. You need to know the exact PromptSummary shape so you can extend it minimally.

- [ ] **Step 2: Extend the shared `PromptSummary` type**

Open `packages/shared/src/types/domain.ts`. In the `PromptSummary` block (lines ~50-83), after the `primaryImage` block, add inside the type:

```ts
  /**
   * When set, the primaryImage may carry a remoteUrl instead of an R2 ref.
   * Surfaces on cards as a small "来源 · {site}" chip + source_url link.
   */
  sourceSite?: string;
  sourceUrl?: string;
```

Then find the `primaryImage` shape — it's:

```ts
  primaryImage: {
    r2AccountId: string;
    r2Key: string;
    width: number | null;
    height: number | null;
    lqip: string | null;
  } | null;
```

Change `r2AccountId` and `r2Key` to nullable + add `remoteUrl`:

```ts
  primaryImage: {
    r2AccountId: string | null;
    r2Key: string | null;
    remoteUrl: string | null;
    width: number | null;
    height: number | null;
    lqip: string | null;
  } | null;
```

- [ ] **Step 3: Update the matching zod schema**

Open `packages/shared/src/schemas/prompt.ts`. Find the primary image sub-schema (it appears inside the `PromptSummarySchema` definition — search for `r2AccountId`). Match the type changes:

```ts
// Before:
//   primaryImage: z.object({
//     r2AccountId: UuidSchema,
//     r2Key: z.string(),
//     width: z.number().nullable(),
//     height: z.number().nullable(),
//     lqip: z.string().nullable(),
//   }).nullable(),

// After:
  primaryImage: z.object({
    r2AccountId: UuidSchema.nullable(),
    r2Key: z.string().nullable(),
    remoteUrl: z.string().nullable(),
    width: z.number().nullable(),
    height: z.number().nullable(),
    lqip: z.string().nullable(),
  }).nullable(),
```

In `PromptSummarySchema`, after `primaryImage`, add:

```ts
  sourceSite: z.string().optional(),
  sourceUrl: z.string().url().optional(),
```

- [ ] **Step 4: Write failing tests for `resolveImageUrl`**

Open `apps/web/src/lib/imageUrl.test.ts`. After the existing tests, add:

```ts
it("returns the remote URL when remoteUrl is set", () => {
  const url = resolveImageUrl(
    { r2AccountId: null, r2Key: null, remoteUrl: "https://cdn.example.com/a.jpg" },
    new Map(),
  );
  expect(url).toBe("https://cdn.example.com/a.jpg");
});

it("prefers remoteUrl over a stale R2 pair (defensive)", () => {
  const url = resolveImageUrl(
    {
      r2AccountId: "00000000-0000-0000-0000-000000000001",
      r2Key: "prompts/foo.jpg",
      remoteUrl: "https://cdn.example.com/b.jpg",
    },
    new Map(),
  );
  expect(url).toBe("https://cdn.example.com/b.jpg");
});
```

- [ ] **Step 5: Run the tests, confirm they fail**

```bash
pnpm -F web exec vitest run src/lib/imageUrl.test.ts
```

Expected: 2 fails ("Cannot read properties of null", or similar — depends on current impl).

- [ ] **Step 6: Update `resolveImageUrl`**

Open `apps/web/src/lib/imageUrl.ts`. Find the function (it's small — probably under 30 lines). Change the signature to accept the new shape and short-circuit on remoteUrl:

```ts
export function resolveImageUrl(
  image: {
    r2AccountId: string | null;
    r2Key: string | null;
    remoteUrl?: string | null;
  },
  r2Map: Map<string, { publicUrl: string }>,
): string {
  // Imported prompts carry a remote CDN URL — use it verbatim.
  if (image.remoteUrl) return image.remoteUrl;
  if (!image.r2AccountId || !image.r2Key) return "";
  const account = r2Map.get(image.r2AccountId);
  if (!account) return "";
  return `${account.publicUrl.replace(/\/$/, "")}/${image.r2Key}`;
}
```

(Adjust the existing implementation's interior URL-building to whatever pattern is already there — preserve it. The key change is the remoteUrl short-circuit + nullable inputs.)

Update call sites: search for `resolveImageUrl(` and follow up any TypeScript errors. The shape change should make Tsc complain at any caller that hardcoded non-null `r2AccountId` / `r2Key`.

```bash
cd /d/Image-Prompts && pnpm -F web typecheck
```

Expected: clean. Fix any TS errors in caller files by either narrowing with `if` or passing through the wider shape.

- [ ] **Step 7: Run the tests, confirm they pass**

```bash
pnpm -F web exec vitest run src/lib/imageUrl.test.ts
```

Expected: all (existing + 2 new) pass.

- [ ] **Step 8: Add the source-attribution chip to PromptCard**

Open `apps/web/src/components/PromptCard.tsx`. Find the area where `contributor` is rendered (avatar + name). Replace the current "render contributor or anonymous" branch with:

```tsx
{prompt.contributor ? (
  <Link to={withLocale(locale, `/users/${prompt.contributor.id}`)} className="flex items-center gap-1.5 hover:underline">
    <Avatar id={prompt.contributor.id} name={prompt.contributor.name} src={prompt.contributor.avatarUrl} size={20} />
    <span className="truncate text-[11px] text-ink-muted">
      {prompt.contributor.name ?? t("common.anonymous")}
    </span>
  </Link>
) : prompt.sourceSite ? (
  <a
    href={prompt.sourceUrl ?? "#"}
    target="_blank"
    rel="noopener noreferrer"
    className="inline-flex items-center gap-1 rounded-pill border border-border-soft bg-surface px-2 py-0.5 text-[10.5px] text-ink-muted hover:text-ink"
    aria-label={t("card.source_chip_aria", { site: prompt.sourceSite })}
  >
    <ExternalLink size={10} aria-hidden />
    {t("card.source_chip", { site: prompt.sourceSite })}
  </a>
) : (
  <span className="text-[11px] text-ink-dim">{t("common.anonymous")}</span>
)}
```

(Match the surrounding style — the snippet above assumes existing imports for `Link`, `useTranslation`, `withLocale`, `Avatar`. Import `ExternalLink` from `lucide-react`.)

- [ ] **Step 9: Add the i18n keys**

In `apps/web/src/i18n/locales/zh.json`, add to the existing `"card"` namespace (or create it if it doesn't exist — search first):

```json
    "source_chip": "来源 · {site}",
    "source_chip_aria": "Open source page on {site}"
```

In `apps/web/src/i18n/locales/en.json`:

```json
    "source_chip": "From {site}",
    "source_chip_aria": "Open source page on {site}"
```

- [ ] **Step 10: Typecheck + web test baseline**

```bash
cd /d/Image-Prompts
pnpm -F web typecheck
pnpm -F web test --run
pnpm -F web build
```

Expected: clean across the board.

- [ ] **Step 11: Update API projections so the new shape ships to the wire**

Search for `primaryImage` in the API code:

```bash
grep -rn "primaryImage" apps/api/src | grep -v "test"
```

You'll find the projection in `apps/api/src/repositories/prompts.ts` (listPrompts + getPromptBySlug), `apps/api/src/repositories/users-public.ts` (listUserPrompts, listUserFavorites, getPinnedPromptsForUser), and `apps/api/src/repositories/owner-prompts.ts` (listAllPromptsForOwner). For every place that builds a `primaryImage: { r2AccountId, r2Key, width, height, lqip }` object, ADD `remoteUrl: img.remoteUrl ?? null` to the shape. The Drizzle row already has it; you just need to surface it. Example pattern:

```ts
primaryImage: img
  ? {
      r2AccountId: img.r2AccountId,
      r2Key: img.r2Key,
      remoteUrl: img.remoteUrl,
      width: img.width,
      height: img.height,
      lqip: img.lqip,
    }
  : null,
```

Same for the multi-image `images: ...` arrays in `getPromptBySlug` and `getPromptForOwner`. Don't forget to include `remoteUrl` in the SELECT projection at the top of those functions (the SELECT object usually lists each column; add `remoteUrl: promptImages.remoteUrl`).

For `listPrompts` (the main browsing endpoint), also add `sourceSite` + `sourceUrl` to the SELECT and the response item. Match:

```ts
// In the SELECT object:
  sourceSite: prompts.sourceSite,
  sourceUrl: prompts.sourceUrl,

// In the returned item:
  ...(r.sourceSite ? { sourceSite: r.sourceSite } : {}),
  ...(r.sourceUrl ? { sourceUrl: r.sourceUrl } : {}),
```

Same in `getPromptBySlug`. The other repos (user-public, owner-prompts) can pass through too, but at minimum `listPrompts` + `getPromptBySlug` are required for the public-facing surface to work.

- [ ] **Step 12: Final typecheck + tests**

```bash
cd /d/Image-Prompts
pnpm -F api typecheck
pnpm -F web typecheck
pnpm -F api exec vitest run src/repositories/prompts.test.ts src/routes/prompts.test.ts
pnpm -F web test --run
pnpm -F web build
```

Expected: api typecheck clean; web typecheck clean; relevant api tests pass (existing baseline — don't break them); web baseline 58/58; build clean.

- [ ] **Step 13: Verify dev data intact**

```bash
cd apps/api && pnpm exec tsx scripts/restore-user-prompt.ts
```

Same expected `Before` line.

- [ ] **Step 14: Commit**

```bash
cd /d/Image-Prompts
git add apps/web/src/lib/imageUrl.ts apps/web/src/lib/imageUrl.test.ts apps/web/src/components/PromptCard.tsx packages/shared/src/types/domain.ts packages/shared/src/schemas/prompt.ts apps/web/src/i18n/locales/{zh,en}.json apps/api/src/repositories/prompts.ts apps/api/src/repositories/users-public.ts apps/api/src/repositories/owner-prompts.ts
git commit -m "$(cat <<'EOF'
feat(import): render remote images + source-attribution chip on PromptCard

- resolveImageUrl short-circuits on remoteUrl (imported prompts) and is now
  null-safe on the r2 pair
- PromptCard shows "来源 · {site}" chip linking to source_url when the prompt
  has no contributor but does have source_site (i.e. imported)
- PromptSummary type + zod schema gain sourceSite/sourceUrl + nullable r2 cols
- listPrompts / getPromptBySlug / listUserPrompts / listUserFavorites /
  getPinnedPromptsForUser / listAllPromptsForOwner all surface remoteUrl +
  sourceSite + sourceUrl when present
EOF
)"
```

---

## Task 7: Owner imports page + endpoints

**Files:**
- Modify: `apps/api/src/routes/owner.ts`
- Modify: `apps/api/src/routes/owner.test.ts`
- Create: `apps/web/src/lib/hooks/useOwnerImports.ts`
- Create: `apps/web/src/pages/owner/ImportPage.tsx`
- Modify: `apps/web/src/components/owner/OwnerSidebar.tsx`
- Modify: `apps/web/src/components/owner/OwnerTopbar.tsx`
- Modify: `apps/web/src/routes/index.tsx`
- Modify: `apps/web/src/i18n/locales/{zh,en}.json`

- [ ] **Step 1: Add the API endpoints**

In `apps/api/src/routes/owner.ts`, add new imports at the top:

```ts
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";
import {
  importCategoryJsonl,
  listRecentImports,
} from "../repositories/imports.ts";
import { getSetting } from "../repositories/site-settings.ts";
```

Then at the end of the file (before `export default app;`), append:

```ts
// ── Imports (crawled-prompt ingestion) ───────────────────────────────────

const ImportBodySchema = z.object({
  categorySlug: z.string().min(1).max(64),
  dryRun: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

const DEFAULT_IMPORT_ROOT = "G:\\promptsandimages";

app.post("/imports", zv("json", ImportBodySchema), async (c) => {
  const ownerId = requireUserId(c);
  const body = c.req.valid("json");

  const dataRoot = (await getSetting("import.data_root")) ?? DEFAULT_IMPORT_ROOT;
  if (typeof dataRoot !== "string") {
    throw new HTTPException(500, { message: "invalid_data_root" });
  }
  const manifestPath = resolve(dataRoot, "exports/manifest.json");
  let manifest: { categories: Array<{ slug: string; jsonl: string; count: number; name: string }> };
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (e) {
    throw new HTTPException(500, { message: `manifest_unreadable:${(e as Error).message}` });
  }

  const entry = manifest.categories.find((c) => c.slug === body.categorySlug);
  if (!entry) {
    throw new HTTPException(400, { message: `unknown_category:${body.categorySlug}` });
  }
  const filePath = resolve(dataRoot, entry.jsonl);

  const result = await importCategoryJsonl({
    filePath,
    categorySlug: body.categorySlug,
    startedBy: ownerId,
    ...(body.dryRun !== undefined ? { dryRun: body.dryRun } : {}),
    ...(body.limit !== undefined ? { limit: body.limit } : {}),
  });

  await recordAudit({
    actorId: ownerId,
    action: body.dryRun ? "import.dry_run" : "import.run",
    targetType: "import_batch",
    targetId: result.batchId,
    payload: {
      categorySlug: body.categorySlug,
      total: result.total,
      inserted: result.inserted,
      skippedDuplicate: result.skippedDuplicate,
      failed: result.failed,
    },
  });

  return c.json(result);
});

app.get("/imports", async (c) => {
  const limit = Number(c.req.query("limit") ?? "50");
  const rows = await listRecentImports({ limit: Math.min(limit, 100) });
  return c.json({ items: rows });
});

app.get("/imports/manifest", async (c) => {
  const dataRoot = (await getSetting("import.data_root")) ?? DEFAULT_IMPORT_ROOT;
  if (typeof dataRoot !== "string") {
    throw new HTTPException(500, { message: "invalid_data_root" });
  }
  const manifestPath = resolve(dataRoot, "exports/manifest.json");
  try {
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    return c.json({
      dataRoot,
      categories: manifest.categories.map(
        (c: { slug: string; name: string; count: number; jsonl: string }) => ({
          slug: c.slug,
          name: c.name,
          count: c.count,
          jsonl: c.jsonl,
        }),
      ),
    });
  } catch (e) {
    throw new HTTPException(500, { message: `manifest_unreadable:${(e as Error).message}` });
  }
});
```

- [ ] **Step 2: Add minimal route tests**

Open `apps/api/src/routes/owner.test.ts`. Find an existing test that sets up an owner session and copy that scaffold. Add at the bottom of that file:

```ts
describe("imports route", () => {
  it("rejects non-owner caller", async () => {
    // Use whatever helper the file uses to make a non-owner authed call.
    const r = await fetch("/api/owner/imports", { method: "POST", body: JSON.stringify({ categorySlug: "food" }) });
    expect(r.status).toBe(401);
  });

  // We do NOT exercise the actual import here — that requires a real JSONL
  // file on disk. The repo test covers the import semantics; this file just
  // verifies the route is wired + gated.
});
```

(If the existing test file uses a different request helper — e.g. `app.request` — match that. The point is just to add wiring tests; the deep behavior is in `imports.test.ts`.)

```bash
cd apps/api && pnpm exec vitest run src/routes/owner.test.ts
```

Expected: all owner.test.ts tests still passing.

- [ ] **Step 3: Build the hook**

Create `apps/web/src/lib/hooks/useOwnerImports.ts`:

```ts
import { useMutation, useQuery, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import { apiFetch, type ApiError } from "../api";

export type ImportBatchDTO = {
  id: string;
  categorySlug: string;
  sourceFile: string;
  total: number;
  inserted: number;
  skippedDuplicate: number;
  failed: number;
  failedRecords: Array<{ line: number; externalId?: string; error: string }>;
  status: "pending" | "running" | "done" | "failed";
  dryRun: boolean;
  startedAt: string;
  finishedAt: string | null;
};

export type ManifestEntry = {
  slug: string;
  name: string;
  count: number;
  jsonl: string;
};

export function useImportManifest() {
  return useQuery({
    queryKey: ["owner", "imports", "manifest"],
    queryFn: () =>
      apiFetch<{ dataRoot: string; categories: ManifestEntry[] }>(
        "/api/owner/imports/manifest",
      ),
    staleTime: 5 * 60 * 1000,
  });
}

export function useImportHistory() {
  return useQuery({
    queryKey: ["owner", "imports", "history"],
    queryFn: () => apiFetch<{ items: ImportBatchDTO[] }>("/api/owner/imports"),
    staleTime: 30 * 1000,
  });
}

export function useStartImport(): UseMutationResult<
  ImportBatchDTO,
  ApiError,
  { categorySlug: string; dryRun?: boolean; limit?: number }
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      apiFetch<ImportBatchDTO>("/api/owner/imports", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["owner", "imports"] });
      qc.invalidateQueries({ queryKey: ["prompts"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}
```

- [ ] **Step 4: Build the page**

Create `apps/web/src/pages/owner/ImportPage.tsx`:

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, AlertTriangle } from "lucide-react";
import {
  useImportHistory,
  useImportManifest,
  useStartImport,
  type ManifestEntry,
} from "../../lib/hooks/useOwnerImports";
import { toast } from "../../lib/toast";

export default function ImportPage() {
  const { t } = useTranslation();
  const manifest = useImportManifest();
  const history = useImportHistory();
  const startMut = useStartImport();
  const [busySlug, setBusySlug] = useState<string | null>(null);

  function run(entry: ManifestEntry, dryRun: boolean) {
    setBusySlug(entry.slug);
    startMut.mutate(
      { categorySlug: entry.slug, ...(dryRun ? { dryRun: true, limit: 10 } : {}) },
      {
        onSuccess: (data) => {
          toast.success(
            t("owner.import.run_success", {
              inserted: data.inserted,
              skipped: data.skippedDuplicate,
              failed: data.failed,
            }),
          );
          setBusySlug(null);
        },
        onError: (e) => {
          toast.error(e.message ?? t("owner.import.run_failed"));
          setBusySlug(null);
        },
      },
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold">{t("owner.import.title")}</h1>
      <p className="mt-1 text-sm text-zinc-400">
        {t("owner.import.subtitle", { root: manifest.data?.dataRoot ?? "…" })}
      </p>

      {manifest.isError && (
        <div className="mt-6 flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          <AlertTriangle size={16} aria-hidden />
          {t("owner.import.manifest_unreadable")}
        </div>
      )}

      {manifest.data && (
        <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-800 text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-3 text-left">{t("owner.import.col_slug")}</th>
                <th className="px-4 py-3 text-left">{t("owner.import.col_name")}</th>
                <th className="px-4 py-3 text-right">{t("owner.import.col_count")}</th>
                <th className="px-4 py-3 text-right">{t("owner.import.col_actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {manifest.data.categories.map((entry) => (
                <tr key={entry.slug}>
                  <td className="px-4 py-2 font-mono text-xs text-zinc-300">{entry.slug}</td>
                  <td className="px-4 py-2">{entry.name}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-zinc-400">{entry.count}</td>
                  <td className="px-4 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => run(entry, true)}
                      disabled={busySlug === entry.slug}
                      className="rounded-md bg-zinc-800 px-3 py-1 text-xs font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
                    >
                      {t("owner.import.dry_run")}
                    </button>
                    <button
                      type="button"
                      onClick={() => run(entry, false)}
                      disabled={busySlug === entry.slug}
                      className="ml-2 rounded-md bg-emerald-500 px-3 py-1 text-xs font-medium text-zinc-950 hover:bg-emerald-400 disabled:opacity-40"
                    >
                      {busySlug === entry.slug ? "…" : t("owner.import.run")}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-10 text-lg font-semibold">{t("owner.import.history_title")}</h2>
      {history.data && history.data.items.length > 0 ? (
        <div className="mt-3 rounded-lg border border-zinc-800 bg-zinc-900">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-800 text-xs uppercase tracking-wider text-zinc-500">
              <tr>
                <th className="px-4 py-3 text-left">{t("owner.import.col_started_at")}</th>
                <th className="px-4 py-3 text-left">{t("owner.import.col_slug")}</th>
                <th className="px-4 py-3 text-left">{t("owner.import.col_status")}</th>
                <th className="px-4 py-3 text-right">{t("owner.import.col_inserted")}</th>
                <th className="px-4 py-3 text-right">{t("owner.import.col_skipped")}</th>
                <th className="px-4 py-3 text-right">{t("owner.import.col_failed")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {history.data.items.map((b) => (
                <tr key={b.id}>
                  <td className="px-4 py-2 font-mono text-xs text-zinc-300">{new Date(b.startedAt).toLocaleString()}</td>
                  <td className="px-4 py-2 font-mono text-xs text-zinc-400">
                    {b.categorySlug} {b.dryRun && <span className="ml-1 rounded bg-amber-500/20 px-1 text-[10px] text-amber-300">dry</span>}
                  </td>
                  <td className="px-4 py-2 text-xs">
                    <span className={
                      b.status === "done"
                        ? "rounded bg-emerald-500/20 px-2 py-0.5 text-emerald-300"
                        : b.status === "failed"
                        ? "rounded bg-rose-500/20 px-2 py-0.5 text-rose-300"
                        : "rounded bg-zinc-700 px-2 py-0.5 text-zinc-300"
                    }>{b.status}</span>
                  </td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-emerald-400">+{b.inserted}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-zinc-400">~{b.skippedDuplicate}</td>
                  <td className="px-4 py-2 text-right font-mono text-xs text-rose-400">!{b.failed}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-500">{t("owner.import.history_empty")}</p>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Wire navigation + route**

In `apps/web/src/routes/index.tsx` at the top, add:

```tsx
import ImportPage from "../pages/owner/ImportPage";
```

Inside the `OwnerLayout` children block (where `prompts`, `categories`, `tags` etc. are listed), add:

```tsx
{ path: "import", element: <ImportPage /> },
```

In `apps/web/src/components/owner/OwnerSidebar.tsx`, add `Download` to the lucide imports and insert a new entry in the `items` array between Tags and Submissions:

```tsx
{ to: withLocale(locale, "/rosekhlifa/import"), label: t("owner.nav.import"), icon: Download },
```

In `apps/web/src/components/owner/OwnerTopbar.tsx`, add to `SEGMENT_LABELS`:

```ts
import: "owner.nav.import",
```

- [ ] **Step 6: Add i18n keys**

In `apps/web/src/i18n/locales/zh.json`, find the `owner.nav` block and add:

```json
"import": "导入",
```

Then find the `owner` block and add a new namespace alongside `prompts`, `categories`, etc:

```json
    "import": {
      "title": "外部数据导入",
      "subtitle": "从 {root} 按分类导入爬取的提示词。重复运行幂等。",
      "manifest_unreadable": "未能读取 manifest.json,请确认 site_settings 中 import.data_root 是否正确。",
      "col_slug": "分类 slug",
      "col_name": "中文名",
      "col_count": "总数",
      "col_actions": "操作",
      "col_started_at": "开始时间",
      "col_status": "状态",
      "col_inserted": "新增",
      "col_skipped": "重复",
      "col_failed": "失败",
      "dry_run": "试导入 10",
      "run": "导入此分类",
      "run_success": "完成:新增 {inserted},跳过 {skipped},失败 {failed}",
      "run_failed": "导入失败",
      "history_title": "最近导入",
      "history_empty": "暂无记录"
    },
```

In `apps/web/src/i18n/locales/en.json`, the matching English entries:

```json
"import": "Import",
```

```json
    "import": {
      "title": "External data import",
      "subtitle": "Import crawled prompts by category from {root}. Re-runs are idempotent.",
      "manifest_unreadable": "manifest.json could not be read. Check the import.data_root site setting.",
      "col_slug": "Slug",
      "col_name": "Name",
      "col_count": "Total",
      "col_actions": "Actions",
      "col_started_at": "Started",
      "col_status": "Status",
      "col_inserted": "Inserted",
      "col_skipped": "Skipped",
      "col_failed": "Failed",
      "dry_run": "Dry-run 10",
      "run": "Run import",
      "run_success": "Done: +{inserted} inserted, ~{skipped} skipped, !{failed} failed",
      "run_failed": "Import failed",
      "history_title": "Recent imports",
      "history_empty": "No imports yet"
    },
```

- [ ] **Step 7: Add the site_settings key for data_root**

Open `apps/api/src/routes/owner.ts`. In the `WRITABLE_SETTING_KEYS` set, add:

```ts
"import.data_root",
```

This lets the owner edit the path from `/rosekhlifa/config` without an API restart. (No DB migration needed — `site_settings` is key-value text/jsonb.)

- [ ] **Step 8: Gate check + typecheck + build + tests**

```bash
cd /d/Image-Prompts
pnpm -F api typecheck
pnpm -F web typecheck
pnpm -F web build
pnpm -F api exec vitest run src/routes/owner.test.ts src/repositories/imports.test.ts
pnpm -F web test --run
```

Expected: api typecheck clean, web typecheck clean, web build clean, owner+imports tests passing, web baseline 58/58.

- [ ] **Step 9: Verify dev data intact**

```bash
cd apps/api && pnpm exec tsx scripts/restore-user-prompt.ts
```

Same expected `Before` line.

- [ ] **Step 10: Smoke-test the page in the dev server**

```bash
cd /d/Image-Prompts && pnpm dev
```

Open `http://localhost:5173/zh/rosekhlifa/import`. Verify:
- Manifest table populates with 16 rows
- "Dry-run 10" button on `food` returns toast "完成:新增 10..."
- "导入此分类" on `food` (or another small one) returns toast with real counts
- History table shows the runs

Stop the dev server.

- [ ] **Step 11: Commit**

```bash
cd /d/Image-Prompts
git add apps/api/src/routes/owner.ts apps/api/src/routes/owner.test.ts apps/web/src/lib/hooks/useOwnerImports.ts apps/web/src/pages/owner/ImportPage.tsx apps/web/src/routes/index.tsx apps/web/src/components/owner/OwnerSidebar.tsx apps/web/src/components/owner/OwnerTopbar.tsx apps/web/src/i18n/locales/zh.json apps/web/src/i18n/locales/en.json
git commit -m "$(cat <<'EOF'
feat(import): /rosekhlifa/import admin page + API endpoints

- POST /api/owner/imports runs importCategoryJsonl synchronously, audit-logged
- GET /api/owner/imports + /api/owner/imports/manifest serve the page
- ImportPage shows 16-category table with dry-run + run buttons; toast on
  completion; recent-imports history table below
- import.data_root added to WRITABLE_SETTING_KEYS so owners can repath
  without an env restart
- New Download lucide icon in OwnerSidebar; breadcrumb labels updated
EOF
)"
```

---

## Task 8: End-to-end verification

**Files:** none modified — this is the validation pass.

- [ ] **Step 1: Bring up the dev server**

```bash
cd /d/Image-Prompts && pnpm dev
```

Wait for both api + web to come up clean.

- [ ] **Step 2: Live-import the food category from the UI**

Navigate to `http://localhost:5173/zh/rosekhlifa/import`. Click "导入此分类" on `food`. Wait for the toast. Expected: `+51 inserted ~0 skipped !0 failed`.

(If `food` was already imported via the CLI in Task 5, expect `+0 inserted ~51 skipped` — that's the idempotent path working.)

- [ ] **Step 3: Confirm the prompts surface on the homepage**

Navigate to `http://localhost:5173/zh`. Filter or browse to the `food` category (top-nav sidebar should show 美食餐饮). Confirm:
- Card thumbnails load from the remote CDN
- Source-attribution chip ("来源 · NanoBananaPrompt") shows on each card
- Clicking the chip opens `https://nanobananaprompt.co/...` in a new tab
- Clicking the card opens the detail page; the detail page also shows the remote image + source chip

- [ ] **Step 4: Run a second category from the UI to confirm scalability**

Pick `landscape_scene` (175 records) from the table. Click "导入此分类". Toast should arrive in <5s with `+175 inserted ~0 skipped !0 failed`.

- [ ] **Step 5: Verify user data intact one final time**

```bash
cd apps/api && pnpm exec tsx scripts/restore-user-prompt.ts
```

Expected `Before` line: `contributor_id: '905af5ef-2fd0-4832-8cf1-d9c61f4abd72'`.

```bash
pnpm exec tsx -e "
import {db} from './src/db/client.ts';
import {sql} from 'drizzle-orm';
const r = await db.execute(sql\`SELECT name, account_id FROM r2_accounts WHERE name='dev-primary'\`);
console.log(r.rows);
process.exit(0);
"
```

Expected: one row `{name: 'dev-primary', account_id: '36dca4498d1ed04ce95a50c5277be644'}`.

- [ ] **Step 6: Stop the dev server**

Ctrl-C in the dev terminal.

- [ ] **Step 7: Update the memory file with the new pattern**

Add a memory entry summarizing the import pattern + safety constraints so future sessions know about it. Append to `C:\Users\YuanHua\.claude\projects\D--Image-Prompts\memory\MEMORY.md`:

```markdown
- [Import data shape + safety](import_crawled_prompts_pattern.md) — 33K crawled prompts use remote_url on prompt_images + source_site/source_url on prompts; resolveImageUrl short-circuits on remoteUrl; PromptCard shows source chip in lieu of contributor; idempotent via external_id unique
```

Then create the memory file `C:\Users\YuanHua\.claude\projects\D--Image-Prompts\memory\import_crawled_prompts_pattern.md`:

```markdown
---
name: import-crawled-prompts-pattern
description: "Imported prompts (source='imported') store the image as a remote CDN URL on prompt_images.remote_url instead of an R2 ref. resolveImageUrl short-circuits when remoteUrl is set. Idempotent via prompts.external_id unique-when-set."
metadata:
  type: project
---

The site holds two parallel prompt populations now:

- **User submissions / demo seed:** `prompts.source ∈ {'site','nanobanana_seed'}`, image lives in R2 (`prompt_images.r2_account_id + r2_key`).
- **Imported crawled data:** `prompts.source = 'imported'`, image is a remote CDN URL (`prompt_images.remote_url`). `r2_account_id` and `r2_key` are NULL. A CHECK constraint enforces "at least one storage form set" per row.

**Why:** Migration 0013 (2026-06-09) ingested ~33K prompts from `G:\promptsandimages\exports\by_category\*.jsonl` to seed the public browsing surface. Crawling images locally would have used >50 GB; the source CDNs are stable enough for v1.

**How to apply:**
- When rendering an image, `resolveImageUrl(image, r2Map)` short-circuits on `image.remoteUrl` — don't add code that assumes `r2_account_id` is non-null on `prompt_images`. Check the spec at `docs/superpowers/specs/2026-06-09-import-crawled-prompts-design.md` for the full rationale.
- `PromptCard` shows a "来源 · {site}" chip when `contributor === null && sourceSite != null`; existing demo seed (no contributor, no source) still shows "anonymous".
- Re-imports are safe — `prompts.external_id` has a partial unique index. The owner's `/rosekhlifa/import` page is the canonical entry; CLI is `pnpm exec tsx apps/api/scripts/import-prompts.ts <slug>`.
```

- [ ] **Step 8: Commit the memory file separately**

```bash
cd /d/Image-Prompts
# The memory dir lives outside the repo — no git add for that path.
# This step is just to log the memory write in the agent's task history.
echo "Memory entry recorded."
```

- [ ] **Step 9: Report**

Summarize the final state to the user:
- Total commits this sprint
- food + landscape_scene imported (or whichever categories were run)
- All 16 categories visible in /rosekhlifa/import
- User prompt + dev-primary R2 intact
- Recommended next step: owner runs the remaining 14 categories at their pace from the UI (or via `pnpm exec tsx scripts/import-prompts.ts --all` for unattended bulk)

---

## Self-review

**Spec coverage:**
- §3.1 prompt_images remote_url + nullability + CHECK → Task 1 SQL + Task 2 schema
- §3.2 source columns on prompts → Task 1 SQL + Task 2 schema
- §3.3 'imported' enum value → Task 1 (apply script issues it outside tx) + Task 2 schema
- §3.4 import_batches table → Task 1 SQL + Task 2 schema
- §4 tag slug strategy → Task 3 helper + Task 4 uses it in `insertOne`
- §5 source-attribution chip → Task 6
- §6.1 importCategoryJsonl → Task 4
- §6.2 CLI → Task 5
- §6.3 admin endpoints → Task 7
- §6.4 admin UI → Task 7
- §8 safety constraints → embedded in every task's verification steps

**Placeholder scan:** No "TBD" / "TODO" / "implement later" present. Tests have complete bodies. SQL blocks are complete. All identifiers used in later tasks (`importCategoryJsonl`, `listRecentImports`, `tagSlugFromName`, `useStartImport`, `ImportPage`) are defined in earlier tasks.

**Type consistency:**
- `ImportCategoryArgs.startedBy` (Task 4) matches `requireUserId(c)` return (Task 7).
- `ImportBatchRow.failedRecords` (Task 4) matches the DTO shape in `useOwnerImports.ts` (Task 7).
- `categorySlug` is consistently the URL/UX slug (e.g. `food`), separate from `tag.slug` (which uses `tagSlugFromName`).

No issues found.
