import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth.ts";

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid().primaryKey().defaultRandom(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id),
    action: text().notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    payload: jsonb().$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    actorIdx: index("audit_log_actor_idx").on(t.actorId, t.createdAt.desc()),
    targetIdx: index("audit_log_target_idx").on(t.targetType, t.targetId, t.createdAt.desc()),
  }),
);
