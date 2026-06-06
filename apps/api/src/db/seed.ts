import { db, pool } from "./client.ts";
import * as schema from "./schema/index.ts";
import {
  DEMO_CATEGORIES,
  DEMO_TAGS,
  DEMO_R2_ACCOUNT,
  DEMO_PROMPTS,
  DEMO_SITE_SETTINGS,
} from "./seed-data.ts";
import { sql } from "drizzle-orm";

// Prompts that get 2 extra images each so the Gallery's multi-image thumb
// strip is visible during demo. These slugs must exist in DEMO_PROMPTS.
const MULTI_IMAGE_SLUGS = new Set([
  "cyberpunk-neon-cat",
  "purple-minimal-portrait",
  "japanese-zen-garden",
]);

async function main() {
  console.log("Seeding…");

  // Idempotent via wipe: TRUNCATE the demo-owned tables on every run so the
  // script is safe to re-execute (and re-runs pick up any new DEMO_PROMPTS
  // additions). CASCADE handles dependent rows; we explicitly leave audit_log
  // and users alone so dev-created accounts survive a re-seed.
  console.log("Wiping existing data…");
  await db.execute(sql`
    TRUNCATE TABLE
      prompt_images,
      prompt_tags,
      likes,
      favorites,
      import_tokens,
      submissions,
      prompts,
      tags,
      categories,
      r2_accounts,
      site_settings
    RESTART IDENTITY CASCADE;
  `);
  console.log("Seeding fresh data…");

  // R2 account (must come first — prompt_images references it; we'll seed 1 placeholder).
  const [r2] = await db
    .insert(schema.r2Accounts)
    .values({
      name: DEMO_R2_ACCOUNT.name,
      accountId: DEMO_R2_ACCOUNT.accountId,
      accessKeyId: DEMO_R2_ACCOUNT.accessKeyId,
      accessKeySecretEncrypted: DEMO_R2_ACCOUNT.accessKeySecretEncrypted,
      bucket: DEMO_R2_ACCOUNT.bucket,
      endpoint: DEMO_R2_ACCOUNT.endpoint,
      publicUrl: DEMO_R2_ACCOUNT.publicUrl,
      enabled: DEMO_R2_ACCOUNT.enabled,
      priority: DEMO_R2_ACCOUNT.priority,
    })
    .returning();
  if (!r2) throw new Error("failed to insert r2 account");

  // Categories
  const insertedCategories = await db
    .insert(schema.categories)
    .values(
      DEMO_CATEGORIES.map((c) => ({
        slug: c.slug,
        name: { zh: c.nameZh, en: c.nameEn },
        order: c.order,
      })),
    )
    .returning();
  const categoryBySlug = new Map(insertedCategories.map((c) => [c.slug, c]));

  // Tags
  const insertedTags = await db
    .insert(schema.tags)
    .values(
      DEMO_TAGS.map((t) => ({
        slug: t.slug,
        name: { zh: t.nameZh, en: t.nameEn },
      })),
    )
    .returning();
  const tagBySlug = new Map(insertedTags.map((t) => [t.slug, t]));

  // Prompts + prompt_tags + prompt_images
  for (const p of DEMO_PROMPTS) {
    const category = categoryBySlug.get(p.categorySlug);
    if (!category) throw new Error(`unknown category slug: ${p.categorySlug}`);

    const [prompt] = await db
      .insert(schema.prompts)
      .values({
        slug: p.slug,
        title: { zh: p.titleZh, en: p.titleEn },
        prompt: { zh: p.promptZh, en: p.promptEn },
        negativePrompt:
          p.negativeZh || p.negativeEn ? { zh: p.negativeZh, en: p.negativeEn } : null,
        aspectRatio: p.aspectRatio,
        categoryId: category.id,
        source: "site",
      })
      .returning();
    if (!prompt) throw new Error(`failed to insert prompt: ${p.slug}`);

    // Tags
    for (const tagSlug of p.tagSlugs) {
      const tag = tagBySlug.get(tagSlug);
      if (!tag) continue;
      await db.insert(schema.promptTags).values({ promptId: prompt.id, tagId: tag.id });
    }

    // One Picsum-shaped image per prompt: resolveImageUrl will compose
    // `${publicUrl}/${r2Key}` → https://picsum.photos/seed/{slug}/{w}/{h}
    // which returns a deterministic real photo at the requested size.
    await db.insert(schema.promptImages).values({
      promptId: prompt.id,
      r2AccountId: r2.id,
      r2Key: `seed/${p.slug}/${p.width}/${p.height}`,
      order: 0,
      altText: p.titleEn,
      width: p.width,
      height: p.height,
      lqip: null,
    });

    // Multi-image demo: a few prompts get 2 extra images so the Gallery
    // thumb strip is visible during the demo. Same Picsum convention —
    // different seeds (suffixed slug) produce different photos.
    if (MULTI_IMAGE_SLUGS.has(p.slug)) {
      const extraDims = [
        { w: 500, h: 700 },
        { w: 800, h: 600 },
      ];
      for (let i = 0; i < extraDims.length; i++) {
        const e = extraDims[i]!;
        await db.insert(schema.promptImages).values({
          promptId: prompt.id,
          r2AccountId: r2.id,
          r2Key: `seed/${p.slug}-${i + 1}/${e.w}/${e.h}`,
          order: i + 1,
          altText: `${p.titleEn} (alt ${i + 1})`,
          width: e.w,
          height: e.h,
          lqip: null,
        });
      }
    }
  }

  // Update tag usage_count
  for (const tag of insertedTags) {
    await db.execute(
      sql`UPDATE tags SET usage_count = (SELECT count(*) FROM prompt_tags WHERE tag_id = ${tag.id}) WHERE id = ${tag.id}`,
    );
  }

  // Site settings
  for (const setting of DEMO_SITE_SETTINGS) {
    await db.insert(schema.siteSettings).values(setting).onConflictDoNothing();
  }

  console.log(
    `Seeded ${DEMO_PROMPTS.length} prompts, ${DEMO_CATEGORIES.length} categories, ${DEMO_TAGS.length} tags.`,
  );
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
