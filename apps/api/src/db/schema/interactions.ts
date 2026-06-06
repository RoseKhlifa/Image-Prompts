import { pgTable, uuid, timestamp, index, primaryKey } from "drizzle-orm/pg-core";
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
