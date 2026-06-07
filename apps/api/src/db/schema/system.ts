import { pgTable, pgEnum, uuid, text, jsonb, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./auth.ts";
import { prompts } from "./prompts.ts";

export const reportStatusEnum = pgEnum("report_status", [
  "open",
  "reviewing",
  "resolved",
  "dismissed",
]);
export const announcementSeverityEnum = pgEnum("announcement_severity", [
  "info",
  "warning",
  "critical",
]);

export const importTokens = pgTable(
  "import_tokens",
  {
    token: text().primaryKey(),
    payload: jsonb().notNull(),
    promptId: uuid("prompt_id").references(() => prompts.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    used: boolean().notNull().default(false),
    usedAt: timestamp("used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdIp: text("created_ip"),
  },
  (t) => ({
    expiresIdx: index("import_tokens_expires_idx").on(t.expiresAt),
    userIdx: index("import_tokens_user_idx").on(t.userId, t.createdAt.desc()),
  }),
);

export const reports = pgTable(
  "reports",
  {
    id: uuid().primaryKey().defaultRandom(),
    reporterId: uuid("reporter_id").references(() => users.id),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    reason: text().notNull(),
    detail: text(),
    status: reportStatusEnum().notNull().default("open"),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    actionTaken: text("action_taken"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("reports_status_idx").on(t.status, t.createdAt),
  }),
);

export const announcements = pgTable(
  "announcements",
  {
    id: uuid().primaryKey().defaultRandom(),
    title: jsonb().$type<{ zh?: string; en?: string }>().notNull(),
    body: jsonb().$type<{ zh?: string; en?: string }>().notNull(),
    severity: announcementSeverityEnum().notNull().default("info"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    periodIdx: index("announcements_period_idx").on(t.startsAt, t.endsAt),
  }),
);

export const siteSettings = pgTable("site_settings", {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  description: text(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => users.id),
});
