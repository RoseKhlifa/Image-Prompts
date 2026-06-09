import { index, integer, pgTable, primaryKey, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth.ts";
import { prompts } from "./prompts.ts";

/**
 * ★ M11 profile enrich: user can pin up to 3 of their own published prompts
 *   to feature them at the top of the works tab on their UserPage. Order is
 *   a small int; ties broken by created_at. Both FKs cascade — a deleted
 *   user or prompt silently disappears from this join.
 *
 * "Up to 3" is enforced by setMyPinnedPrompts in the repo layer; the table
 * itself accepts any count so backfills / data fixes don't choke.
 */
export const userPinnedPrompts = pgTable(
  "user_pinned_prompts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    promptId: uuid("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    order: integer().notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    pk: primaryKey({
      name: "user_pinned_prompts_pkey",
      columns: [t.userId, t.promptId],
    }),
    userIdx: index("user_pinned_prompts_user_idx").on(t.userId, t.order),
  }),
);
