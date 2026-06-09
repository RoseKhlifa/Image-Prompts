import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq, inArray, like, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  users,
  categories,
  tags,
  prompts,
  promptTags,
} from "../db/schema/index.ts";
import {
  listCategoriesForOwner,
  getCategoryForOwner,
  createCategory,
  updateCategory,
  deleteCategory,
  listTagsForOwner,
  getTagForOwner,
  createTag,
  updateTag,
  deleteTag,
} from "./owner-taxonomy.ts";

// All test rows wear a `tw-tax-` prefix on slug + email so cleanup() can sweep
// them without touching the dev seed. We also wipe prompt_tags + prompts that
// reference our test-category / test-tag rows so the rows themselves can be
// hard-deleted; the schema's FK constraints don't cascade across taxonomy →
// prompts and we don't want to depend on test ordering for that.
const TEST_PREFIX = "tw-tax-";
const TEST_EMAIL = `${TEST_PREFIX}user@example.com`;

async function cleanup() {
  // Order matters: prompts FK categories.id NOT NULL + prompt_tags FK tags.id
  // (cascade) — must clear prompt_tags + prompts before we can hard-delete the
  // category / tag rows the tests planted.
  const testCatIds = (
    await db
      .select({ id: categories.id })
      .from(categories)
      .where(like(categories.slug, `${TEST_PREFIX}%`))
  ).map((r) => r.id);
  const testTagIds = (
    await db
      .select({ id: tags.id })
      .from(tags)
      .where(like(tags.slug, `${TEST_PREFIX}%`))
  ).map((r) => r.id);
  const testPromptIds = (
    await db
      .select({ id: prompts.id })
      .from(prompts)
      .where(like(prompts.slug, `${TEST_PREFIX}%`))
  ).map((r) => r.id);
  if (testPromptIds.length > 0) {
    await db.delete(promptTags).where(inArray(promptTags.promptId, testPromptIds));
    await db.delete(prompts).where(inArray(prompts.id, testPromptIds));
  }
  if (testCatIds.length > 0) {
    await db.delete(categories).where(inArray(categories.id, testCatIds));
  }
  if (testTagIds.length > 0) {
    await db.delete(tags).where(inArray(tags.id, testTagIds));
  }
  await db.delete(users).where(like(users.email, `${TEST_PREFIX}%@example.com`));
}

beforeEach(cleanup);
afterAll(cleanup);

let counter = 0;
function uniq(suffix = ""): string {
  counter += 1;
  return `${TEST_PREFIX}${counter}-${Date.now()}${suffix}`;
}

async function makeTestUser() {
  const [u] = await db
    .insert(users)
    .values({ email: TEST_EMAIL })
    .returning();
  return u!;
}

// ── Categories ───────────────────────────────────────────────────────────

