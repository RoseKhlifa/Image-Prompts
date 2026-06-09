import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { eq, inArray, like, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import {
  users,
  categories,
  tags,
  prompts,
  promptTags,
  promptImages,
  submissions,
  r2Accounts,
  auditLog,
} from "../db/schema/index.ts";
import { encryptSecret } from "../lib/crypto.ts";
import {
  listAllPromptsForOwner,
  getPromptForOwner,
  createPromptDirect,
  updatePromptForOwner,
  deletePromptForOwner,
} from "./owner-prompts.ts";

// Test isolation: every test slug + email wears `tw41r-` so cleanup can
// sweep without touching dev data. We also sweep the test R2 account so
// the keyspace tests don't pile orphans.
const TEST_PREFIX = "tw41r-";
const TEST_EMAIL = `${TEST_PREFIX}owner@example.com`;
const TEST_R2_NAME = "tw41r-r2";

beforeAll(() => {
  process.env.R2_ENCRYPTION_KEY ||=
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
});

async function cleanup() {
  // Discover ids by slug/email prefix, then delete in FK order. Two extra
  // concerns:
  //  - the test categories are also referenced by prompts on dev seed rows
  //    (they're not — we only wipe rows that wear our prefixes), but prompts
  //    that contribute *to* test users live on dev categories; those have
  //    to be cleared before the user delete can land.
  //  - submissions reference both contributors AND categories; both arrows
  //    must be drained before the parents can be deleted.
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
  const testUserIds = (
    await db
      .select({ id: users.id })
      .from(users)
      .where(like(users.email, `${TEST_PREFIX}%@example.com`))
  ).map((r) => r.id);

  // Test prompts: discovered by slug prefix OR by referencing a test
  // category OR contributor (so dev-side rows that piggy-back on our
  // category get cleaned up too). Slug prefix is a superset of the
  // ones createPromptDirect spawned for the test.
  const promptsByPrefix = (
    await db
      .select({ id: prompts.id })
      .from(prompts)
      .where(like(prompts.slug, `${TEST_PREFIX}%`))
  ).map((r) => r.id);
  const promptsByCat = testCatIds.length > 0
    ? (
        await db
          .select({ id: prompts.id })
          .from(prompts)
          .where(inArray(prompts.categoryId, testCatIds))
      ).map((r) => r.id)
    : [];
  const promptsByContrib = testUserIds.length > 0
    ? (
        await db
          .select({ id: prompts.id })
          .from(prompts)
          .where(inArray(prompts.contributorId, testUserIds))
      ).map((r) => r.id)
    : [];
  const testPromptIds = Array.from(
    new Set([...promptsByPrefix, ...promptsByCat, ...promptsByContrib]),
  );

  if (testPromptIds.length > 0) {
    await db.delete(promptImages).where(inArray(promptImages.promptId, testPromptIds));
    await db.delete(promptTags).where(inArray(promptTags.promptId, testPromptIds));
    await db
      .update(submissions)
      .set({ promotedTo: null })
      .where(inArray(submissions.promotedTo, testPromptIds));
    await db.delete(prompts).where(inArray(prompts.id, testPromptIds));
  }
  if (testUserIds.length > 0) {
    // Submissions FK both contributor + category — clean by contributor here
    // and by category in the next block.
    await db.delete(submissions).where(inArray(submissions.contributorId, testUserIds));
    await db.delete(auditLog).where(inArray(auditLog.actorId, testUserIds));
  }
  if (testCatIds.length > 0) {
    await db.delete(submissions).where(inArray(submissions.categoryId, testCatIds));
    await db.delete(categories).where(inArray(categories.id, testCatIds));
  }
  if (testTagIds.length > 0) {
    await db.delete(tags).where(inArray(tags.id, testTagIds));
  }
  if (testUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, testUserIds));
  }
  await db.delete(r2Accounts).where(eq(r2Accounts.name, TEST_R2_NAME));
}

beforeEach(cleanup);
afterAll(cleanup);

let counter = 0;
function uniq(suffix = ""): string {
  counter += 1;
  return `${TEST_PREFIX}${counter}-${Date.now()}${suffix}`;
}

async function makeOwner() {
  const [u] = await db
    .insert(users)
    .values({ email: `${TEST_PREFIX}owner-${counter}-${Date.now()}@example.com`, role: "admin" })
    .returning();
  counter += 1;
  return u!;
}

async function makeContributor() {
  const [u] = await db
    .insert(users)
    .values({ email: `${TEST_PREFIX}contrib-${counter}-${Date.now()}@example.com`, role: "user" })
    .returning();
  counter += 1;
  return u!;
}

async function makeCategory() {
  const slug = uniq("-cat");
  const [c] = await db
    .insert(categories)
    .values({ slug, name: { zh: slug, en: slug } })
    .returning();
  return c!;
}

async function makeTag(slugSuffix = "") {
  const slug = uniq(`-tag${slugSuffix}`);
  const [t] = await db
    .insert(tags)
    .values({ slug, name: { zh: slug, en: slug } })
    .returning();
  return t!;
}

