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

async function main() {
  console.log("Seeding…");

  // Idempotent: skip if any prompts already exist.
  const existing = await db.execute(sql`SELECT count(*)::int AS n FROM prompts`);
  const promptCount = Number((existing.rows[0] as { n: number }).n);
  if (promptCount > 0) {
    console.log(`Prompts already exist (${promptCount}). Skip seed.`);
    await pool.end();
    return;
  }

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

    // One placeholder image per prompt
    await db.insert(schema.promptImages).values({
      promptId: prompt.id,
      r2AccountId: r2.id,
      r2Key: `prompts/${prompt.id}/0.svg`,
      order: 0,
      altText: p.titleEn,
      width: 1280,
      height: 720,
      lqip: null,
    });
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
