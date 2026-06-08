ALTER TYPE "public"."notification_type" ADD VALUE 'prompt_liked';--> statement-breakpoint
ALTER TYPE "public"."notification_type" ADD VALUE 'prompt_favorited';--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "group_key" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "aggregated_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE INDEX "notifications_group_lookup_idx" ON "notifications" USING btree ("user_id","group_key","created_at" DESC NULLS LAST) WHERE "notifications"."group_key" IS NOT NULL AND "notifications"."read_at" IS NULL;