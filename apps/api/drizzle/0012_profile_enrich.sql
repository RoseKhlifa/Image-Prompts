ALTER TABLE "users" ADD COLUMN "bio" jsonb;
ALTER TABLE "users" ADD COLUMN "social_links" jsonb;

CREATE TABLE "user_pinned_prompts" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "prompt_id" uuid NOT NULL REFERENCES "prompts"("id") ON DELETE CASCADE,
  "order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  PRIMARY KEY ("user_id", "prompt_id")
);
CREATE INDEX IF NOT EXISTS "user_pinned_prompts_user_idx" ON "user_pinned_prompts" ("user_id", "order");
