ALTER TABLE "users" ADD COLUMN "banned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "banned_reason" text;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "users_banned_at_idx" ON "users" ("banned_at") WHERE "banned_at" IS NOT NULL;