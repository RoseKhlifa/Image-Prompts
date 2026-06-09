-- Distinguishes pop-up modal announcements ("popup") from persistent ribbon
-- announcements ("banner"). Existing rows default to "banner" since that's
-- what was shipped in 0009.
ALTER TABLE "announcements" ADD COLUMN "display_mode" text NOT NULL DEFAULT 'banner';
CREATE INDEX IF NOT EXISTS "announcements_display_mode_idx" ON "announcements" ("display_mode") WHERE "deleted_at" IS NULL;
