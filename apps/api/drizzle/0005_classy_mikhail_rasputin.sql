CREATE TABLE "view_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"prompt_id" uuid NOT NULL,
	"user_id" uuid,
	"ip_hash" text,
	"bucket_date" date NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "view_log" ADD CONSTRAINT "view_log_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "view_log" ADD CONSTRAINT "view_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "view_log_prompt_idx" ON "view_log" USING btree ("prompt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "view_log_dedup_idx"
  ON "view_log" ("prompt_id", coalesce("user_id"::text, "ip_hash"), "bucket_date");