async function makeR2() {
  // The test repo doesn't reach the network, but prompt_images.r2_account_id
  // FKs r2_accounts so we need a real row.
  const [r] = await db
    .insert(r2Accounts)
    .values({
      name: TEST_R2_NAME,
      accountId: "tw41r-account",
      endpoint: "https://tw41r.example.com",
      accessKeyId: "K",
      accessKeySecretEncrypted: encryptSecret("s"),
      bucket: "tw41r",
      publicUrl: "https://tw41r.example.com",
      priority: 999,
      enabled: false,
    })
    .returning();
  return r!;
}

async function makePromptDirect(opts?: {
  ownerId?: string;
  categoryId?: string;
  r2AccountId?: string;
  titleEn?: string;
  promptEn?: string;
  tagSlugs?: string[];
}) {
  const owner = opts?.ownerId
    ? { id: opts.ownerId }
    : await makeOwner();
  const cat = opts?.categoryId
    ? { id: opts.categoryId }
    : await makeCategory();
  const r2 = opts?.r2AccountId
    ? { id: opts.r2AccountId }
    : await makeR2();
  return await createPromptDirect(
    {
      titleZh: null,
      titleEn: opts?.titleEn ?? `tw41r prompt ${counter}`,
      promptZh: null,
      promptEn: opts?.promptEn ?? "hello world",
      negativePromptZh: null,
      negativePromptEn: null,
      notesZh: null,
      notesEn: null,
      aspectRatio: null,
      categoryId: cat.id,
      tagSlugs: opts?.tagSlugs ?? [],
      images: [
        { r2AccountId: r2.id, r2Key: `submissions/owner/${uniq()}.jpg` },
      ],
    },
    owner.id,
  );
}

// ── listAllPromptsForOwner ──────────────────────────────────────────────

describe("listAllPromptsForOwner", () => {
  it("returns rows in createdAt desc with the documented shape", async () => {
    const owner = await makeOwner();
    const cat = await makeCategory();
    const r2 = await makeR2();
    const a = await createPromptDirect(
      {
        titleZh: "tw41r甲", titleEn: "tw41r A",
        promptZh: "甲提示", promptEn: "alpha",
        negativePromptZh: null, negativePromptEn: null,
        notesZh: null, notesEn: null,
        aspectRatio: "1:1",
        categoryId: cat.id,
        tagSlugs: [],
        images: [{ r2AccountId: r2.id, r2Key: `submissions/owner/${uniq()}.jpg` }],
      },
      owner.id,
    );
    await new Promise((r) => setTimeout(r, 5));
    const b = await createPromptDirect(
      {
        titleZh: "tw41r乙", titleEn: "tw41r B",
        promptZh: "乙提示", promptEn: "beta",
        negativePromptZh: null, negativePromptEn: null,
        notesZh: null, notesEn: null,
        aspectRatio: null,
        categoryId: cat.id,
        tagSlugs: [],
        images: [{ r2AccountId: r2.id, r2Key: `submissions/owner/${uniq()}.jpg` }],
      },
      owner.id,
    );

    const { items } = await listAllPromptsForOwner({ q: "tw41r" });
    const ours = items.filter((i) => i.id === a.id || i.id === b.id);
    expect(ours).toHaveLength(2);
    expect(ours[0]!.id).toBe(b.id);
    expect(ours[1]!.id).toBe(a.id);
    const row = ours[0]!;
    expect(row.title.zh).toBe("tw41r乙");
    expect(row.title.en).toBe("tw41r B");
    expect(typeof row.viewCount).toBe("number");
    expect(row.category.id).toBe(cat.id);
    expect(row.contributor?.id).toBe(owner.id);
    expect(row.tagSlugs).toEqual([]);
  });

  it("filters by q matching title, prompt, or slug", async () => {
    const owner = await makeOwner();
    const cat = await makeCategory();
    const r2 = await makeR2();
    await createPromptDirect(
      {
        titleZh: null, titleEn: "uniquetw41rapple",
        promptZh: null, promptEn: "p",
        negativePromptZh: null, negativePromptEn: null,
        notesZh: null, notesEn: null,
        aspectRatio: null,
        categoryId: cat.id, tagSlugs: [],
        images: [{ r2AccountId: r2.id, r2Key: `submissions/owner/${uniq()}.jpg` }],
      },
      owner.id,
    );
    await createPromptDirect(
      {
        titleZh: null, titleEn: "tw41r banana title",
        promptZh: null, promptEn: "ban content uniquetw41rbananaprompt",
        negativePromptZh: null, negativePromptEn: null,
        notesZh: null, notesEn: null,
        aspectRatio: null,
        categoryId: cat.id, tagSlugs: [],
        images: [{ r2AccountId: r2.id, r2Key: `submissions/owner/${uniq()}.jpg` }],
      },
      owner.id,
    );

    const titleHit = await listAllPromptsForOwner({ q: "uniquetw41rapple" });
    expect(titleHit.items.length).toBeGreaterThanOrEqual(1);
    expect(titleHit.items.some((i) => i.title.en === "uniquetw41rapple")).toBe(true);

    const promptHit = await listAllPromptsForOwner({ q: "uniquetw41rbananaprompt" });
    expect(promptHit.items.length).toBeGreaterThanOrEqual(1);
    expect(promptHit.items.some((i) => i.title.en === "tw41r banana title")).toBe(true);
  });

  it("filters by categorySlug", async () => {
    const owner = await makeOwner();
    const r2 = await makeR2();
    const c1 = await makeCategory();
    const c2 = await makeCategory();
    const aRes = await makePromptDirect({ ownerId: owner.id, categoryId: c1.id, r2AccountId: r2.id });
    const bRes = await makePromptDirect({ ownerId: owner.id, categoryId: c2.id, r2AccountId: r2.id });

    const { items: aItems } = await listAllPromptsForOwner({ categorySlug: c1.slug });
    const ours = aItems.filter((i) => i.id === aRes.id || i.id === bRes.id);
    expect(ours).toHaveLength(1);
    expect(ours[0]!.id).toBe(aRes.id);
  });

  it("paginates with limit + cursor", async () => {
    const owner = await makeOwner();
    const cat = await makeCategory();
    const r2 = await makeR2();
    const seen = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const { id } = await makePromptDirect({
        ownerId: owner.id, categoryId: cat.id, r2AccountId: r2.id,
        titleEn: `tw41r-paginate-${i}`,
      });
      seen.add(id);
      await new Promise((r) => setTimeout(r, 5));
    }

    const p1 = await listAllPromptsForOwner({ q: "tw41r-paginate", limit: 1 });
    expect(p1.items).toHaveLength(1);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = await listAllPromptsForOwner({
      q: "tw41r-paginate", limit: 1, cursor: p1.nextCursor!,
    });
    expect(p2.items).toHaveLength(1);
    expect(p2.items[0]!.id).not.toBe(p1.items[0]!.id);
  });

  it("returns the primary image (order=0) when present", async () => {
    const owner = await makeOwner();
    const cat = await makeCategory();
    const r2 = await makeR2();
    const { id } = await createPromptDirect(
      {
        titleZh: null, titleEn: "tw41r-imgtest",
        promptZh: null, promptEn: "p",
        negativePromptZh: null, negativePromptEn: null,
        notesZh: null, notesEn: null,
        aspectRatio: null,
        categoryId: cat.id, tagSlugs: [],
        images: [
          { r2AccountId: r2.id, r2Key: `submissions/owner/${uniq()}-a.jpg` },
          { r2AccountId: r2.id, r2Key: `submissions/owner/${uniq()}-b.jpg` },
        ],
      },
      owner.id,
    );
    const { items } = await listAllPromptsForOwner({ q: "tw41r-imgtest" });
    const row = items.find((i) => i.id === id);
    expect(row).toBeDefined();
    expect(row!.primaryImage).not.toBeNull();
    expect(row!.primaryImage!.r2AccountId).toBe(r2.id);
  });
});

