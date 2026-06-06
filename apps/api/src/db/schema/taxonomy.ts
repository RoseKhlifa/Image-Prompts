import { pgTable, uuid, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { users } from "./auth.ts";

export const categories = pgTable("categories", {
  id: uuid().primaryKey().defaultRandom(),
  slug: text().notNull().unique(),
  name: jsonb().$type<{ zh?: string; en?: string }>().notNull(),
  description: jsonb().$type<{ zh?: string; en?: string }>(),
  order: integer().notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tags = pgTable("tags", {
  id: uuid().primaryKey().defaultRandom(),
  slug: text().notNull().unique(),
  name: jsonb().$type<{ zh?: string; en?: string }>().notNull(),
  usageCount: integer("usage_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tagSuggestions = pgTable("tag_suggestions", {
  id: uuid().primaryKey().defaultRandom(),
  suggesterId: uuid("suggester_id")
    .notNull()
    .references(() => users.id),
  suggestedName: jsonb("suggested_name").$type<{ zh?: string; en?: string }>().notNull(),
  reason: text(),
  status: text().notNull().default("pending"),
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
