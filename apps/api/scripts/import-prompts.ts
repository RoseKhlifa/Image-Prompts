/**
 * Import crawled prompts from G:\promptsandimages\exports\by_category\<slug>.jsonl
 * into the dev DB. Owner runs this for ad-hoc imports; the admin /rosekhlifa/import
 * page does the same thing via the API.
 *
 * Examples:
 *   pnpm exec tsx scripts/import-prompts.ts food
 *   pnpm exec tsx scripts/import-prompts.ts food --dry-run --limit=10
 *   pnpm exec tsx scripts/import-prompts.ts --all
 *
 * Reads the data root from site_settings['import.data_root'], falling back to
 * G:\\promptsandimages. The manifest at <root>/exports/manifest.json drives the
 * category → file mapping.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client.ts";
import { users } from "../src/db/schema/auth.ts";
import { getSetting } from "../src/repositories/site-settings.ts";
import { importCategoryJsonl } from "../src/repositories/imports.ts";

type Manifest = {
  categories: Array<{ slug: string; name: string; count: number; jsonl: string }>;
};

const DEFAULT_ROOT = "G:\\promptsandimages";

async function findOwnerId(): Promise<string> {
  // Use the first admin user we find as the audit actor for CLI runs.
  const [u] = await db.select({ id: users.id }).from(users).where(eq(users.role, "admin")).limit(1);
  if (!u) throw new Error("No admin user found — cannot record import audit");
  return u.id;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const limitArg = args.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : undefined;
  const all = args.includes("--all");
  const positional = args.filter((a) => !a.startsWith("--"));

  const dataRoot = (await getSetting<string>("import.data_root")) ?? DEFAULT_ROOT;
  const manifestPath = resolve(dataRoot, "exports/manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;

  let slugs: string[];
  if (all) {
    slugs = manifest.categories.slice().sort((a, b) => a.count - b.count).map((c) => c.slug);
  } else if (positional.length > 0) {
    slugs = positional;
  } else {
    console.error("Usage: import-prompts <slug> [--dry-run] [--limit=N]");
    console.error("       import-prompts --all [--dry-run] [--limit=N]");
    process.exit(1);
  }

  const ownerId = await findOwnerId();
  const summary: Array<{ slug: string; inserted: number; skipped: number; failed: number }> = [];

  for (const slug of slugs) {
    const entry = manifest.categories.find((c) => c.slug === slug);
    if (!entry) {
      console.error(`Skipping unknown category slug: ${slug}`);
      continue;
    }
    const filePath = resolve(dataRoot, entry.jsonl);
    console.log(`\n=== ${slug} (${entry.name}, ${entry.count} records) ===`);
    console.log(`File: ${filePath}`);
    console.log(`Mode: ${dryRun ? "DRY-RUN" : "LIVE"}${limit ? ` (limit ${limit})` : ""}`);
    const result = await importCategoryJsonl({
      filePath,
      categorySlug: slug,
      startedBy: ownerId,
      ...(dryRun ? { dryRun: true } : {}),
      ...(limit ? { limit } : {}),
    });
    console.log(
      `Done: ${result.inserted} inserted, ${result.skippedDuplicate} skipped, ${result.failed} failed`,
    );
    summary.push({
      slug,
      inserted: result.inserted,
      skipped: result.skippedDuplicate,
      failed: result.failed,
    });
  }

  console.log("\n=== Summary ===");
  for (const s of summary) {
    console.log(`  ${s.slug.padEnd(28)} +${s.inserted.toString().padStart(5)}  ~${s.skipped.toString().padStart(5)}  !${s.failed.toString().padStart(3)}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
