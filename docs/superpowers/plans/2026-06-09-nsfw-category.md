# NSFW Category Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated `nsfw` category with category-page modal gate, locked single-tag invariant, full hiding from mixed listings, submission acknowledgment, and mod-queue thumbnail blur. Source of truth: `docs/superpowers/specs/2026-06-09-nsfw-category-design.md`.

**Architecture:** API-side: one new listing filter helper + one new tag-invariant helper, applied at every site of public list / mutation. Frontend: one new modal component + one new submission-ack component; wire into `PromptListPage`, `SubmitPage`, `PromptDetailPage`, `owner/SubmissionsPage`. SessionStorage-only client-state — no schema migration, no new API endpoints.

**Tech Stack:** Hono + Drizzle + Postgres (API), React 18 + TanStack Query + Tailwind (web), Vitest, i18next.

**Constraints (per project memory):**
- DO NOT run `pnpm db:seed` — it wipes user data.
- DO NOT run the full API suite (`pnpm -F api test --run`); pre-existing tests mutate dev data. Use **focused test file paths** for every test command in this plan.
- Work in `main` (no worktree per user pattern). Commit after every task.

---

### Task 1: Seed `nsfw` category in dev DB

**Files:**
- Create: `apps/api/scripts/seed-nsfw-category.ts`

- [ ] **Step 1: Write the seed script**

```ts
// apps/api/scripts/seed-nsfw-category.ts
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db } from "../src/db/client";

async function main() {
  const result = await db.execute(sql`
    INSERT INTO categories (slug, name, description, "order")
    VALUES (
      'nsfw',
      '{"zh":"敏感内容","en":"NSFW"}'::jsonb,
      '{"zh":"可能引起不适或生理厌恶的内容,访问需确认免责声明。","en":"Content that may cause distress or visceral revulsion. Acknowledgment required to view."}'::jsonb,
      9999
    )
    ON CONFLICT (slug) DO NOTHING
    RETURNING id, slug;
  `);
  const rows = (result as unknown as { rows: Array<{ id: string; slug: string }> }).rows ?? [];
  if (rows.length > 0) {
    console.log(`[seed-nsfw] inserted category ${rows[0]!.slug} id=${rows[0]!.id}`);
  } else {
    console.log("[seed-nsfw] category already exists, nothing to do");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("[seed-nsfw] failed:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the seed**

```
pnpm -F api exec tsx scripts/seed-nsfw-category.ts
```

Expected output: `[seed-nsfw] inserted category nsfw id=<uuid>`. Second run: `nothing to do`.

- [ ] **Step 3: Verify with a quick repo call**

```
pnpm -F api exec tsx -e "import {db} from './src/db/client'; import {categories} from './src/db/schema/taxonomy'; import {eq} from 'drizzle-orm'; db.query.categories.findFirst({where: eq(categories.slug, 'nsfw')}).then(c => {console.log(c); process.exit(0)})"
```

Expected: prints the row with `name: {zh: '敏感内容', en: 'NSFW'}` and `order: 9999`.

- [ ] **Step 4: Commit**

```
git add apps/api/scripts/seed-nsfw-category.ts
git commit -m "feat(nsfw): seed nsfw category"
```

---

### Task 2: `assertNsfwTagInvariant` helper

**Files:**
- Create: `apps/api/src/lib/nsfw.ts`
- Create: `apps/api/src/lib/nsfw.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/api/src/lib/nsfw.test.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "../db/client";
import { categories } from "../db/schema/taxonomy";
import { assertNsfwTagInvariant } from "./nsfw";

