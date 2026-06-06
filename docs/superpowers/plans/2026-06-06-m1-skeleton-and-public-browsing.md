# M1: Project Skeleton + Public Browsing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the Image-Prompts monorepo with a working public-browsing experience: guests can open homepage, browse the prompt list with filtering and sorting, and view detail pages — all bilingual (zh/en) with theme switching. No auth, no submissions, no Send-to-Studio yet (those are M2-M3).

**Architecture:**
- pnpm Monorepo: `apps/web` (React+Vite SPA), `apps/api` (Hono server), `packages/shared` (Zod + TS types).
- Hono serves a JSON API on port 3000. PostgreSQL 16 holds all 19 tables created in M1 so future milestones never need backward-incompat migrations.
- Web app talks to API via fetch wrappers in `apps/web/src/lib/api.ts`. State managed by Zustand for UI prefs; server state via TanStack Query.
- Design tokens lifted verbatim from spec §11 (Apple HIG, single brand blue, 999px pill controls, Inter+Noto Sans SC self-hosted).

**Tech Stack:** Node 22 LTS, pnpm 9, TypeScript 5.7, React 18, Vite 6, Tailwind 4, Hono 4, Drizzle ORM, PostgreSQL 16, Zod 3, TanStack Query 5, react-i18next 15, react-router 7, Zustand 4, Vitest 3, Playwright 1.

**Reference:** See `docs/superpowers/specs/2026-06-06-image-prompts-design.md` for full design context.

---

## Prerequisites (one-time setup, not commits)

Before Task 0, the engineer must have on their machine:

1. **Node.js 22 LTS** (`nvm install 22 && nvm use 22`)
2. **pnpm 9** (`npm install -g pnpm@9`)
3. **PostgreSQL 16** running locally on `localhost:5432` (no Docker per §2.4 of spec). Verify with `psql -V`.
4. A dev database created: `createdb image_prompts_dev` and a user `psql -d image_prompts_dev -c "CREATE USER ip_app WITH PASSWORD 'devpassword' SUPERUSER;"`.
5. **Git** configured with name + email.

**No Docker commands in this plan.** Production deployment is M8.

---

## Task 0: Workspace Initialization

**Files:**
- Create: `pnpm-workspace.yaml`
- Create: `package.json` (root)
- Create: `tsconfig.base.json`
- Create: `.editorconfig`
- Create: `.nvmrc`
- Create: `.npmrc`
- Create: `.prettierrc.json`
- Create: `.prettierignore`
- Create: `eslint.config.js`
- Create: `README.md`
- Modify: `.gitignore` (extend existing)

- [ ] **Step 0.1: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

- [ ] **Step 0.2: Create root `package.json`**

```json
{
  "name": "image-prompts",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.15.0",
  "engines": {
    "node": ">=22.0.0",
    "pnpm": ">=9.0.0"
  },
  "scripts": {
    "dev": "pnpm -r --parallel run dev",
    "build": "pnpm -r run build",
    "test": "pnpm -r run test",
    "typecheck": "pnpm -r run typecheck",
    "lint": "eslint .",
    "format": "prettier --write \"**/*.{ts,tsx,js,jsx,json,md,yaml,yml}\"",
    "format:check": "prettier --check \"**/*.{ts,tsx,js,jsx,json,md,yaml,yml}\""
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "eslint": "^9.17.0",
    "@eslint/js": "^9.17.0",
    "typescript-eslint": "^8.20.0",
    "prettier": "^3.4.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 0.3: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": false,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 0.4: Create `.editorconfig`**

```ini
root = true

[*]
indent_style = space
indent_size = 2
end_of_line = lf
charset = utf-8
trim_trailing_whitespace = true
insert_final_newline = true

[*.md]
trim_trailing_whitespace = false
```

- [ ] **Step 0.5: Create `.nvmrc`**

```
22
```

- [ ] **Step 0.6: Create `.npmrc`**

```ini
auto-install-peers=true
strict-peer-dependencies=false
shamefully-hoist=false
prefer-workspace-packages=true
```

- [ ] **Step 0.7: Create `.prettierrc.json`**

```json
{
  "semi": true,
  "trailingComma": "all",
  "singleQuote": false,
  "printWidth": 100,
  "tabWidth": 2,
  "useTabs": false,
  "arrowParens": "always",
  "endOfLine": "lf"
}
```

- [ ] **Step 0.8: Create `.prettierignore`**

```
node_modules
dist
build
.next
.turbo
coverage
pnpm-lock.yaml
*.min.js
*.min.css
.superpowers
```

- [ ] **Step 0.9: Create `eslint.config.js`**

```js
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/.next/**",
      "**/.superpowers/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
);
```

- [ ] **Step 0.10: Extend `.gitignore`** (do NOT replace the existing file — append these lines)

Current content of `.gitignore` should look like:

```
# Visual companion / brainstorm session artifacts
.superpowers/

# Logs
*.log

# Editor / OS
.DS_Store
Thumbs.db
.idea/
.vscode/

# Env
.env
.env.local
.env.*.local
```

Append the following block to the end of `.gitignore`:

```

# Node / pnpm
node_modules/
.pnpm-store/

# Build artifacts
dist/
build/
*.tsbuildinfo

# Test coverage
coverage/
.vitest-cache/

# Playwright
test-results/
playwright-report/
playwright/.cache/

# Drizzle
drizzle/meta/_journal.json.bak
```

- [ ] **Step 0.11: Create `README.md` (root)**

```markdown
# Image-Prompts

中英双语生图提示词聚合站,Image-Studio 配套产品。

## Repository Structure

This is a pnpm monorepo:

- \`apps/web\` — React + Vite SPA (frontend)
- \`apps/api\` — Hono server (backend API)
- \`packages/shared\` — Shared Zod schemas, TS types, i18n keys
- \`docs/superpowers/specs\` — Design specs
- \`docs/superpowers/plans\` — Implementation plans
- \`scripts\` — One-off migration / data tasks

## Prerequisites

- Node.js 22 LTS (\`nvm use\`)
- pnpm 9 (\`npm i -g pnpm@9\`)
- PostgreSQL 16 running locally on \`localhost:5432\`
- A dev database: \`createdb image_prompts_dev\`

## Quick Start

\`\`\`bash
pnpm install
cp apps/api/.env.example apps/api/.env
# Edit apps/api/.env with your local PG credentials and dev R2 creds
pnpm --filter @ip/api db:migrate
pnpm --filter @ip/api db:seed
pnpm dev
\`\`\`

Then open <http://localhost:5173>.

## Useful Commands

\`\`\`bash
pnpm dev            # Run all apps in dev mode
pnpm build          # Build all apps
pnpm test           # Run all tests
pnpm typecheck      # Type-check all packages
pnpm lint           # Lint all packages
pnpm format         # Auto-format with Prettier
\`\`\`
```

- [ ] **Step 0.12: Install root dependencies**

Run:
```bash
pnpm install
```

Expected: pnpm bootstraps an empty workspace, installs root devDependencies (eslint, prettier, typescript). Creates `pnpm-lock.yaml` and a `node_modules` directory.

- [ ] **Step 0.13: Verify tooling works**

Run:
```bash
pnpm format:check
```

Expected: Exits 0 (nothing to format yet — all files already follow Prettier conventions or are excluded).

Run:
```bash
pnpm exec tsc --version
```

Expected: prints `Version 5.7.x`.

- [ ] **Step 0.14: Commit**

```bash
git add pnpm-workspace.yaml package.json tsconfig.base.json .editorconfig .nvmrc .npmrc \
        .prettierrc.json .prettierignore eslint.config.js README.md .gitignore pnpm-lock.yaml
git commit -m "chore: bootstrap pnpm monorepo with tooling

- pnpm workspace targeting apps/* and packages/*
- TypeScript 5.7 strict base config
- ESLint 9 + Prettier 3 + EditorConfig
- Engines locked to Node >=22, pnpm >=9
- Root scripts for dev/build/test/typecheck/lint/format"
```

---

## Task 1: packages/shared — Domain Types & Schemas

