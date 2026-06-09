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
    const externalId = `${PREFIX}numeric-${Date.now()}`;
    const file = await writeJsonl("numeric.jsonl", [
      makeRecord({ id: externalId, sourceId: 12345 as unknown as string }),
    ]);
    const result = await importCategoryJsonl({
      filePath: file, categorySlug: `${PREFIX}cat-food`, startedBy: ownerId,
    });
    expect(result.inserted).toBe(1);
    // Read the prompt back so a future Zod-transform regression surfaces here.
    const [p] = await db.select().from(prompts).where(eq(prompts.externalId, externalId));
    expect(p).toBeDefined();
    expect(p!.externalId).toBe(externalId);
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

  it("rejects nsfw categorySlug outright (Task 6)", async () => {
    await expect(
      importCategoryJsonl({
        filePath: "/dev/null",
        categorySlug: "nsfw",
        startedBy: ownerId,
      }),
    ).rejects.toThrow("nsfw_import_forbidden");
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
