CREATE TYPE "public"."notification_type" AS ENUM('submission_approved', 'submission_rejected');--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" "notification_type" NOT NULL,
	"payload" jsonb NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "audit_log_action_idx";--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "actor_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "target_id" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "audit_log" ALTER COLUMN "target_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "agreed_guidelines_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "payload" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_user_unread_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST) WHERE "notifications"."read_at" IS NULL;--> statement-breakpoint
CREATE INDEX "notifications_user_all_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target_type","target_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "audit_log" DROP COLUMN "meta";--> statement-breakpoint
ALTER TABLE "audit_log" DROP COLUMN "ip";--> statement-breakpoint
ALTER TABLE "audit_log" DROP COLUMN "user_agent";