// ── getPromptForOwner ──────────────────────────────────────────────────

describe("getPromptForOwner", () => {
  it("returns null for an unknown id", async () => {
    const r = await getPromptForOwner("00000000-0000-0000-0000-000000000000");
    expect(r).toBeNull();
  });

  it("returns full detail with images sorted by order", async () => {
    const owner = await makeOwner();
    const cat = await makeCategory();
    const r2 = await makeR2();
    const { id } = await createPromptDirect(
      {
        titleZh: "完整", titleEn: "Full",
        promptZh: "提示", promptEn: "prompt",
        negativePromptZh: "负", negativePromptEn: "neg",
        notesZh: "备注", notesEn: "notes",
        aspectRatio: "16:9",
        categoryId: cat.id, tagSlugs: [],
        images: [
          { r2AccountId: r2.id, r2Key: `submissions/owner/${uniq()}-a.jpg` },
          { r2AccountId: r2.id, r2Key: `submissions/owner/${uniq()}-b.jpg` },
        ],
      },
      owner.id,
    );
    const d = await getPromptForOwner(id);
    expect(d).not.toBeNull();
    expect(d!.title.zh).toBe("完整");
    expect(d!.prompt.en).toBe("prompt");
    expect(d!.negativePrompt?.zh).toBe("负");
    expect(d!.notes?.en).toBe("notes");
    expect(d!.aspectRatio).toBe("16:9");
    expect(d!.images).toHaveLength(2);
    expect(d!.images[0]!.order).toBe(0);
    expect(d!.images[1]!.order).toBe(1);
    expect(d!.contributor?.id).toBe(owner.id);
  });
});

// ── createPromptDirect ─────────────────────────────────────────────────

