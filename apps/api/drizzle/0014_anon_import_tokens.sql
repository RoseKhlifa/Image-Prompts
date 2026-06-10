-- 0014_anon_import_tokens.sql
-- Allow anonymous (guest) "Send to Image-Studio" handoffs by relaxing
-- the FK constraint on import_tokens.user_id. NULL = guest token,
-- non-NULL = signed-in user (rate-limited per user as before).
-- Cascade behavior also flips: if a signed-in user later deletes
-- their account, their outstanding tokens become anonymous rather
-- than disappearing — the consume side never needs the user_id.

ALTER TABLE "import_tokens" ALTER COLUMN "user_id" DROP NOT NULL;

ALTER TABLE "import_tokens" DROP CONSTRAINT IF EXISTS "import_tokens_user_id_users_id_fk";

ALTER TABLE "import_tokens"
  ADD CONSTRAINT "import_tokens_user_id_users_id_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL;