describe("assertNsfwTagInvariant", () => {
  let nsfwId: string;
  let sfwId: string;

  beforeAll(async () => {
    // Ensure nsfw exists (Task 1 should have seeded it; safe re-insert)
    await db.execute(sql`
      INSERT INTO categories (slug, name, description, "order")
      VALUES ('nsfw', '{"zh":"敏感内容","en":"NSFW"}'::jsonb, '{}'::jsonb, 9999)
      ON CONFLICT (slug) DO NOTHING;
    `);
    // Create a throwaway SFW category for the non-NSFW branch
    await db.execute(sql`
      INSERT INTO categories (slug, name, description, "order")
      VALUES ('tw48r-sfw', '{"zh":"测试","en":"Test"}'::jsonb, '{}'::jsonb, 0)
      ON CONFLICT (slug) DO NOTHING;
    `);
    const rows = await db.query.categories.findMany({
      columns: { id: true, slug: true },
    });
    nsfwId = rows.find((r) => r.slug === "nsfw")!.id;
    sfwId = rows.find((r) => r.slug === "tw48r-sfw")!.id;
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM categories WHERE slug = 'tw48r-sfw';`);
  });

  it("permits a non-NSFW category with arbitrary tags", async () => {
    await expect(
      assertNsfwTagInvariant(db, sfwId, ["any", "tags"]),
    ).resolves.toBeUndefined();
  });

  it("permits NSFW category when tags is exactly ['nsfw']", async () => {
    await expect(
      assertNsfwTagInvariant(db, nsfwId, ["nsfw"]),
    ).resolves.toBeUndefined();
  });

  it("permits NSFW category when tags is ['NSFW'] (case-insensitive)", async () => {
    await expect(
      assertNsfwTagInvariant(db, nsfwId, ["NSFW"]),
    ).resolves.toBeUndefined();
  });

  it("rejects NSFW category with extra tags", async () => {
    await expect(
      assertNsfwTagInvariant(db, nsfwId, ["nsfw", "extra"]),
    ).rejects.toThrow("nsfw_category_tags_locked");
  });

  it("rejects NSFW category with no nsfw tag", async () => {
    await expect(
      assertNsfwTagInvariant(db, nsfwId, ["other"]),
    ).rejects.toThrow("nsfw_category_tags_locked");
  });

  it("rejects NSFW category with empty tag list", async () => {
    await expect(
      assertNsfwTagInvariant(db, nsfwId, []),
    ).rejects.toThrow("nsfw_category_tags_locked");
  });
});
```

- [ ] **Step 2: Run the test — expect failure**

```
pnpm -F api exec vitest run src/lib/nsfw.test.ts
```

Expected: 6 tests fail with "Cannot find module './nsfw'" or similar.

- [ ] **Step 3: Implement the helper**

```ts
// apps/api/src/lib/nsfw.ts
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { categories } from "../db/schema/taxonomy";

// Loose type so this helper can run against a tx or the root db handle
type DbOrTx = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export class NsfwTagInvariantError extends Error {
  constructor() {
    super("nsfw_category_tags_locked");
    this.name = "NsfwTagInvariantError";
  }
}

/**
 * Enforce: prompts in the `nsfw` category may carry ONLY the `nsfw` tag.
 * No-op for any other category. Compares slugs case-insensitively after
 * trimming so `'NSFW'`, `' nsfw '`, and `'nsfw'` all pass.
 *
 * Throws `NsfwTagInvariantError` (`.message === 'nsfw_category_tags_locked'`)
 * so callers / the error middleware can map it to a 400 with a stable code.
 */
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
    throw new NsfwTagInvariantError();
  }
}
```

- [ ] **Step 4: Re-run the test**

```
pnpm -F api exec vitest run src/lib/nsfw.test.ts
```

Expected: 6/6 pass.

- [ ] **Step 5: Commit**

```
git add apps/api/src/lib/nsfw.ts apps/api/src/lib/nsfw.test.ts
git commit -m "feat(nsfw): assertNsfwTagInvariant helper + tests"
```

---

### Task 3: `excludeNsfw` listing-filter helper

**Files:**
- Create: `apps/api/src/repositories/_filters.ts`

- [ ] **Step 1: Implement the helper**

```ts
// apps/api/src/repositories/_filters.ts
//
// Reusable list-query predicates. Currently just NSFW exclusion. Kept in its
// own file so the wiring is obvious at every call site (`import { excludeNsfw }`)
// and so the helper has one place to evolve if the rule changes.

import { sql, type SQL } from "drizzle-orm";

/**
 * SQL fragment that excludes prompts whose category is `nsfw`.
 *
 * Use as a WHERE clause AND-condition in any list query that joins or
 * subselects against `categories`. The fragment is a `NOT EXISTS` subquery
 * keyed on `prompts.category_id` so it works regardless of whether the
 * outer query has already joined `categories`.
 *
 * To bypass (e.g. `?category=nsfw`), simply don't append this fragment.
 */
export function excludeNsfw(): SQL {
  return sql`NOT EXISTS (
    SELECT 1 FROM categories c
    WHERE c.id = prompts.category_id AND c.slug = 'nsfw'
  )`;
}
```

- [ ] **Step 2: Typecheck**

```
pnpm -F api typecheck
```

Expected: no new errors. (Helper isn't called yet — just compiles.)

- [ ] **Step 3: Commit**

```
git add apps/api/src/repositories/_filters.ts
git commit -m "feat(nsfw): excludeNsfw SQL filter helper"
```

---

### Task 4: Apply `excludeNsfw` to all list queries

**Files:**
- Modify: `apps/api/src/repositories/prompts.ts`
- Modify: `apps/api/src/repositories/users-public.ts`
- Modify: `apps/api/src/repositories/me-profile.ts`
- Modify: `apps/api/src/repositories/stats.ts`
- Modify: `apps/api/src/repositories/prompts.test.ts` (add NSFW-exclusion cases)

- [ ] **Step 1: Find every public list query**

Run these greps to verify the call sites:

```
pnpm -F api exec grep -rn "from(prompts)" src/repositories/prompts.ts src/repositories/users-public.ts src/repositories/me-profile.ts src/repositories/stats.ts
```

For each match in the four files, you'll add `.where(and(<existing>, excludeNsfw()))` UNLESS the query is `getPromptBySlug` (single-row by slug → no filter) or unless `filters.categorySlug === 'nsfw'` (bypass for the category page).

- [ ] **Step 2: Write the failing test in `prompts.test.ts`**

Add this block to the existing `apps/api/src/repositories/prompts.test.ts` (place near other listPrompts tests; use the `tw48r-` prefix per memory):

```ts
describe("NSFW exclusion (Task 4)", () => {
  let nsfwId: string;
  let nsfwPromptId: string;
  let sfwPromptId: string;

  beforeAll(async () => {
    // Ensure nsfw category seeded
    await db.execute(sql`
      INSERT INTO categories (slug, name, description, "order")
      VALUES ('nsfw', '{"zh":"敏感内容","en":"NSFW"}'::jsonb, '{}'::jsonb, 9999)
      ON CONFLICT (slug) DO NOTHING;
    `);
    const cat = await db.query.categories.findFirst({
      where: eq(categories.slug, "nsfw"),
      columns: { id: true },
    });
    nsfwId = cat!.id;

    // Pick any SFW category that already exists
    const sfwCat = await db.query.categories.findFirst({
      where: ne(categories.slug, "nsfw"),
      columns: { id: true },
    });

    // Insert two test prompts directly (bypassing the API so we can place
    // them in any category we want).
    const [nsfw] = await db
      .insert(prompts)
      .values({
        slug: "tw48r-nsfw-test",
        title: { zh: "tw48r nsfw", en: "tw48r nsfw" },
        body: { zh: "x", en: "x" },
        categoryId: nsfwId,
        status: "approved",
        approvedAt: new Date(),
        source: "site",
      })
      .returning({ id: prompts.id });
    nsfwPromptId = nsfw!.id;

    const [sfw] = await db
      .insert(prompts)
      .values({
        slug: "tw48r-sfw-test",
        title: { zh: "tw48r sfw", en: "tw48r sfw" },
        body: { zh: "x", en: "x" },
        categoryId: sfwCat!.id,
        status: "approved",
        approvedAt: new Date(),
        source: "site",
      })
      .returning({ id: prompts.id });
    sfwPromptId = sfw!.id;
  });

  afterAll(async () => {
    await db.delete(prompts).where(inArray(prompts.id, [nsfwPromptId, sfwPromptId]));
  });

  it("listPrompts default excludes NSFW prompts", async () => {
    const result = await listPrompts({ page: 1, pageSize: 100 });
    const ids = result.items.map((p) => p.id);
    expect(ids).toContain(sfwPromptId);
    expect(ids).not.toContain(nsfwPromptId);
  });

  it("listPrompts with categorySlug='nsfw' returns NSFW prompts", async () => {
    const result = await listPrompts({
      page: 1,
      pageSize: 100,
      categorySlug: "nsfw",
    });
    const ids = result.items.map((p) => p.id);
    expect(ids).toContain(nsfwPromptId);
    expect(ids).not.toContain(sfwPromptId);
  });
});
```

(Make sure `ne` and `inArray` are imported from `drizzle-orm` at the top of the test file; if missing, add them.)

- [ ] **Step 3: Run the test — expect failure**

```
pnpm -F api exec vitest run src/repositories/prompts.test.ts -t "NSFW exclusion"
```

Expected: `listPrompts default excludes NSFW prompts` fails (currently returns both).

- [ ] **Step 4: Patch `prompts.ts`**

For every public list query in `prompts.ts` (`listPrompts`, `listRecentPrompts`, `searchPrompts`, `listRelatedPrompts`, `listPromptsByTag`), import `excludeNsfw` and add it to the `WHERE` clause. Concrete sketch:

```ts
import { and, eq /* … existing … */ } from "drizzle-orm";
import { excludeNsfw } from "./_filters";

// In listPrompts:
const baseWhere = and(
  eq(prompts.status, "approved"),
  // ... existing predicates ...
  filters.categorySlug === "nsfw" ? undefined : excludeNsfw(),
);
```

The `undefined` arg to `and()` is safely dropped by Drizzle. Apply the same pattern (without the categorySlug bypass) to the other four queries — they always exclude.

- [ ] **Step 5: Patch `users-public.ts`**

Locate `listUserPrompts` (or whatever surfaces a user's public prompt list / pinned list). Add `excludeNsfw()` to the WHERE — always exclude, no bypass.

- [ ] **Step 6: Patch `me-profile.ts`**

If it has any prompt-list function for the public profile view, add `excludeNsfw()`. If it only handles owner-view (logged-in self), skip — owner sees their own NSFW prompts normally.

(Confirm during implementation: open the file and look for `from(prompts)`. If absent, leave the file alone.)

- [ ] **Step 7: Patch `stats.ts`**

`getPromptStats` (or whatever feeds the homepage counter) — find the COUNT, add `excludeNsfw()` so NSFW prompts aren't tallied in the public "X prompts" badge.

- [ ] **Step 8: Re-run the test**

```
pnpm -F api exec vitest run src/repositories/prompts.test.ts -t "NSFW exclusion"
```

Expected: both new tests pass.

- [ ] **Step 9: Quick sanity check on existing tests**

Run the rest of the file's tests to make sure the WHERE additions didn't break anything else:

```
pnpm -F api exec vitest run src/repositories/prompts.test.ts
```

Expected: all green (or at most pre-existing test pollution — note it but don't try to fix here).

- [ ] **Step 10: Commit**

```
git add apps/api/src/repositories/prompts.ts \
        apps/api/src/repositories/users-public.ts \
        apps/api/src/repositories/me-profile.ts \
        apps/api/src/repositories/stats.ts \
        apps/api/src/repositories/_filters.ts \
        apps/api/src/repositories/prompts.test.ts
git commit -m "feat(nsfw): exclude NSFW from public list queries"
```

---

### Task 5: Wire `assertNsfwTagInvariant` into mutation paths

**Files:**
- Modify: `apps/api/src/repositories/submissions.ts`
- Modify: `apps/api/src/repositories/owner-prompts.ts`
- Modify: any "approve submission → promote to prompt" handler (likely in `apps/api/src/routes/owner.ts` or `apps/api/src/repositories/submissions.ts`)
- Modify: `apps/api/src/repositories/submissions.test.ts`
- Modify: `apps/api/src/repositories/owner-prompts.test.ts`

- [ ] **Step 1: Find the mutation entry points**

```
pnpm -F api exec grep -n "categoryId" src/repositories/submissions.ts src/repositories/owner-prompts.ts
```

For submissions: locate `createSubmission` (or the function that does the INSERT).
For owner-prompts: locate `createPromptForOwner` / `updatePromptForOwner`.
For approve: search `promotedTo` or `approveSubmission`.

- [ ] **Step 2: Write failing tests in `submissions.test.ts`**

Add this block:

```ts
describe("NSFW tag invariant on submission (Task 5)", () => {
  let nsfwCategoryId: string;
  beforeAll(async () => {
    const cat = await db.query.categories.findFirst({
      where: eq(categories.slug, "nsfw"),
      columns: { id: true },
    });
    nsfwCategoryId = cat!.id;
  });

  it("rejects NSFW submission with extra tags", async () => {
    await expect(
      createSubmission({
        contributorId: "<a-valid-test-user-id>", // use the fixture for tw48r tests
        title: { zh: "x", en: "x" },
        body: { zh: "x", en: "x" },
        categoryId: nsfwCategoryId,
        tagNames: ["nsfw", "extra"],
        imageInputs: [],
      }),
    ).rejects.toThrow("nsfw_category_tags_locked");
  });

  it("accepts NSFW submission with exactly ['nsfw']", async () => {
    const result = await createSubmission({
      contributorId: "<a-valid-test-user-id>",
      title: { zh: "x", en: "x" },
      body: { zh: "x", en: "x" },
      categoryId: nsfwCategoryId,
      tagNames: ["nsfw"],
      imageInputs: [],
    });
    expect(result).toBeDefined();
    // clean up so the test is idempotent
    await db.delete(submissions).where(eq(submissions.id, result.id));
  });
});
```

(Look at neighboring tests for the test-user fixture pattern — most repos have a `seedTestUser()` helper or a constant id. Reuse whichever lives in `submissions.test.ts` already.)

Same shape for `owner-prompts.test.ts`:

```ts
describe("NSFW tag invariant on owner prompts (Task 5)", () => {
  // similar setup; tests createPromptForOwner + updatePromptForOwner
  // covering both directions:
  //  - create with NSFW + extra tags → rejects
  //  - update existing SFW prompt to NSFW category with extra tags → rejects
  //  - update existing SFW prompt to NSFW category with tags=['nsfw'] → succeeds
  //  - update from NSFW back to SFW with new tags → succeeds
});
```

(Implementer: flesh out per existing patterns in the file.)

- [ ] **Step 3: Run the tests — expect failures**

```
pnpm -F api exec vitest run src/repositories/submissions.test.ts -t "NSFW tag invariant"
pnpm -F api exec vitest run src/repositories/owner-prompts.test.ts -t "NSFW tag invariant"
```

Expected: rejection tests fail (no current enforcement).

- [ ] **Step 4: Wire the helper into `submissions.ts` `createSubmission`**

```ts
import { assertNsfwTagInvariant } from "../lib/nsfw";

export async function createSubmission(input: CreateSubmissionInput) {
  return db.transaction(async (tx) => {
    await assertNsfwTagInvariant(tx, input.categoryId, input.tagNames);
    // ... existing INSERT logic unchanged ...
  });
}
```

- [ ] **Step 5: Wire into `owner-prompts.ts` `createPromptForOwner`**

Same shape:

```ts
import { assertNsfwTagInvariant } from "../lib/nsfw";

export async function createPromptForOwner(input: ...) {
  return db.transaction(async (tx) => {
    await assertNsfwTagInvariant(tx, input.categoryId, input.tagNames ?? []);
    // ... existing INSERT logic ...
  });
}
```

- [ ] **Step 6: Wire into `owner-prompts.ts` `updatePromptForOwner`**

This one is trickier — if the caller is only updating tags, `categoryId` may not be in the input. Resolve the effective categoryId (input.categoryId ?? existing.categoryId) and the effective tag names (input.tagNames ?? existing.tag.slugs) before calling the helper:

```ts
const effectiveCategoryId = input.categoryId ?? existing.categoryId;
const effectiveTagNames = input.tagNames ?? existing.tags.map((t) => t.slug);
await assertNsfwTagInvariant(tx, effectiveCategoryId, effectiveTagNames);
```

- [ ] **Step 7: Wire into the approve-submission path**

Find `approveSubmission` (or equivalent). When promoting the submission row into a prompt, re-call `assertNsfwTagInvariant` so a moderator cannot bypass by approving a stale row whose category is NSFW but tags aren't:

```ts
await assertNsfwTagInvariant(tx, submission.categoryId, submission.tagNames);
```

If approval allows the moderator to override category, use the *post-override* values.

- [ ] **Step 8: Re-run the tests**

```
pnpm -F api exec vitest run src/repositories/submissions.test.ts -t "NSFW tag invariant"
pnpm -F api exec vitest run src/repositories/owner-prompts.test.ts -t "NSFW tag invariant"
```

Expected: all pass.

- [ ] **Step 9: Commit**

```
git add apps/api/src/repositories/submissions.ts \
        apps/api/src/repositories/owner-prompts.ts \
        apps/api/src/routes/owner.ts \
        apps/api/src/repositories/submissions.test.ts \
        apps/api/src/repositories/owner-prompts.test.ts
git commit -m "feat(nsfw): enforce single-nsfw-tag invariant on submission + owner mutations"
```

---

### Task 6: Block `nsfw` from JSONL import

**Files:**
- Modify: `apps/api/src/repositories/imports.ts`
- Modify: `apps/api/src/repositories/imports.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `imports.test.ts`:

```ts
it("rejects nsfw categorySlug outright (Task 6)", async () => {
  await expect(
    importCategoryJsonl({
      filePath: "/dev/null", // never reached
      categorySlug: "nsfw",
      startedBy: TEST_OWNER_ID,
    }),
  ).rejects.toThrow("nsfw_import_forbidden");
});
```

- [ ] **Step 2: Run — expect failure**

```
pnpm -F api exec vitest run src/repositories/imports.test.ts -t "rejects nsfw"
```

- [ ] **Step 3: Add the guard at the top of `importCategoryJsonl`**

```ts
export async function importCategoryJsonl(input: ImportCategoryJsonlInput) {
  if (input.categorySlug === "nsfw") {
    throw new Error("nsfw_import_forbidden");
  }
  // ... existing body unchanged ...
}
```

- [ ] **Step 4: Re-run — expect pass**

```
pnpm -F api exec vitest run src/repositories/imports.test.ts -t "rejects nsfw"
```

- [ ] **Step 5: Commit**

```
git add apps/api/src/repositories/imports.ts apps/api/src/repositories/imports.test.ts
git commit -m "feat(nsfw): block nsfw category from JSONL import"
```

---

### Task 7: Error mapping + i18n keys

**Files:**
- Modify: `apps/api/src/middleware/error.ts`
- Modify: `apps/web/src/i18n/locales/zh.json`
- Modify: `apps/web/src/i18n/locales/en.json`

- [ ] **Step 1: Map errors to 400 in `middleware/error.ts`**

Find the block that converts thrown errors to JSON responses. Add a branch:

```ts
if (err instanceof Error) {
  if (err.message === "nsfw_category_tags_locked") {
    return c.json({ error: "nsfw_category_tags_locked", message: err.message }, 400);
  }
  if (err.message === "nsfw_import_forbidden") {
    return c.json({ error: "nsfw_import_forbidden", message: err.message }, 400);
  }
}
```

Match the existing style — if the middleware uses a ValidationError class, throw that from the helpers instead. The implementer should adapt to whatever shape lives in `error.ts`.

- [ ] **Step 2: Add zh i18n keys**

Open `apps/web/src/i18n/locales/zh.json`. Add under the existing tree:

```json
"nsfw": {
  "badge": "NSFW",
  "gate": {
    "title": "内容警告",
    "body": "此分类下的内容可能令人不适或引起生理厌恶 —— 包括但不限于暴力、血腥、惊悚画面,以及其他可能对部分观看者造成心理或生理负面反应的视觉元素。\n\n继续访问意味着:\n• 您已成年并自愿浏览;\n• 您理解可能引发的不适并自行承担风险;\n• 您不会因此向本站或其他用户追究任何责任。\n\n如确认继续,请在下方输入「我已了解」。",
    "confirm_phrase": "我已了解",
    "confirm_placeholder": "请输入「我已了解」",
    "enter": "进入",
    "cancel": "取消"
  },
  "submit": {
    "tag_locked_note": "此分类下所有作品仅共享 \"nsfw\" 标签",
    "ack_body": "您正在向「敏感内容」分类投稿。此分类专门收纳可能引起不适的图像 —— 您声明对所投稿内容的性质知情、自愿且对其承担全部责任。如确认提交,请在下方输入「我已了解」。",
    "ack_placeholder": "请输入「我已了解」"
  },
  "errors": {
    "tags_locked": "NSFW 分类下作品只能使用 \"nsfw\" 标签",
    "import_forbidden": "NSFW 分类不支持批量导入"
  }
},
"owner": {
  /* ... existing owner block ... add this key inside the modqueue subtree, or at root if no subtree exists ... */
  "modqueue": {
    "reveal_nsfw": "点击查看"
  }
}
```

(Place keys in alphabetical / structural order matching the file's existing convention. If `owner.modqueue` already exists, merge — don't duplicate.)

- [ ] **Step 3: Add en i18n keys**

Same structure in `apps/web/src/i18n/locales/en.json`:

```json
"nsfw": {
  "badge": "NSFW",
  "gate": {
    "title": "Content Warning",
    "body": "Content in this category may be distressing or physically revolting — including but not limited to violence, gore, horror, and other visuals that may cause psychological or physical adverse reactions in some viewers.\n\nBy continuing you confirm that:\n• You are of legal age and viewing voluntarily;\n• You understand the potential discomfort and accept the risk;\n• You will not hold the site or other users liable.\n\nTo proceed, type \"I understand\" below.",
    "confirm_phrase": "I understand",
    "confirm_placeholder": "Type \"I understand\"",
    "enter": "Enter",
    "cancel": "Cancel"
  },
  "submit": {
    "tag_locked_note": "All works in this category share the single \"nsfw\" tag",
    "ack_body": "You are submitting to the NSFW category. This category is reserved for potentially distressing imagery — you confirm that you understand the nature of what you are submitting, do so voluntarily, and accept full responsibility. To proceed, type \"I understand\" below.",
    "ack_placeholder": "Type \"I understand\""
  },
  "errors": {
    "tags_locked": "NSFW category prompts may only carry the \"nsfw\" tag",
    "import_forbidden": "NSFW category does not support bulk import"
  }
},
"owner": {
  "modqueue": {
    "reveal_nsfw": "Click to reveal"
  }
}
```

- [ ] **Step 4: Typecheck both apps**

```
pnpm -F api typecheck
pnpm -F web typecheck
```

Expected: no errors. (i18n typecheck depends on whether the project uses typed keys — if it does, both apps may need a rebuild.)

- [ ] **Step 5: Commit**

```
git add apps/api/src/middleware/error.ts \
        apps/web/src/i18n/locales/zh.json \
        apps/web/src/i18n/locales/en.json
git commit -m "feat(nsfw): error mapping + i18n keys (zh/en)"
```

---

### Task 8: `NsfwGateModal` component

**Files:**
- Create: `apps/web/src/components/NsfwGateModal.tsx`

- [ ] **Step 1: Write the component**

```tsx
// apps/web/src/components/NsfwGateModal.tsx
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";

type Props = {
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * Full-viewport gate that hides the page body until the visitor types the
 * locale-specific confirmation phrase ("我已了解" / "I understand") exactly.
 *
 * Used by `PromptListPage` when `?category=nsfw`. Acknowledgment is recorded
 * in sessionStorage by the caller — the modal itself is stateless w.r.t. that.
 */
export function NsfwGateModal({ onConfirm, onCancel }: Props) {
  const { t } = useTranslation();
  const [typed, setTyped] = useState("");
  const expected = t("nsfw.gate.confirm_phrase");
  const matches = typed.trim() === expected;
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === "Enter" && matches) {
      e.preventDefault();
      onConfirm();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/85 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="nsfw-gate-title"
    >
      <div className="w-full max-w-md rounded-lg border border-rose-700 bg-zinc-900 p-6 shadow-2xl">
        <div className="flex items-center gap-2 text-rose-300">
          <AlertTriangle size={20} aria-hidden />
          <h2 id="nsfw-gate-title" className="text-lg font-semibold">
            {t("nsfw.gate.title")}
          </h2>
        </div>
        <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-zinc-200">
          {t("nsfw.gate.body")}
        </p>
        <input
          ref={inputRef}
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={handleKey}
          placeholder={t("nsfw.gate.confirm_placeholder")}
          className="mt-5 w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-rose-500 focus:outline-none"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-200 hover:bg-zinc-700"
          >
            {t("nsfw.gate.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!matches}
            className="rounded-md bg-rose-500 px-3 py-1.5 text-sm font-medium text-zinc-950 hover:bg-rose-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("nsfw.gate.enter")}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

```
pnpm -F web typecheck
```

Expected: no errors.

- [ ] **Step 3: Commit**

```
git add apps/web/src/components/NsfwGateModal.tsx
git commit -m "feat(nsfw): NsfwGateModal component"
```

---

### Task 9: Wire modal into `PromptListPage`

**Files:**
- Modify: `apps/web/src/pages/PromptListPage.tsx`

- [ ] **Step 1: Find where the category param is resolved**

Open `PromptListPage.tsx`. Locate where `category` (or `categorySlug`) is read from the URL or query state. Note the variable name.

- [ ] **Step 2: Add the gate**

Near the top of the page component, after the category resolution:

```tsx
import { useNavigate } from "react-router-dom";
import { NsfwGateModal } from "../components/NsfwGateModal";

// inside the component:
const navigate = useNavigate();
const isNsfwCategory = currentCategorySlug === "nsfw"; // adapt variable name
const [nsfwAcked, setNsfwAcked] = useState(
  () => sessionStorage.getItem("nsfw-ack") === "1",
);

if (isNsfwCategory && !nsfwAcked) {
  return (
    <NsfwGateModal
      onConfirm={() => {
        sessionStorage.setItem("nsfw-ack", "1");
        setNsfwAcked(true);
      }}
      onCancel={() => {
        // Prefer back; fall back to /prompts root if there's no history entry
        if (window.history.length > 1) {
          navigate(-1);
        } else {
          navigate("/prompts");
        }
      }}
    />
  );
}
```

This block must come BEFORE any other return so the page body never renders behind the modal.

- [ ] **Step 3: Manual verification**

Start dev server:

```
pnpm dev
```

Then in a browser:

1. Visit `http://localhost:5173/zh/prompts?category=nsfw` → modal appears, page body hidden behind backdrop.
2. Type `我已了解` → **进入** button activates → click → page lists NSFW prompts (likely empty for now — that's fine).
3. Open a fresh tab, visit the same URL → modal appears again (sessionStorage is per-tab).
4. Switch to en locale (`/en/prompts?category=nsfw`) → modal shows English copy, requires typing `I understand`.
5. Visit `http://localhost:5173/zh/prompts` (default) → no modal, no NSFW prompts in the list.

Note any visual issues; fix inline before committing.

- [ ] **Step 4: Commit**

```
git add apps/web/src/pages/PromptListPage.tsx
git commit -m "feat(nsfw): gate category=nsfw behind acknowledgment modal"
```

---

### Task 10: Submit page — locked tags + inline ack

**Files:**
- Create: `apps/web/src/components/NsfwSubmitAck.tsx`
- Modify: `apps/web/src/pages/SubmitPage.tsx`

- [ ] **Step 1: Build the ack card component**

```tsx
// apps/web/src/components/NsfwSubmitAck.tsx
import { useTranslation } from "react-i18next";
import { AlertTriangle } from "lucide-react";

type Props = {
  value: string;
  onChange: (v: string) => void;
};

/**
 * Inline disclaimer + type-to-confirm field shown in the submit form when
 * the visitor selects the NSFW category. The parent owns the value/onChange
 * pair and disables its submit button until `value.trim() === t("nsfw.gate.confirm_phrase")`.
 */
export function NsfwSubmitAck({ value, onChange }: Props) {
  const { t } = useTranslation();
  return (
    <div className="rounded-lg border border-rose-700/50 bg-rose-500/5 p-4">
      <div className="flex items-center gap-2 text-rose-300">
        <AlertTriangle size={16} aria-hidden />
        <span className="text-sm font-semibold">{t("nsfw.gate.title")}</span>
      </div>
      <p className="mt-2 whitespace-pre-line text-xs leading-relaxed text-zinc-300">
        {t("nsfw.submit.ack_body")}
      </p>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("nsfw.submit.ack_placeholder")}
        className="mt-3 w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-rose-500 focus:outline-none"
      />
    </div>
  );
}
```

- [ ] **Step 2: Wire `SubmitPage.tsx`**

Open `apps/web/src/pages/SubmitPage.tsx`. Plan the integration:

a) Add state: `const [nsfwAck, setNsfwAck] = useState("")`.

b) Find where the category is selected. When category changes:
   - If selected category slug is `nsfw`: `setTagNames(["nsfw"])` and clear any custom tag input state.
   - If selected category slug changes AWAY from `nsfw`: `setTagNames([])` and `setNsfwAck("")`.

c) Render conditionally:
   ```tsx
   {selectedCategorySlug === "nsfw" ? (
     <>
       <p className="text-xs text-zinc-400">{t("nsfw.submit.tag_locked_note")}</p>
       <NsfwSubmitAck value={nsfwAck} onChange={setNsfwAck} />
     </>
   ) : (
     <TagSelector /* existing */ />
   )}
   ```

d) Gate the submit button:
   ```tsx
   const expectedPhrase = t("nsfw.gate.confirm_phrase");
   const nsfwGateOK = selectedCategorySlug !== "nsfw" || nsfwAck.trim() === expectedPhrase;
   <button disabled={!isValid || !nsfwGateOK || isSubmitting}>…</button>
   ```

- [ ] **Step 3: Manual verification**

```
pnpm dev
```

1. Log in as a contributor user.
2. Go to `/zh/submit`.
3. Pick the "敏感内容" category from the dropdown.
4. Tag selector disappears; ack card appears; submit button disabled.
5. Type `我已了解` → submit enables.
6. Switch category to something else → ack card disappears, tag selector returns empty.
7. Try to submit without ack (just to confirm guard works).

- [ ] **Step 4: Commit**

```
git add apps/web/src/components/NsfwSubmitAck.tsx apps/web/src/pages/SubmitPage.tsx
git commit -m "feat(nsfw): submit page locks tags + requires inline acknowledgment"
```

---

### Task 11: Detail page — hide `nsfw` tag chip + show badge

**Files:**
- Modify: `apps/web/src/pages/PromptDetailPage.tsx`

- [ ] **Step 1: Filter the tag list**

Find where the prompt's `tags` array maps to chips. Add a filter:

```tsx
const visibleTags = (prompt.tags ?? []).filter((tag) => tag.slug !== "nsfw");
// then render `visibleTags.map(...)` instead of `prompt.tags.map(...)`
```

- [ ] **Step 2: Add the NSFW badge**

In the metadata column / near the category chip:

```tsx
{prompt.category?.slug === "nsfw" && (
  <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-rose-300">
    {t("nsfw.badge")}
  </span>
)}
```

- [ ] **Step 3: Manual verification**

Create a test NSFW prompt (via the submit flow you wired in Task 10, then approve it via mod queue). Open its detail page:
- `nsfw` does NOT appear as a clickable tag.
- A small rose-tinted "NSFW" badge appears next to the category info.

- [ ] **Step 4: Commit**

```
git add apps/web/src/pages/PromptDetailPage.tsx
git commit -m "feat(nsfw): hide nsfw tag chip + show NSFW badge on detail page"
```

---

### Task 12: Mod queue — blurred thumbnail

**Files:**
- Modify: `apps/web/src/pages/owner/SubmissionsPage.tsx`

- [ ] **Step 1: Identify the submission card / thumbnail render**

Open `SubmissionsPage.tsx`. Find where each submission's thumbnail `<img>` is rendered.

- [ ] **Step 2: Add per-card reveal state and blur logic**

```tsx
// Inside the submission card sub-component (or inline if simple):
const [revealed, setRevealed] = useState(false);
const isNsfw = submission.category?.slug === "nsfw";

<div className="relative">
  <img
    src={thumbnailUrl}
    alt=""
    className={isNsfw && !revealed ? "blur-2xl" : ""}
  />
  {isNsfw && !revealed && (
    <button
      type="button"
      onClick={() => setRevealed(true)}
      className="absolute inset-0 flex items-center justify-center bg-zinc-950/40 text-xs font-semibold text-rose-200 hover:bg-zinc-950/30"
    >
      {t("owner.modqueue.reveal_nsfw")}
    </button>
  )}
</div>
```

If the existing card is a simple inline map (not a sub-component), refactor minimally to add this logic — but don't restructure beyond what's needed.

- [ ] **Step 3: Manual verification**

Visit `/zh/rosekhlifa/submissions` (or whatever the mod queue route is) with at least one NSFW submission pending:
- The thumbnail is blurred.
- A "点击查看" button covers it.
- Clicking reveals the image; the reveal does NOT persist across page reload (state is local).

- [ ] **Step 4: Commit**

```
git add apps/web/src/pages/owner/SubmissionsPage.tsx
git commit -m "feat(nsfw): blur NSFW submission thumbnails in mod queue"
```

---

### Task 13: Acceptance walkthrough

**Files:** none — manual verification only.

- [ ] **Step 1: Run through every acceptance criterion in spec §15**

Take spec §15's 10 numbered items in order. For each, perform the click-through in a real browser, on a fresh tab/incognito where relevant. Note failures.

- [ ] **Step 2: Address any gaps**

If a criterion fails, dispatch a fix and re-verify just that criterion. Don't bundle fixes — one commit per fix.

- [ ] **Step 3: Final gates**

```
pnpm -F api typecheck
pnpm -F web typecheck
pnpm -F web build
pnpm -F shared test --run
```

Expected: all green. (Skip the full API test run per project memory — too much pollution risk.)

- [ ] **Step 4: Final commit (if any pending changes)**

```
git status
# if anything left:
git add -- <listed files>
git commit -m "fix(nsfw): acceptance walkthrough adjustments"
```

---

## Summary of commits this plan produces

| # | Subject |
|---|---------|
| 1 | feat(nsfw): seed nsfw category |
| 2 | feat(nsfw): assertNsfwTagInvariant helper + tests |
| 3 | feat(nsfw): excludeNsfw SQL filter helper |
| 4 | feat(nsfw): exclude NSFW from public list queries |
| 5 | feat(nsfw): enforce single-nsfw-tag invariant on submission + owner mutations |
| 6 | feat(nsfw): block nsfw category from JSONL import |
| 7 | feat(nsfw): error mapping + i18n keys (zh/en) |
| 8 | feat(nsfw): NsfwGateModal component |
| 9 | feat(nsfw): gate category=nsfw behind acknowledgment modal |
| 10 | feat(nsfw): submit page locks tags + requires inline acknowledgment |
| 11 | feat(nsfw): hide nsfw tag chip + show NSFW badge on detail page |
| 12 | feat(nsfw): blur NSFW submission thumbnails in mod queue |
| 13 | fix(nsfw): acceptance walkthrough adjustments (if needed) |