describe("createPromptDirect", () => {
  it("inserts prompt + prompt_images + prompt_tags with approvedAt set", async () => {
    const owner = await makeOwner();
    const cat = await makeCategory();
    const r2 = await makeR2();
    const t1 = await makeTag();
    const t2 = await makeTag();

    const before = Date.now();
    const { id, slug } = await createPromptDirect(
      {
        titleZh: null, titleEn: "tw41r-create",
        promptZh: null, promptEn: "create prompt",
        negativePromptZh: null, negativePromptEn: null,
        notesZh: null, notesEn: null,
        aspectRatio: "1:1",
        categoryId: cat.id,
        tagSlugs: [t1.slug, t2.slug],
        images: [{ r2AccountId: r2.id, r2Key: `submissions/owner/${uniq()}.jpg` }],
      },
      owner.id,
    );
    expect(slug.startsWith("tw41r-create")).toBe(true);

    const [row] = await db
      .select()
      .from(prompts)
      .where(eq(prompts.id, id));
    expect(row!.source).toBe("site");
    expect(row!.contributorId).toBe(owner.id);
    expect(row!.approvedAt.getTime()).toBeGreaterThanOrEqual(before);

    const ptRows = await db.select().from(promptTags).where(eq(promptTags.promptId, id));
    expect(ptRows).toHaveLength(2);

    const piRows = await db.select().from(promptImages).where(eq(promptImages.promptId, id));
    expect(piRows).toHaveLength(1);
    expect(piRows[0]!.order).toBe(0);
  });

  it("bumps tags.usage_count by 1 per attached tag", async () => {
    const owner = await makeOwner();
    const cat = await makeCategory();
    const r2 = await makeR2();
    const t1 = await makeTag();
    const startUsage = t1.usageCount;

    await createPromptDirect(
      {
        titleZh: null, titleEn: "tw41r-usage",
        promptZh: null, promptEn: "p",
        negativePromptZh: null, negativePromptEn: null,
        notesZh: null, notesEn: null,
        aspectRatio: null,
        categoryId: cat.id,
        tagSlugs: [t1.slug],
        images: [{ r2AccountId: r2.id, r2Key: `submissions/owner/${uniq()}.jpg` }],
      },
      owner.id,
    );

    const [reread] = await db.select().from(tags).where(eq(tags.id, t1.id));
    expect(reread!.usageCount).toBe(startUsage + 1);
  });

  it("retries slug on conflict (uniqueness preserved)", async () => {
    const owner = await makeOwner();
    const cat = await makeCategory();
    const r2 = await makeR2();
    const sharedTitle = "tw41r-collide";
    const a = await createPromptDirect(
      {
        titleZh: null, titleEn: sharedTitle,
        promptZh: null, promptEn: "p",
        negativePromptZh: null, negativePromptEn: null,
        notesZh: null, notesEn: null,
        aspectRatio: null,
        categoryId: cat.id, tagSlugs: [],
        images: [{ r2AccountId: r2.id, r2Key: `submissions/owner/${uniq()}.jpg` }],
      },
      owner.id,
    );
    const b = await createPromptDirect(
      {
        titleZh: null, titleEn: sharedTitle,
        promptZh: null, promptEn: "p",
        negativePromptZh: null, negativePromptEn: null,
        notesZh: null, notesEn: null,
        aspectRatio: null,
        categoryId: cat.id, tagSlugs: [],
        images: [{ r2AccountId: r2.id, r2Key: `submissions/owner/${uniq()}.jpg` }],
      },
      owner.id,
    );
    expect(a.slug).not.toBe(b.slug);
    // Second slug should have the -2 suffix per generateUniqueSlug.
    expect(b.slug.endsWith("-2")).toBe(true);
  });

  it("rejects when both titleZh and titleEn are empty", async () => {
    const owner = await makeOwner();
    const cat = await makeCategory();
    const r2 = await makeR2();
    await expect(
      createPromptDirect(
        {
          titleZh: null, titleEn: null,
          promptZh: null, promptEn: "p",
          negativePromptZh: null, negativePromptEn: null,
          notesZh: null, notesEn: null,
          aspectRatio: null,
          categoryId: cat.id, tagSlugs: [],
          images: [{ r2AccountId: r2.id, r2Key: `submissions/owner/${uniq()}.jpg` }],
        },
        owner.id,
      ),
    ).rejects.toThrow();
  });
});

// ── updatePromptForOwner ───────────────────────────────────────────────

