import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { z } from "zod";
import { desc, eq, inArray, sql } from "drizzle-orm";
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
import { resolveTagForImport } from "../lib/tag-normalize.ts";

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
          const externalId = (parsed as { id?: string }).id;
          // exactOptionalPropertyTypes: omit the key entirely when there's no id.
          const entry: { line: number; externalId?: string; error: string } = {
            line: lineNo,
            error: `validate: ${result.error.issues[0]?.message ?? "unknown"}`,
          };
          if (typeof externalId === "string") entry.externalId = externalId;
          failedRecords.push(entry);
        }
        continue;
      }

      const rec = result.data;
      if (dryRun) {
        counters.inserted += 1;
        continue;
      }

      try {
        await insertOne(rec, args.startedBy, categoryIdBySlug, tagIdBySlug);
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
  const err = e as { code?: string; constraint?: string; message?: string };
  if (err.code !== "23505") return false;
  // Only treat as duplicate-external-id if the conflict is on the partial unique
  // index from migration 0013. Any other 23505 (e.g. prompts.slug collision from
  // ensureUniqueSlug deterministic hash) is a REAL failure and must surface.
  if (err.constraint === "prompts_external_id_uq") return true;
  if (typeof err.message === "string" && err.message.includes("prompts_external_id_uq")) return true;
  return false;
}

async function insertOne(
  rec: ImportRawRecord,
  contributorId: string,
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

  // 2. Resolve tag ids (UPSERT each). Each incoming normalized_tag is run
  //    through the canonical map (apps/api/src/lib/tag-normalize.ts) so
  //    aliases like "美食 / 美食餐饮 / Food / food" all resolve to a single
  //    canonical row with a proper bilingual name. Names outside the map
  //    fall back to the prior behavior: slug = tagSlugFromName, name =
  //    { zh: raw, en: raw }.
  const resolved = rec.normalized_tags.map((n) => resolveTagForImport(n));
  const tagIds: string[] = [];
  for (const r of resolved) {
    let id = tagIdBySlug.get(r.slug);
    if (!id) {
      id = await upsertTag(r.slug, r.zh, r.en);
      tagIdBySlug.set(r.slug, id);
    }
    if (!tagIds.includes(id)) tagIds.push(id);
  }

  // 3. Insert the prompt row. ON CONFLICT (external_id) DO NOTHING returns 0
  //    rows when this id was already imported.
  // Crawled records carry no per-language metadata; fill both sides with the
  // same title so prompts_title_bilingual_chk passes and pickBilingual works
  // regardless of viewer locale.
  const titleBilingual: { zh?: string; en?: string } = {};
  titleBilingual.zh = rec.title;
  titleBilingual.en = rec.title;
  const promptBilingual: { zh?: string; en?: string } = {};
  if (hasContent(rec.prompts.zh)) promptBilingual.zh = rec.prompts.zh;
  if (hasContent(rec.prompts.en)) promptBilingual.en = rec.prompts.en;

  const slug = await ensureUniqueSlug(rec.title, rec.id);

  // The unique index on prompts.external_id is partial (WHERE external_id IS NOT NULL),
  // so ON CONFLICT must repeat the predicate or Postgres won't match it.
  const inserted = await db
    .insert(prompts)
    .values({
      slug,
      source: "imported",
      title: titleBilingual,
      prompt: promptBilingual,
      categoryId: catId,
      // Per 2026-06-09 UX: imports attribute to the running admin so cards
      // render as a real contribution. The `source_url` + `source_site`
      // columns still preserve attribution; the detail page renders it as
      // a subtle footer line.
      contributorId,
      externalId: rec.id,
      sourceUrl: rec.source_url,
      sourceSite: rec.source_site,
      approvedAt: new Date(),
    })
    .onConflictDoNothing({
      target: prompts.externalId,
      where: sql`${prompts.externalId} IS NOT NULL`,
    })
    .returning({ id: prompts.id });

  if (inserted.length === 0) {
    // Synthesize the same shape Postgres would have raised, so isDuplicateExternalId
    // routes us through the skippedDuplicate counter. Note we set `constraint` to
    // the partial-unique index name from migration 0013 — without it, the constraint
    // narrowing in isDuplicateExternalId would reject this as a real failure.
    const err = new Error("duplicate external_id");
    (err as { code?: string; constraint?: string }).code = "23505";
    (err as { code?: string; constraint?: string }).constraint = "prompts_external_id_uq";
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
      .where(inArray(tags.id, tagIds));
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

async function upsertTag(slug: string, zh: string, en: string): Promise<string> {
  await db
    .insert(tags)
    .values({
      slug,
      name: { zh, en },
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
