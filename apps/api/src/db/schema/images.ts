import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  boolean,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";

export const r2Accounts = pgTable(
  "r2_accounts",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    accountId: text("account_id").notNull(),
    accessKeyId: text("access_key_id").notNull(),
    accessKeySecretEncrypted: text("access_key_secret_encrypted").notNull(),
    bucket: text().notNull(),
    endpoint: text().notNull(),
    publicUrl: text("public_url").notNull(),
    enabled: boolean().notNull().default(true),
    priority: integer().notNull().default(100),
    notes: text(),
    usedBytes: bigint("used_bytes", { mode: "number" }).notNull().default(0),
    monthlyClassACount: integer("monthly_class_a_count").notNull().default(0),
    monthlyClassBCount: integer("monthly_class_b_count").notNull().default(0),
    monthlyResetAt: timestamp("monthly_reset_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pickIdx: index("r2_accounts_pick_idx").on(t.priority, t.createdAt),
  }),
);

export const promptImages = pgTable(
  "prompt_images",
  {
    id: uuid().primaryKey().defaultRandom(),
    promptId: uuid("prompt_id").notNull(),
    r2AccountId: uuid("r2_account_id")
      .notNull()
      .references(() => r2Accounts.id),
    r2Key: text("r2_key").notNull(),
    order: integer().notNull().default(0),
    altText: text("alt_text"),
    width: integer(),
    height: integer(),
    lqip: text(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    promptOrderIdx: index("prompt_images_prompt_idx").on(t.promptId, t.order),
    keyUnique: unique("prompt_images_account_key_uq").on(t.r2AccountId, t.r2Key),
  }),
);
