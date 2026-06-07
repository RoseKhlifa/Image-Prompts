import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth.ts";

export const notificationTypeEnum = pgEnum("notification_type", [
  "submission_approved",
  "submission_rejected",
]);

export type NotificationPayload =
  | {
      submissionId: string;
      promptId: string;
      promptSlug: string;
      titleZh: string | null;
      titleEn: string | null;
    }
  | {
      submissionId: string;
      reason: string;
      titleZh: string | null;
      titleEn: string | null;
    };

export const notifications = pgTable(
  "notifications",
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: notificationTypeEnum().notNull(),
    payload: jsonb().$type<NotificationPayload>().notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userUnreadIdx: index("notifications_user_unread_idx")
      .on(t.userId, t.createdAt.desc())
      .where(sql`${t.readAt} IS NULL`),
    userAllIdx: index("notifications_user_all_idx").on(t.userId, t.createdAt.desc()),
  }),
);
