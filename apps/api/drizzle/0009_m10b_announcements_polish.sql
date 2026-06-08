ALTER TABLE "announcements" ADD COLUMN "dismissible" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "updated_by" uuid;--> statement-breakpoint
ALTER TABLE "announcements" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "announcements_active_idx" ON "announcements" ("starts_at", "ends_at") WHERE "deleted_at" IS NULL;