**Files:**
- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/types/locale.ts`
- Create: `packages/shared/src/types/domain.ts`
- Create: `packages/shared/src/schemas/common.ts`
- Create: `packages/shared/src/schemas/prompt.ts`
- Create: `packages/shared/src/schemas/api.ts`
- Create: `packages/shared/src/utils/bilingual.ts`
- Create: `packages/shared/src/utils/slug.ts`
- Create: `packages/shared/src/index.ts`
- Test: `packages/shared/src/utils/bilingual.test.ts`
- Test: `packages/shared/src/utils/slug.test.ts`

- [ ] **Step 1.1: Create `packages/shared/package.json`**

```json
{
  "name": "@ip/shared",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./types": "./src/types/index.ts",
    "./schemas": "./src/schemas/index.ts",
    "./utils": "./src/utils/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 1.2: Create `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 1.3: Create `packages/shared/src/types/locale.ts`**

```ts
export const LOCALES = ["zh", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "zh";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}
```

- [ ] **Step 1.4: Create `packages/shared/src/types/domain.ts`**

```ts
import type { Locale } from "./locale.ts";

/**
 * Bilingual text. At least one of zh / en must be a non-empty string.
 * Enforced by Zod schema + Postgres CHECK constraint.
 */
export type BilingualText = {
  zh?: string;
  en?: string;
};

export const ASPECT_RATIOS = ["auto", "1:1", "3:2", "2:3", "16:9", "9:16"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export const USER_ROLES = ["user", "moderator", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const SUBMISSION_STATUSES = ["pending", "approved", "rejected"] as const;
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];

export const REPORT_STATUSES = ["open", "reviewing", "resolved", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const ANNOUNCEMENT_SEVERITIES = ["info", "warning", "critical"] as const;
export type AnnouncementSeverity = (typeof ANNOUNCEMENT_SEVERITIES)[number];

export const SORT_OPTIONS = ["latest", "popular", "liked", "sent"] as const;
export type SortOption = (typeof SORT_OPTIONS)[number];

export const THEME_MODES = ["light", "dark", "system"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export type PromptSummary = {
  id: string;
  slug: string;
  title: BilingualText;
  category: {
    id: string;
    slug: string;
    name: BilingualText;
  };
  tags: Array<{ slug: string; name: BilingualText }>;
  aspectRatio: AspectRatio | null;
  primaryImage: {
    r2AccountId: string;
    r2Key: string;
    width: number | null;
    height: number | null;
    lqip: string | null;
  } | null;
  viewCount: number;
  likeCount: number;
  sendCount: number;
  favoriteCount: number;
  approvedAt: string;
};

export type PromptDetail = PromptSummary & {
  prompt: BilingualText;
  negativePrompt: BilingualText | null;
  notes: BilingualText | null;
  contributor: {
    id: string;
    name: string | null;
    avatarUrl: string | null;
  } | null;
  images: Array<{
    id: string;
    r2AccountId: string;
    r2Key: string;
    order: number;
    altText: string | null;
    width: number | null;
    height: number | null;
    lqip: string | null;
  }>;
  source: "site" | "nanobanana_seed";
  createdAt: string;
  updatedAt: string;
};

export type R2PoolEntry = {
  id: string;
  publicUrl: string;
};

export type CategorySummary = {
  id: string;
  slug: string;
  name: BilingualText;
  order: number;
  promptCount: number;
};

export type TagSummary = {
  id: string;
  slug: string;
  name: BilingualText;
  usageCount: number;
};

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
};

export type { Locale };
```

- [ ] **Step 1.5: Create `packages/shared/src/types/index.ts`**

```ts
export * from "./locale.ts";
export * from "./domain.ts";
```

- [ ] **Step 1.6: Create `packages/shared/src/utils/bilingual.ts`**

```ts
import type { BilingualText, Locale } from "../types/index.ts";

/**
 * Pick the text in the requested locale. If empty, fall back to the other.
 * Returns null only when both are empty (should be prevented by DB CHECK).
 */
export function pickBilingual(text: BilingualText | null | undefined, locale: Locale): string | null {
  if (!text) return null;
  const primary = text[locale];
  if (primary && primary.trim().length > 0) return primary;
  const otherLocale: Locale = locale === "zh" ? "en" : "zh";
  const fallback = text[otherLocale];
  if (fallback && fallback.trim().length > 0) return fallback;
  return null;
}

/**
 * True when the field has the requested locale populated.
 * Used to render a "no <lang> version, showing <other>" hint.
 */
export function hasLocale(text: BilingualText | null | undefined, locale: Locale): boolean {
  if (!text) return false;
  const value = text[locale];
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * True when at least one of zh / en is non-empty (validation rule).
 */
export function hasAnyLanguage(text: BilingualText | null | undefined): boolean {
  if (!text) return false;
  return hasLocale(text, "zh") || hasLocale(text, "en");
}
```

- [ ] **Step 1.7: Create `packages/shared/src/utils/bilingual.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { pickBilingual, hasLocale, hasAnyLanguage } from "./bilingual.ts";

describe("pickBilingual", () => {
  it("returns the requested locale when present", () => {
    expect(pickBilingual({ zh: "中文", en: "English" }, "zh")).toBe("中文");
    expect(pickBilingual({ zh: "中文", en: "English" }, "en")).toBe("English");
  });

  it("falls back to the other locale when requested is empty", () => {
    expect(pickBilingual({ en: "English" }, "zh")).toBe("English");
    expect(pickBilingual({ zh: "中文" }, "en")).toBe("中文");
  });

  it("treats whitespace-only as empty", () => {
    expect(pickBilingual({ zh: "   ", en: "English" }, "zh")).toBe("English");
  });

  it("returns null when both are missing", () => {
    expect(pickBilingual({}, "zh")).toBeNull();
    expect(pickBilingual(null, "zh")).toBeNull();
    expect(pickBilingual(undefined, "en")).toBeNull();
  });
});

describe("hasLocale", () => {
  it("is true when the locale is non-empty", () => {
    expect(hasLocale({ zh: "中文" }, "zh")).toBe(true);
    expect(hasLocale({ zh: "中文", en: "English" }, "en")).toBe(true);
  });

  it("is false when the locale is missing or whitespace", () => {
    expect(hasLocale({ en: "English" }, "zh")).toBe(false);
    expect(hasLocale({ zh: "   " }, "zh")).toBe(false);
    expect(hasLocale(null, "zh")).toBe(false);
  });
});

describe("hasAnyLanguage", () => {
  it("is true when at least one locale is non-empty", () => {
    expect(hasAnyLanguage({ zh: "中文" })).toBe(true);
    expect(hasAnyLanguage({ en: "English" })).toBe(true);
    expect(hasAnyLanguage({ zh: "中文", en: "English" })).toBe(true);
  });

  it("is false when both are missing or whitespace", () => {
    expect(hasAnyLanguage({})).toBe(false);
    expect(hasAnyLanguage({ zh: "  ", en: "" })).toBe(false);
    expect(hasAnyLanguage(null)).toBe(false);
  });
});
```

- [ ] **Step 1.8: Create `packages/shared/src/utils/slug.ts`**

```ts
/**
 * Produce a URL-safe slug. Lowercases, replaces non-alphanumeric runs with single hyphens,
 * trims leading/trailing hyphens, truncates to 80 chars.
 *
 * Note: callers are expected to dedupe against the prompts.slug uniqueness constraint
 * (e.g. by appending -2 / -3 on conflict).
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip combining diacritics
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/**
 * Generate a short random base62 token used by import_tokens.
 * 8 chars × log2(62) ≈ 47.6 bits — collision-free for our scale.
 */
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function generateBase62Token(length = 8): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (const byte of bytes) {
    out += BASE62[byte % 62];
  }
  return out;
}
```

- [ ] **Step 1.9: Create `packages/shared/src/utils/slug.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { slugify, generateBase62Token } from "./slug.ts";

describe("slugify", () => {
  it("lowercases and replaces spaces", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  it("collapses runs of non-alphanumeric chars", () => {
    expect(slugify("foo  --  bar")).toBe("foo-bar");
    expect(slugify("foo & bar / baz")).toBe("foo-bar-baz");
  });

  it("strips leading and trailing hyphens", () => {
    expect(slugify("--hello--")).toBe("hello");
  });

  it("strips diacritics", () => {
    expect(slugify("Crème Brûlée")).toBe("creme-brulee");
  });

  it("drops non-ASCII (CJK) for slug-safety", () => {
    // CJK chars are not in [a-z0-9] so they become hyphens, then collapsed.
    expect(slugify("赛博朋克 cat")).toBe("cat");
    expect(slugify("cyberpunk 霓虹 cat")).toBe("cyberpunk-cat");
  });

  it("truncates to 80 chars", () => {
    const long = "a".repeat(200);
    expect(slugify(long)).toHaveLength(80);
  });
});

describe("generateBase62Token", () => {
  it("returns the requested length", () => {
    expect(generateBase62Token(8)).toHaveLength(8);
    expect(generateBase62Token(12)).toHaveLength(12);
  });

  it("only uses base62 alphabet", () => {
    const token = generateBase62Token(64);
    expect(token).toMatch(/^[0-9A-Za-z]+$/);
  });

  it("is unlikely to collide", () => {
    const set = new Set<string>();
    for (let i = 0; i < 5000; i++) set.add(generateBase62Token(8));
    expect(set.size).toBe(5000);
  });
});
```

- [ ] **Step 1.10: Create `packages/shared/src/utils/index.ts`**

```ts
export * from "./bilingual.ts";
export * from "./slug.ts";
```

- [ ] **Step 1.11: Create `packages/shared/src/schemas/common.ts`**

```ts
import { z } from "zod";
import {
  ASPECT_RATIOS,
  SUBMISSION_STATUSES,
  USER_ROLES,
  REPORT_STATUSES,
  ANNOUNCEMENT_SEVERITIES,
  LOCALES,
  SORT_OPTIONS,
  THEME_MODES,
} from "../types/index.ts";

export const LocaleSchema = z.enum(LOCALES);
export const AspectRatioSchema = z.enum(ASPECT_RATIOS);
export const UserRoleSchema = z.enum(USER_ROLES);
export const SubmissionStatusSchema = z.enum(SUBMISSION_STATUSES);
export const ReportStatusSchema = z.enum(REPORT_STATUSES);
export const AnnouncementSeveritySchema = z.enum(ANNOUNCEMENT_SEVERITIES);
export const SortOptionSchema = z.enum(SORT_OPTIONS);
export const ThemeModeSchema = z.enum(THEME_MODES);

/**
 * Bilingual text where at least one of zh / en is a non-empty string after trimming.
 * Maximum length per language is 4000 chars to bound payload size.
 */
export const BilingualTextSchema = z
  .object({
    zh: z.string().trim().max(4000).optional(),
    en: z.string().trim().max(4000).optional(),
  })
  .refine((v) => (v.zh && v.zh.length > 0) || (v.en && v.en.length > 0), {
    message: "at_least_one_language_required",
  });

/**
 * Optional bilingual text — both zh and en may be empty / undefined.
 * Used for negative_prompt and notes.
 */
export const OptionalBilingualTextSchema = z.object({
  zh: z.string().trim().max(4000).optional(),
  en: z.string().trim().max(4000).optional(),
});

export const UuidSchema = z.string().uuid();
export const SlugSchema = z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
```

- [ ] **Step 1.12: Create `packages/shared/src/schemas/prompt.ts`**

```ts
import { z } from "zod";
import {
  AspectRatioSchema,
  BilingualTextSchema,
  OptionalBilingualTextSchema,
  SlugSchema,
  UuidSchema,
} from "./common.ts";

export const CategorySchema = z.object({
  id: UuidSchema,
  slug: SlugSchema,
  name: BilingualTextSchema,
  order: z.number().int().default(0),
  promptCount: z.number().int().nonnegative().default(0),
});

export const TagSchema = z.object({
  id: UuidSchema,
  slug: SlugSchema,
  name: BilingualTextSchema,
  usageCount: z.number().int().nonnegative().default(0),
});

export const PromptImageSchema = z.object({
  id: UuidSchema,
  r2AccountId: UuidSchema,
  r2Key: z.string().min(1),
  order: z.number().int().default(0),
  altText: z.string().nullable(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  lqip: z.string().nullable(),
});

export const PromptSummarySchema = z.object({
  id: UuidSchema,
  slug: SlugSchema,
  title: BilingualTextSchema,
  category: z.object({
    id: UuidSchema,
    slug: SlugSchema,
    name: BilingualTextSchema,
  }),
  tags: z.array(z.object({ slug: SlugSchema, name: BilingualTextSchema })),
  aspectRatio: AspectRatioSchema.nullable(),
  primaryImage: PromptImageSchema.pick({
    r2AccountId: true,
    r2Key: true,
    width: true,
    height: true,
    lqip: true,
  }).nullable(),
  viewCount: z.number().int().nonnegative(),
  likeCount: z.number().int().nonnegative(),
  sendCount: z.number().int().nonnegative(),
  favoriteCount: z.number().int().nonnegative(),
  approvedAt: z.string(),
});

export const PromptDetailSchema = PromptSummarySchema.extend({
  prompt: BilingualTextSchema,
  negativePrompt: OptionalBilingualTextSchema.nullable(),
  notes: OptionalBilingualTextSchema.nullable(),
  contributor: z
    .object({
      id: UuidSchema,
      name: z.string().nullable(),
      avatarUrl: z.string().nullable(),
    })
    .nullable(),
  images: z.array(PromptImageSchema),
  source: z.enum(["site", "nanobanana_seed"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});
```

- [ ] **Step 1.13: Create `packages/shared/src/schemas/api.ts`**

```ts
import { z } from "zod";
import {
  AspectRatioSchema,
  SlugSchema,
  SortOptionSchema,
  UuidSchema,
} from "./common.ts";
import {
  CategorySchema,
  PromptDetailSchema,
  PromptSummarySchema,
  TagSchema,
} from "./prompt.ts";

export const PromptListQuerySchema = z.object({
  category: SlugSchema.optional(),
  tag: SlugSchema.optional(),
  aspect: AspectRatioSchema.optional(),
  sort: SortOptionSchema.default("latest"),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(60).default(24),
});

export const PaginatedSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
    hasMore: z.boolean(),
  });

export const PromptListResponseSchema = PaginatedSchema(PromptSummarySchema);
export const PromptDetailResponseSchema = PromptDetailSchema;
export const CategoryListResponseSchema = z.array(CategorySchema);
export const TagListResponseSchema = z.array(TagSchema);

export const R2PoolEntrySchema = z.object({
  id: UuidSchema,
  publicUrl: z.string().url(),
});
export const R2PoolResponseSchema = z.array(R2PoolEntrySchema);

export const ErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  fields: z.record(z.string(), z.string()).optional(),
});
```

- [ ] **Step 1.14: Create `packages/shared/src/schemas/index.ts`**

```ts
export * from "./common.ts";
export * from "./prompt.ts";
export * from "./api.ts";
```

- [ ] **Step 1.15: Create `packages/shared/src/index.ts`**

```ts
export * from "./types/index.ts";
export * from "./schemas/index.ts";
export * from "./utils/index.ts";
```

- [ ] **Step 1.16: Install package deps**

Run:
```bash
pnpm install
```

Expected: pnpm now sees `packages/shared` in the workspace and installs zod + vitest there.

- [ ] **Step 1.17: Run tests for shared**

Run:
```bash
pnpm --filter @ip/shared test
```

Expected: All tests pass (3 suites: `bilingual.test.ts` × 3 describes, `slug.test.ts` × 2 describes). Vitest output shows green checkmarks.

- [ ] **Step 1.18: Typecheck shared**

Run:
```bash
pnpm --filter @ip/shared typecheck
```

Expected: Exits 0.

- [ ] **Step 1.19: Commit**

```bash
git add packages/shared pnpm-lock.yaml
git commit -m "feat(shared): add domain types, zod schemas, bilingual + slug utils

- @ip/shared package exposes types, schemas, utils as separate entries
- BilingualText enforced via Zod refine and CHECK constraint (DB)
- pickBilingual fallback logic with whitespace handling
- slugify covers ASCII + CJK strip + 80-char truncation
- generateBase62Token for import_tokens (8 chars ~ 47.6 bits)"
```

---

## Task 2: apps/api — Hono Server Skeleton

**Files:**
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/api/.env.example`
- Create: `apps/api/drizzle.config.ts`
- Create: `apps/api/src/env.ts`
- Create: `apps/api/src/server.ts`
- Create: `apps/api/src/index.ts`
- Create: `apps/api/src/db/client.ts`
- Create: `apps/api/src/middleware/error.ts`
- Create: `apps/api/src/middleware/locale.ts`
- Create: `apps/api/src/routes/health.ts`
- Test: `apps/api/src/routes/health.test.ts`
- Test: `apps/api/vitest.config.ts`

- [ ] **Step 2.1: Create `apps/api/package.json`**

```json
{
  "name": "@ip/api",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "drizzle-kit migrate",
    "db:seed": "tsx src/db/seed.ts",
    "db:studio": "drizzle-kit studio"
  },
  "dependencies": {
    "@ip/shared": "workspace:*",
    "@hono/node-server": "^1.13.0",
    "@hono/zod-validator": "^0.4.0",
    "dotenv": "^16.4.0",
    "drizzle-orm": "^0.38.0",
    "hono": "^4.6.0",
    "pg": "^8.13.0",
    "pino": "^9.5.0",
    "pino-pretty": "^13.0.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "@types/pg": "^8.11.0",
    "drizzle-kit": "^0.30.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2.2: Create `apps/api/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "types": ["node"],
    "module": "ESNext",
    "moduleResolution": "Bundler"
  },
  "include": ["src/**/*.ts", "drizzle.config.ts"],
  "exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 2.3: Create `apps/api/.env.example`**

```bash
# Server
NODE_ENV=development
PORT=3000
HOST=127.0.0.1
SITE_URL=http://localhost:5173
API_URL=http://localhost:3000

# Logging
LOG_LEVEL=debug

# Database
DATABASE_URL=postgres://ip_app:devpassword@localhost:5432/image_prompts_dev

# Auth (M3, not used in M1)
AUTH_SECRET=dev_secret_change_me_at_least_32_chars_long_xx

# Encryption for R2 / AI keys (M4, not used in M1)
R2_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000

# Optional dev R2 (M4 will need real values; M1 may leave dummy)
R2_DEV_ENDPOINT=
R2_DEV_ACCESS_KEY_ID=
R2_DEV_ACCESS_KEY_SECRET=
R2_DEV_BUCKET=
R2_DEV_PUBLIC_URL=https://placeholder.example.com
```

- [ ] **Step 2.4: Create `apps/api/src/env.ts`**

```ts
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
  R2_ENCRYPTION_KEY: z.string().regex(/^[0-9a-f]{64}$/i, "must be 32-byte hex"),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error("❌ Invalid environment variables:");
  console.error(parsed.error.format());
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
```

- [ ] **Step 2.5: Create `apps/api/src/db/client.ts`**

```ts
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { env } from "../env.ts";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on("error", (err) => {
  // Log fatal pool errors; allow process to die so the supervisor restarts.
  // eslint-disable-next-line no-console
  console.error("[pg-pool] unexpected error", err);
  process.exit(1);
});

export const db = drizzle(pool);
export type Db = typeof db;
```

- [ ] **Step 2.6: Create `apps/api/src/middleware/error.ts`**

```ts
import type { ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: errorCodeForStatus(err.status), message: err.message }, err.status);
  }
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const issue of err.errors) {
      fields[issue.path.join(".") || "_root"] = issue.message;
    }
    return c.json({ error: "validation_error", fields }, 400);
  }
  // eslint-disable-next-line no-console
  console.error("[server] unhandled error", err);
  return c.json({ error: "internal_error" }, 500);
};

function errorCodeForStatus(status: number): string {
  switch (status) {
    case 400:
      return "bad_request";
    case 401:
      return "unauthorized";
    case 403:
      return "forbidden";
    case 404:
      return "not_found";
    case 410:
      return "gone";
    case 429:
      return "rate_limited";
    case 503:
      return "service_unavailable";
    default:
      return status >= 500 ? "internal_error" : "error";
  }
}
```

- [ ] **Step 2.7: Create `apps/api/src/middleware/locale.ts`**

```ts
import { createMiddleware } from "hono/factory";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@ip/shared";

type LocaleVars = { locale: Locale };

/**
 * Extracts requested locale from the X-Locale header or ?locale query param.
 * Defaults to zh. Used by API routes that need to format bilingual content.
 * (Path locale prefixes belong to the web app router, not the API.)
 */
export const localeMiddleware = createMiddleware<{ Variables: LocaleVars }>(async (c, next) => {
  const fromHeader = c.req.header("x-locale");
  const fromQuery = c.req.query("locale");
  const candidate = fromHeader ?? fromQuery ?? "";
  c.set("locale", isLocale(candidate) ? candidate : DEFAULT_LOCALE);
  await next();
});

export type { LocaleVars };
```

- [ ] **Step 2.8: Create `apps/api/src/routes/health.ts`**

```ts
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { db } from "../db/client.ts";

const app = new Hono();

app.get("/", async (c) => {
  try {
    await db.execute(sql`SELECT 1`);
    return c.json({ status: "ok", db: "ok", time: new Date().toISOString() });
  } catch (err) {
    return c.json(
      {
        status: "degraded",
        db: "down",
        time: new Date().toISOString(),
        message: err instanceof Error ? err.message : String(err),
      },
      503,
    );
  }
});

export default app;
```

- [ ] **Step 2.9: Create `apps/api/src/server.ts`**

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { env } from "./env.ts";
import { errorHandler } from "./middleware/error.ts";
import healthRoute from "./routes/health.ts";

export function createServer() {
  const app = new Hono();

  app.use("*", logger());
  app.use("*", secureHeaders());
  app.use(
    "*",
    cors({
      origin: [env.SITE_URL],
      credentials: true,
      allowHeaders: ["Content-Type", "Authorization", "X-Locale"],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  app.route("/api/health", healthRoute);

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError(errorHandler);

  return app;
}
```

- [ ] **Step 2.10: Create `apps/api/src/index.ts`**

```ts
import { serve } from "@hono/node-server";
import { env } from "./env.ts";
import { createServer } from "./server.ts";

const app = createServer();

serve({ fetch: app.fetch, hostname: env.HOST, port: env.PORT }, (info) => {
  // eslint-disable-next-line no-console
  console.log(`✓ Image-Prompts API running on http://${info.address}:${info.port}`);
});

const shutdown = (signal: string) => {
  // eslint-disable-next-line no-console
  console.log(`\n[${signal}] shutting down...`);
  process.exit(0);
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
```

- [ ] **Step 2.11: Create `apps/api/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    setupFiles: [],
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
```

- [ ] **Step 2.12: Create `apps/api/src/routes/health.test.ts`**

```ts
import { describe, it, expect } from "vitest";

describe("GET /api/health (smoke, no DB)", () => {
  it("responds with json shape", async () => {
    // We can't hit the live route without DB; assert the route module exports a Hono app.
    const mod = await import("./health.ts");
    expect(mod.default).toBeDefined();
    expect(typeof mod.default.fetch).toBe("function");
  });
});
```

- [ ] **Step 2.13: Write `apps/api/.env`**

Copy `.env.example` and fill values that work locally:

```bash
cp apps/api/.env.example apps/api/.env
```

Then edit `apps/api/.env` and replace these placeholders with real values:
- `R2_ENCRYPTION_KEY`: generate with `openssl rand -hex 32`
- `AUTH_SECRET`: generate with `openssl rand -base64 48` (any string ≥32 chars works for M1)
- `DATABASE_URL`: confirm `ip_app` user and `image_prompts_dev` database exist locally (see Prerequisites).

- [ ] **Step 2.14: Install api deps**

```bash
pnpm install
```

Expected: pnpm adds dependencies under `apps/api/node_modules`. Lockfile updated.

- [ ] **Step 2.15: Typecheck api**

```bash
pnpm --filter @ip/api typecheck
```

Expected: Exits 0.

- [ ] **Step 2.16: Run api unit tests**

```bash
pnpm --filter @ip/api test
```

Expected: 1 test passes (`health` smoke test).

- [ ] **Step 2.17: Manually verify dev server boots**

```bash
pnpm --filter @ip/api dev
```

Expected output:
```
✓ Image-Prompts API running on http://127.0.0.1:3000
```

In another terminal:
```bash
curl -s http://127.0.0.1:3000/api/health | head -c 200
```

Expected: JSON like `{"status":"ok","db":"ok","time":"2026-..."}`. If DB isn't running you'll see `"db":"down"` with 503 status — fix prerequisites if so.

Stop the dev server with Ctrl+C.

- [ ] **Step 2.18: Commit**

```bash
git add apps/api pnpm-lock.yaml
git commit -m "feat(api): hono server skeleton with health route

- Strict env validation via zod
- pg pool + drizzle client
- CORS / logger / secure-headers middleware
- Error handler unifies HTTPException + ZodError + unknown
- Locale middleware (X-Locale or ?locale → ctx.locale)
- GET /api/health does SELECT 1, returns 503 on DB down
- vitest config, single-fork for integration safety"
```

---

## Task 3: Drizzle Schema — All 19 Tables

**Files:**
- Create: `apps/api/src/db/schema/auth.ts`
- Create: `apps/api/src/db/schema/prompts.ts`
- Create: `apps/api/src/db/schema/taxonomy.ts`
- Create: `apps/api/src/db/schema/images.ts`
- Create: `apps/api/src/db/schema/interactions.ts`
- Create: `apps/api/src/db/schema/system.ts`
- Create: `apps/api/src/db/schema/index.ts`
- Create: `apps/api/drizzle.config.ts`
- Generated: `apps/api/drizzle/0000_*.sql`

- [ ] **Step 3.1: Create `apps/api/drizzle.config.ts`**

```ts
import { defineConfig } from "drizzle-kit";
import dotenv from "dotenv";

dotenv.config();

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  casing: "snake_case",
  verbose: true,
  strict: true,
});
```

- [ ] **Step 3.2: Create `apps/api/src/db/schema/auth.ts`**

```ts
import { pgTable, pgEnum, uuid, text, timestamp, integer } from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["user", "moderator", "admin"]);

export const users = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull().unique(),
  name: text(),
  avatarUrl: text("avatar_url"),
  role: userRoleEnum().notNull().default("user"),
  locale: text().notNull().default("zh"),
  communityGuidelinesVersion: integer("community_guidelines_version").notNull().default(0),
  dailySubmissionCount: integer("daily_submission_count").notNull().default(0),
  dailySubmissionResetAt: timestamp("daily_submission_reset_at", { withTimezone: true }),
  rejectedCount: integer("rejected_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable("accounts", {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: text().notNull(),
  providerUid: text("provider_uid").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  sessionToken: text("session_token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable("verification_tokens", {
  identifier: text().notNull(),
  token: text().notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
```

- [ ] **Step 3.3: Create `apps/api/src/db/schema/taxonomy.ts`**

```ts
import { pgTable, uuid, text, integer, jsonb, timestamp, primaryKey, index } from "drizzle-orm/pg-core";
import { users } from "./auth.ts";

export const categories = pgTable("categories", {
  id: uuid().primaryKey().defaultRandom(),
  slug: text().notNull().unique(),
  name: jsonb().$type<{ zh?: string; en?: string }>().notNull(),
  description: jsonb().$type<{ zh?: string; en?: string }>(),
  order: integer().notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tags = pgTable("tags", {
  id: uuid().primaryKey().defaultRandom(),
  slug: text().notNull().unique(),
  name: jsonb().$type<{ zh?: string; en?: string }>().notNull(),
  usageCount: integer("usage_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tagSuggestions = pgTable("tag_suggestions", {
  id: uuid().primaryKey().defaultRandom(),
  suggesterId: uuid("suggester_id")
    .notNull()
    .references(() => users.id),
  suggestedName: jsonb("suggested_name").$type<{ zh?: string; en?: string }>().notNull(),
  reason: text(),
  status: text().notNull().default("pending"),
  reviewedBy: uuid("reviewed_by").references(() => users.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
```

- [ ] **Step 3.4: Create `apps/api/src/db/schema/images.ts`**

```ts
import { pgTable, uuid, text, integer, bigint, boolean, timestamp, jsonb, unique, index } from "drizzle-orm/pg-core";

export const r2Accounts = pgTable(
  "r2_accounts",
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    accountId: text("account_id").notNull(),
    accessKeyId: text("access_key_id").notNull(),
    accessKeySecretEncrypted: text("access_key_secret_encrypted").notNull(),
    bucket: text().notNull(),
    endpoint: text().notNull(),
    publicUrl: text("public_url").notNull(),
    enabled: boolean().notNull().default(true),
    priority: integer().notNull().default(100),
    notes: text(),
    usedBytes: bigint("used_bytes", { mode: "number" }).notNull().default(0),
    monthlyClassACount: integer("monthly_class_a_count").notNull().default(0),
    monthlyClassBCount: integer("monthly_class_b_count").notNull().default(0),
    monthlyResetAt: timestamp("monthly_reset_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pickIdx: index("r2_accounts_pick_idx").on(t.priority, t.createdAt),
  }),
);

export const promptImages = pgTable(
  "prompt_images",
  {
    id: uuid().primaryKey().defaultRandom(),
    promptId: uuid("prompt_id").notNull(),
    r2AccountId: uuid("r2_account_id")
      .notNull()
      .references(() => r2Accounts.id),
    r2Key: text("r2_key").notNull(),
    order: integer().notNull().default(0),
    altText: text("alt_text"),
    width: integer(),
    height: integer(),
    lqip: text(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    promptOrderIdx: index("prompt_images_prompt_idx").on(t.promptId, t.order),
    keyUnique: unique("prompt_images_account_key_uq").on(t.r2AccountId, t.r2Key),
  }),
);
```

- [ ] **Step 3.5: Create `apps/api/src/db/schema/prompts.ts`**

```ts
import { sql } from "drizzle-orm";
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { categories } from "./taxonomy.ts";
import { users } from "./auth.ts";

export const submissionStatusEnum = pgEnum("submission_status", ["pending", "approved", "rejected"]);

const bilingualCheck = (field: string) =>
  sql.raw(
    `((${field} ->> 'zh') IS NOT NULL AND length(${field} ->> 'zh') > 0) ` +
      `OR ((${field} ->> 'en') IS NOT NULL AND length(${field} ->> 'en') > 0)`,
  );

export const prompts = pgTable(
  "prompts",
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: text().notNull().unique(),
    title: jsonb().$type<{ zh?: string; en?: string }>().notNull(),
    prompt: jsonb().$type<{ zh?: string; en?: string }>().notNull(),
    negativePrompt: jsonb("negative_prompt").$type<{ zh?: string; en?: string }>(),
    notes: jsonb().$type<{ zh?: string; en?: string }>(),
    aspectRatio: text("aspect_ratio"),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    contributorId: uuid("contributor_id").references(() => users.id),
    source: text().notNull().default("site"),
    viewCount: integer("view_count").notNull().default(0),
    favoriteCount: integer("favorite_count").notNull().default(0),
    likeCount: integer("like_count").notNull().default(0),
    sendCount: integer("send_count").notNull().default(0),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    categoryIdx: index("prompts_category_idx").on(t.categoryId),
    approvedAtIdx: index("prompts_approved_at_idx").on(t.approvedAt.desc()),
    likeCountIdx: index("prompts_like_count_idx").on(t.likeCount.desc()),
    viewCountIdx: index("prompts_view_count_idx").on(t.viewCount.desc()),
    sendCountIdx: index("prompts_send_count_idx").on(t.sendCount.desc()),
    titleBilingual: check("prompts_title_bilingual_chk", bilingualCheck("title")),
    promptBilingual: check("prompts_prompt_bilingual_chk", bilingualCheck("prompt")),
  }),
);

export const promptTags = pgTable(
  "prompt_tags",
  {
    promptId: uuid("prompt_id").notNull(),
    tagId: uuid("tag_id").notNull(),
  },
  (t) => ({
    pk: { name: "prompt_tags_pkey", columns: [t.promptId, t.tagId] },
    tagIdx: index("prompt_tags_tag_idx").on(t.tagId),
  }),
);

export const submissions = pgTable(
  "submissions",
  {
    id: uuid().primaryKey().defaultRandom(),
    title: jsonb().$type<{ zh?: string; en?: string }>().notNull(),
    prompt: jsonb().$type<{ zh?: string; en?: string }>().notNull(),
    negativePrompt: jsonb("negative_prompt").$type<{ zh?: string; en?: string }>(),
    notes: jsonb().$type<{ zh?: string; en?: string }>(),
    aspectRatio: text("aspect_ratio"),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id),
    contributorId: uuid("contributor_id")
      .notNull()
      .references(() => users.id),
    tagSlugs: text("tag_slugs").array().notNull().default(sql`'{}'::text[]`),
    imageKeys: jsonb("image_keys").$type<Array<{ r2AccountId: string; r2Key: string; altText?: string }>>().notNull(),
    status: submissionStatusEnum().notNull().default("pending"),
    rejectReason: text("reject_reason"),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    promotedTo: uuid("promoted_to").references(() => prompts.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("submissions_status_idx").on(t.status),
    contributorIdx: index("submissions_contributor_idx").on(t.contributorId),
    titleBilingual: check("submissions_title_bilingual_chk", bilingualCheck("title")),
    promptBilingual: check("submissions_prompt_bilingual_chk", bilingualCheck("prompt")),
  }),
);
```

- [ ] **Step 3.6: Create `apps/api/src/db/schema/interactions.ts`**

```ts
import { pgTable, uuid, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./auth.ts";
import { prompts } from "./prompts.ts";

export const favorites = pgTable(
  "favorites",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    promptId: uuid("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: { name: "favorites_pkey", columns: [t.userId, t.promptId] },
    userIdx: index("favorites_user_idx").on(t.userId, t.createdAt.desc()),
  }),
);

export const likes = pgTable(
  "likes",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    promptId: uuid("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: { name: "likes_pkey", columns: [t.userId, t.promptId] },
    promptIdx: index("likes_prompt_idx").on(t.promptId),
  }),
);
```

- [ ] **Step 3.7: Create `apps/api/src/db/schema/system.ts`**

```ts
import { pgTable, pgEnum, uuid, text, jsonb, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./auth.ts";
import { prompts } from "./prompts.ts";

export const reportStatusEnum = pgEnum("report_status", ["open", "reviewing", "resolved", "dismissed"]);
export const announcementSeverityEnum = pgEnum("announcement_severity", ["info", "warning", "critical"]);

export const importTokens = pgTable(
  "import_tokens",
  {
    token: text().primaryKey(),
    payload: jsonb().notNull(),
    promptId: uuid("prompt_id").references(() => prompts.id),
    used: boolean().notNull().default(false),
    usedAt: timestamp("used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdIp: text("created_ip"),
  },
  (t) => ({
    expiresIdx: index("import_tokens_expires_idx").on(t.expiresAt),
  }),
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid().primaryKey().defaultRandom(),
    actorId: uuid("actor_id").references(() => users.id),
    action: text().notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id"),
    meta: jsonb(),
    ip: text(),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    actorIdx: index("audit_log_actor_idx").on(t.actorId, t.createdAt.desc()),
    actionIdx: index("audit_log_action_idx").on(t.action, t.createdAt.desc()),
  }),
);

export const reports = pgTable(
  "reports",
  {
    id: uuid().primaryKey().defaultRandom(),
    reporterId: uuid("reporter_id").references(() => users.id),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    reason: text().notNull(),
    detail: text(),
    status: reportStatusEnum().notNull().default("open"),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    actionTaken: text("action_taken"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("reports_status_idx").on(t.status, t.createdAt),
  }),
);

export const announcements = pgTable(
  "announcements",
  {
    id: uuid().primaryKey().defaultRandom(),
    title: jsonb().$type<{ zh?: string; en?: string }>().notNull(),
    body: jsonb().$type<{ zh?: string; en?: string }>().notNull(),
    severity: announcementSeverityEnum().notNull().default("info"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    periodIdx: index("announcements_period_idx").on(t.startsAt, t.endsAt),
  }),
);

export const siteSettings = pgTable("site_settings", {
  key: text().primaryKey(),
  value: jsonb().notNull(),
  description: text(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid("updated_by").references(() => users.id),
});
```

- [ ] **Step 3.8: Create `apps/api/src/db/schema/index.ts`**

```ts
export * from "./auth.ts";
export * from "./taxonomy.ts";
export * from "./images.ts";
export * from "./prompts.ts";
export * from "./interactions.ts";
export * from "./system.ts";
```

- [ ] **Step 3.9: Generate the first migration**

```bash
pnpm --filter @ip/api db:generate
```

Expected:
- A file appears at `apps/api/drizzle/0000_*.sql` (timestamped, e.g. `0000_loose_omega_red.sql`)
- A `meta/_journal.json` is updated
- drizzle-kit prints `✔ Your SQL migration file is ready.`

- [ ] **Step 3.10: Inspect the generated SQL**

Open the generated `apps/api/drizzle/0000_*.sql` file. Verify:
- All 19 tables present (users, accounts, sessions, verification_tokens, categories, tags, tag_suggestions, r2_accounts, prompt_images, prompts, prompt_tags, submissions, favorites, likes, import_tokens, audit_log, reports, announcements, site_settings)
- The two CHECK constraints on `prompts` (`prompts_title_bilingual_chk`, `prompts_prompt_bilingual_chk`) are present
- The two CHECK constraints on `submissions` are present
- Composite primary keys exist on `prompt_tags`, `favorites`, `likes`

If any are missing, fix the schema and re-run `db:generate`.

- [ ] **Step 3.11: Apply migration**

```bash
pnpm --filter @ip/api db:migrate
```

Expected: drizzle-kit connects to local PG, applies migration, prints `✔ migrations applied`.

- [ ] **Step 3.12: Verify schema in PG**

```bash
psql -d image_prompts_dev -c "\dt"
```

Expected: lists all 19 tables. Then:

```bash
psql -d image_prompts_dev -c "\d prompts"
```

Expected output shows columns including the two bilingual CHECK constraints.

- [ ] **Step 3.13: Commit**

```bash
git add apps/api/src/db apps/api/drizzle.config.ts apps/api/drizzle
git commit -m "feat(api): drizzle schema with all 19 tables + first migration

- auth: users + accounts + sessions + verification_tokens (Auth.js compatible)
- taxonomy: categories + tags + tag_suggestions
- images: r2_accounts (pool) + prompt_images
- prompts: prompts + prompt_tags + submissions (CHECK bilingual)
- interactions: favorites + likes (composite PK)
- system: import_tokens + audit_log + reports + announcements + site_settings
- Drizzle uses snake_case casing, generated migration applied locally"
```

---

## Task 4: Seed Script for Local Development

**Files:**
- Create: `apps/api/src/db/seed.ts`
- Create: `apps/api/src/db/seed-data.ts`

- [ ] **Step 4.1: Create `apps/api/src/db/seed-data.ts`**

```ts
/**
 * Demo seed data for local dev only. Tiny, hand-written. M8 will replace this
 * with the real nanobanana-website 2380 prompt migration.
 */
export const DEMO_CATEGORIES = [
  { slug: "landscape", nameZh: "风景", nameEn: "Landscape", order: 1 },
  { slug: "portrait", nameZh: "人物", nameEn: "Portrait", order: 2 },
  { slug: "anime", nameZh: "二次元", nameEn: "Anime", order: 3 },
  { slug: "guofeng", nameZh: "国风", nameEn: "Chinese Style", order: 4 },
  { slug: "animal", nameZh: "动物", nameEn: "Animal", order: 5 },
  { slug: "architecture", nameZh: "建筑", nameEn: "Architecture", order: 6 },
];

export const DEMO_TAGS = [
  { slug: "cyberpunk", nameZh: "赛博朋克", nameEn: "Cyberpunk" },
  { slug: "neon", nameZh: "霓虹", nameEn: "Neon" },
  { slug: "minimal", nameZh: "极简", nameEn: "Minimal" },
  { slug: "film", nameZh: "胶片", nameEn: "Film" },
  { slug: "night", nameZh: "夜景", nameEn: "Night" },
  { slug: "rain", nameZh: "雨", nameEn: "Rain" },
  { slug: "purple", nameZh: "紫调", nameEn: "Purple" },
  { slug: "nature", nameZh: "自然", nameEn: "Nature" },
];

export const DEMO_R2_ACCOUNT = {
  name: "Local Dev Placeholder",
  accountId: "dev-account",
  accessKeyId: "dev-key-id",
  // Plaintext placeholder ONLY for dev seed. M4 will switch to AES-GCM-encrypted.
  accessKeySecretEncrypted: "DEV_PLACEHOLDER_NOT_ENCRYPTED",
  bucket: "image-prompts-dev",
  endpoint: "https://placeholder.example.com",
  publicUrl: "https://placeholder.example.com",
  enabled: true,
  priority: 100,
};

export const DEMO_PROMPTS = [
  {
    slug: "cyberpunk-neon-cat",
    titleZh: "赛博朋克霓虹猫",
    titleEn: "Cyberpunk Neon Cat",
    promptZh: "一只赛博朋克风格的橘猫,坐在雨夜霓虹招牌下的窗台,毛发被霓虹灯照亮,蓝紫色调,电影级侧逆光,50mm 镜头,浅景深,写实摄影风格",
    promptEn: "A cyberpunk-style orange cat sitting on a windowsill under neon signs in a rainy night, fur illuminated by neon lights, blue-purple tones, cinematic side backlighting, 50mm lens, shallow depth of field, photorealistic style",
    negativeZh: "模糊, 噪点, 多余的手",
    negativeEn: "blurry, noisy, extra hands",
    aspectRatio: "16:9",
    categorySlug: "landscape",
    tagSlugs: ["cyberpunk", "neon", "night", "rain"],
  },
  {
    slug: "purple-minimal-portrait",
    titleZh: "紫调极简肖像",
    titleEn: "Purple Minimal Portrait",
    promptZh: "极简紫调人物肖像,正面光,纯色背景,胶片质感,柔焦",
    promptEn: "Minimal purple-toned portrait, frontal lighting, solid color background, film texture, soft focus",
    negativeZh: undefined,
    negativeEn: undefined,
    aspectRatio: "3:2",
    categorySlug: "portrait",
    tagSlugs: ["purple", "minimal", "film"],
  },
  {
    slug: "misty-forest-morning",
    titleZh: "青绿森林晨雾",
    titleEn: "Misty Forest Morning",
    promptZh: "清晨青绿森林中的薄雾,阳光透过树叶形成丁达尔光束,广角",
    promptEn: "Misty morning in a green forest, sunlight filtering through leaves as Tyndall beams, wide angle",
    negativeZh: undefined,
    negativeEn: undefined,
    aspectRatio: "16:9",
    categorySlug: "landscape",
    tagSlugs: ["nature"],
  },
  {
    slug: "gobi-sunset-road",
    titleZh: "黄昏戈壁公路",
    titleEn: "Gobi Sunset Road",
    promptZh: "落日下的戈壁公路,远景一辆车,暖橙色调,公路片质感",
    promptEn: "Gobi highway at sunset, a distant car, warm orange tones, road movie aesthetic",
    negativeZh: undefined,
    negativeEn: undefined,
    aspectRatio: "16:9",
    categorySlug: "landscape",
    tagSlugs: ["film"],
  },
  {
    slug: "rainy-street-deep-grey",
    titleZh: "深灰雨夜街景",
    titleEn: "Rainy Street Deep Grey",
    promptZh: "深灰色调雨夜街景,反光路面,孤独人物背影,电影质感",
    promptEn: "Deep grey rainy night street, reflective pavement, lone figure from behind, cinematic",
    negativeZh: undefined,
    negativeEn: undefined,
    aspectRatio: "16:9",
    categorySlug: "landscape",
    tagSlugs: ["night", "rain", "film"],
  },
  {
    slug: "japanese-zen-garden",
    titleZh: "日式禅院庭院",
    titleEn: "Japanese Zen Garden",
    promptZh: "极简日式禅院庭院,白沙耙痕,枯石,苔藓,黄昏柔光",
    promptEn: "Minimalist Japanese zen garden, raked white sand, dry rocks, moss, soft dusk light",
    negativeZh: undefined,
    negativeEn: undefined,
    aspectRatio: "3:2",
    categorySlug: "architecture",
    tagSlugs: ["minimal"],
  },
];

export const DEMO_SITE_SETTINGS = [
  { key: "submit.daily_limit", value: 10, description: "Per-user daily submission limit" },
  { key: "community_guidelines.version", value: 1, description: "Current guidelines version" },
  { key: "community_guidelines.body", value: { zh: "请遵守社区准则。", en: "Please follow community guidelines." }, description: "Guidelines body bilingual" },
  { key: "translation.enabled", value: false, description: "AI translation feature toggle" },
  { key: "view_count.dedup_hours", value: 24, description: "View dedup window" },
];
```

- [ ] **Step 4.2: Create `apps/api/src/db/seed.ts`**

```ts
import { db, pool } from "./client.ts";
import * as schema from "./schema/index.ts";
import { DEMO_CATEGORIES, DEMO_TAGS, DEMO_R2_ACCOUNT, DEMO_PROMPTS, DEMO_SITE_SETTINGS } from "./seed-data.ts";
import { sql } from "drizzle-orm";

async function main() {
  console.log("Seeding…");

  // Idempotent: skip if any prompts already exist.
  const existing = await db.execute(sql`SELECT count(*)::int AS n FROM prompts`);
  const promptCount = Number((existing.rows[0] as { n: number }).n);
  if (promptCount > 0) {
    console.log(`Prompts already exist (${promptCount}). Skip seed.`);
    await pool.end();
    return;
  }

  // R2 account (must come first — prompt_images references it; we'll seed 1 placeholder).
  const [r2] = await db
    .insert(schema.r2Accounts)
    .values({
      name: DEMO_R2_ACCOUNT.name,
      accountId: DEMO_R2_ACCOUNT.accountId,
      accessKeyId: DEMO_R2_ACCOUNT.accessKeyId,
      accessKeySecretEncrypted: DEMO_R2_ACCOUNT.accessKeySecretEncrypted,
      bucket: DEMO_R2_ACCOUNT.bucket,
      endpoint: DEMO_R2_ACCOUNT.endpoint,
      publicUrl: DEMO_R2_ACCOUNT.publicUrl,
      enabled: DEMO_R2_ACCOUNT.enabled,
      priority: DEMO_R2_ACCOUNT.priority,
    })
    .returning();

  // Categories
  const insertedCategories = await db
    .insert(schema.categories)
    .values(
      DEMO_CATEGORIES.map((c) => ({
        slug: c.slug,
        name: { zh: c.nameZh, en: c.nameEn },
        order: c.order,
      })),
    )
    .returning();
  const categoryBySlug = new Map(insertedCategories.map((c) => [c.slug, c]));

  // Tags
  const insertedTags = await db
    .insert(schema.tags)
    .values(
      DEMO_TAGS.map((t) => ({
        slug: t.slug,
        name: { zh: t.nameZh, en: t.nameEn },
      })),
    )
    .returning();
  const tagBySlug = new Map(insertedTags.map((t) => [t.slug, t]));

  // Prompts + prompt_tags + prompt_images
  for (const p of DEMO_PROMPTS) {
    const category = categoryBySlug.get(p.categorySlug);
    if (!category) throw new Error(`unknown category slug: ${p.categorySlug}`);

    const [prompt] = await db
      .insert(schema.prompts)
      .values({
        slug: p.slug,
        title: { zh: p.titleZh, en: p.titleEn },
        prompt: { zh: p.promptZh, en: p.promptEn },
        negativePrompt: p.negativeZh || p.negativeEn ? { zh: p.negativeZh, en: p.negativeEn } : null,
        aspectRatio: p.aspectRatio,
        categoryId: category.id,
        source: "site",
      })
      .returning();

    // Tags
    for (const tagSlug of p.tagSlugs) {
      const tag = tagBySlug.get(tagSlug);
      if (!tag) continue;
      await db.insert(schema.promptTags).values({ promptId: prompt.id, tagId: tag.id });
    }

    // One placeholder image per prompt
    await db.insert(schema.promptImages).values({
      promptId: prompt.id,
      r2AccountId: r2.id,
      r2Key: `prompts/${prompt.id}/0.svg`,
      order: 0,
      altText: p.titleEn,
      width: 1280,
      height: 720,
      lqip: null,
    });
  }

  // Update tag usage_count
  for (const tag of insertedTags) {
    await db.execute(
      sql`UPDATE tags SET usage_count = (SELECT count(*) FROM prompt_tags WHERE tag_id = ${tag.id}) WHERE id = ${tag.id}`,
    );
  }

  // Site settings
  for (const setting of DEMO_SITE_SETTINGS) {
    await db.insert(schema.siteSettings).values(setting).onConflictDoNothing();
  }

  console.log(`Seeded ${DEMO_PROMPTS.length} prompts, ${DEMO_CATEGORIES.length} categories, ${DEMO_TAGS.length} tags.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 4.3: Run the seed**

```bash
pnpm --filter @ip/api db:seed
```

Expected:
```
Seeding…
Seeded 6 prompts, 6 categories, 8 tags.
```

- [ ] **Step 4.4: Verify in PG**

```bash
psql -d image_prompts_dev -c "SELECT slug, title->>'zh' AS title_zh FROM prompts ORDER BY slug;"
```

Expected: lists 6 rows with `cyberpunk-neon-cat`, etc.

```bash
psql -d image_prompts_dev -c "SELECT slug, usage_count FROM tags ORDER BY usage_count DESC;"
```

Expected: tags sorted by usage_count desc, most-used tags first.

- [ ] **Step 4.5: Run seed again to verify idempotency**

```bash
pnpm --filter @ip/api db:seed
```

Expected:
```
Seeding…
Prompts already exist (6). Skip seed.
```

- [ ] **Step 4.6: Commit**

```bash
git add apps/api/src/db/seed.ts apps/api/src/db/seed-data.ts
git commit -m "feat(api): seed script with demo data

- 6 categories, 8 tags, 1 placeholder R2 account, 6 demo prompts
- All bilingual; one placeholder image per prompt
- Idempotent: bails if prompts table already populated
- Site settings preloaded with submit limit + guidelines version"
```

---

## Task 5: Public Read API — Prompts, Categories, Tags, R2 Pool

**Files:**
- Create: `apps/api/src/repositories/prompts.ts`
- Create: `apps/api/src/repositories/categories.ts`
- Create: `apps/api/src/repositories/tags.ts`
- Create: `apps/api/src/repositories/r2-accounts.ts`
- Create: `apps/api/src/routes/prompts.ts`
- Create: `apps/api/src/routes/categories.ts`
- Create: `apps/api/src/routes/tags.ts`
- Create: `apps/api/src/routes/public.ts`
- Modify: `apps/api/src/server.ts`
- Test: `apps/api/src/repositories/prompts.test.ts`
- Test: `apps/api/src/routes/prompts.test.ts`

- [ ] **Step 5.1: Create `apps/api/src/repositories/prompts.ts`**

```ts
import { and, asc, desc, eq, ilike, inArray, sql } from "drizzle-orm";
import type { z } from "zod";
import { db } from "../db/client.ts";
import { categories, prompts, promptImages, promptTags, tags } from "../db/schema/index.ts";
import type { PromptListQuerySchema } from "@ip/shared";

type PromptListQuery = z.infer<typeof PromptListQuerySchema>;

const orderBy = (sort: PromptListQuery["sort"]) => {
  switch (sort) {
    case "popular":
      return desc(prompts.viewCount);
    case "liked":
      return desc(prompts.likeCount);
    case "sent":
      return desc(prompts.sendCount);
    case "latest":
    default:
      return desc(prompts.approvedAt);
  }
};

export async function listPrompts(q: PromptListQuery) {
  const offset = (q.page - 1) * q.pageSize;

  // Resolve category and tag IDs from slugs.
  let categoryId: string | undefined;
  if (q.category) {
    const [row] = await db.select({ id: categories.id }).from(categories).where(eq(categories.slug, q.category));
    if (!row) return { items: [], total: 0, page: q.page, pageSize: q.pageSize, hasMore: false };
    categoryId = row.id;
  }

  let promptIdsByTag: string[] | undefined;
  if (q.tag) {
    const [tagRow] = await db.select({ id: tags.id }).from(tags).where(eq(tags.slug, q.tag));
    if (!tagRow) return { items: [], total: 0, page: q.page, pageSize: q.pageSize, hasMore: false };
    const ids = await db.select({ id: promptTags.promptId }).from(promptTags).where(eq(promptTags.tagId, tagRow.id));
    promptIdsByTag = ids.map((r) => r.id);
    if (promptIdsByTag.length === 0) return { items: [], total: 0, page: q.page, pageSize: q.pageSize, hasMore: false };
  }

  const conditions = [
    categoryId ? eq(prompts.categoryId, categoryId) : undefined,
    promptIdsByTag ? inArray(prompts.id, promptIdsByTag) : undefined,
    q.aspect ? eq(prompts.aspectRatio, q.aspect) : undefined,
    q.q
      ? sql`(${prompts.title}->>'zh' ILIKE ${"%" + q.q + "%"} OR ${prompts.title}->>'en' ILIKE ${"%" + q.q + "%"} OR ${prompts.prompt}->>'zh' ILIKE ${"%" + q.q + "%"} OR ${prompts.prompt}->>'en' ILIKE ${"%" + q.q + "%"})`
      : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const where = conditions.length ? and(...conditions) : undefined;

  const [countRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(prompts)
    .where(where);
  const total = countRow?.total ?? 0;

  if (total === 0) return { items: [], total, page: q.page, pageSize: q.pageSize, hasMore: false };

  const rows = await db
    .select({
      id: prompts.id,
      slug: prompts.slug,
      title: prompts.title,
      aspectRatio: prompts.aspectRatio,
      viewCount: prompts.viewCount,
      likeCount: prompts.likeCount,
      sendCount: prompts.sendCount,
      favoriteCount: prompts.favoriteCount,
      approvedAt: prompts.approvedAt,
      categoryId: prompts.categoryId,
      categorySlug: categories.slug,
      categoryName: categories.name,
    })
    .from(prompts)
    .innerJoin(categories, eq(categories.id, prompts.categoryId))
    .where(where)
    .orderBy(orderBy(q.sort))
    .limit(q.pageSize)
    .offset(offset);

  if (rows.length === 0) return { items: [], total, page: q.page, pageSize: q.pageSize, hasMore: false };

  const ids = rows.map((r) => r.id);

  // Primary image per prompt (order = 0)
  const images = await db
    .select({
      promptId: promptImages.promptId,
      r2AccountId: promptImages.r2AccountId,
      r2Key: promptImages.r2Key,
      width: promptImages.width,
      height: promptImages.height,
      lqip: promptImages.lqip,
      order: promptImages.order,
    })
    .from(promptImages)
    .where(inArray(promptImages.promptId, ids))
    .orderBy(asc(promptImages.order));
  const firstImageByPrompt = new Map<string, (typeof images)[number]>();
  for (const img of images) {
    if (!firstImageByPrompt.has(img.promptId)) firstImageByPrompt.set(img.promptId, img);
  }

  // Tags per prompt
  const tagsRows = await db
    .select({
      promptId: promptTags.promptId,
      slug: tags.slug,
      name: tags.name,
    })
    .from(promptTags)
    .innerJoin(tags, eq(tags.id, promptTags.tagId))
    .where(inArray(promptTags.promptId, ids));

  const tagsByPrompt = new Map<string, Array<{ slug: string; name: typeof tags.name._type }>>();
  for (const r of tagsRows) {
    const list = tagsByPrompt.get(r.promptId) ?? [];
    list.push({ slug: r.slug, name: r.name });
    tagsByPrompt.set(r.promptId, list);
  }

  const items = rows.map((r) => {
    const img = firstImageByPrompt.get(r.id) ?? null;
    return {
      id: r.id,
      slug: r.slug,
      title: r.title,
      category: { id: r.categoryId, slug: r.categorySlug, name: r.categoryName },
      tags: tagsByPrompt.get(r.id) ?? [],
      aspectRatio: r.aspectRatio,
      primaryImage: img
        ? {
            r2AccountId: img.r2AccountId,
            r2Key: img.r2Key,
            width: img.width,
            height: img.height,
            lqip: img.lqip,
          }
        : null,
      viewCount: r.viewCount,
      likeCount: r.likeCount,
      sendCount: r.sendCount,
      favoriteCount: r.favoriteCount,
      approvedAt: r.approvedAt.toISOString(),
    };
  });

  return {
    items,
    total,
    page: q.page,
    pageSize: q.pageSize,
    hasMore: q.page * q.pageSize < total,
  };
}

export async function getPromptBySlug(slug: string) {
  const [row] = await db
    .select({
      id: prompts.id,
      slug: prompts.slug,
      title: prompts.title,
      prompt: prompts.prompt,
      negativePrompt: prompts.negativePrompt,
      notes: prompts.notes,
      aspectRatio: prompts.aspectRatio,
      viewCount: prompts.viewCount,
      likeCount: prompts.likeCount,
      sendCount: prompts.sendCount,
      favoriteCount: prompts.favoriteCount,
      approvedAt: prompts.approvedAt,
      createdAt: prompts.createdAt,
      updatedAt: prompts.updatedAt,
      source: prompts.source,
      contributorId: prompts.contributorId,
      categoryId: prompts.categoryId,
      categorySlug: categories.slug,
      categoryName: categories.name,
    })
    .from(prompts)
    .innerJoin(categories, eq(categories.id, prompts.categoryId))
    .where(eq(prompts.slug, slug));

  if (!row) return null;

  const images = await db
    .select()
    .from(promptImages)
    .where(eq(promptImages.promptId, row.id))
    .orderBy(asc(promptImages.order));

  const tagRows = await db
    .select({ slug: tags.slug, name: tags.name })
    .from(promptTags)
    .innerJoin(tags, eq(tags.id, promptTags.tagId))
    .where(eq(promptTags.promptId, row.id));

  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    prompt: row.prompt,
    negativePrompt: row.negativePrompt,
    notes: row.notes,
    aspectRatio: row.aspectRatio,
    category: { id: row.categoryId, slug: row.categorySlug, name: row.categoryName },
    tags: tagRows,
    primaryImage: images[0]
      ? {
          r2AccountId: images[0].r2AccountId,
          r2Key: images[0].r2Key,
          width: images[0].width,
          height: images[0].height,
          lqip: images[0].lqip,
        }
      : null,
    images: images.map((i) => ({
      id: i.id,
      r2AccountId: i.r2AccountId,
      r2Key: i.r2Key,
      order: i.order,
      altText: i.altText,
      width: i.width,
      height: i.height,
      lqip: i.lqip,
    })),
    contributor: null, // M3 will join users when contributor exists
    viewCount: row.viewCount,
    likeCount: row.likeCount,
    sendCount: row.sendCount,
    favoriteCount: row.favoriteCount,
    source: row.source as "site" | "nanobanana_seed",
    approvedAt: row.approvedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listRelatedPrompts(promptId: string, categoryId: string, limit = 6) {
  // Same-category siblings, excluding self. M5 will switch to "shared tags" ranking.
  const rows = await db
    .select({
      id: prompts.id,
      slug: prompts.slug,
      title: prompts.title,
      aspectRatio: prompts.aspectRatio,
      viewCount: prompts.viewCount,
      likeCount: prompts.likeCount,
      sendCount: prompts.sendCount,
      favoriteCount: prompts.favoriteCount,
      approvedAt: prompts.approvedAt,
      categoryId: prompts.categoryId,
    })
    .from(prompts)
    .where(and(eq(prompts.categoryId, categoryId), sql`${prompts.id} <> ${promptId}`))
    .orderBy(desc(prompts.likeCount), desc(prompts.approvedAt))
    .limit(limit);
  return rows;
}
```

- [ ] **Step 5.2: Create `apps/api/src/repositories/categories.ts`**

```ts
import { asc, eq, sql } from "drizzle-orm";
import { db } from "../db/client.ts";
import { categories, prompts } from "../db/schema/index.ts";

export async function listCategories() {
  const rows = await db
    .select({
      id: categories.id,
      slug: categories.slug,
      name: categories.name,
      order: categories.order,
      promptCount: sql<number>`(SELECT count(*)::int FROM ${prompts} WHERE ${prompts.categoryId} = ${categories.id})`,
    })
    .from(categories)
    .orderBy(asc(categories.order), asc(categories.slug));
  return rows.map((r) => ({ ...r, promptCount: Number(r.promptCount ?? 0) }));
}
```

- [ ] **Step 5.3: Create `apps/api/src/repositories/tags.ts`**

```ts
import { desc, asc } from "drizzle-orm";
import { db } from "../db/client.ts";
import { tags } from "../db/schema/index.ts";

export async function listTags(limit = 100) {
  const rows = await db
    .select()
    .from(tags)
    .orderBy(desc(tags.usageCount), asc(tags.slug))
    .limit(limit);
  return rows.map((t) => ({
    id: t.id,
    slug: t.slug,
    name: t.name,
    usageCount: t.usageCount,
  }));
}
```

- [ ] **Step 5.4: Create `apps/api/src/repositories/r2-accounts.ts`**

```ts
import { and, asc, eq, isNull } from "drizzle-orm";
import { db } from "../db/client.ts";
import { r2Accounts } from "../db/schema/index.ts";

export async function listR2PoolPublic() {
  const rows = await db
    .select({
      id: r2Accounts.id,
      publicUrl: r2Accounts.publicUrl,
    })
    .from(r2Accounts)
    .where(and(eq(r2Accounts.enabled, true), isNull(r2Accounts.deletedAt)))
    .orderBy(asc(r2Accounts.createdAt));
  return rows;
}
```

- [ ] **Step 5.5: Create `apps/api/src/routes/prompts.ts`**

```ts
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator";
import { PromptListQuerySchema } from "@ip/shared";
import { getPromptBySlug, listPrompts, listRelatedPrompts } from "../repositories/prompts.ts";

const app = new Hono();

app.get("/", zValidator("query", PromptListQuerySchema), async (c) => {
  const query = c.req.valid("query");
  const result = await listPrompts(query);
  return c.json(result);
});

app.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const detail = await getPromptBySlug(slug);
  if (!detail) throw new HTTPException(404, { message: "prompt_not_found" });

  const related = await listRelatedPrompts(detail.id, detail.category.id, 6);
  return c.json({
    ...detail,
    related: related.map((r) => ({
      id: r.id,
      slug: r.slug,
      title: r.title,
      aspectRatio: r.aspectRatio,
      viewCount: r.viewCount,
      likeCount: r.likeCount,
      sendCount: r.sendCount,
      favoriteCount: r.favoriteCount,
      approvedAt: r.approvedAt.toISOString(),
    })),
  });
});

export default app;
```

- [ ] **Step 5.6: Create `apps/api/src/routes/categories.ts`**

```ts
import { Hono } from "hono";
import { listCategories } from "../repositories/categories.ts";

const app = new Hono();

app.get("/", async (c) => {
  const rows = await listCategories();
  return c.json(rows);
});

export default app;
```

- [ ] **Step 5.7: Create `apps/api/src/routes/tags.ts`**

```ts
import { Hono } from "hono";
import { listTags } from "../repositories/tags.ts";

const app = new Hono();

app.get("/", async (c) => {
  const rows = await listTags();
  return c.json(rows);
});

export default app;
```

- [ ] **Step 5.8: Create `apps/api/src/routes/public.ts`**

```ts
import { Hono } from "hono";
import { listR2PoolPublic } from "../repositories/r2-accounts.ts";

const app = new Hono();

app.get("/r2-pool", async (c) => {
  const rows = await listR2PoolPublic();
  return c.json(rows);
});

export default app;
```

- [ ] **Step 5.9: Mount the new routes in `apps/api/src/server.ts`**

Replace the file with:

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { env } from "./env.ts";
import { errorHandler } from "./middleware/error.ts";
import healthRoute from "./routes/health.ts";
import promptsRoute from "./routes/prompts.ts";
import categoriesRoute from "./routes/categories.ts";
import tagsRoute from "./routes/tags.ts";
import publicRoute from "./routes/public.ts";

export function createServer() {
  const app = new Hono();

  app.use("*", logger());
  app.use("*", secureHeaders());
  app.use(
    "*",
    cors({
      origin: [env.SITE_URL],
      credentials: true,
      allowHeaders: ["Content-Type", "Authorization", "X-Locale"],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  app.route("/api/health", healthRoute);
  app.route("/api/prompts", promptsRoute);
  app.route("/api/categories", categoriesRoute);
  app.route("/api/tags", tagsRoute);
  app.route("/api/public", publicRoute);

  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError(errorHandler);

  return app;
}
```

- [ ] **Step 5.10: Create `apps/api/src/repositories/prompts.test.ts`**

```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { pool } from "../db/client.ts";
import { listPrompts, getPromptBySlug } from "./prompts.ts";

describe("prompts repository (integration, requires seeded DB)", () => {
  afterAll(async () => {
    await pool.end();
  });

  it("listPrompts returns seeded prompts on default query", async () => {
    const res = await listPrompts({ sort: "latest", page: 1, pageSize: 24 });
    expect(res.total).toBeGreaterThan(0);
    expect(res.items.length).toBeGreaterThan(0);
    expect(res.items[0]?.title).toBeDefined();
  });

  it("filters by category", async () => {
    const res = await listPrompts({ sort: "latest", page: 1, pageSize: 24, category: "landscape" });
    expect(res.items.every((i) => i.category.slug === "landscape")).toBe(true);
  });

  it("filters by tag", async () => {
    const res = await listPrompts({ sort: "latest", page: 1, pageSize: 24, tag: "cyberpunk" });
    expect(res.items.every((i) => i.tags.some((t) => t.slug === "cyberpunk"))).toBe(true);
  });

  it("returns empty for unknown category", async () => {
    const res = await listPrompts({ sort: "latest", page: 1, pageSize: 24, category: "does-not-exist" });
    expect(res.total).toBe(0);
    expect(res.items).toEqual([]);
  });

  it("getPromptBySlug returns full detail", async () => {
    const detail = await getPromptBySlug("cyberpunk-neon-cat");
    expect(detail).not.toBeNull();
    expect(detail?.title.zh).toBe("赛博朋克霓虹猫");
    expect(detail?.title.en).toBe("Cyberpunk Neon Cat");
    expect(detail?.images.length).toBeGreaterThan(0);
    expect(detail?.tags.length).toBeGreaterThan(0);
  });

  it("getPromptBySlug returns null for missing", async () => {
    const detail = await getPromptBySlug("does-not-exist");
    expect(detail).toBeNull();
  });
});
```

- [ ] **Step 5.11: Run repository tests**

```bash
pnpm --filter @ip/api test
```

Expected: all tests pass (health smoke + 6 prompts repo tests).

- [ ] **Step 5.12: Manually verify endpoints**

Start the dev server:
```bash
pnpm --filter @ip/api dev
```

In another terminal:
```bash
curl -s "http://127.0.0.1:3000/api/prompts?sort=latest&pageSize=2" | head -c 600
curl -s "http://127.0.0.1:3000/api/prompts/cyberpunk-neon-cat" | head -c 600
curl -s "http://127.0.0.1:3000/api/categories" | head -c 400
curl -s "http://127.0.0.1:3000/api/tags" | head -c 400
curl -s "http://127.0.0.1:3000/api/public/r2-pool" | head -c 200
```

Expected: each returns valid JSON with the seeded data.

Stop the dev server.

- [ ] **Step 5.13: Commit**

```bash
git add apps/api/src/repositories apps/api/src/routes apps/api/src/server.ts
git commit -m "feat(api): public read endpoints — prompts/categories/tags/r2-pool

- listPrompts supports category/tag/aspect/sort/search/pagination
- getPromptBySlug returns detail + ordered images + tags
- listRelatedPrompts same-category for now (tag-aware in M5)
- listR2PoolPublic returns id+publicUrl only (no secrets)
- Integration tests cover happy path + empty filter + missing slug"
```

---

## Task 6: apps/web — Vite + React + Tailwind + Design Tokens

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/tsconfig.node.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/styles/tokens.css`
- Create: `apps/web/src/styles/index.css`
- Create: `apps/web/src/styles/fonts.css`
- Create: `apps/web/public/fonts/.gitkeep`
- Create: `apps/web/public/favicon.svg`
- Create: `apps/web/.env.example`
- Create: `apps/web/.env.development`

- [ ] **Step 6.1: Create `apps/web/package.json`**

```json
{
  "name": "@ip/web",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ip/shared": "workspace:*",
    "@tanstack/react-query": "^5.62.0",
    "i18next": "^24.0.0",
    "i18next-browser-languagedetector": "^8.0.0",
    "lucide-react": "^0.469.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-i18next": "^15.4.0",
    "react-router": "^7.1.0",
    "zustand": "^4.5.0"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "vitest": "^3.0.0",
    "@testing-library/react": "^16.1.0",
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/user-event": "^14.5.0",
    "jsdom": "^25.0.0"
  }
}
```

- [ ] **Step 6.2: Create `apps/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "rootDir": "src",
    "outDir": "dist",
    "noEmit": true,
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src", "vite.config.ts"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

- [ ] **Step 6.3: Create `apps/web/tsconfig.node.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["node"]
  },
  "include": ["vite.config.ts"]
}
```

- [ ] **Step 6.4: Create `apps/web/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
```

- [ ] **Step 6.5: Create `apps/web/index.html`**

```html
<!DOCTYPE html>
<html lang="zh-Hans" class="">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#131315" />
    <link rel="preload" href="/fonts/inter-variable.woff2" as="font" type="font/woff2" crossorigin />
    <title>Image-Prompts</title>
    <script>
      // Apply theme before React mounts to avoid white flash.
      (function () {
        try {
          var stored = localStorage.getItem("ip.theme");
          var sysDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
          var dark = stored === "dark" || (stored !== "light" && sysDark);
          if (dark) document.documentElement.classList.add("dark");
        } catch (_e) {}
      })();
    </script>
  </head>
  <body class="bg-bg text-text antialiased">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6.6: Create `apps/web/public/favicon.svg`**

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7" fill="#0a84ff"/>
  <text x="16" y="22" font-family="system-ui,-apple-system,sans-serif" font-size="18" font-weight="700" text-anchor="middle" fill="#fff">IP</text>
</svg>
```

- [ ] **Step 6.7: Create `apps/web/src/styles/tokens.css`** — lifted from spec §11

```css
/*
 * Image-Prompts design tokens.
 * Lifted verbatim from spec §11. Apple HIG style.
 *
 * Light mode: var(--accent) = #007aff
 * Dark mode applied when html has class "dark": var(--accent) = #0a84ff
 */
:root {
  /* brand (single color) */
  --accent: #007aff;
  --accent-2: #409cff;
  --accent-soft: rgb(0 122 255 / 0.1);

  /* backgrounds */
  --bg: #f5f5f7;
  --bg-2: #ececf1;
  --panel: #ffffff;
  --panel-2: #fbfbfd;
  --surface: #f2f2f7;
  --surface-2: #e5e5ea;

  /* text */
  --text: #111111;
  --text-muted: rgb(60 60 67 / 0.72);
  --text-dim: rgb(60 60 67 / 0.48);

  /* borders */
  --border: rgb(60 60 67 / 0.16);
  --border-soft: rgb(60 60 67 / 0.08);

  /* state (used sparingly) */
  --danger: #ff3b30;
  --success: #34c759;

  /* radii */
  --radius-pill: 999px;
  --radius-card: 18px;
  --radius-control: 12px;

  /* shadow */
  --shadow-card: 0 10px 30px rgb(15 23 42 / 0.06);
  --shadow-card-hover: 0 18px 48px rgb(15 23 42 / 0.09);
}

:root.dark {
  --accent: #0a84ff;
  --accent-2: #5eb0ff;
  --accent-soft: rgb(10 132 255 / 0.18);

  --bg: #131315;
  --bg-2: #1c1c1e;
  --panel: #232326;
  --panel-2: #1c1c1f;
  --surface: #2c2c2f;
  --surface-2: #3a3a3d;

  --text: #f5f5f7;
  --text-muted: rgb(235 235 245 / 0.78);
  --text-dim: rgb(235 235 245 / 0.54);

  --border: rgb(84 84 88 / 0.52);
  --border-soft: rgb(84 84 88 / 0.28);

  --danger: #ff453a;
  --success: #30d158;

  --shadow-card: 0 18px 46px rgb(0 0 0 / 0.38);
  --shadow-card-hover: 0 24px 60px rgb(0 0 0 / 0.46);
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 6.8: Create `apps/web/src/styles/fonts.css`**

```css
/*
 * Self-hosted Inter (variable) + Noto Sans SC subset.
 * Files live in /public/fonts/.
 *
 * Inter Variable: https://github.com/rsms/inter/releases (woff2, ~30 KB).
 * Noto Sans SC subset: use a tool like fontmin or harfbuzz subset for ~3500 common chars.
 *
 * If files are missing on first dev run, browsers fall back to system fonts
 * (the next family in the stack) — no crash, just a slight visual mismatch.
 */
@font-face {
  font-family: "Inter";
  src: url("/fonts/inter-variable.woff2") format("woff2-variations");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: "Noto Sans SC";
  src: url("/fonts/noto-sans-sc-400.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: "Noto Sans SC";
  src: url("/fonts/noto-sans-sc-500.woff2") format("woff2");
  font-weight: 500;
  font-style: normal;
  font-display: swap;
}

@font-face {
  font-family: "Noto Sans SC";
  src: url("/fonts/noto-sans-sc-700.woff2") format("woff2");
  font-weight: 700;
  font-style: normal;
  font-display: swap;
}
```

- [ ] **Step 6.9: Create `apps/web/src/styles/index.css`**

```css
@import "./tokens.css";
@import "./fonts.css";
@import "tailwindcss";

@theme {
  /* Tailwind 4 theme block: expose CSS vars as named utilities */
  --color-accent: var(--accent);
  --color-accent-2: var(--accent-2);
  --color-accent-soft: var(--accent-soft);
  --color-bg: var(--bg);
  --color-bg-2: var(--bg-2);
  --color-panel: var(--panel);
  --color-panel-2: var(--panel-2);
  --color-surface: var(--surface);
  --color-surface-2: var(--surface-2);
  --color-text: var(--text);
  --color-text-muted: var(--text-muted);
  --color-text-dim: var(--text-dim);
  --color-border: var(--border);
  --color-border-soft: var(--border-soft);
  --color-danger: var(--danger);
  --color-success: var(--success);

  --radius-pill: var(--radius-pill);
  --radius-card: var(--radius-card);
  --radius-control: var(--radius-control);

  --font-sans:
    "Inter", "Noto Sans SC", -apple-system, BlinkMacSystemFont, "SF Pro Display", "PingFang SC",
    "Hiragino Sans GB", "Microsoft YaHei UI", sans-serif;
}

/* Custom dark variant — apply when html has class "dark" */
@custom-variant dark (&:where(.dark, .dark *));

html,
body,
#root {
  margin: 0;
  padding: 0;
  height: 100%;
  font-family: var(--font-sans);
  font-feature-settings: "ss01", "cv01", "cv11";
  letter-spacing: -0.011em;
  background: var(--bg);
  color: var(--text);
}

body {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

::selection {
  background: var(--accent-soft);
  color: var(--text);
}

/* Scrollbar — slim, Apple-ish */
*::-webkit-scrollbar {
  width: 10px;
  height: 10px;
}
*::-webkit-scrollbar-thumb {
  background: rgb(155 155 160 / 0.5);
  border-radius: 8px;
  border: 2px solid transparent;
  background-clip: padding-box;
}
*::-webkit-scrollbar-thumb:hover {
  background: rgb(155 155 160 / 0.75);
  background-clip: padding-box;
}
html.dark *::-webkit-scrollbar-thumb {
  background: rgb(155 155 160 / 0.32);
  background-clip: padding-box;
}
html.dark *::-webkit-scrollbar-thumb:hover {
  background: rgb(155 155 160 / 0.5);
  background-clip: padding-box;
}
```

- [ ] **Step 6.10: Create `apps/web/.env.example`**

```bash
VITE_API_URL=http://localhost:3000
VITE_SITE_URL=http://localhost:5173
```

- [ ] **Step 6.11: Create `apps/web/.env.development`** (same as example for local dev)

```bash
VITE_API_URL=http://localhost:3000
VITE_SITE_URL=http://localhost:5173
```

- [ ] **Step 6.12: Create `apps/web/public/fonts/.gitkeep`**

Empty file. Real fonts are committed by the engineer separately (see next step).

- [ ] **Step 6.13: Download fonts**

```bash
# Inter Variable (single woff2 covers 100-900)
curl -L -o apps/web/public/fonts/inter-variable.woff2 \
  https://rsms.me/inter/font-files/InterVariable.woff2
```

For Noto Sans SC subset: generate with the `subset-font` npm tool or `fonttools` (Python). M1 acceptable shortcut — use **system fallback only for Chinese** during dev (browsers will hit `PingFang SC` / `Microsoft YaHei UI` next in the stack). Production-quality subset is M8.

For now, create empty placeholder files so the @font-face requests 404 fast and fall through to system fonts cleanly:
```bash
touch apps/web/public/fonts/noto-sans-sc-400.woff2
touch apps/web/public/fonts/noto-sans-sc-500.woff2
touch apps/web/public/fonts/noto-sans-sc-700.woff2
```

- [ ] **Step 6.14: Create `apps/web/src/main.tsx`**

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./styles/index.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 6.15: Create `apps/web/src/App.tsx`** (placeholder content — proves tokens render)

```tsx
export default function App() {
  return (
    <div className="min-h-dvh bg-bg text-text">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <h1 className="text-3xl font-semibold tracking-tight">Image-Prompts</h1>
        <p className="mt-2 text-text-muted">
          Skeleton boots. Tokens working. Routing/i18n/UI will land in Tasks 7–14.
        </p>
        <div className="mt-6 flex gap-3">
          <button
            type="button"
            className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-2 transition-colors"
            onClick={() => document.documentElement.classList.toggle("dark")}
          >
            Toggle dark
          </button>
          <a
            href="/api/prompts"
            className="rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-text-muted hover:text-text transition-colors"
          >
            Test /api/prompts
          </a>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6.16: Create `apps/web/src/test/setup.ts`** (empty for now; vitest config references it)

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 6.17: Install web deps**

```bash
pnpm install
```

- [ ] **Step 6.18: Typecheck web**

```bash
pnpm --filter @ip/web typecheck
```

Expected: Exits 0.

- [ ] **Step 6.19: Boot web dev server**

```bash
pnpm --filter @ip/web dev
```

Expected output:
```
VITE v6.x ready in ... ms
➜  Local:   http://localhost:5173/
```

Open the URL in a browser. Verify:
- Page shows "Image-Prompts" heading
- "Toggle dark" button switches between light and dark themes
- Theme uses Apple-style colors (white bg in light, near-black in dark)
- Clicking "Test /api/prompts" link returns JSON from `:3000` (proxy works) — but only if api dev server is running too

Stop the dev server.

- [ ] **Step 6.20: Commit**

```bash
git add apps/web pnpm-lock.yaml
git commit -m "feat(web): vite + react + tailwind 4 skeleton with design tokens

- Tokens lifted from spec §11 — Apple HIG single-blue, 999px pill, system font stack with Inter+Noto Sans SC self-host
- index.html pre-mount script applies dark class to avoid white flash
- @custom-variant dark wired so Tailwind utilities work without :where
- Vite proxies /api to api server on 3000
- Placeholder App proves tokens + dark toggle
- Inter Variable downloaded; Noto Sans SC stubbed for M1 (real subset in M8)"
```

---

## Task 7: Routing + i18n

**Files:**
- Create: `apps/web/src/i18n/index.ts`
- Create: `apps/web/src/i18n/locales/zh.json`
- Create: `apps/web/src/i18n/locales/en.json`
- Create: `apps/web/src/lib/locale.ts`
- Create: `apps/web/src/routes/index.tsx`
- Create: `apps/web/src/routes/locale-redirect.tsx`
- Create: `apps/web/src/routes/locale-layout.tsx`
- Create: `apps/web/src/components/LangSwitcher.tsx`
- Test: `apps/web/src/lib/locale.test.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/main.tsx`

- [ ] **Step 7.1: Create `apps/web/src/i18n/locales/zh.json`**

```json
{
  "nav": {
    "browse": "浏览",
    "categories": "分类",
    "submit": "投稿",
    "about": "关于"
  },
  "common": {
    "search_placeholder": "搜索提示词",
    "loading": "加载中…",
    "empty": "暂无内容",
    "retry": "重试",
    "not_found_title": "找不到此提示词",
    "not_found_body": "可能已删除或未通过审核。",
    "back_home": "返回首页",
    "no_en_version": "暂无英文版,显示中文",
    "no_zh_version": "暂无中文版,显示英文",
    "language": "语言",
    "theme": "主题",
    "all": "全部"
  },
  "home": {
    "hero_title": "生图提示词聚合",
    "hero_subtitle": "{count}+ 条精选提示词 · 一键送到 Image-Studio",
    "start_browsing": "开始浏览 →"
  },
  "list": {
    "sort_latest": "最新",
    "sort_popular": "最热",
    "sort_liked": "最赞",
    "sort_sent": "最多送",
    "total": "共 {count} 条"
  },
  "detail": {
    "send_to_studio": "Send to Image-Studio",
    "copy_prompt": "复制",
    "favorite": "收藏",
    "more": "更多",
    "prompt": "Prompt",
    "negative_prompt": "负向提示词",
    "suggested_params": "作者建议参数",
    "aspect_ratio": "比例",
    "related": "相关提示词",
    "category": "分类",
    "tags": "标签",
    "no_suggestions": "未指定建议参数, 沿用 Image-Studio 默认值"
  },
  "about": {
    "title": "关于 Image-Prompts",
    "body": "Image-Prompts 是 Image-Studio 配套的生图提示词聚合站。任何人都能浏览、收藏、点赞、分享;已登录用户可以投稿,管理员审核后公开。",
    "credits_title": "数据来源致谢",
    "credits_body": "本站初始内容(2380 条提示词种子数据)迁移自 unknowlei 的开源项目 nanobanana-website (github.com/unknowlei/nanobanana-website),经 AI 辅助翻译为中英双语后由本站维护与扩展。原内容版权归 nanobanana 社区贡献者所有,本站按 CC-BY-4.0 精神标注来源。"
  },
  "theme_modes": {
    "light": "浅色",
    "dark": "深色",
    "system": "跟随系统"
  }
}
```

- [ ] **Step 7.2: Create `apps/web/src/i18n/locales/en.json`**

```json
{
  "nav": {
    "browse": "Browse",
    "categories": "Categories",
    "submit": "Submit",
    "about": "About"
  },
  "common": {
    "search_placeholder": "Search prompts",
    "loading": "Loading…",
    "empty": "Nothing here yet",
    "retry": "Retry",
    "not_found_title": "Prompt not found",
    "not_found_body": "It may have been removed or is still pending review.",
    "back_home": "Back to home",
    "no_en_version": "No English version; showing Chinese",
    "no_zh_version": "No Chinese version; showing English",
    "language": "Language",
    "theme": "Theme",
    "all": "All"
  },
  "home": {
    "hero_title": "Prompts for Image-Studio",
    "hero_subtitle": "{count}+ curated prompts · one click to Image-Studio",
    "start_browsing": "Start browsing →"
  },
  "list": {
    "sort_latest": "Latest",
    "sort_popular": "Popular",
    "sort_liked": "Liked",
    "sort_sent": "Most Sent",
    "total": "{count} prompts"
  },
  "detail": {
    "send_to_studio": "Send to Image-Studio",
    "copy_prompt": "Copy",
    "favorite": "Favorite",
    "more": "More",
    "prompt": "Prompt",
    "negative_prompt": "Negative Prompt",
    "suggested_params": "Suggested Parameters",
    "aspect_ratio": "Aspect Ratio",
    "related": "Related Prompts",
    "category": "Category",
    "tags": "Tags",
    "no_suggestions": "No suggestions; uses Image-Studio defaults"
  },
  "about": {
    "title": "About Image-Prompts",
    "body": "Image-Prompts is a prompt aggregator paired with Image-Studio. Anyone can browse, favorite, like, and share; logged-in users can submit; moderators review.",
    "credits_title": "Credits",
    "credits_body": "Initial seed content (2,380 prompts) was migrated from unknowlei's open-source nanobanana-website (github.com/unknowlei/nanobanana-website), translated into bilingual (zh/en) via AI assistance, and curated by this site. Original content belongs to nanobanana community contributors; attribution follows the spirit of CC-BY-4.0."
  },
  "theme_modes": {
    "light": "Light",
    "dark": "Dark",
    "system": "System"
  }
}
```

- [ ] **Step 7.3: Create `apps/web/src/lib/locale.ts`**

```ts
import { DEFAULT_LOCALE, LOCALES, type Locale, isLocale } from "@ip/shared";

export const LOCALE_STORAGE_KEY = "ip.locale";

/**
 * Resolve the user's preferred locale.
 * Priority: explicit URL path > localStorage > browser nav.languages > default.
 */
export function detectLocale(pathname: string): Locale {
  const fromPath = pathname.split("/").filter(Boolean)[0];
  if (isLocale(fromPath)) return fromPath;

  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // localStorage may be unavailable (SSR, embedded WebView restrictions). Fall through.
  }

  const nav = (typeof navigator !== "undefined" ? navigator.languages : []) ?? [];
  for (const lang of nav) {
    const base = lang.toLowerCase().split("-")[0];
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

/**
 * Strip the leading locale segment from a path.
 * "/zh/prompts/foo" → "/prompts/foo"
 * "/en"             → "/"
 * "/about"          → "/about" (no locale prefix)
 */
export function stripLocale(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length > 0 && isLocale(segments[0])) {
    const rest = segments.slice(1).join("/");
    return "/" + rest;
  }
  return pathname.startsWith("/") ? pathname : "/" + pathname;
}

/**
 * Build a path with the given locale prefix.
 */
export function withLocale(locale: Locale, relativePath: string): string {
  const clean = relativePath.startsWith("/") ? relativePath : "/" + relativePath;
  // Avoid trailing slash for root
  const path = clean === "/" ? "" : clean;
  return `/${locale}${path}`;
}

export { LOCALES, DEFAULT_LOCALE };
export type { Locale };
```

- [ ] **Step 7.4: Create `apps/web/src/lib/locale.test.ts`**

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { detectLocale, stripLocale, withLocale, LOCALE_STORAGE_KEY } from "./locale.ts";

describe("detectLocale", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("prefers locale from URL path", () => {
    expect(detectLocale("/zh/prompts")).toBe("zh");
    expect(detectLocale("/en/about")).toBe("en");
  });

  it("falls back to localStorage", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "en");
    expect(detectLocale("/")).toBe("en");
  });

  it("ignores invalid path segment", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "zh");
    expect(detectLocale("/garbage/path")).toBe("zh");
  });

  it("falls back to default when nothing matches", () => {
    expect(detectLocale("/")).toBe("zh");
  });
});

describe("stripLocale", () => {
  it("removes leading locale segment", () => {
    expect(stripLocale("/zh/prompts/foo")).toBe("/prompts/foo");
    expect(stripLocale("/en")).toBe("/");
  });

  it("leaves path unchanged when no locale prefix", () => {
    expect(stripLocale("/about")).toBe("/about");
    expect(stripLocale("/")).toBe("/");
  });
});

describe("withLocale", () => {
  it("prepends locale", () => {
    expect(withLocale("zh", "/prompts")).toBe("/zh/prompts");
    expect(withLocale("en", "about")).toBe("/en/about");
  });

  it("handles root path", () => {
    expect(withLocale("zh", "/")).toBe("/zh");
  });
});
```

- [ ] **Step 7.5: Create `apps/web/src/i18n/index.ts`**

```ts
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zh from "./locales/zh.json";
import en from "./locales/en.json";
import { DEFAULT_LOCALE, type Locale } from "../lib/locale.ts";

export async function initI18n(locale: Locale = DEFAULT_LOCALE) {
  await i18n.use(initReactI18next).init({
    resources: {
      zh: { translation: zh },
      en: { translation: en },
    },
    lng: locale,
    fallbackLng: DEFAULT_LOCALE,
    interpolation: { escapeValue: false },
    returnNull: false,
    react: { useSuspense: false },
  });
  return i18n;
}

export async function changeLanguage(locale: Locale) {
  await i18n.changeLanguage(locale);
}

export default i18n;
```

- [ ] **Step 7.6: Create `apps/web/src/routes/locale-redirect.tsx`**

```tsx
import { Navigate, useLocation } from "react-router";
import { detectLocale, withLocale } from "../lib/locale.ts";

/**
 * Mounted at "/" and any path without a locale prefix.
 * Detects preferred locale and redirects.
 */
export default function LocaleRedirect() {
  const location = useLocation();
  const target = detectLocale(location.pathname);
  const dest = withLocale(target, location.pathname === "/" ? "/" : location.pathname);
  return <Navigate to={dest} replace />;
}
```

- [ ] **Step 7.7: Create `apps/web/src/routes/locale-layout.tsx`**

```tsx
import { useEffect } from "react";
import { Outlet, useParams } from "react-router";
import { isLocale, type Locale } from "@ip/shared";
import { LOCALE_STORAGE_KEY } from "../lib/locale.ts";
import { changeLanguage } from "../i18n/index.ts";

/**
 * Parent route for all /:locale/... routes.
 * Validates the locale segment and keeps i18next + <html lang> in sync.
 */
export default function LocaleLayout() {
  const { locale } = useParams<{ locale: string }>();
  const safeLocale: Locale = isLocale(locale) ? locale : "zh";

  useEffect(() => {
    void changeLanguage(safeLocale);
    document.documentElement.lang = safeLocale === "zh" ? "zh-Hans" : "en";
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, safeLocale);
    } catch {
      // ignore
    }
  }, [safeLocale]);

  if (!isLocale(locale)) {
    // Unknown locale prefix → bounce to default
    return null; // a future <Navigate> would loop with LocaleRedirect; this branch normally never renders
  }

  return <Outlet />;
}
```

- [ ] **Step 7.8: Create `apps/web/src/components/LangSwitcher.tsx`**

```tsx
import { useNavigate, useLocation, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { isLocale, LOCALES, type Locale } from "@ip/shared";
import { stripLocale, withLocale } from "../lib/locale.ts";

export default function LangSwitcher() {
  const { t } = useTranslation();
  const { locale: paramLocale } = useParams<{ locale: string }>();
  const current: Locale = isLocale(paramLocale) ? paramLocale : "zh";
  const navigate = useNavigate();
  const location = useLocation();

  function switchTo(target: Locale) {
    if (target === current) return;
    const rest = stripLocale(location.pathname);
    navigate(withLocale(target, rest) + location.search + location.hash, { replace: false });
  }

  return (
    <div
      role="group"
      aria-label={t("common.language")}
      className="inline-flex rounded-pill border border-border-soft bg-surface p-0.5 text-xs"
    >
      {LOCALES.map((loc) => (
        <button
          key={loc}
          type="button"
          aria-pressed={loc === current}
          onClick={() => switchTo(loc)}
          className={[
            "rounded-pill px-3 py-1 transition-colors",
            loc === current ? "bg-accent text-white" : "text-text-muted hover:text-text",
          ].join(" ")}
        >
          {loc === "zh" ? "中" : "EN"}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 7.9: Create `apps/web/src/routes/index.tsx`** (router)

```tsx
import { createBrowserRouter, RouterProvider } from "react-router";
import LocaleRedirect from "./locale-redirect.tsx";
import LocaleLayout from "./locale-layout.tsx";

// Placeholder pages. Real pages land in Tasks 11–14.
function HomePlaceholder() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">Home (locale-scoped)</h1>
      <p className="mt-2 text-text-muted">Replaced by the real Home in Task 11.</p>
    </div>
  );
}

export const router = createBrowserRouter([
  { path: "/", element: <LocaleRedirect /> },
  {
    path: "/:locale",
    element: <LocaleLayout />,
    children: [
      { index: true, element: <HomePlaceholder /> },
      { path: "prompts", element: <HomePlaceholder /> },
      { path: "prompts/:slug", element: <HomePlaceholder /> },
      { path: "categories/:slug", element: <HomePlaceholder /> },
      { path: "about", element: <HomePlaceholder /> },
    ],
  },
  { path: "*", element: <LocaleRedirect /> },
]);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
```

- [ ] **Step 7.10: Update `apps/web/src/App.tsx`**

```tsx
import AppRouter from "./routes/index.tsx";
import LangSwitcher from "./components/LangSwitcher.tsx";
import { useTranslation } from "react-i18next";

function Header() {
  const { t } = useTranslation();
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border-soft bg-panel-2/85 px-5 py-3 backdrop-blur">
      <div className="text-base font-semibold tracking-tight">Image-Prompts</div>
      <nav className="hidden gap-1 text-sm md:flex">
        <a className="rounded-pill px-3 py-1.5 text-text-muted hover:text-text" href="/zh">
          {t("nav.browse")}
        </a>
        <a className="rounded-pill px-3 py-1.5 text-text-muted hover:text-text" href="/zh/about">
          {t("nav.about")}
        </a>
      </nav>
      <div className="flex items-center gap-2">
        <LangSwitcher />
      </div>
    </header>
  );
}

export default function App() {
  return (
    <div className="min-h-dvh bg-bg text-text">
      <Header />
      <AppRouter />
    </div>
  );
}
```

- [ ] **Step 7.11: Update `apps/web/src/main.tsx`** (call initI18n)

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { initI18n } from "./i18n/index.ts";
import { detectLocale } from "./lib/locale.ts";
import "./styles/index.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root");

await initI18n(detectLocale(window.location.pathname));

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 7.12: Run web tests**

```bash
pnpm --filter @ip/web test
```

Expected: 3 describes pass (`detectLocale`, `stripLocale`, `withLocale`).

- [ ] **Step 7.13: Typecheck**

```bash
pnpm --filter @ip/web typecheck
```

Expected: Exits 0.

- [ ] **Step 7.14: Manually verify routing**

```bash
pnpm --filter @ip/web dev
```

Visit:
- `http://localhost:5173/` → should redirect to `/zh` (or `/en` if browser language is English).
- `http://localhost:5173/zh` → "Home (locale-scoped)" + Chinese nav.
- `http://localhost:5173/en` → "Home (locale-scoped)" + English nav.
- Click the lang switcher: URL prefix changes; UI text changes; `<html lang>` flips.

Stop the dev server.

- [ ] **Step 7.15: Commit**

```bash
git add apps/web/src/i18n apps/web/src/lib apps/web/src/routes apps/web/src/components/LangSwitcher.tsx apps/web/src/App.tsx apps/web/src/main.tsx
git commit -m "feat(web): routing + i18n with /:locale prefix

- react-router 7 with locale-scoped subtree
- LocaleRedirect picks locale from URL > localStorage > navigator.languages
- LocaleLayout keeps i18next + <html lang> + localStorage in sync
- zh.json + en.json cover nav / common / home / list / detail / about
- LangSwitcher switches locale without losing path/search/hash
- detectLocale/stripLocale/withLocale fully unit-tested"
```

---

## Task 8: Theme System + Zustand UI Store

**Files:**
- Create: `apps/web/src/state/uiStore.ts`
- Create: `apps/web/src/lib/theme.ts`
- Create: `apps/web/src/components/ThemeSwitcher.tsx`
- Test: `apps/web/src/state/uiStore.test.ts`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/main.tsx`

- [ ] **Step 8.1: Create `apps/web/src/lib/theme.ts`**

```ts
import type { ThemeMode } from "@ip/shared";

export const THEME_STORAGE_KEY = "ip.theme";

export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/**
 * Compute whether the dark class should be applied for the given preference.
 */
export function resolveDark(mode: ThemeMode): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return systemPrefersDark();
}

export function applyTheme(mode: ThemeMode) {
  const dark = resolveDark(mode);
  const cls = document.documentElement.classList;
  if (dark) cls.add("dark");
  else cls.remove("dark");
}

export function persistTheme(mode: ThemeMode) {
  try {
    if (mode === "system") {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    }
  } catch {
    // ignore
  }
}

export function readPersistedTheme(): ThemeMode {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    if (value === "light" || value === "dark") return value;
  } catch {
    // ignore
  }
  return "system";
}
```

- [ ] **Step 8.2: Create `apps/web/src/state/uiStore.ts`**

```ts
import { create } from "zustand";
import type { ThemeMode } from "@ip/shared";
import { applyTheme, persistTheme, readPersistedTheme, systemPrefersDark } from "../lib/theme.ts";

type UiState = {
  theme: ThemeMode;
  /** Toolbar / sidebar state for mobile drawers — used in later tasks. */
  sidebarOpen: boolean;
  setTheme: (mode: ThemeMode) => void;
  toggleSidebar: () => void;
  /** Watch matchMedia and re-apply on system changes when mode is "system". */
  bindSystemThemeWatcher: () => () => void;
};

export const useUiStore = create<UiState>((set, get) => ({
  theme: readPersistedTheme(),
  sidebarOpen: false,

  setTheme: (mode) => {
    applyTheme(mode);
    persistTheme(mode);
    set({ theme: mode });
  },

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

  bindSystemThemeWatcher: () => {
    if (typeof window === "undefined" || !window.matchMedia) return () => {};
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (get().theme === "system") applyTheme("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  },
}));

// Expose for debugging
export { systemPrefersDark };
```

- [ ] **Step 8.3: Create `apps/web/src/state/uiStore.test.ts`**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useUiStore } from "./uiStore.ts";

describe("uiStore", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    // matchMedia stub: light by default
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("starts as system theme when no localStorage", () => {
    useUiStore.setState({ theme: "system" });
    expect(useUiStore.getState().theme).toBe("system");
  });

  it("setTheme('dark') adds .dark class and persists", () => {
    useUiStore.getState().setTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("ip.theme")).toBe("dark");
    expect(useUiStore.getState().theme).toBe("dark");
  });

  it("setTheme('light') removes .dark class and persists", () => {
    document.documentElement.classList.add("dark");
    useUiStore.getState().setTheme("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("ip.theme")).toBe("light");
  });

  it("setTheme('system') clears localStorage and follows system", () => {
    localStorage.setItem("ip.theme", "dark");
    useUiStore.getState().setTheme("system");
    expect(localStorage.getItem("ip.theme")).toBeNull();
    // system stub returns matches=false, so no .dark
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("toggleSidebar flips state", () => {
    useUiStore.setState({ sidebarOpen: false });
    useUiStore.getState().toggleSidebar();
    expect(useUiStore.getState().sidebarOpen).toBe(true);
    useUiStore.getState().toggleSidebar();
    expect(useUiStore.getState().sidebarOpen).toBe(false);
  });
});
```

- [ ] **Step 8.4: Create `apps/web/src/components/ThemeSwitcher.tsx`**

```tsx
import { useTranslation } from "react-i18next";
import { Sun, Moon, Monitor } from "lucide-react";
import type { ThemeMode } from "@ip/shared";
import { useUiStore } from "../state/uiStore.ts";

const ICONS: Record<ThemeMode, typeof Sun> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

export default function ThemeSwitcher() {
  const { t } = useTranslation();
  const theme = useUiStore((s) => s.theme);
  const setTheme = useUiStore((s) => s.setTheme);

  const modes: ThemeMode[] = ["light", "dark", "system"];

  return (
    <div
      role="group"
      aria-label={t("common.theme")}
      className="inline-flex rounded-pill border border-border-soft bg-surface p-0.5"
    >
      {modes.map((mode) => {
        const Icon = ICONS[mode];
        const isActive = theme === mode;
        return (
          <button
            key={mode}
            type="button"
            aria-pressed={isActive}
            aria-label={t(`theme_modes.${mode}`)}
            title={t(`theme_modes.${mode}`)}
            onClick={() => setTheme(mode)}
            className={[
              "rounded-pill p-1.5 transition-colors",
              isActive ? "bg-accent text-white" : "text-text-muted hover:text-text",
            ].join(" ")}
          >
            <Icon size={14} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 8.5: Wire bindSystemThemeWatcher in `apps/web/src/main.tsx`**

Update `apps/web/src/main.tsx` to bind the watcher:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import { initI18n } from "./i18n/index.ts";
import { detectLocale } from "./lib/locale.ts";
import { applyTheme, readPersistedTheme } from "./lib/theme.ts";
import { useUiStore } from "./state/uiStore.ts";
import "./styles/index.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("missing #root");

// Apply persisted theme synchronously before any React render to avoid flash.
applyTheme(readPersistedTheme());

// Bind system theme watcher; ignore the unsubscribe (lives for app lifetime).
useUiStore.getState().bindSystemThemeWatcher();

await initI18n(detectLocale(window.location.pathname));

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 8.6: Add ThemeSwitcher to `apps/web/src/App.tsx` header**

```tsx
import AppRouter from "./routes/index.tsx";
import LangSwitcher from "./components/LangSwitcher.tsx";
import ThemeSwitcher from "./components/ThemeSwitcher.tsx";
import { useTranslation } from "react-i18next";

function Header() {
  const { t } = useTranslation();
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border-soft bg-panel-2/85 px-5 py-3 backdrop-blur">
      <div className="text-base font-semibold tracking-tight">Image-Prompts</div>
      <nav className="hidden gap-1 text-sm md:flex">
        <a className="rounded-pill px-3 py-1.5 text-text-muted hover:text-text" href="/zh">
          {t("nav.browse")}
        </a>
        <a className="rounded-pill px-3 py-1.5 text-text-muted hover:text-text" href="/zh/about">
          {t("nav.about")}
        </a>
      </nav>
      <div className="flex items-center gap-2">
        <ThemeSwitcher />
        <LangSwitcher />
      </div>
    </header>
  );
}

export default function App() {
  return (
    <div className="min-h-dvh bg-bg text-text">
      <Header />
      <AppRouter />
    </div>
  );
}
```

- [ ] **Step 8.7: Run web tests**

```bash
pnpm --filter @ip/web test
```

Expected: locale tests (3) + new uiStore tests (5) all pass.

- [ ] **Step 8.8: Manually verify theme switcher**

```bash
pnpm --filter @ip/web dev
```

In browser at `http://localhost:5173/zh`:
- Click Sun icon → light mode (no .dark class)
- Click Moon icon → dark mode (.dark class)
- Click Monitor icon → follows system (toggle OS dark mode while page is open; web app should follow without refresh)
- Refresh: theme persists (except "system" which falls through to OS).

Stop the dev server.

- [ ] **Step 8.9: Commit**

```bash
git add apps/web/src/lib/theme.ts apps/web/src/state apps/web/src/components/ThemeSwitcher.tsx apps/web/src/App.tsx apps/web/src/main.tsx
git commit -m "feat(web): theme system with light/dark/system + zustand UI store

- ThemeMode persisted to localStorage (system = no entry)
- applyTheme runs pre-React to avoid flash
- bindSystemThemeWatcher reacts to OS theme changes when mode=system
- ThemeSwitcher uses pill segmented control with Lucide icons
- uiStore covers theme + sidebarOpen; sidebar consumed by later tasks"
```

---

## Task 9: API Client + TanStack Query Hooks

**Files:**
- Create: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/lib/query-client.ts`
- Create: `apps/web/src/lib/hooks/usePromptList.ts`
- Create: `apps/web/src/lib/hooks/usePromptDetail.ts`
- Create: `apps/web/src/lib/hooks/useCategories.ts`
- Create: `apps/web/src/lib/hooks/useTags.ts`
- Create: `apps/web/src/lib/hooks/useR2Pool.ts`
- Create: `apps/web/src/lib/imageUrl.ts`
- Test: `apps/web/src/lib/imageUrl.test.ts`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 9.1: Create `apps/web/src/lib/api.ts`**

```ts
import type { Locale } from "@ip/shared";

const API_URL = import.meta.env.VITE_API_URL ?? "";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type FetchOptions = RequestInit & {
  locale?: Locale;
  query?: Record<string, string | number | boolean | undefined | null>;
};

function buildUrl(path: string, query?: FetchOptions["query"]): string {
  const url = new URL(path, API_URL || window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

export async function apiFetch<T>(path: string, options: FetchOptions = {}): Promise<T> {
  const { locale, query, headers, ...rest } = options;
  const url = buildUrl(path, query);
  const res = await fetch(url, {
    credentials: "include",
    ...rest,
    headers: {
      Accept: "application/json",
      ...(locale ? { "X-Locale": locale } : {}),
      ...(rest.body ? { "Content-Type": "application/json" } : {}),
      ...(headers ?? {}),
    },
  });

  if (!res.ok) {
    let payload: { error?: string; message?: string; fields?: Record<string, string> } = {};
    try {
      payload = await res.json();
    } catch {
      // non-JSON error response
    }
    throw new ApiError(
      res.status,
      payload.error ?? `http_${res.status}`,
      payload.message ?? res.statusText,
      payload.fields,
    );
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
```

- [ ] **Step 9.2: Create `apps/web/src/lib/query-client.ts`**

```ts
import { QueryClient } from "@tanstack/react-query";
import { ApiError } from "./api.ts";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: (failureCount, error) => {
        if (error instanceof ApiError && [400, 401, 403, 404, 410, 422].includes(error.status)) {
          return false;
        }
        return failureCount < 2;
      },
      refetchOnWindowFocus: false,
    },
  },
});
```

- [ ] **Step 9.3: Create `apps/web/src/lib/hooks/usePromptList.ts`**

```ts
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { z } from "zod";
import { PromptListQuerySchema, type PromptSummary, type Paginated } from "@ip/shared";
import { apiFetch } from "../api.ts";

export type PromptListQuery = z.input<typeof PromptListQuerySchema>;

export function usePromptList(query: PromptListQuery) {
  return useQuery<Paginated<PromptSummary>>({
    queryKey: ["prompts", query],
    queryFn: ({ signal }) =>
      apiFetch<Paginated<PromptSummary>>("/api/prompts", {
        query: query as Record<string, string | number | boolean | undefined | null>,
        signal,
      }),
    placeholderData: keepPreviousData,
  });
}
```

- [ ] **Step 9.4: Create `apps/web/src/lib/hooks/usePromptDetail.ts`**

```ts
import { useQuery } from "@tanstack/react-query";
import type { PromptDetail, PromptSummary } from "@ip/shared";
import { apiFetch } from "../api.ts";

export type PromptDetailWithRelated = PromptDetail & {
  related: Array<Pick<PromptSummary, "id" | "slug" | "title" | "aspectRatio" | "viewCount" | "likeCount" | "sendCount" | "favoriteCount" | "approvedAt">>;
};

export function usePromptDetail(slug: string | undefined) {
  return useQuery<PromptDetailWithRelated>({
    queryKey: ["prompts", "detail", slug],
    queryFn: ({ signal }) => apiFetch<PromptDetailWithRelated>(`/api/prompts/${slug}`, { signal }),
    enabled: Boolean(slug),
  });
}
```

- [ ] **Step 9.5: Create `apps/web/src/lib/hooks/useCategories.ts`**

```ts
import { useQuery } from "@tanstack/react-query";
import type { CategorySummary } from "@ip/shared";
import { apiFetch } from "../api.ts";

export function useCategories() {
  return useQuery<CategorySummary[]>({
    queryKey: ["categories"],
    queryFn: ({ signal }) => apiFetch<CategorySummary[]>("/api/categories", { signal }),
    staleTime: 5 * 60_000, // categories rarely change
  });
}
```

- [ ] **Step 9.6: Create `apps/web/src/lib/hooks/useTags.ts`**

```ts
import { useQuery } from "@tanstack/react-query";
import type { TagSummary } from "@ip/shared";
import { apiFetch } from "../api.ts";

export function useTags() {
  return useQuery<TagSummary[]>({
    queryKey: ["tags"],
    queryFn: ({ signal }) => apiFetch<TagSummary[]>("/api/tags", { signal }),
    staleTime: 5 * 60_000,
  });
}
```

- [ ] **Step 9.7: Create `apps/web/src/lib/hooks/useR2Pool.ts`**

```ts
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { R2PoolEntry } from "@ip/shared";
import { apiFetch } from "../api.ts";

export function useR2PoolMap() {
  const query = useQuery<R2PoolEntry[]>({
    queryKey: ["r2-pool"],
    queryFn: ({ signal }) => apiFetch<R2PoolEntry[]>("/api/public/r2-pool", { signal }),
    staleTime: 60 * 60_000, // 1h — pool changes rarely; manual invalidate after admin edit
  });

  const map = useMemo(() => {
    const out = new Map<string, string>();
    for (const entry of query.data ?? []) out.set(entry.id, entry.publicUrl);
    return out;
  }, [query.data]);

  return { ...query, map };
}
```

- [ ] **Step 9.8: Create `apps/web/src/lib/imageUrl.ts`**

```ts
/**
 * Resolve a full image URL by joining the R2 account's public URL with the key.
 * Falls back to a placeholder if the account isn't in the pool map (e.g. disabled
 * after the image was uploaded, but spec says public_url remains valid as long as
 * the underlying bucket lives).
 */
const PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 9'%3E%3Crect width='16' height='9' fill='%232c2c2f'/%3E%3C/svg%3E";

export function resolveImageUrl(
  image: { r2AccountId: string; r2Key: string } | null | undefined,
  poolMap: Map<string, string>,
): string {
  if (!image) return PLACEHOLDER;
  const base = poolMap.get(image.r2AccountId);
  if (!base) return PLACEHOLDER;
  const trimmedBase = base.replace(/\/$/, "");
  const trimmedKey = image.r2Key.replace(/^\//, "");
  return `${trimmedBase}/${trimmedKey}`;
}

export const IMAGE_URL_PLACEHOLDER = PLACEHOLDER;
```

- [ ] **Step 9.9: Create `apps/web/src/lib/imageUrl.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { resolveImageUrl, IMAGE_URL_PLACEHOLDER } from "./imageUrl.ts";

const pool = new Map([
  ["acc-1", "https://cdn.example.com"],
  ["acc-2", "https://pub-xxx.r2.dev/"],
]);

describe("resolveImageUrl", () => {
  it("joins base + key", () => {
    expect(resolveImageUrl({ r2AccountId: "acc-1", r2Key: "p/x/0.webp" }, pool)).toBe(
      "https://cdn.example.com/p/x/0.webp",
    );
  });

  it("trims trailing slash from base and leading from key", () => {
    expect(resolveImageUrl({ r2AccountId: "acc-2", r2Key: "/p/y/0.webp" }, pool)).toBe(
      "https://pub-xxx.r2.dev/p/y/0.webp",
    );
  });

  it("returns placeholder when account is unknown", () => {
    expect(resolveImageUrl({ r2AccountId: "missing", r2Key: "p/z/0.webp" }, pool)).toBe(IMAGE_URL_PLACEHOLDER);
  });

  it("returns placeholder when image is null", () => {
    expect(resolveImageUrl(null, pool)).toBe(IMAGE_URL_PLACEHOLDER);
  });
});
```

- [ ] **Step 9.10: Add QueryClientProvider to `apps/web/src/App.tsx`**

```tsx
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/query-client.ts";
import AppRouter from "./routes/index.tsx";
import LangSwitcher from "./components/LangSwitcher.tsx";
import ThemeSwitcher from "./components/ThemeSwitcher.tsx";
import { useTranslation } from "react-i18next";

function Header() {
  const { t } = useTranslation();
  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border-soft bg-panel-2/85 px-5 py-3 backdrop-blur">
      <div className="text-base font-semibold tracking-tight">Image-Prompts</div>
      <nav className="hidden gap-1 text-sm md:flex">
        <a className="rounded-pill px-3 py-1.5 text-text-muted hover:text-text" href="/zh">
          {t("nav.browse")}
        </a>
        <a className="rounded-pill px-3 py-1.5 text-text-muted hover:text-text" href="/zh/about">
          {t("nav.about")}
        </a>
      </nav>
      <div className="flex items-center gap-2">
        <ThemeSwitcher />
        <LangSwitcher />
      </div>
    </header>
  );
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-dvh bg-bg text-text">
        <Header />
        <AppRouter />
      </div>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 9.11: Run tests + typecheck**

```bash
pnpm --filter @ip/web test
pnpm --filter @ip/web typecheck
```

Expected: locale (3) + uiStore (5) + imageUrl (4) all pass. Typecheck exits 0.

- [ ] **Step 9.12: Commit**

```bash
git add apps/web/src/lib apps/web/src/App.tsx
git commit -m "feat(web): api client + tanstack query hooks + r2 url resolver

- apiFetch wraps fetch with API_URL, X-Locale, JSON, typed ApiError
- queryClient default: 30s stale, 5m gc, no retry on 4xx, no refocus refetch
- usePromptList / usePromptDetail / useCategories / useTags / useR2PoolMap
- resolveImageUrl joins pool base + key, falls back to inline svg placeholder
- imageUrl unit-tested for slash trimming + missing-account fallback"
```

---

## Task 10: UI Base Components

**Files:**
- Create: `apps/web/src/components/layout/AppShell.tsx`
- Create: `apps/web/src/components/layout/Sidebar.tsx`
- Create: `apps/web/src/components/PromptCard.tsx`
- Create: `apps/web/src/components/Toolbar.tsx`
- Create: `apps/web/src/components/Skeleton.tsx`
- Create: `apps/web/src/components/EmptyState.tsx`
- Create: `apps/web/src/components/ErrorState.tsx`
- Create: `apps/web/src/components/Hero.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 10.1: Create `apps/web/src/components/layout/Sidebar.tsx`**

```tsx
import { Link, useParams, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { isLocale, type Locale } from "@ip/shared";
import { useCategories } from "../../lib/hooks/useCategories.ts";
import { useTags } from "../../lib/hooks/useTags.ts";
import { pickBilingual } from "@ip/shared";
import { withLocale } from "../../lib/locale.ts";

export default function Sidebar() {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const [searchParams] = useSearchParams();
  const activeCategory = searchParams.get("category");
  const activeTag = searchParams.get("tag");

  const categories = useCategories();
  const tags = useTags();

  return (
    <aside className="hidden w-56 shrink-0 border-r border-border-soft px-3 py-5 md:block">
      <SidebarSection label={t("detail.category")}>
        <SidebarLink locale={locale} pathOverride="/prompts" isActive={!activeCategory && !activeTag} label={t("common.all")} count={categories.data?.reduce((n, c) => n + c.promptCount, 0)} />
        {categories.data?.map((c) => (
          <SidebarLink
            key={c.id}
            locale={locale}
            pathOverride={`/prompts?category=${c.slug}`}
            isActive={activeCategory === c.slug}
            label={pickBilingual(c.name, locale) ?? c.slug}
            count={c.promptCount}
          />
        ))}
      </SidebarSection>

      <SidebarSection label={t("detail.tags")}>
        {tags.data?.slice(0, 20).map((tg) => (
          <SidebarLink
            key={tg.id}
            locale={locale}
            pathOverride={`/prompts?tag=${tg.slug}`}
            isActive={activeTag === tg.slug}
            label={`# ${pickBilingual(tg.name, locale) ?? tg.slug}`}
            count={tg.usageCount}
          />
        ))}
      </SidebarSection>
    </aside>
  );
}

function SidebarSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-text-dim">
        {label}
      </div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </section>
  );
}

function SidebarLink({
  locale,
  pathOverride,
  isActive,
  label,
  count,
}: {
  locale: Locale;
  pathOverride: string;
  isActive: boolean;
  label: string;
  count?: number;
}) {
  return (
    <Link
      to={withLocale(locale, pathOverride)}
      className={[
        "flex items-center justify-between gap-2 rounded-md px-3 py-1.5 text-[13px]",
        isActive
          ? "bg-accent-soft text-accent"
          : "text-text-muted hover:bg-surface hover:text-text",
      ].join(" ")}
    >
      <span className="truncate">{label}</span>
      {count !== undefined && (
        <span className="shrink-0 text-[11px] text-text-dim">{count}</span>
      )}
    </Link>
  );
}
```

- [ ] **Step 10.2: Create `apps/web/src/components/layout/AppShell.tsx`**

```tsx
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { isLocale, type Locale } from "@ip/shared";
import LangSwitcher from "../LangSwitcher.tsx";
import ThemeSwitcher from "../ThemeSwitcher.tsx";
import { withLocale } from "../../lib/locale.ts";

export default function AppShell({ children, sidebar }: { children: React.ReactNode; sidebar?: React.ReactNode }) {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-text">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-border-soft bg-panel-2/85 px-5 py-3 backdrop-blur">
        <div className="flex items-center gap-6">
          <Link to={withLocale(locale, "/")} className="text-base font-semibold tracking-tight">
            Image-Prompts
          </Link>
          <nav className="hidden gap-1 text-sm md:flex">
            <Link to={withLocale(locale, "/prompts")} className="rounded-pill px-3 py-1.5 text-text-muted hover:text-text">
              {t("nav.browse")}
            </Link>
            <Link to={withLocale(locale, "/about")} className="rounded-pill px-3 py-1.5 text-text-muted hover:text-text">
              {t("nav.about")}
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            placeholder={t("common.search_placeholder")}
            className="hidden h-8 w-56 rounded-pill border border-border-soft bg-surface px-3 text-xs text-text placeholder:text-text-dim focus:outline-none focus:ring-2 focus:ring-accent-soft md:block"
          />
          <ThemeSwitcher />
          <LangSwitcher />
        </div>
      </header>
      <div className="flex flex-1">
        {sidebar}
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 10.3: Create `apps/web/src/components/PromptCard.tsx`**

```tsx
import { Link, useParams } from "react-router";
import { Heart } from "lucide-react";
import { isLocale, pickBilingual, type Locale, type PromptSummary } from "@ip/shared";
import { resolveImageUrl } from "../lib/imageUrl.ts";
import { useR2PoolMap } from "../lib/hooks/useR2Pool.ts";
import { withLocale } from "../lib/locale.ts";

export default function PromptCard({ prompt }: { prompt: PromptSummary }) {
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const { map } = useR2PoolMap();
  const title = pickBilingual(prompt.title, locale) ?? prompt.slug;
  const imageUrl = resolveImageUrl(prompt.primaryImage, map);
  const aspect = prompt.aspectRatio ?? "4/5";
  const aspectStyle = aspect === "auto" || aspect === undefined ? "4 / 5" : aspect.replace(":", " / ");

  return (
    <Link
      to={withLocale(locale, `/prompts/${prompt.slug}`)}
      className="group flex flex-col rounded-card overflow-hidden border border-border-soft bg-panel transition-colors hover:border-accent/40"
    >
      <div
        className="relative w-full bg-surface"
        style={{ aspectRatio: aspectStyle }}
      >
        <img
          src={imageUrl}
          alt={title}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
          width={prompt.primaryImage?.width ?? undefined}
          height={prompt.primaryImage?.height ?? undefined}
        />
      </div>
      <div className="flex flex-col gap-1.5 p-3.5">
        <div className="line-clamp-1 text-[13.5px] font-medium tracking-tight text-text">
          {title}
        </div>
        <div className="flex items-center justify-between text-[11.5px] text-text-dim">
          <div className="line-clamp-1">
            {prompt.tags
              .slice(0, 3)
              .map((tg) => `#${pickBilingual(tg.name, locale) ?? tg.slug}`)
              .join(" · ")}
          </div>
          <span className="flex items-center gap-0.5 text-text-muted">
            <Heart size={10} aria-hidden /> {prompt.likeCount}
          </span>
        </div>
      </div>
    </Link>
  );
}
```

- [ ] **Step 10.4: Create `apps/web/src/components/Toolbar.tsx`**

```tsx
import { useTranslation } from "react-i18next";
import type { SortOption } from "@ip/shared";

const SORTS: SortOption[] = ["latest", "popular", "liked", "sent"];

export default function Toolbar({
  total,
  sort,
  onSortChange,
}: {
  total: number;
  sort: SortOption;
  onSortChange: (next: SortOption) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between border-b border-border-soft px-6 py-4">
      <div className="text-[13px] text-text-muted">{t("list.total", { count: total })}</div>
      <div role="group" className="inline-flex rounded-pill border border-border-soft bg-surface p-0.5 text-xs">
        {SORTS.map((s) => (
          <button
            key={s}
            type="button"
            aria-pressed={s === sort}
            onClick={() => onSortChange(s)}
            className={[
              "rounded-pill px-3 py-1 transition-colors",
              s === sort ? "bg-accent text-white" : "text-text-muted hover:text-text",
            ].join(" ")}
          >
            {t(`list.sort_${s}`)}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 10.5: Create `apps/web/src/components/Skeleton.tsx`**

```tsx
export function Skeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={[
        "animate-pulse rounded-md bg-surface-2",
        className,
      ].join(" ")}
    />
  );
}

export function PromptCardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-border-soft bg-panel p-3.5">
      <Skeleton className="aspect-[4/5] w-full rounded-md" />
      <Skeleton className="h-3 w-3/4" />
      <Skeleton className="h-2 w-1/2" />
    </div>
  );
}

export function CardGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <PromptCardSkeleton key={i} />
      ))}
    </div>
  );
}
```

- [ ] **Step 10.6: Create `apps/web/src/components/EmptyState.tsx`**

```tsx
import { useTranslation } from "react-i18next";

export default function EmptyState({ message }: { message?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
      <div className="text-[42px] mb-2">·</div>
      <p className="text-sm text-text-muted">{message ?? t("common.empty")}</p>
    </div>
  );
}
```

- [ ] **Step 10.7: Create `apps/web/src/components/ErrorState.tsx`**

```tsx
import { useTranslation } from "react-i18next";

export default function ErrorState({
  message,
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center justify-center px-6 py-24 text-center">
      <p className="text-sm text-danger">{message ?? "Error"}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-pill border border-border-soft bg-surface px-4 py-1.5 text-xs text-text-muted hover:text-text"
        >
          {t("common.retry")}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 10.8: Create `apps/web/src/components/Hero.tsx`**

```tsx
import { Link, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { isLocale, type Locale } from "@ip/shared";
import { withLocale } from "../lib/locale.ts";

export default function Hero({ promptCount }: { promptCount: number }) {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border-soft px-6 py-7">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">{t("home.hero_title")}</h1>
        <p className="mt-1.5 text-[13.5px] text-text-muted">
          {t("home.hero_subtitle", { count: promptCount.toLocaleString() })}
        </p>
      </div>
      <Link
        to={withLocale(locale, "/prompts")}
        className="whitespace-nowrap rounded-pill bg-accent px-4 py-2 text-[13px] font-medium text-white hover:bg-accent-2"
      >
        {t("home.start_browsing")}
      </Link>
    </div>
  );
}
```

- [ ] **Step 10.9: Simplify `apps/web/src/App.tsx` to delegate header to AppShell**

```tsx
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/query-client.ts";
import AppRouter from "./routes/index.tsx";

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppRouter />
    </QueryClientProvider>
  );
}
```

(The header is now part of each page via `<AppShell>`.)

- [ ] **Step 10.10: Typecheck**

```bash
pnpm --filter @ip/web typecheck
```

Expected: Exits 0.

- [ ] **Step 10.11: Commit**

```bash
git add apps/web/src/components apps/web/src/App.tsx
git commit -m "feat(web): base UI components (shell, sidebar, card, toolbar, states)

- AppShell: sticky header with logo + nav + search input placeholder + theme/lang
- Sidebar: category & tag list with active state + counts
- PromptCard: image + bilingual title + tag chips + heart count, 4:5 aspect default
- Toolbar: total count + sort segmented (latest/popular/liked/sent)
- Skeleton: pulse blocks + PromptCardSkeleton + CardGridSkeleton
- EmptyState + ErrorState (with optional retry)
- Hero: home top section with bilingual hero + CTA"
```

---

## Task 11: Home Page

**Files:**
- Create: `apps/web/src/pages/HomePage.tsx`
- Modify: `apps/web/src/routes/index.tsx`

- [ ] **Step 11.1: Create `apps/web/src/pages/HomePage.tsx`**

```tsx
import AppShell from "../components/layout/AppShell.tsx";
import Sidebar from "../components/layout/Sidebar.tsx";
import Hero from "../components/Hero.tsx";
import PromptCard from "../components/PromptCard.tsx";
import { CardGridSkeleton } from "../components/Skeleton.tsx";
import EmptyState from "../components/EmptyState.tsx";
import ErrorState from "../components/ErrorState.tsx";
import { usePromptList } from "../lib/hooks/usePromptList.ts";

export default function HomePage() {
  const list = usePromptList({ sort: "latest", page: 1, pageSize: 12 });

  return (
    <AppShell sidebar={<Sidebar />}>
      <Hero promptCount={list.data?.total ?? 0} />
      {list.isLoading && <CardGridSkeleton count={8} />}
      {list.isError && (
        <ErrorState
          message={list.error instanceof Error ? list.error.message : "Error"}
          onRetry={() => list.refetch()}
        />
      )}
      {!list.isLoading && !list.isError && list.data && (
        list.data.items.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {list.data.items.map((p) => (
              <PromptCard key={p.id} prompt={p} />
            ))}
          </div>
        )
      )}
    </AppShell>
  );
}
```

- [ ] **Step 11.2: Wire HomePage into the router**

Update `apps/web/src/routes/index.tsx`:

```tsx
import { createBrowserRouter, RouterProvider } from "react-router";
import LocaleRedirect from "./locale-redirect.tsx";
import LocaleLayout from "./locale-layout.tsx";
import HomePage from "../pages/HomePage.tsx";

function ComingSoon({ name }: { name: string }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">{name}</h1>
      <p className="mt-2 text-text-muted">Replaced by the real page in later tasks.</p>
    </div>
  );
}

export const router = createBrowserRouter([
  { path: "/", element: <LocaleRedirect /> },
  {
    path: "/:locale",
    element: <LocaleLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "prompts", element: <ComingSoon name="List (Task 12)" /> },
      { path: "prompts/:slug", element: <ComingSoon name="Detail (Task 13)" /> },
      { path: "categories/:slug", element: <ComingSoon name="Category (later)" /> },
      { path: "about", element: <ComingSoon name="About (Task 14)" /> },
    ],
  },
  { path: "*", element: <LocaleRedirect /> },
]);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
```

- [ ] **Step 11.3: Manually verify**

Make sure both servers are running:
```bash
# terminal 1
pnpm --filter @ip/api dev
# terminal 2
pnpm --filter @ip/web dev
```

Visit `http://localhost:5173/zh`:
- Header shows logo + nav + theme + lang switchers
- Sidebar shows 6 categories + 8 tags with counts
- Hero shows "生图提示词聚合" + "6 条精选提示词 · ..." (count from API)
- Below Hero: a 1-4 column grid of 6 placeholder cards (each shows title, tags, like count)
- Switching to `/en`: all UI text becomes English; card titles flip to English version

If the cards show "no image" placeholder (gray box) — that's expected; real images come from R2 in M2-M4.

- [ ] **Step 11.4: Commit**

```bash
git add apps/web/src/pages/HomePage.tsx apps/web/src/routes/index.tsx
git commit -m "feat(web): home page wires AppShell + Hero + grid

- /zh and /en both reach HomePage
- Loading shows 8-card skeleton; empty shows EmptyState; error shows ErrorState with retry
- Hero subtitle interpolates {count} from total
- Grid responsive 1/2/3/4 cols at sm/md/lg breakpoints"
```

---

## Task 12: Prompt List Page

**Files:**
- Create: `apps/web/src/pages/PromptListPage.tsx`
- Create: `apps/web/src/lib/hooks/useUrlState.ts`
- Modify: `apps/web/src/routes/index.tsx`

- [ ] **Step 12.1: Create `apps/web/src/lib/hooks/useUrlState.ts`**

```ts
import { useCallback } from "react";
import { useSearchParams } from "react-router";

/**
 * Convenience hook over URLSearchParams: read + write a value of type string|null,
 * preserving other params and reset behavior.
 */
export function useUrlParam(name: string): [string | null, (value: string | null) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(name);
  const setValue = useCallback(
    (next: string | null) => {
      const updated = new URLSearchParams(params);
      if (next === null || next === "") updated.delete(name);
      else updated.set(name, next);
      setParams(updated, { replace: false });
    },
    [params, setParams, name],
  );
  return [value, setValue];
}
```

- [ ] **Step 12.2: Create `apps/web/src/pages/PromptListPage.tsx`**

```tsx
import { useMemo } from "react";
import { useSearchParams } from "react-router";
import AppShell from "../components/layout/AppShell.tsx";
import Sidebar from "../components/layout/Sidebar.tsx";
import Toolbar from "../components/Toolbar.tsx";
import PromptCard from "../components/PromptCard.tsx";
import { CardGridSkeleton } from "../components/Skeleton.tsx";
import EmptyState from "../components/EmptyState.tsx";
import ErrorState from "../components/ErrorState.tsx";
import { usePromptList } from "../lib/hooks/usePromptList.ts";
import type { SortOption, AspectRatio } from "@ip/shared";

const SORT_VALUES: readonly SortOption[] = ["latest", "popular", "liked", "sent"];
const ASPECT_VALUES: readonly AspectRatio[] = ["auto", "1:1", "3:2", "2:3", "16:9", "9:16"];

function asSort(v: string | null): SortOption {
  return SORT_VALUES.includes(v as SortOption) ? (v as SortOption) : "latest";
}

function asAspect(v: string | null): AspectRatio | undefined {
  return ASPECT_VALUES.includes(v as AspectRatio) ? (v as AspectRatio) : undefined;
}

export default function PromptListPage() {
  const [params, setParams] = useSearchParams();
  const category = params.get("category") ?? undefined;
  const tag = params.get("tag") ?? undefined;
  const aspect = asAspect(params.get("aspect"));
  const q = params.get("q") ?? undefined;
  const sort = asSort(params.get("sort"));
  const page = Number(params.get("page") ?? "1") || 1;

  const query = useMemo(
    () => ({ category, tag, aspect, q, sort, page, pageSize: 24 }),
    [category, tag, aspect, q, sort, page],
  );
  const list = usePromptList(query);

  function setSort(next: SortOption) {
    const updated = new URLSearchParams(params);
    updated.set("sort", next);
    updated.delete("page");
    setParams(updated);
  }

  function setPage(next: number) {
    const updated = new URLSearchParams(params);
    if (next <= 1) updated.delete("page");
    else updated.set("page", String(next));
    setParams(updated);
  }

  return (
    <AppShell sidebar={<Sidebar />}>
      <Toolbar total={list.data?.total ?? 0} sort={sort} onSortChange={setSort} />
      {list.isLoading && <CardGridSkeleton count={12} />}
      {list.isError && (
        <ErrorState
          message={list.error instanceof Error ? list.error.message : "Error"}
          onRetry={() => list.refetch()}
        />
      )}
      {!list.isLoading && !list.isError && list.data && (
        list.data.items.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {list.data.items.map((p) => (
                <PromptCard key={p.id} prompt={p} />
              ))}
            </div>
            <Pagination
              page={page}
              hasMore={list.data.hasMore}
              total={list.data.total}
              pageSize={list.data.pageSize}
              onChange={setPage}
            />
          </>
        )
      )}
    </AppShell>
  );
}

function Pagination({
  page,
  hasMore,
  total,
  pageSize,
  onChange,
}: {
  page: number;
  hasMore: boolean;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
}) {
  const maxPage = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-center gap-2 border-t border-border-soft px-6 py-6 text-[13px]">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        className="rounded-pill border border-border-soft bg-surface px-4 py-1.5 text-text-muted disabled:opacity-40 hover:enabled:text-text"
      >
        ← prev
      </button>
      <span className="px-2 text-text-dim">
        {page} / {maxPage}
      </span>
      <button
        type="button"
        disabled={!hasMore}
        onClick={() => onChange(page + 1)}
        className="rounded-pill border border-border-soft bg-surface px-4 py-1.5 text-text-muted disabled:opacity-40 hover:enabled:text-text"
      >
        next →
      </button>
    </div>
  );
}
```

- [ ] **Step 12.3: Update router**

Update `apps/web/src/routes/index.tsx`:

```tsx
import { createBrowserRouter, RouterProvider } from "react-router";
import LocaleRedirect from "./locale-redirect.tsx";
import LocaleLayout from "./locale-layout.tsx";
import HomePage from "../pages/HomePage.tsx";
import PromptListPage from "../pages/PromptListPage.tsx";

function ComingSoon({ name }: { name: string }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">{name}</h1>
      <p className="mt-2 text-text-muted">Replaced by the real page in later tasks.</p>
    </div>
  );
}

export const router = createBrowserRouter([
  { path: "/", element: <LocaleRedirect /> },
  {
    path: "/:locale",
    element: <LocaleLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "prompts", element: <PromptListPage /> },
      { path: "prompts/:slug", element: <ComingSoon name="Detail (Task 13)" /> },
      { path: "categories/:slug", element: <ComingSoon name="Category (later)" /> },
      { path: "about", element: <ComingSoon name="About (Task 14)" /> },
    ],
  },
  { path: "*", element: <LocaleRedirect /> },
]);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
```

- [ ] **Step 12.4: Manually verify**

With both dev servers running, visit `http://localhost:5173/zh/prompts`:
- Sidebar lets you filter by category (clicking adds `?category=landscape`)
- Toolbar shows total + sort segmented control; sort toggles update URL `?sort=liked` etc.
- Pagination prev/next buttons; disabled when at first/last page
- Browser back/forward respects filter + sort state

Try `?category=does-not-exist` → EmptyState renders.

- [ ] **Step 12.5: Commit**

```bash
git add apps/web/src/pages/PromptListPage.tsx apps/web/src/lib/hooks/useUrlState.ts apps/web/src/routes/index.tsx
git commit -m "feat(web): prompt list page with URL-driven filters

- ?category / ?tag / ?aspect / ?q / ?sort / ?page parsed from search params
- Sort changes reset page; pagination preserves other params
- useUrlParam helper for any single param read/write
- Sidebar already participates by updating URL on click"
```

---

## Task 13: Prompt Detail Page

**Files:**
- Create: `apps/web/src/pages/PromptDetailPage.tsx`
- Create: `apps/web/src/components/PromptDetail/Gallery.tsx`
- Create: `apps/web/src/components/PromptDetail/PromptTextBlock.tsx`
- Create: `apps/web/src/components/PromptDetail/SuggestedParams.tsx`
- Create: `apps/web/src/components/PromptDetail/RelatedRow.tsx`
- Modify: `apps/web/src/routes/index.tsx`

- [ ] **Step 13.1: Create `apps/web/src/components/PromptDetail/Gallery.tsx`**

```tsx
import { useState } from "react";
import type { PromptDetail } from "@ip/shared";
import { resolveImageUrl } from "../../lib/imageUrl.ts";
import { useR2PoolMap } from "../../lib/hooks/useR2Pool.ts";

export default function Gallery({ images, title }: { images: PromptDetail["images"]; title: string }) {
  const [active, setActive] = useState(0);
  const { map } = useR2PoolMap();
  const current = images[active] ?? null;
  const mainUrl = resolveImageUrl(current, map);

  return (
    <div className="rounded-card border border-border-soft bg-panel p-2">
      <div className="overflow-hidden rounded-[14px] bg-surface">
        <img
          src={mainUrl}
          alt={title}
          className="block max-h-[70vh] w-full object-contain"
          width={current?.width ?? undefined}
          height={current?.height ?? undefined}
        />
      </div>
      {images.length > 1 && (
        <div className="mt-2 grid grid-cols-4 gap-2">
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              onClick={() => setActive(i)}
              aria-pressed={i === active}
              className={[
                "overflow-hidden rounded-[10px] border-2 transition-colors",
                i === active ? "border-accent" : "border-transparent hover:border-border",
              ].join(" ")}
            >
              <img
                src={resolveImageUrl(img, map)}
                alt=""
                className="aspect-square w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 13.2: Create `apps/web/src/components/PromptDetail/PromptTextBlock.tsx`**

```tsx
import { useState } from "react";
import { useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Copy, Check } from "lucide-react";
import { hasLocale, isLocale, pickBilingual, type BilingualText, type Locale } from "@ip/shared";

export default function PromptTextBlock({
  label,
  value,
}: {
  label: string;
  value: BilingualText | null;
}) {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const [copied, setCopied] = useState(false);

  const text = pickBilingual(value, locale);
  if (!text) return null;
  const hint = !hasLocale(value, locale)
    ? locale === "zh"
      ? t("common.no_zh_version")
      : t("common.no_en_version")
    : null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text!);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API blocked; fallback to legacy textarea
      const ta = document.createElement("textarea");
      ta.value = text!;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } finally {
        ta.remove();
      }
    }
  }

  return (
    <section className="rounded-card border border-border-soft bg-panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[13px] font-semibold uppercase tracking-wider text-text-dim">{label}</h2>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1.5 rounded-pill border border-border-soft bg-surface px-3 py-1 text-[11px] text-text-muted hover:text-text"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {t("detail.copy_prompt")}
        </button>
      </div>
      <p className="whitespace-pre-wrap font-mono text-[13px] leading-[1.7] text-text">{text}</p>
      {hint && <p className="mt-2 text-[11px] text-text-dim">{hint}</p>}
    </section>
  );
}
```

- [ ] **Step 13.3: Create `apps/web/src/components/PromptDetail/SuggestedParams.tsx`**

```tsx
import { useTranslation } from "react-i18next";
import type { AspectRatio } from "@ip/shared";

export default function SuggestedParams({ aspect }: { aspect: AspectRatio | null }) {
  const { t } = useTranslation();
  return (
    <section className="rounded-card border border-border-soft bg-panel p-4">
      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-text-dim">
        {t("detail.suggested_params")}
      </h2>
      <div className="grid grid-cols-2 gap-2 text-[12.5px]">
        <ParamCell label={t("detail.aspect_ratio")} value={aspect ?? "—"} />
        <ParamCell
          label=""
          value={aspect ? "—" : t("detail.no_suggestions")}
        />
      </div>
    </section>
  );
}

function ParamCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-surface px-3 py-2">
      {label && <div className="text-[11px] text-text-dim">{label}</div>}
      <div className="font-medium text-text">{value}</div>
    </div>
  );
}
```

- [ ] **Step 13.4: Create `apps/web/src/components/PromptDetail/RelatedRow.tsx`**

```tsx
import { Link, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { isLocale, pickBilingual, type Locale } from "@ip/shared";
import { withLocale } from "../../lib/locale.ts";
import type { PromptDetailWithRelated } from "../../lib/hooks/usePromptDetail.ts";

export default function RelatedRow({ items }: { items: PromptDetailWithRelated["related"] }) {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  if (items.length === 0) return null;

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wider text-text-dim">
        {t("detail.related")}
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {items.map((r) => (
          <Link
            key={r.id}
            to={withLocale(locale, `/prompts/${r.slug}`)}
            className="block rounded-card border border-border-soft bg-panel p-3 hover:border-accent/40"
          >
            <div className="line-clamp-2 text-[12.5px] font-medium text-text">
              {pickBilingual(r.title, locale) ?? r.slug}
            </div>
            <div className="mt-1 text-[11px] text-text-dim">♡ {r.likeCount}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 13.5: Create `apps/web/src/pages/PromptDetailPage.tsx`**

```tsx
import { Link, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Heart, Send } from "lucide-react";
import { isLocale, pickBilingual, type Locale } from "@ip/shared";
import AppShell from "../components/layout/AppShell.tsx";
import { usePromptDetail } from "../lib/hooks/usePromptDetail.ts";
import { withLocale } from "../lib/locale.ts";
import Gallery from "../components/PromptDetail/Gallery.tsx";
import PromptTextBlock from "../components/PromptDetail/PromptTextBlock.tsx";
import SuggestedParams from "../components/PromptDetail/SuggestedParams.tsx";
import RelatedRow from "../components/PromptDetail/RelatedRow.tsx";
import { Skeleton } from "../components/Skeleton.tsx";
import ErrorState from "../components/ErrorState.tsx";

export default function PromptDetailPage() {
  const { t } = useTranslation();
  const { slug, locale: param } = useParams<{ slug: string; locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const detail = usePromptDetail(slug);

  if (detail.isLoading) {
    return (
      <AppShell>
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 p-6 lg:grid-cols-[1.4fr_1fr]">
          <Skeleton className="aspect-[3/2] w-full rounded-card" />
          <div className="space-y-4">
            <Skeleton className="h-7 w-3/4 rounded-md" />
            <Skeleton className="h-4 w-1/2 rounded-md" />
            <Skeleton className="h-24 w-full rounded-card" />
          </div>
        </div>
      </AppShell>
    );
  }

  if (detail.isError || !detail.data) {
    return (
      <AppShell>
        <div className="mx-auto max-w-2xl px-6 py-16 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">{t("common.not_found_title")}</h1>
          <p className="mt-2 text-text-muted">{t("common.not_found_body")}</p>
          <Link
            to={withLocale(locale, "/prompts")}
            className="mt-6 inline-block rounded-pill bg-accent px-4 py-2 text-[13px] font-medium text-white"
          >
            {t("common.back_home")}
          </Link>
        </div>
      </AppShell>
    );
  }

  const d = detail.data;
  const title = pickBilingual(d.title, locale) ?? d.slug;

  return (
    <AppShell>
      <article className="mx-auto max-w-6xl px-6 py-6">
        {/* breadcrumb */}
        <nav aria-label="breadcrumb" className="mb-4 text-[12.5px] text-text-dim">
          <Link to={withLocale(locale, "/prompts")} className="hover:text-text">
            ← {t("nav.browse")}
          </Link>
          <span className="mx-2">·</span>
          <span>{pickBilingual(d.category.name, locale) ?? d.category.slug}</span>
        </nav>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.5fr_1fr]">
          <Gallery images={d.images} title={title} />

          <aside className="flex flex-col gap-4">
            <div>
              <h1 className="text-[24px] font-semibold leading-tight tracking-tight text-text">{title}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px]">
                <Link
                  to={withLocale(locale, `/prompts?category=${d.category.slug}`)}
                  className="rounded-pill bg-accent-soft px-2.5 py-0.5 text-accent"
                >
                  📁 {pickBilingual(d.category.name, locale) ?? d.category.slug}
                </Link>
                {d.tags.map((tg) => (
                  <Link
                    key={tg.slug}
                    to={withLocale(locale, `/prompts?tag=${tg.slug}`)}
                    className="rounded-pill border border-border-soft bg-surface px-2.5 py-0.5 text-text-muted hover:text-text"
                  >
                    #{pickBilingual(tg.name, locale) ?? tg.slug}
                  </Link>
                ))}
              </div>
            </div>

            {/* Send to Studio CTA — M2 wires it. M1 button is disabled-but-visible placeholder. */}
            <button
              type="button"
              disabled
              title="Implemented in M2"
              className="inline-flex items-center justify-center gap-2 rounded-pill bg-accent px-4 py-2.5 text-[13px] font-medium text-white opacity-60"
            >
              <Send size={14} aria-hidden />
              {t("detail.send_to_studio")}
            </button>

            <div className="grid grid-cols-3 gap-2 text-[12.5px]">
              <button
                type="button"
                disabled
                className="rounded-pill border border-border-soft bg-surface px-3 py-2 text-text-muted opacity-60"
              >
                {t("detail.copy_prompt")}
              </button>
              <button
                type="button"
                disabled
                className="inline-flex items-center justify-center gap-1.5 rounded-pill border border-border-soft bg-surface px-3 py-2 text-text-muted opacity-60"
              >
                <Heart size={12} /> {t("detail.favorite")}
              </button>
              <button
                type="button"
                disabled
                className="rounded-pill border border-border-soft bg-surface px-3 py-2 text-text-muted opacity-60"
              >
                {t("detail.more")}
              </button>
            </div>

            <SuggestedParams aspect={d.aspectRatio} />
          </aside>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4">
          <PromptTextBlock label={t("detail.prompt")} value={d.prompt} />
          {d.negativePrompt && (
            <PromptTextBlock label={t("detail.negative_prompt")} value={d.negativePrompt} />
          )}
        </div>

        <RelatedRow items={d.related} />
      </article>
    </AppShell>
  );
}
```

- [ ] **Step 13.6: Update router**

Update `apps/web/src/routes/index.tsx`:

```tsx
import { createBrowserRouter, RouterProvider } from "react-router";
import LocaleRedirect from "./locale-redirect.tsx";
import LocaleLayout from "./locale-layout.tsx";
import HomePage from "../pages/HomePage.tsx";
import PromptListPage from "../pages/PromptListPage.tsx";
import PromptDetailPage from "../pages/PromptDetailPage.tsx";

function ComingSoon({ name }: { name: string }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">{name}</h1>
      <p className="mt-2 text-text-muted">Replaced by the real page in later tasks.</p>
    </div>
  );
}

export const router = createBrowserRouter([
  { path: "/", element: <LocaleRedirect /> },
  {
    path: "/:locale",
    element: <LocaleLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "prompts", element: <PromptListPage /> },
      { path: "prompts/:slug", element: <PromptDetailPage /> },
      { path: "categories/:slug", element: <ComingSoon name="Category (later)" /> },
      { path: "about", element: <ComingSoon name="About (Task 14)" /> },
    ],
  },
  { path: "*", element: <LocaleRedirect /> },
]);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
```

- [ ] **Step 13.7: Manually verify**

With both servers running, visit:
- `http://localhost:5173/zh/prompts/cyberpunk-neon-cat` — full detail page
- Click a tag → bounces back to filtered list
- Switch language: title + body switches to en; if a field is missing en, falls back to zh + grey hint shown
- Copy button: click → button shows ✓ briefly; clipboard contains current-locale prompt text
- "Send to Image-Studio" + "Copy/Favorite/More" buttons are visible-but-disabled (M2/M5 will enable)
- Unknown slug → "找不到此提示词" empty state + back link

- [ ] **Step 13.8: Commit**

```bash
git add apps/web/src/pages/PromptDetailPage.tsx apps/web/src/components/PromptDetail apps/web/src/routes/index.tsx
git commit -m "feat(web): prompt detail page with gallery, bilingual text, related

- Two-column layout: gallery left, info right
- Gallery: main image + thumbnail strip, click to swap
- PromptTextBlock: copy button + missing-locale fallback hint
- SuggestedParams: aspect ratio + 'uses Image-Studio defaults' default
- RelatedRow: 6 same-category siblings sorted by likeCount
- Send to Studio + Copy + Favorite + More buttons are visible-disabled (M2/M5)
- 404 empty state with i18n + back link"
```

---

## Task 14: About Page + 404 Page

**Files:**
- Create: `apps/web/src/pages/AboutPage.tsx`
- Create: `apps/web/src/pages/NotFoundPage.tsx`
- Modify: `apps/web/src/routes/index.tsx`

- [ ] **Step 14.1: Create `apps/web/src/pages/AboutPage.tsx`**

```tsx
import { useTranslation } from "react-i18next";
import AppShell from "../components/layout/AppShell.tsx";

export default function AboutPage() {
  const { t } = useTranslation();
  return (
    <AppShell>
      <article className="mx-auto max-w-2xl px-6 py-12">
        <h1 className="text-[28px] font-semibold tracking-tight">{t("about.title")}</h1>
        <p className="mt-4 text-[15px] leading-relaxed text-text-muted">{t("about.body")}</p>

        <section className="mt-10 rounded-card border border-border-soft bg-panel p-6">
          <h2 className="text-[14px] font-semibold text-text">{t("about.credits_title")}</h2>
          <p className="mt-3 text-[13.5px] leading-relaxed text-text-muted">
            {t("about.credits_body")}
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-[12px]">
            <a
              href="https://github.com/unknowlei/nanobanana-website"
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-pill border border-border-soft bg-surface px-3 py-1.5 text-text-muted hover:text-text"
            >
              nanobanana-website ↗
            </a>
            <a
              href="https://github.com/RoseKhlifa/Image-Studio"
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-pill border border-border-soft bg-surface px-3 py-1.5 text-text-muted hover:text-text"
            >
              Image-Studio ↗
            </a>
            <a
              href="https://github.com/RoseKhlifa/Image-Prompts"
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-pill border border-border-soft bg-surface px-3 py-1.5 text-text-muted hover:text-text"
            >
              Image-Prompts ↗
            </a>
          </div>
        </section>
      </article>
    </AppShell>
  );
}
```

- [ ] **Step 14.2: Create `apps/web/src/pages/NotFoundPage.tsx`**

```tsx
import { Link, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { isLocale, type Locale } from "@ip/shared";
import AppShell from "../components/layout/AppShell.tsx";
import { withLocale } from "../lib/locale.ts";

export default function NotFoundPage() {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  return (
    <AppShell>
      <div className="mx-auto max-w-md px-6 py-24 text-center">
        <div className="text-[64px] font-semibold tracking-tight text-text-dim">404</div>
        <h1 className="mt-2 text-[20px] font-semibold tracking-tight">{t("common.not_found_title")}</h1>
        <p className="mt-2 text-[13.5px] text-text-muted">{t("common.not_found_body")}</p>
        <Link
          to={withLocale(locale, "/")}
          className="mt-6 inline-block rounded-pill bg-accent px-4 py-2 text-[13px] font-medium text-white hover:bg-accent-2"
        >
          {t("common.back_home")}
        </Link>
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 14.3: Wire pages into router**

Replace `apps/web/src/routes/index.tsx`:

```tsx
import { createBrowserRouter, RouterProvider } from "react-router";
import LocaleRedirect from "./locale-redirect.tsx";
import LocaleLayout from "./locale-layout.tsx";
import HomePage from "../pages/HomePage.tsx";
import PromptListPage from "../pages/PromptListPage.tsx";
import PromptDetailPage from "../pages/PromptDetailPage.tsx";
import AboutPage from "../pages/AboutPage.tsx";
import NotFoundPage from "../pages/NotFoundPage.tsx";

export const router = createBrowserRouter([
  { path: "/", element: <LocaleRedirect /> },
  {
    path: "/:locale",
    element: <LocaleLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "prompts", element: <PromptListPage /> },
      { path: "prompts/:slug", element: <PromptDetailPage /> },
      { path: "categories/:slug", element: <PromptListPage /> }, // category page = list with ?category param baked in via redirect (later)
      { path: "about", element: <AboutPage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
  { path: "*", element: <LocaleRedirect /> },
]);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
```

- [ ] **Step 14.4: Manually verify**

Visit `http://localhost:5173/zh/about`:
- Shows bilingual About page + credits section + 3 GitHub link pills (open in new tab)

Visit `http://localhost:5173/zh/garbage-path`:
- Shows 404 page with "返回首页" button

Switch locale on each page — content + links stay correct.

- [ ] **Step 14.5: Commit**

```bash
git add apps/web/src/pages/AboutPage.tsx apps/web/src/pages/NotFoundPage.tsx apps/web/src/routes/index.tsx
git commit -m "feat(web): about page (with attribution) + 404 page

- /[locale]/about: bilingual body + credits to unknowlei/nanobanana-website
- /[locale]/about: three GitHub link pills (nanobanana + Image-Studio + Image-Prompts)
- /[locale]/* fallback: NotFoundPage with i18n + back-home CTA"
```

---

## Task 15: Dev Conveniences + CI Workflow

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `scripts/check-prereqs.sh`
- Modify: `package.json` (root)
- Modify: `README.md` (root)

- [ ] **Step 15.1: Add a root convenience script**

Replace `scripts` block in root `package.json`:

```json
{
  "name": "image-prompts",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "packageManager": "pnpm@9.15.0",
  "engines": {
    "node": ">=22.0.0",
    "pnpm": ">=9.0.0"
  },
  "scripts": {
    "dev": "pnpm -r --parallel --filter @ip/api --filter @ip/web run dev",
    "dev:api": "pnpm --filter @ip/api run dev",
    "dev:web": "pnpm --filter @ip/web run dev",
    "build": "pnpm -r run build",
    "test": "pnpm -r run test",
    "typecheck": "pnpm -r run typecheck",
    "lint": "eslint .",
    "format": "prettier --write \"**/*.{ts,tsx,js,jsx,json,md,yaml,yml}\"",
    "format:check": "prettier --check \"**/*.{ts,tsx,js,jsx,json,md,yaml,yml}\"",
    "db:migrate": "pnpm --filter @ip/api run db:migrate",
    "db:seed": "pnpm --filter @ip/api run db:seed",
    "check": "pnpm typecheck && pnpm lint && pnpm test"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "eslint": "^9.17.0",
    "@eslint/js": "^9.17.0",
    "typescript-eslint": "^8.20.0",
    "prettier": "^3.4.0",
    "typescript": "^5.7.0"
  }
}
```

- [ ] **Step 15.2: Create `scripts/check-prereqs.sh`**

```bash
#!/usr/bin/env bash
set -euo pipefail

ok() { printf "\033[32m✓\033[0m %s\n" "$1"; }
warn() { printf "\033[33m!\033[0m %s\n" "$1"; }
fail() { printf "\033[31m✗\033[0m %s\n" "$1"; exit 1; }

# Node version
if ! command -v node >/dev/null 2>&1; then
  fail "node is not installed"
fi
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [[ "$NODE_MAJOR" -lt 22 ]]; then
  fail "node >= 22 required (have $(node -v))"
fi
ok "node $(node -v)"

# pnpm version
if ! command -v pnpm >/dev/null 2>&1; then
  fail "pnpm is not installed (run: npm i -g pnpm@9)"
fi
PNPM_MAJOR=$(pnpm --version | cut -d. -f1)
if [[ "$PNPM_MAJOR" -lt 9 ]]; then
  fail "pnpm >= 9 required (have $(pnpm --version))"
fi
ok "pnpm $(pnpm --version)"

# psql client (for DB checks; psql not strictly required if DB runs elsewhere)
if command -v psql >/dev/null 2>&1; then
  ok "psql $(psql --version | awk '{print $3}')"
else
  warn "psql not in PATH (recommended for DB inspection)"
fi

echo "All prerequisites OK."
```

Make it executable:
```bash
chmod +x scripts/check-prereqs.sh
```

- [ ] **Step 15.3: Replace `README.md` with full setup instructions**

```markdown
# Image-Prompts

中英双语生图提示词聚合站,Image-Studio 配套产品。

## Repository Structure

This is a pnpm monorepo:

- \`apps/web\` — React + Vite SPA (frontend)
- \`apps/api\` — Hono server (backend API)
- \`packages/shared\` — Shared Zod schemas, TS types, i18n utilities
- \`docs/superpowers/specs\` — Design specs
- \`docs/superpowers/plans\` — Implementation plans
- \`scripts\` — One-off migration / data tasks

## Prerequisites

- Node.js 22 LTS (\`nvm install 22 && nvm use 22\`)
- pnpm 9 (\`npm i -g pnpm@9\`)
- PostgreSQL 16 running locally on \`localhost:5432\`
- A dev database:
  \`\`\`bash
  createdb image_prompts_dev
  psql -d image_prompts_dev -c "CREATE USER ip_app WITH PASSWORD 'devpassword' SUPERUSER;"
  \`\`\`

Run \`bash scripts/check-prereqs.sh\` to validate.

> **No Docker is required for local development.** Docker is only used for production deployment (M8).

## Quick Start

\`\`\`bash
pnpm install
cp apps/api/.env.example apps/api/.env       # then edit secrets
pnpm db:migrate                              # creates 19 tables
pnpm db:seed                                 # inserts demo prompts
pnpm dev                                     # starts api:3000 + web:5173 in parallel
\`\`\`

Open <http://localhost:5173>.

## Useful Commands

\`\`\`bash
pnpm dev            # api + web in parallel
pnpm dev:api        # api only
pnpm dev:web        # web only
pnpm build          # all packages
pnpm test           # all packages
pnpm typecheck      # all packages
pnpm lint           # all packages
pnpm format         # auto-format with Prettier
pnpm check          # typecheck + lint + test
pnpm db:migrate     # apply pending migrations
pnpm db:seed        # idempotent dev seed
\`\`\`

## CI

GitHub Actions runs \`pnpm check\` plus an integration test job (PG service container) on every PR.
See \`.github/workflows/ci.yml\`.

## Design

See \`docs/superpowers/specs/2026-06-06-image-prompts-design.md\`. Implementation milestones live in \`docs/superpowers/plans/\`.

## Roadmap (8 milestones)

- **M1** Skeleton + public browsing  ✅ (this milestone)
- M2 Send to Studio integration
- M3 User submission flow
- M4 Admin review + R2 account pool
- M5 Likes / favorites / related discovery
- M6 Full bilingual content + AI translation
- M7 Reports / announcements / system settings
- M8 nanobanana data migration + production deploy
```

- [ ] **Step 15.4: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint-typecheck-unit:
    name: lint + typecheck + unit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: "pnpm"
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - name: Unit tests (exclude integration)
        run: |
          pnpm --filter @ip/shared test
          pnpm --filter @ip/web test

  api-integration:
    name: api integration (with PG service)
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_DB: image_prompts_test
          POSTGRES_USER: ip_app
          POSTGRES_PASSWORD: testpassword
        ports: ["5432:5432"]
        options: >-
          --health-cmd="pg_isready -U ip_app -d image_prompts_test"
          --health-interval=5s
          --health-timeout=5s
          --health-retries=10
    env:
      NODE_ENV: test
      PORT: 3000
      HOST: 127.0.0.1
      SITE_URL: http://localhost:5173
      API_URL: http://localhost:3000
      LOG_LEVEL: warn
      DATABASE_URL: postgres://ip_app:testpassword@localhost:5432/image_prompts_test
      AUTH_SECRET: ci_secret_at_least_32_chars_long_xxxxxxxx
      R2_ENCRYPTION_KEY: "0000000000000000000000000000000000000000000000000000000000000000"
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: "pnpm"
      - run: pnpm install --frozen-lockfile
      - name: Apply migrations
        run: pnpm --filter @ip/api run db:migrate
      - name: Seed demo data
        run: pnpm --filter @ip/api run db:seed
      - name: Run api integration tests
        run: pnpm --filter @ip/api test
```

- [ ] **Step 15.5: Run the full check locally**

```bash
pnpm check
```

Expected: typecheck OK, lint OK, all tests pass (shared + web + api).

- [ ] **Step 15.6: Final smoke — full dev flow**

```bash
pnpm dev
```

Expected: api on :3000 + web on :5173 boot in parallel. Visit:
- `/zh` → home with 6 cards
- Click first card → detail page renders
- Click a tag → list page with `?tag=...`
- Switch theme/language → all UI follows
- `/zh/about` → about with credits
- `/zh/nonsense` → 404

Stop with Ctrl+C.

- [ ] **Step 15.7: Commit**

```bash
git add package.json README.md scripts/check-prereqs.sh .github/workflows/ci.yml
git commit -m "chore: dev conveniences + CI workflow

- Root scripts: dev / dev:api / dev:web / db:migrate / db:seed / check
- check-prereqs.sh validates node >= 22, pnpm >= 9, optional psql
- README has prereqs / quick start / commands / CI / roadmap
- CI runs lint+typecheck+unit on every PR
- api-integration job uses ubuntu service container postgres:16-alpine,
  applies migrations + seed, runs vitest integration tests"
```

---

## Definition of Done — M1

When all 15 tasks are committed, the following must hold:

- [ ] **`pnpm check` exits 0** (typecheck + lint + unit all pass)
- [ ] **Manual smoke:**
  - `pnpm dev` boots api + web cleanly
  - `/zh` home renders 6 cards, Hero subtitle reads "6+ 条精选提示词"
  - Switching to `/en` flips all UI text + bilingual card titles
  - Filter sidebar updates URL `?category=` / `?tag=` and grid refreshes
  - Sort segmented control updates `?sort=` and re-orders
  - Pagination prev/next disabled at boundaries
  - Detail page shows gallery + bilingual title + tags + prompt text + copy ✓
  - About page shows attribution to nanobanana-website
  - `/zh/garbage` shows 404 page
  - Light/Dark/System theme switches without flash
- [ ] **CI green** on `main` after merge

If any item fails, fix and recommit before declaring M1 done.

---

## Next Milestone (M2 preview, not in this plan)

M2 (Send to Studio Integration) will:
- Add `POST /api/import-tokens` and `GET /api/import-tokens/:t` API
- Enable the "Send to Image-Studio" CTA on detail page
- Add browser-side scheme detection + "App not installed" fallback modal
- Add `POST /api/translate` proxy (groundwork for AI translation; functional in M6)

A separate plan file will be written when M1 ships.







