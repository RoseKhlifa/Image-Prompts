CREATE TYPE "public"."prompt_source" AS ENUM('site', 'nanobanana_seed');--> statement-breakpoint
ALTER TABLE "prompts" ALTER COLUMN "source" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "prompts" ALTER COLUMN "source" SET DATA TYPE "prompt_source" USING "source"::"prompt_source";--> statement-breakpoint
ALTER TABLE "prompts" ALTER COLUMN "source" SET DEFAULT 'site';
