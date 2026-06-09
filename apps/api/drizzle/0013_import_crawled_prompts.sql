-- 0013_import_crawled_prompts.sql
-- prompt_images: allow remote-only images
ALTER TABLE "prompt_images"
  ALTER COLUMN "r2_account_id" DROP NOT NULL,
  ALTER COLUMN "r2_key"        DROP NOT NULL,
  ADD COLUMN  "remote_url"     text;

ALTER TABLE "prompt_images" DROP CONSTRAINT IF EXISTS "prompt_images_account_key_uq";

CREATE UNIQUE INDEX IF NOT EXISTS "prompt_images_account_key_uq"
  ON "prompt_images" ("r2_account_id", "r2_key")
  WHERE "r2_account_id" IS NOT NULL AND "r2_key" IS NOT NULL;

ALTER TABLE "prompt_images" ADD CONSTRAINT "prompt_images_storage_chk" CHECK (
  ("r2_account_id" IS NOT NULL AND "r2_key" IS NOT NULL) OR "remote_url" IS NOT NULL
);

-- prompts: source columns
ALTER TABLE "prompts"
  ADD COLUMN "external_id" text,
  ADD COLUMN "source_url"  text,
  ADD COLUMN "source_site" text;

CREATE UNIQUE INDEX IF NOT EXISTS "prompts_external_id_uq"
  ON "prompts" ("external_id") WHERE "external_id" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "prompts_source_site_idx"
  ON "prompts" ("source_site") WHERE "source_site" IS NOT NULL;

-- import_batches table
CREATE TABLE "import_batches" (
  "id"                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "category_slug"       text NOT NULL,
  "source_file"         text NOT NULL,
  "total"               integer NOT NULL DEFAULT 0,
  "inserted"            integer NOT NULL DEFAULT 0,
  "skipped_duplicate"   integer NOT NULL DEFAULT 0,
  "failed"              integer NOT NULL DEFAULT 0,
  "failed_records"      jsonb   NOT NULL DEFAULT '[]'::jsonb,
  "status"              text    NOT NULL DEFAULT 'pending',
  "dry_run"             boolean NOT NULL DEFAULT false,
  "started_by"          uuid    REFERENCES "users"("id") ON DELETE SET NULL,
  "started_at"          timestamptz NOT NULL DEFAULT now(),
  "finished_at"         timestamptz
);

CREATE INDEX IF NOT EXISTS "import_batches_started_at_idx"
  ON "import_batches" ("started_at" DESC);
