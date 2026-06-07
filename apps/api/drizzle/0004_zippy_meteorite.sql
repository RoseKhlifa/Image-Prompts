ALTER TABLE "import_tokens" ADD COLUMN "user_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "import_tokens" ADD CONSTRAINT "import_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_tokens_user_idx" ON "import_tokens" USING btree ("user_id","created_at" DESC NULLS LAST);