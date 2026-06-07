import {
  pgTable,
  uuid,
  timestamp,
  index,
  primaryKey,
  text,
  date,
  bigserial,
} from "drizzle-orm/pg-core";
import { users } from "./auth.ts";
import { prompts } from "./prompts.ts";

export const favorites = pgTable(
  "favorites",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    promptId: uuid("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ name: "favorites_pkey", columns: [t.userId, t.promptId] }),
    userIdx: index("favorites_user_idx").on(t.userId, t.createdAt.desc()),
  }),
);

export const likes = pgTable(
  "likes",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    promptId: uuid("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ name: "likes_pkey", columns: [t.userId, t.promptId] }),
    promptIdx: index("likes_prompt_idx").on(t.promptId),
  }),
);

/**
 * Per-prompt view log. The unique constraint on
 * (prompt_id, coalesce(user_id::text, ip_hash), bucket_date) gives us
 * 24h dedup: same viewer in the same UTC day inserts at most one row.
 *
 * Drizzle 0.38's `uniqueIndex(...).on(sql`coalesce(...)`)` is unreliable
 * for expression indexes, so the unique constraint is declared in the SQL
 * migration directly; here we only register a plain index on prompt_id.
 */
export const viewLog = pgTable(
  "view_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    promptId: uuid("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    ipHash: text("ip_hash"),
    bucketDate: date("bucket_date").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    promptIdx: index("view_log_prompt_idx").on(t.promptId),
  }),
);
