import { pgTable, pgEnum, uuid, text, timestamp, integer, primaryKey } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["user", "moderator", "admin"]);

/**
 * users table — extended with app-specific columns (role, locale, community
 * guidelines, daily submission counters). Auth.js DrizzleAdapter only requires
 * id / email / emailVerified / name / image; extra columns are ignored on
 * upsert.
 */
export const users = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull().unique(),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  name: text(),
  image: text(),
  role: userRoleEnum().notNull().default("user"),
  locale: text().notNull().default("zh"),
  communityGuidelinesVersion: integer("community_guidelines_version").notNull().default(0),
  dailySubmissionCount: integer("daily_submission_count").notNull().default(0),
  dailySubmissionResetAt: timestamp("daily_submission_reset_at", { withTimezone: true }),
  rejectedCount: integer("rejected_count").notNull().default(0),
  bannedAt: timestamp("banned_at", { withTimezone: true }),
  bannedReason: text("banned_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * accounts table — Auth.js DrizzleAdapter shape. Composite PK on
 * (provider, providerAccountId). `expires_at` is unix epoch seconds (Auth.js
 * convention), not a timestamp.
 */
export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text().notNull(), // "oauth" | "oidc" | "email"
    provider: text().notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text(),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => ({
    pk: primaryKey({
      name: "accounts_pkey",
      columns: [t.provider, t.providerAccountId],
    }),
  }),
);

/**
 * sessions table — Auth.js DrizzleAdapter shape: sessionToken as PK, plain
 * `expires` (not `expires_at`).
 */
export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp({ withTimezone: true }).notNull(),
});

/**
 * verification_tokens table — Auth.js shape. Kept for adapter completeness
 * even though we don't expose email login.
 */
export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text().notNull(),
    token: text().notNull().unique(),
    expires: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ name: "verification_tokens_pkey", columns: [t.identifier, t.token] }),
  }),
);