describe("updatePromptForOwner", () => {
  it("returns null for an unknown id", async () => {
    const r = await updatePromptForOwner(
      "00000000-0000-0000-0000-000000000000",
      { titleEn: "x" },
    );
    expect(r).toBeNull();
  });

  it("patches a single field and bumps updatedAt", async () => {
    const { id } = await makePromptDirect();
    const before = await getPromptForOwner(id);
    await new Promise((r) => setTimeout(r, 5));
    const patched = await updatePromptForOwner(id, { aspectRatio: "21:9" });
    expect(patched).not.toBeNull();
    expect(patched!.detail.aspectRatio).toBe("21:9");
    expect(patched!.detail.updatedAt.getTime()).toBeGreaterThan(before!.updatedAt.getTime());
  });

  it("merges bilingual jsonb safely (zh overwrite preserves en)", async () => {
    const owner = await makeOwner();
    const cat = await makeCategory();
    const r2 = await makeR2();
    const { id } = await createPromptDirect(
      {
        titleZh: "原始中", titleEn: "Original EN",
        promptZh: "原始", promptEn: "Original",
        negativePromptZh: null, negativePromptEn: null,
        notesZh: null, notesEn: null,
        aspectRatio: null,
        categoryId: cat.id, tagSlugs: [],
        images: [{ r2AccountId: r2.id, r2Key: `submissions/owner/${uniq()}.jpg` }],
      },
      owner.id,
    );
    const patched = await updatePromptForOwner(id, { titleZh: "新中" });
    expect(patched!.detail.title.zh).toBe("新中");
    expect(patched!.detail.title.en).toBe("Original EN"); // EN preserved
  });

  it("replaces tagSlugs (delta-adjusts usage_count)", async () => {
    const owner = await makeOwner();
    const cat = await makeCategory();
    const r2 = await makeR2();
    const t1 = await makeTag();
    const t2 = await makeTag();
    const t3 = await makeTag();

    const { id } = await createPromptDirect(
      {
        titleZh: null, titleEn: "tw41r-tagdelta",
        promptZh: null, promptEn: "p",
        negativePromptZh: null, negativePromptEn: null,
        notesZh: null, notesEn: null,
        aspectRatio: null,
        categoryId: cat.id, tagSlugs: [t1.slug, t2.slug],
        images: [{ r2AccountId: r2.id, r2Key: `submissions/owner/${uniq()}.jpg` }],
      },
      owner.id,
    );
    // Now baseline: t1.usageCount = +1, t2.usageCount = +1, t3.usageCount unchanged.
    const [t1a] = await db.select().from(tags).where(eq(tags.id, t1.id));
    const [t2a] = await db.select().from(tags).where(eq(tags.id, t2.id));
    const [t3a] = await db.select().from(tags).where(eq(tags.id, t3.id));

    // Swap: keep t1, drop t2, add t3.
    await updatePromptForOwner(id, { tagSlugs: [t1.slug, t3.slug] });

    const [t1b] = await db.select().from(tags).where(eq(tags.id, t1.id));
    const [t2b] = await db.select().from(tags).where(eq(tags.id, t2.id));
    const [t3b] = await db.select().from(tags).where(eq(tags.id, t3.id));
    expect(t1b!.usageCount).toBe(t1a!.usageCount); // unchanged (kept)
    expect(t2b!.usageCount).toBe(t2a!.usageCount - 1); // removed
    expect(t3b!.usageCount).toBe(t3a!.usageCount + 1); // added

    const pt = await db.select().from(promptTags).where(eq(promptTags.promptId, id));
    const slugs = await db
      .select({ slug: tags.slug })
      .from(promptTags)
      .innerJoin(tags, eq(tags.id, promptTags.tagId))
      .where(eq(promptTags.promptId, id));
    expect(pt).toHaveLength(2);
    expect(new Set(slugs.map((s) => s.slug))).toEqual(new Set([t1.slug, t3.slug]));
  });

  it("clears optional bilingual fields when both sides become empty", async () => {
    const owner = await makeOwner();
    const cat = await makeCategory();
    const r2 = await makeR2();
    const { id } = await createPromptDirect(
      {
        titleZh: null, titleEn: "tw41r-clear",
        promptZh: null, promptEn: "p",
        negativePromptZh: "neg-zh", negativePromptEn: "neg-en",
        notesZh: null, notesEn: null,
        aspectRatio: null,
        categoryId: cat.id, tagSlugs: [],
        images: [{ r2AccountId: r2.id, r2Key: `submissions/owner/${uniq()}.jpg` }],
      },
      owner.id,
    );
    // Empty string clears both sides → negativePrompt → null.
    const patched = await updatePromptForOwner(id, {
      negativePromptZh: "",
      negativePromptEn: "",
    });
    expect(patched!.detail.negativePrompt).toBeNull();
  });

  it("does not touch images on PATCH (when images is undefined)", async () => {
    const { id } = await makePromptDirect();
    const before = await getPromptForOwner(id);
    await updatePromptForOwner(id, { aspectRatio: "16:9" });
    const after = await getPromptForOwner(id);
    expect(after!.images).toEqual(before!.images);
  });

  // ── Image diff-replace ────────────────────────────────────────────────
  //
  // tw42r- prefix per the test-isolation spec for Feature A. We pass r2Keys
  // that match the patterns the real flow will use:
  //   - prompts/<id>/<order>.<ext> for "kept" (already-migrated) images
  //   - submissions/* for "new" (fresh upload, route migrates post-tx)
  // Foreign keyspaces (any other prefix) must reject.

  it("update with images: kept-only (no R2 change, count unchanged)", async () => {
    const owner = await makeOwner();
    const cat = await makeCategory();
    const r2 = await makeR2();
    const { id } = await createPromptDirect(
      {
        titleZh: null, titleEn: "tw42r-kept",
        promptZh: null, promptEn: "p",
        negativePromptZh: null, negativePromptEn: null,
        notesZh: null, notesEn: null,
        aspectRatio: null,
        categoryId: cat.id, tagSlugs: [],
        images: [
          { r2AccountId: r2.id, r2Key: `submissions/owner/${uniq()}-a.jpg` },
        ],
      },
      owner.id,
    );
    // Manually rename the existing row's key to look like a migrated one so
    // the diff-replace recognises it as "kept" by the prompts/<id>/ prefix.
    const keptKey = `prompts/${id}/0.jpg`;
    await db.update(promptImages).set({ r2Key: keptKey }).where(eq(promptImages.promptId, id));

    const before = await db.select().from(promptImages).where(eq(promptImages.promptId, id));
    const result = await updatePromptForOwner(id, {
      images: [{ r2AccountId: r2.id, r2Key: keptKey }],
    });
    expect(result).not.toBeNull();
    expect(result!.removedKeys).toEqual([]);
    expect(result!.migrateKeys).toEqual([]);
    const after = await db.select().from(promptImages).where(eq(promptImages.promptId, id));
    expect(after).toHaveLength(before.length);
  });

  it("update with images: add new (submission key in migrateKeys, removed empty)", async () => {
    const owner = await makeOwner();
    const cat = await makeCategory();
    const r2 = await makeR2();
    const { id } = await createPromptDirect(
      {
        titleZh: null, titleEn: "tw42r-add",
        promptZh: null, promptEn: "p",
        negativePromptZh: null, negativePromptEn: null,
        notesZh: null, notesEn: null,
        aspectRatio: null,
        categoryId: cat.id, tagSlugs: [],
        images: [
          { r2AccountId: r2.id, r2Key: `submissions/owner/${uniq()}-a.jpg` },
        ],
      },
      owner.id,
    );
    const keptKey = `prompts/${id}/0.jpg`;
    await db.update(promptImages).set({ r2Key: keptKey }).where(eq(promptImages.promptId, id));

    const newSubKey = `submissions/owner/${uniq()}-new.jpg`;
    const result = await updatePromptForOwner(id, {
      images: [
        { r2AccountId: r2.id, r2Key: keptKey },
        { r2AccountId: r2.id, r2Key: newSubKey },
      ],
    });
    expect(result).not.toBeNull();
    expect(result!.removedKeys).toEqual([]);
    expect(result!.migrateKeys).toHaveLength(1);
    expect(result!.migrateKeys[0]!.r2Key).toBe(newSubKey);
    expect(result!.migrateKeys[0]!.targetOrder).toBe(1);
  });

  it("update with images: remove existing (empty array → all removed, kept = 0)", async () => {
    const owner = await makeOwner();
    const cat = await makeCategory();
    const r2 = await makeR2();
    const { id } = await createPromptDirect(
      {
        titleZh: null, titleEn: "tw42r-remove",
        promptZh: null, promptEn: "p",
        negativePromptZh: null, negativePromptEn: null,
        notesZh: null, notesEn: null,
        aspectRatio: null,
        categoryId: cat.id, tagSlugs: [],
        images: [
          { r2AccountId: r2.id, r2Key: `submissions/owner/${uniq()}-a.jpg` },
          { r2AccountId: r2.id, r2Key: `submissions/owner/${uniq()}-b.jpg` },
        ],
      },
      owner.id,
    );
    const before = await db.select().from(promptImages).where(eq(promptImages.promptId, id));
    expect(before).toHaveLength(2);

    // Re-key the existing images so they look "kept" — but we pass [] so the
    // diff treats them all as "removed".
    await db.update(promptImages).set({ r2Key: sql`replace(${promptImages.r2Key}, 'submissions/', 'prompts/' || ${id} || '/')` }).where(eq(promptImages.promptId, id));

    // Wait, simpler: just set them deterministically.
    const all = await db.select().from(promptImages).where(eq(promptImages.promptId, id));
    for (const r of all) {
      await db.update(promptImages).set({ r2Key: `prompts/${id}/${r.order}.jpg` }).where(eq(promptImages.id, r.id));
    }

    // For a "1-10 images" length restriction, the repo doesn't enforce ≥1
    // — that's the route's zod schema. Here we test that passing an empty
    // diff-replace removes everything.
    const result = await updatePromptForOwner(id, { images: [] });
    expect(result).not.toBeNull();
    expect(result!.removedKeys).toHaveLength(2);
    expect(result!.migrateKeys).toEqual([]);
    const after = await db.select().from(promptImages).where(eq(promptImages.promptId, id));
    expect(after).toHaveLength(0);
  });

  it("update with images: reject foreign keyspace (invalid_image_key)", async () => {
    const owner = await makeOwner();
    const cat = await makeCategory();
    const r2 = await makeR2();
    const { id } = await createPromptDirect(
      {
        titleZh: null, titleEn: "tw42r-reject",
        promptZh: null, promptEn: "p",
        negativePromptZh: null, negativePromptEn: null,
        notesZh: null, notesEn: null,
        aspectRatio: null,
        categoryId: cat.id, tagSlugs: [],
        images: [
          { r2AccountId: r2.id, r2Key: `submissions/owner/${uniq()}.jpg` },
        ],
      },
      owner.id,
    );
    await expect(
      updatePromptForOwner(id, {
        images: [{ r2AccountId: r2.id, r2Key: "evil/key.jpg" }],
      }),
    ).rejects.toThrow(/invalid_image_key/);
  });
});

