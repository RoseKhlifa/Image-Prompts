import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default("127.0.0.1"),
  SITE_URL: z.string().url(),
  API_URL: z.string().url(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DATABASE_URL: z.string().url(),
  AUTH_SECRET: z.string().min(32),
  // M3: OAuth provider credentials. Optional so dev/CI can boot without them;
  // the auth/index.ts module filters out any provider whose creds are missing
  // and logs a warning.
  AUTH_URL: z.string().url().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  ADMIN_EMAILS: z.string().optional(),
  // M10a: comma-separated list of project-owner emails. Used by isOwnerEmail()
  // + session callback to derive session.user.isOwner. Owner is a strict
  // subset of admin (B-scheme) — admins not in this list stay non-owner.
  OWNER_EMAILS: z.string().optional().default(""),
  R2_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, "must be 32-byte hex"),
  // M4: optional dev R2 creds. Used only by the seed:r2 script to insert the
  // first row of r2_accounts; runtime code reads decrypted creds from the DB.
  // The url() vars accept "" as well so dev .env files can leave them blank
  // without tripping Zod's URL validator.
  R2_DEV_ENDPOINT: z.union([z.string().url(), z.literal("")]).optional(),
  R2_DEV_ACCESS_KEY_ID: z.string().optional(),
  R2_DEV_ACCESS_KEY_SECRET: z.string().optional(),
  R2_DEV_BUCKET: z.string().optional(),
  R2_DEV_PUBLIC_URL: z.union([z.string().url(), z.literal("")]).optional(),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  console.error(parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
