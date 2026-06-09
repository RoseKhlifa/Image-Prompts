ALTER TABLE "submissions" ADD COLUMN "original_prompt_id" uuid REFERENCES "prompts"("id");
CREATE INDEX IF NOT EXISTS "submissions_original_prompt_idx" ON "submissions" ("original_prompt_id") WHERE "original_prompt_id" IS NOT NULL;