// ── Task 5: NSFW tag invariant ──────────────────────────────────────────
//
// createPromptDirect and updatePromptForOwner both wire
// assertNsfwTagInvariant. The update path computes the EFFECTIVE post-patch
// values: categoryId falls back to existing, tagSlugs fall back to existing.
//
// We assume the `nsfw` category is seeded (Task 1). Tests look it up.

describe("NSFW tag invariant on owner prompts (Task 5)", () => {
  it("rejects create with NSFW category + extra tags", async () => {
    const owner = await makeOwner();
    const r2 = await makeR2();
    const [nsfwCat] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, "nsfw"))
      .limit(1);
    expect(nsfwCat).toBeDefined();
    await expect(
      createPromptDirect(
        {
          titleZh: null, titleEn: "tw41r-nsfw-create-bad",
          promptZh: null, promptEn: "p",
          negativePromptZh: null, negativePromptEn: null,
          notesZh: null, notesEn: null,
          aspectRatio: null,
          categoryId: nsfwCat!.id,
          tagSlugs: ["nsfw", "extra"],
          images: [{ r2AccountId: r2.id, r2Key: `submissions/owner/${uniq()}.jpg` }],
        },
        owner.id,
      ),
    ).rejects.toThrow("nsfw_category_tags_locked");
  });

  it("rejects update moving SFW prompt to NSFW category with extra tags", async () => {
    const { id } = await makePromptDirect({ tagSlugs: [] });
    const [nsfwCat] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, "nsfw"))
      .limit(1);
    expect(nsfwCat).toBeDefined();
    await expect(
      updatePromptForOwner(id, {
        categoryId: nsfwCat!.id,
        tagSlugs: ["nsfw", "extra"],
      }),
    ).rejects.toThrow("nsfw_category_tags_locked");
  });

  it("accepts update moving SFW prompt to NSFW with tagSlugs=['nsfw']", async () => {
    const { id } = await makePromptDirect({ tagSlugs: [] });
    const [nsfwCat] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, "nsfw"))
      .limit(1);
    expect(nsfwCat).toBeDefined();
    const result = await updatePromptForOwner(id, {
      categoryId: nsfwCat!.id,
      tagSlugs: ["nsfw"],
    });
    expect(result).not.toBeNull();
    expect(result!.detail.category.id).toBe(nsfwCat!.id);
    expect(result!.detail.tagSlugs).toEqual(["nsfw"]);
  });

  it("accepts update moving NSFW prompt back to SFW with new tags", async () => {
    // Need to first build an NSFW prompt with the locked single tag.
    const owner = await makeOwner();
    const cat = await makeCategory();
    const r2 = await makeR2();
    const [nsfwCat] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(eq(categories.slug, "nsfw"))
      .limit(1);
    expect(nsfwCat).toBeDefined();
    // Ensure the global `nsfw` tag exists so the create can insert
    // prompt_tags row (createPromptDirect skips unknown slugs silently).
    // We also seed our own SFW tag to use after the category swap.
    await db.execute(
      sql`INSERT INTO tags (slug, name) VALUES ('nsfw', '{"zh":"NSFW","en":"NSFW"}'::jsonb) ON CONFLICT (slug) DO NOTHING`,
    );
    const sfwTag = await makeTag("-after");
    const { id } = await createPromptDirect(
      {
        titleZh: null, titleEn: "tw41r-nsfw-swapback",
        promptZh: null, promptEn: "p",
        negativePromptZh: null, negativePromptEn: null,
        notesZh: null, notesEn: null,
        aspectRatio: null,
        categoryId: nsfwCat!.id,
        tagSlugs: ["nsfw"],
        images: [{ r2AccountId: r2.id, r2Key: `submissions/owner/${uniq()}.jpg` }],
      },
      owner.id,
    );
    // Now move back to a fresh SFW category with an unrelated tag set.
    const result = await updatePromptForOwner(id, {
      categoryId: cat.id,
      tagSlugs: [sfwTag.slug],
    });
    expect(result).not.toBeNull();
    expect(result!.detail.category.id).toBe(cat.id);
    expect(result!.detail.tagSlugs).toEqual([sfwTag.slug]);
  });
});