describe("createCategory + getCategoryForOwner", () => {
  it("roundtrips slug/name/description/order with promptCount=0", async () => {
    const slug = uniq();
    const created = await createCategory({
      slug,
      name: { zh: "测试", en: "Test" },
      description: { en: "desc" },
      order: 7,
    });
    expect(created.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(created.slug).toBe(slug);
    expect(created.name).toEqual({ zh: "测试", en: "Test" });
    expect(created.description).toEqual({ en: "desc" });
    expect(created.order).toBe(7);
    expect(created.promptCount).toBe(0);
    expect(created.createdAt).toBeInstanceOf(Date);

    const got = await getCategoryForOwner(created.id);
    expect(got).not.toBeNull();
    expect(got!.slug).toBe(slug);
  });

  it("defaults order to 0 when omitted and description to null", async () => {
    const created = await createCategory({
      slug: uniq(),
      name: { en: "Minimal" },
    });
    expect(created.order).toBe(0);
    expect(created.description).toBeNull();
  });

  it("rejects duplicate slug via DB unique constraint", async () => {
    const slug = uniq();
    await createCategory({ slug, name: { en: "A" } });
    await expect(
      createCategory({ slug, name: { en: "B" } }),
    ).rejects.toThrow();
  });
});

describe("listCategoriesForOwner", () => {
  it("returns rows including the seeded one with promptCount field", async () => {
    const slug = uniq();
    await createCategory({ slug, name: { en: "L" }, order: 5 });
    const list = await listCategoriesForOwner();
    const mine = list.find((r) => r.slug === slug);
    expect(mine).toBeDefined();
    expect(mine!.promptCount).toBe(0);
    expect(typeof mine!.promptCount).toBe("number");
  });
});

describe("updateCategory", () => {
  it("partial update changes only the name, slug stays", async () => {
    const slug = uniq();
    const c = await createCategory({
      slug,
      name: { zh: "原" },
      order: 1,
    });
    const updated = await updateCategory(c.id, {
      name: { zh: "新", en: "New" },
    });
    expect(updated).not.toBeNull();
    expect(updated!.slug).toBe(slug);
    expect(updated!.name).toEqual({ zh: "新", en: "New" });
    expect(updated!.order).toBe(1);
  });

  it("returns null for unknown id", async () => {
    const r = await updateCategory(
      "00000000-0000-0000-0000-000000000000",
      { name: { en: "x" } },
    );
    expect(r).toBeNull();
  });
});

describe("deleteCategory", () => {
  it("returns ok when no prompts reference it", async () => {
    const c = await createCategory({ slug: uniq(), name: { en: "delme" } });
    const r = await deleteCategory(c.id);
    expect(r).toEqual({ ok: true });
    const gone = await getCategoryForOwner(c.id);
    expect(gone).toBeNull();
  });

  it("returns in_use with count when a prompt references it", async () => {
    const u = await makeTestUser();
    const c = await createCategory({ slug: uniq(), name: { en: "blocked" } });
    // Plant 1 prompt that references this category. Min schema: slug/title/
    // prompt all required + categoryId NOT NULL. Bilingual check requires
    // ≥1 of zh/en on title + prompt.
    await db.insert(prompts).values({
      slug: uniq("-p"),
      title: { en: "p" },
      prompt: { en: "do a thing" },
      categoryId: c.id,
      contributorId: u.id,
    });
    const r = await deleteCategory(c.id);
    expect(r).toEqual({ ok: false, reason: "in_use", count: 1 });
    // Row still present.
    const still = await getCategoryForOwner(c.id);
    expect(still).not.toBeNull();
  });

  it("returns not_found for unknown id", async () => {
    const r = await deleteCategory("00000000-0000-0000-0000-000000000000");
    expect(r).toEqual({ ok: false, reason: "not_found" });
  });
});

// ── Tags ─────────────────────────────────────────────────────────────────

describe("createTag + getTagForOwner", () => {
  it("roundtrips slug/name with usageCount=0, promptCount=0", async () => {
    const slug = uniq();
    const created = await createTag({
      slug,
      name: { zh: "标", en: "Tag" },
    });
    expect(created.slug).toBe(slug);
    expect(created.name).toEqual({ zh: "标", en: "Tag" });
    expect(created.usageCount).toBe(0);
    expect(created.promptCount).toBe(0);
    expect(created.createdAt).toBeInstanceOf(Date);

    const got = await getTagForOwner(created.id);
    expect(got).not.toBeNull();
    expect(got!.slug).toBe(slug);
  });

  it("rejects duplicate slug via DB unique constraint", async () => {
    const slug = uniq();
    await createTag({ slug, name: { en: "A" } });
    await expect(createTag({ slug, name: { en: "B" } })).rejects.toThrow();
  });
});

describe("listTagsForOwner", () => {
  it("returns rows including the seeded one with promptCount field", async () => {
    const slug = uniq();
    await createTag({ slug, name: { en: "L" } });
    const list = await listTagsForOwner();
    const mine = list.find((r) => r.slug === slug);
    expect(mine).toBeDefined();
    expect(mine!.promptCount).toBe(0);
    expect(typeof mine!.promptCount).toBe("number");
    expect(typeof mine!.usageCount).toBe("number");
  });
});

describe("updateTag", () => {
  it("partial update changes only the name, slug stays", async () => {
    const slug = uniq();
    const t = await createTag({ slug, name: { zh: "原" } });
    const updated = await updateTag(t.id, { name: { zh: "新", en: "New" } });
    expect(updated).not.toBeNull();
    expect(updated!.slug).toBe(slug);
    expect(updated!.name).toEqual({ zh: "新", en: "New" });
  });

  it("returns null for unknown id", async () => {
    const r = await updateTag(
      "00000000-0000-0000-0000-000000000000",
      { name: { en: "x" } },
    );
    expect(r).toBeNull();
  });
});

describe("deleteTag", () => {
  it("returns ok when no prompt_tags reference it", async () => {
    const t = await createTag({ slug: uniq(), name: { en: "delme" } });
    const r = await deleteTag(t.id);
    expect(r).toEqual({ ok: true });
    const gone = await getTagForOwner(t.id);
    expect(gone).toBeNull();
  });

  it("returns in_use with count when a prompt_tags row references it", async () => {
    const u = await makeTestUser();
    // Need a category to host the prompt (prompts.category_id NOT NULL).
    const c = await createCategory({ slug: uniq(), name: { en: "host" } });
    const tg = await createTag({ slug: uniq(), name: { en: "blocked" } });
    const [p] = await db
      .insert(prompts)
      .values({
        slug: uniq("-p"),
        title: { en: "p" },
        prompt: { en: "do a thing" },
        categoryId: c.id,
        contributorId: u.id,
      })
      .returning({ id: prompts.id });
    await db.insert(promptTags).values({ promptId: p!.id, tagId: tg.id });
    const r = await deleteTag(tg.id);
    expect(r).toEqual({ ok: false, reason: "in_use", count: 1 });
    // Tag row still present.
    const still = await getTagForOwner(tg.id);
    expect(still).not.toBeNull();
  });

  it("returns not_found for unknown id", async () => {
    const r = await deleteTag("00000000-0000-0000-0000-000000000000");
    expect(r).toEqual({ ok: false, reason: "not_found" });
  });
});
