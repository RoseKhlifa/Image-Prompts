import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  check,
  primaryKey,
} from "drizzle-orm/pg-core";
import { categories, tags } from "./taxonomy.ts";
import { users } from "./auth.ts";

export const submissionStatusEnum = pgEnum("submission_status", [
  "pending",
  "approved",
  "rejected",
]);

export const promptSourceEnum = pgEnum("prompt_source", ["site", "nanobanana_seed"]);

const bilingualCheck = (field: string) =>
  sql.raw(
    `((${field} ->> 'zh') IS NOT NULL AND length(${field} ->> 'zh') > 0) ` +
      `OR ((${field} ->> 'en') IS NOT NULL AND length(${field} ->> 'en') > 0)`,
  );

export const prompts = pgTable(
  "prompts",
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: text().notNull().unique(),
    title: jsonb().$type<{ zh?: string; en?: string }>().notNull(),
    prompt: jsonb().$type<{ zh?: string; en?: string }>().notNull(),
    negativePrompt: jsonb("negative_prompt").$type<{ zh?: string; en?: string }>(),
    notes: jsonb().$type<{ zh?: string; en?: string }>(),
    aspectRatio: text("aspect_ratio"),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    contributorId: uuid("contributor_id").references(() => users.id),
    source: promptSourceEnum().notNull().default("site"),
    viewCount: integer("view_count").notNull().default(0),
    favoriteCount: integer("favorite_count").notNull().default(0),
    likeCount: integer("like_count").notNull().default(0),
    sendCount: integer("send_count").notNull().default(0),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    categoryIdx: index("prompts_category_idx").on(t.categoryId),
    approvedAtIdx: index("prompts_approved_at_idx").on(t.approvedAt.desc()),
    likeCountIdx: index("prompts_like_count_idx").on(t.likeCount.desc()),
    viewCountIdx: index("prompts_view_count_idx").on(t.viewCount.desc()),
    sendCountIdx: index("prompts_send_count_idx").on(t.sendCount.desc()),
    titleBilingual: check("prompts_title_bilingual_chk", bilingualCheck("title")),
    promptBilingual: check("prompts_prompt_bilingual_chk", bilingualCheck("prompt")),
  }),
);

export const promptTags = pgTable(
  "prompt_tags",
  {
    promptId: uuid("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => ({
    pk: primaryKey({ name: "prompt_tags_pkey", columns: [t.promptId, t.tagId] }),
    tagIdx: index("prompt_tags_tag_idx").on(t.tagId),
  }),
);

export const submissions = pgTable(
  "submissions",
  {
    id: uuid().primaryKey().defaultRandom(),
    title: jsonb().$type<{ zh?: string; en?: string }>().notNull(),
    prompt: jsonb().$type<{ zh?: string; en?: string }>().notNull(),
    negativePrompt: jsonb("negative_prompt").$type<{ zh?: string; en?: string }>(),
    notes: jsonb().$type<{ zh?: string; en?: string }>(),
    aspectRatio: text("aspect_ratio"),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    contributorId: uuid("contributor_id")
      .notNull()
      .references(() => users.id),
    tagSlugs: text("tag_slugs")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    imageKeys: jsonb("image_keys")
      .$type<Array<{ r2AccountId: string; r2Key: string; altText?: string }>>()
      .notNull(),
    status: submissionStatusEnum().notNull().default("pending"),
    rejectReason: text("reject_reason"),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    promotedTo: uuid("promoted_to").references(() => prompts.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("submissions_status_idx").on(t.status),
    contributorIdx: index("submissions_contributor_idx").on(t.contributorId),
    titleBilingual: check("submissions_title_bilingual_chk", bilingualCheck("title")),
    promptBilingual: check("submissions_prompt_bilingual_chk", bilingualCheck("prompt")),
  }),
);