// ── deletePromptForOwner ───────────────────────────────────────────────

describe("deletePromptForOwner", () => {
  it("returns null for an unknown id", async () => {
    const r = await deletePromptForOwner("00000000-0000-0000-0000-000000000000");
    expect(r).toBeNull();
  });

  it("hard-deletes prompt + prompt_images + (cascade) prompt_tags", async () => {
    const owner = await makeOwner();
    const cat = await makeCategory();
    const r2 = await makeR2();
    const t1 = await makeTag();
    const { id } = await createPromptDirect(
      {
        titleZh: null, titleEn: "tw41r-delete",
        promptZh: null, promptEn: "p",
        negativePromptZh: null, negativePromptEn: null,
        notesZh: null, notesEn: null,
        aspectRatio: null,
        categoryId: cat.id, tagSlugs: [t1.slug],
        images: [{ r2AccountId: r2.id, r2Key: `submissions/owner/${uniq()}.jpg` }],
      },
      owner.id,
    );

    const result = await deletePromptForOwner(id);
    expect(result).not.toBeNull();
    expect(result!.deleted).toBe(true);
    expect(result!.imageKeys).toHaveLength(1);

    const p = await db.select().from(prompts).where(eq(prompts.id, id));
    expect(p).toHaveLength(0);
    const imgs = await db.select().from(promptImages).where(eq(promptImages.promptId, id));
    expect(imgs).toHaveLength(0);
    const ptRows = await db.select().from(promptTags).where(eq(promptTags.promptId, id));
    expect(ptRows).toHaveLength(0);
  });

  it("decrements tags.usage_count for every attached tag", async () => {
    const owner = await makeOwner();
    const cat = await makeCategory();
    const r2 = await makeR2();
    const t1 = await makeTag();
    const t2 = await makeTag();
    const { id } = await createPromptDirect(
      {
        titleZh: null, titleEn: "tw41r-delete-usage",
        promptZh: null, promptEn: "p",
        negativePromptZh: null, negativePromptEn: null,
        notesZh: null, notesEn: null,
        aspectRatio: null,
        categoryId: cat.id, tagSlugs: [t1.slug, t2.slug],
        images: [{ r2AccountId: r2.id, r2Key: `submissions/owner/${uniq()}.jpg` }],
      },
      owner.id,
    );
    const [t1mid] = await db.select().from(tags).where(eq(tags.id, t1.id));
    const [t2mid] = await db.select().from(tags).where(eq(tags.id, t2.id));

    await deletePromptForOwner(id);

    const [t1after] = await db.select().from(tags).where(eq(tags.id, t1.id));
    const [t2after] = await db.select().from(tags).where(eq(tags.id, t2.id));
    expect(t1after!.usageCount).toBe(t1mid!.usageCount - 1);
    expect(t2after!.usageCount).toBe(t2mid!.usageCount - 1);
  });

  it("does not go below zero on usage_count (GREATEST guard)", async () => {
    const owner = await makeOwner();
    const cat = await makeCategory();
    const r2 = await makeR2();
    const t1 = await makeTag();
    // Force the tag's counter to 0 — simulates pre-existing drift.
    await db.update(tags).set({ usageCount: 0 }).where(eq(tags.id, t1.id));
    const { id } = await createPromptDirect(
      {
        titleZh: null, titleEn: "tw41r-drift",
        promptZh: null, promptEn: "p",
        negativePromptZh: null, negativePromptEn: null,
        notesZh: null, notesEn: null,
        aspectRatio: null,
        categoryId: cat.id, tagSlugs: [t1.slug],
        images: [{ r2AccountId: r2.id, r2Key: `submissions/owner/${uniq()}.jpg` }],
      },
      owner.id,
    );
    // Now bump it back to 0 — delete should clamp not negative.
    await db.update(tags).set({ usageCount: 0 }).where(eq(tags.id, t1.id));
    await deletePromptForOwner(id);
    const [reread] = await db.select().from(tags).where(eq(tags.id, t1.id));
    expect(reread!.usageCount).toBe(0);
  });

  it("NULLs submissions.promoted_to before deleting the prompt", async () => {
    const owner = await makeOwner();
    const cat = await makeCategory();
    const r2 = await makeR2();
    const { id } = await createPromptDirect(
      {
        titleZh: null, titleEn: "tw41r-promoted",
        promptZh: null, promptEn: "p",
        negativePromptZh: null, negativePromptEn: null,
        notesZh: null, notesEn: null,
        aspectRatio: null,
        categoryId: cat.id, tagSlugs: [],
        images: [{ r2AccountId: r2.id, r2Key: `submissions/owner/${uniq()}.jpg` }],
      },
      owner.id,
    );
    // Seed a submission that points to this prompt via promoted_to.
    const contrib = await makeContributor();
    const [sub] = await db
      .insert(submissions)
      .values({
        contributorId: contrib.id,
        title: { en: "submitted" }, prompt: { en: "p" },
        categoryId: cat.id, tagSlugs: [],
        imageKeys: [{ r2AccountId: r2.id, r2Key: "submissions/x/1.jpg" }],
        agreedGuidelinesVersion: 1, status: "approved",
        promotedTo: id,
      })
      .returning();
    expect(sub!.promotedTo).toBe(id);

    await deletePromptForOwner(id);

    const [reread] = await db
      .select({ promotedTo: submissions.promotedTo })
      .from(submissions)
      .where(eq(submissions.id, sub!.id));
    expect(reread!.promotedTo).toBeNull();
  });

  it("returns the image keys for R2 cleanup", async () => {
    const owner = await makeOwner();
    const cat = await makeCategory();
    const r2 = await makeR2();
    const k1 = `submissions/owner/${uniq()}-1.jpg`;
    const k2 = `submissions/owner/${uniq()}-2.jpg`;
    const { id } = await createPromptDirect(
      {
        titleZh: null, titleEn: "tw41r-keys",
        promptZh: null, promptEn: "p",
        negativePromptZh: null, negativePromptEn: null,
        notesZh: null, notesEn: null,
        aspectRatio: null,
        categoryId: cat.id, tagSlugs: [],
        images: [
          { r2AccountId: r2.id, r2Key: k1 },
          { r2AccountId: r2.id, r2Key: k2 },
        ],
      },
      owner.id,
    );
    const r = await deletePromptForOwner(id);
    expect(r!.imageKeys).toEqual(
      expect.arrayContaining([
        { r2AccountId: r2.id, r2Key: k1 },
        { r2AccountId: r2.id, r2Key: k2 },
      ]),
    );
  });
});
