import { db } from "../src/db/client.ts";
import { r2Accounts } from "../src/db/schema/index.ts";
import { encryptSecret } from "../src/lib/crypto.ts";
import { env } from "../src/env.ts";

async function main() {
  const required = [
    "R2_DEV_ENDPOINT",
    "R2_DEV_ACCESS_KEY_ID",
    "R2_DEV_ACCESS_KEY_SECRET",
    "R2_DEV_BUCKET",
    "R2_DEV_PUBLIC_URL",
  ] as const;
  for (const k of required) {
    if (!(env as Record<string, unknown>)[k]) {
      console.error(`Missing env: ${k}`);
      process.exit(1);
    }
  }
  const ciphertext = encryptSecret(env.R2_DEV_ACCESS_KEY_SECRET!);
  const [existing] = await db
    .select({ id: r2Accounts.id })
    .from(r2Accounts)
    .limit(1);
  if (existing) {
    console.log(`r2_accounts already has a row (${existing.id}); skipping.`);
    process.exit(0);
  }
  // Cloudflare account id — the part of the endpoint URL before .r2.cloudflarestorage.com
  const accountId = (() => {
    const m = env.R2_DEV_ENDPOINT!.match(/^https:\/\/([^.]+)\.r2\.cloudflarestorage\.com/);
    return m ? m[1]! : "unknown";
  })();
  const [row] = await db
    .insert(r2Accounts)
    .values({
      name: "dev-primary",
      accountId,
      endpoint: env.R2_DEV_ENDPOINT!,
      accessKeyId: env.R2_DEV_ACCESS_KEY_ID!,
      accessKeySecretEncrypted: ciphertext,
      bucket: env.R2_DEV_BUCKET!,
      publicUrl: env.R2_DEV_PUBLIC_URL!,
      priority: 100,
      enabled: true,
    })
    .returning();
  console.log(`R2 account seeded: ${row!.id}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
