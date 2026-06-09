import { pgTable, uuid, text, integer, jsonb, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./auth.ts";

/** Status of a single import_batches run. */
export const IMPORT_BATCH_STATUSES = ["pending", "running", "done", "failed"] as const;
export type ImportBatchStatus = (typeof IMPORT_BATCH_STATUSES)[number];

export const importBatches = pgTable(
  "import_batches",
  {
    id: uuid().primaryKey().defaultRandom(),
    categorySlug: text("category_slug").notNull(),
    sourceFile: text("source_file").notNull(),
    total: integer().notNull().default(0),
    inserted: integer().notNull().default(0),
    skippedDuplicate: integer("skipped_duplicate").notNull().default(0),
    failed: integer().notNull().default(0),
    /**
     * Each entry: { line: number, externalId?: string, error: string }.
     * Capped at 50 entries by the import service.
     */
    failedRecords: jsonb("failed_records")
      .$type<Array<{ line: number; externalId?: string; error: string }>>()
      .notNull()
      .default([]),
    status: text().notNull().default("pending").$type<ImportBatchStatus>(),
    dryRun: boolean("dry_run").notNull().default(false),
    startedBy: uuid("started_by").references(() => users.id, { onDelete: "set null" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => ({
    startedAtIdx: index("import_batches_started_at_idx").on(t.startedAt.desc()),
  }),
);
