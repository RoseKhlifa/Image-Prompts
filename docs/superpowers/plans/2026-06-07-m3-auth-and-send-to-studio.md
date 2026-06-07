# M3 Implementation Plan: Auth + Send to Studio

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land Google + GitHub OAuth (via `@auth/core` + `@hono/auth-js`), gate the existing M1 `PromptDetailPage` "Send to Image-Studio" placeholder behind login, and ship the full `image-studio://import?token=...` handshake (POST + GET endpoints, CAS + send_count, in-browser fallback modal with GitHub releases link and clipboard copy).

**Architecture:** Auth.js core + Hono adapter for OAuth + DB sessions persisted via `@auth/drizzle-adapter`. The M1 auth schema (`users` / `accounts` / `sessions` / `verification_tokens`) needs **first-time calibration** to match the adapter shape before adapter init can succeed. Token flow uses transactional CAS (`SELECT FOR UPDATE` → `UPDATE ... WHERE used=FALSE`) co-located with `prompts.send_count` increment in the same Drizzle transaction. Rate limiting is in-memory LRU keyed by `userId || ip`.

**Tech Stack:**
- Backend additions: `@auth/core@^0.37`, `@hono/auth-js@^1`, `@auth/drizzle-adapter@^1`
- Existing M1 stack (no change): Hono, Drizzle, Zod, PostgreSQL, Vitest
- Frontend additions: TanStack Query (already installed) for session caching, lightweight Zustand-based toast (no library)
- No new test infrastructure beyond M1's CI postgres service

**Spec reference:** `docs/superpowers/specs/2026-06-07-m3-auth-and-send-to-studio-design.md`

---

## File Structure (Created / Modified)

### Backend (`apps/api/`)

```
src/
├── auth/
│   ├── index.ts                          # NEW: authConfig (Auth.js init for Hono)
│   └── test-session.ts                   # NEW: test helper to inject a valid session
├── db/
│   ├── schema/
│   │   ├── auth.ts                       # MODIFY: align with @auth/drizzle-adapter v1
│   │   └── system.ts                     # MODIFY: import_tokens.user_id NOT NULL
│   └── ...
├── env.ts                                # MODIFY: add GOOGLE_*, GITHUB_*, AUTH_URL
├── server.ts                             # MODIFY: mount authConfig + authHandler + credentialed CORS
├── lib/
│   └── rate-limit.ts                     # NEW: in-memory LRU rate limiter
├── repositories/
│   ├── import-tokens.ts                  # NEW: createImportToken, consumeImportToken
│   └── import-tokens.test.ts             # NEW: unit tests (CAS, expiry, send_count)
└── routes/
    ├── import-tokens.ts                  # NEW: POST + GET handlers
    └── import-tokens.test.ts             # NEW: integration tests
drizzle/                                  # auto-generated migrations land here
.env.example                              # MODIFY: document new env vars
```

### Shared (`packages/shared/`)

```
src/
├── schemas/
│   └── api.ts                            # MODIFY: add import-tokens request/response schemas
└── types/
    └── domain.ts                         # MODIFY: add Session, ImportTokenPayload types
```

### Frontend (`apps/web/`)

```
src/
├── hooks/                                # NEW directory
│   └── useSession.ts                     # NEW: TanStack Query wrapper around GET /api/auth/session
├── components/
│   ├── auth/                             # NEW directory
│   │   ├── SignInButton.tsx              # NEW: header button when guest
│   │   ├── SignInModal.tsx               # NEW: Google/GitHub provider picker
│   │   └── ProfileMenu.tsx               # NEW: avatar + dropdown when logged in
│   ├── modals/                           # NEW directory
│   │   ├── Modal.tsx                     # NEW: shared headless modal primitive
│   │   ├── StudioNotInstalledModal.tsx   # NEW: 1500ms fallback dialog
│   │   └── StudioNotInstalledModal.test.tsx
│   ├── PromptDetail/
│   │   ├── SendToStudioButton.tsx        # NEW: 6-state button component
│   │   └── SendToStudioButton.test.tsx
│   └── layout/
│       └── AppShell.tsx                  # MODIFY: replace right-side controls with auth area
├── pages/
│   ├── PromptDetailPage.tsx              # MODIFY: replace disabled placeholder
│   └── ProfilePage.tsx                   # NEW: minimal profile (avatar + email + sign out)
├── routes/
│   └── index.tsx                         # MODIFY: register /:locale/profile route
├── lib/
│   └── toast.ts                          # NEW: lightweight Zustand-backed toast
└── i18n/locales/
    ├── zh.json                           # MODIFY: add auth/studio_modal keys, fix detail keys
    └── en.json                           # MODIFY: same
```

### Docs / CI

```
README.md                                 # MODIFY: add "OAuth dev setup" section
.github/workflows/ci.yml                  # MODIFY: add AUTH_SECRET to env (test-only fixed value)
.env.example                              # MODIFY (or create)
```

---

## Task Dependency Order

Tasks are intentionally serial — `subagent-driven-development` dispatches one at a time. Most depend on the previous task's commit being on the branch.

```
Task 1 (worktree + deps)
  ↓
Task 2 (Auth.js schema calibration + migration)
  ↓
Task 3 (import_tokens.user_id + migration)
  ↓
Task 4 (env vars + .env.example + CI secret + README)
  ↓
Task 5 (authConfig module)
  ↓
Task 6 (server.ts middleware wiring)
  ↓
Task 7 (shared schemas for import-tokens)
  ↓
Task 8 (import-tokens repository + unit tests)
  ↓
Task 9 (rate limit helper)
  ↓
Task 10 (POST /api/import-tokens + integration test)
  ↓
Task 11 (GET /api/import-tokens/:token + integration test)
  ↓
Task 12 (i18n keys: zh + en)
  ↓
Task 13 (useSession hook)
  ↓
Task 14 (Toast helper + Modal primitive)
  ↓
Task 15 (SignInButton + SignInModal)
  ↓
Task 16 (ProfileMenu)
  ↓
Task 17 (ProfilePage + /profile route)
  ↓
Task 18 (AppShell auth area integration)
  ↓
Task 19 (SendToStudioButton + tests)
  ↓
Task 20 (StudioNotInstalledModal + tests)
  ↓
Task 21 (PromptDetailPage wiring)
  ↓
Task 22 (manual test pass + final review)
```

---

### Task 1: Worktree setup + Auth.js dependency install

**Files:**
- Modify: `apps/api/package.json`
- Modify: `pnpm-lock.yaml` (auto)

- [ ] **Step 1: Create isolated worktree**

From the main repo root (`/d/Image-Prompts`), run:

```bash
git fetch origin
git worktree add .worktrees/m3-auth-and-send-to-studio -b feat/m3-auth-and-send-to-studio main
cd .worktrees/m3-auth-and-send-to-studio
```

Expected output: `Preparing worktree (new branch 'feat/m3-auth-and-send-to-studio')`.

**Why a manual worktree (not `EnterWorktree`)**: M1 retrospective showed `EnterWorktree` failing in this repo on Windows. Stick with `git worktree add`.

- [ ] **Step 2: Verify clean baseline tests pass**

```bash
pnpm install
pnpm test
```

Expected: 41 tests passing (17 shared + 7 api + 17 web).

If any test fails before we touch code: stop and surface to user — something is wrong with main.

- [ ] **Step 3: Add Auth.js dependencies to `apps/api/package.json`**

Open `apps/api/package.json`. In `"dependencies"` add (alphabetized with existing entries):

```jsonc
{
  "dependencies": {
    "@auth/core": "^0.37.4",
    "@auth/drizzle-adapter": "^1.7.4",
    "@hono/auth-js": "^1.0.18",
    // ... existing dependencies
  }
}
```

Exact versions to use (pinned for reproducibility): `@auth/core@^0.37.4`, `@auth/drizzle-adapter@^1.7.4`, `@hono/auth-js@^1.0.18`. If pnpm reports newer compatible versions, accept them — the `^` allows minor updates.

- [ ] **Step 4: Install**

```bash
pnpm install
```

Expected: completes without `ERR_PNPM_*`. New entries appear in `pnpm-lock.yaml`.

- [ ] **Step 5: Verify imports resolve**

```bash
pnpm --filter @ip/api exec tsc --noEmit
```

Expected: no errors (we haven't written code that uses these yet, so it should just typecheck the existing M1 code with the dep tree expanded).

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml
git commit -m "chore(api): add Auth.js dependencies for M3"
```

---

### Task 2: Auth.js Drizzle schema calibration + migration

**Background:** `@auth/drizzle-adapter` v1 expects a specific column shape per its standard adapter contract. M1's `apps/api/src/db/schema/auth.ts` was hand-rolled for the M1 spec without consulting the adapter, so several columns diverge:

| Table | M1 shape | Adapter shape | Action |
|---|---|---|---|
| `users.avatar_url` | text | `image` text | Rename column |
| `users` | (no `email_verified`) | `email_verified` timestamptz nullable | Add column |
| `accounts` | id PK + provider/providerUid/accessToken/refreshToken/expiresAt(ts) | composite PK (provider, providerAccountId), 11 columns incl. `type`, `id_token`, `scope`, `session_state`, `expires_at` as **integer** (unix epoch) | Drop + recreate |
| `sessions` | id PK + sessionToken + expiresAt | sessionToken PK + expires (no id) | Drop + recreate |
| `verification_tokens` | identifier + token + expiresAt | identifier + token + expires | Rename column |

Since M1 has no user data yet (only seed `prompts` with `contributor_id = null`), the destructive ALTER is safe.

**Files:**
- Modify: `apps/api/src/db/schema/auth.ts`
- Create: `apps/api/drizzle/<timestamp>_m3_auth_schema_calibration.sql` (auto-generated)
- Verify: `apps/api/drizzle/meta/_journal.json` updated

- [ ] **Step 1: Replace `apps/api/src/db/schema/auth.ts` with the calibrated shape**

```ts
import {
  pgTable,
  pgEnum,
  uuid,
  text,
  timestamp,
  integer,
  primaryKey,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["user", "moderator", "admin"]);

/**
 * users table — extended with app-specific columns (role, locale, community
 * guidelines, daily submission counters). Auth.js DrizzleAdapter only requires
 * id / email / emailVerified / name / image; extra columns are ignored on
 * upsert.
 */
export const users = pgTable("users", {
  id: uuid().primaryKey().defaultRandom(),
  email: text().notNull().unique(),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  name: text(),
  image: text(),
  role: userRoleEnum().notNull().default("user"),
  locale: text().notNull().default("zh"),
  communityGuidelinesVersion: integer("community_guidelines_version").notNull().default(0),
  dailySubmissionCount: integer("daily_submission_count").notNull().default(0),
  dailySubmissionResetAt: timestamp("daily_submission_reset_at", { withTimezone: true }),
  rejectedCount: integer("rejected_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * accounts table — Auth.js DrizzleAdapter shape. Composite PK on
 * (provider, providerAccountId). `expires_at` is unix epoch seconds (Auth.js
 * convention), not a timestamp.
 */
export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text().notNull(), // "oauth" | "oidc" | "email"
    provider: text().notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refreshToken: text("refresh_token"),
    accessToken: text("access_token"),
    expiresAt: integer("expires_at"),
    tokenType: text("token_type"),
    scope: text(),
    idToken: text("id_token"),
    sessionState: text("session_state"),
  },
  (t) => ({
    pk: primaryKey({
      name: "accounts_pkey",
      columns: [t.provider, t.providerAccountId],
    }),
  }),
);

/**
 * sessions table — Auth.js DrizzleAdapter shape: sessionToken as PK, plain
 * `expires` (not `expires_at`).
 */
export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp({ withTimezone: true }).notNull(),
});

/**
 * verification_tokens table — Auth.js shape. Kept for adapter completeness
 * even though we don't expose email login.
 */
export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text().notNull(),
    token: text().notNull().unique(),
    expires: timestamp({ withTimezone: true }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ name: "verification_tokens_pkey", columns: [t.identifier, t.token] }),
  }),
);
```

Diff highlights:
- `users.avatarUrl` → `users.image`
- `users` gains `emailVerified`
- `accounts` completely replaced: dropped `id`, added `type/providerAccountId/tokenType/scope/idToken/sessionState`, switched `expiresAt` to `integer`, added composite PK
- `sessions` dropped `id`, `expiresAt` → `expires`
- `verificationTokens.expiresAt` → `expires`

- [ ] **Step 2: Check whether any code references the renamed columns**

```bash
cd /d/Image-Prompts/.worktrees/m3-auth-and-send-to-studio
grep -r "avatarUrl\|avatar_url" apps/ packages/ --include="*.ts" --include="*.tsx"
```

If any matches outside of `apps/api/src/db/schema/auth.ts`, update them to use `image`. Expected in M1: zero matches outside the schema file (no UI consumes user.avatar_url yet).

- [ ] **Step 3: Generate the migration**

```bash
cd apps/api
pnpm db:generate
```

Expected output:
```
[i] 1 schema file: src/db/schema/index.ts
[+] new migration: drizzle/<timestamp>_<slug>.sql
```

Open the generated SQL and verify it contains roughly:
- `ALTER TABLE "users" RENAME COLUMN "avatar_url" TO "image";`
- `ALTER TABLE "users" ADD COLUMN "email_verified" timestamp with time zone;`
- `DROP TABLE "accounts" CASCADE;` (or equivalent) followed by `CREATE TABLE "accounts" (...)` with composite PK
- `DROP TABLE "sessions" CASCADE;` (or equivalent) followed by `CREATE TABLE "sessions" (...)` with `session_token` PK
- `ALTER TABLE "verification_tokens" RENAME COLUMN "expires_at" TO "expires";`

If drizzle-kit asks an interactive question about whether something is a rename or a drop+add, **choose rename for `avatar_url → image`** and **drop+create for accounts/sessions** (they're fundamentally different shapes).

- [ ] **Step 4: Apply the migration to the local dev DB**

```bash
pnpm db:migrate
```

Expected: completes silently or prints the migration ID.

- [ ] **Step 5: Verify the DB schema with a quick psql probe**

```bash
psql "$DATABASE_URL" -c '\d users'
psql "$DATABASE_URL" -c '\d accounts'
psql "$DATABASE_URL" -c '\d sessions'
psql "$DATABASE_URL" -c '\d verification_tokens'
```

Confirm:
- `users` has `image` (not `avatar_url`) and `email_verified`
- `accounts` PK is `(provider, provider_account_id)` and `expires_at` is integer
- `sessions` PK is `session_token` and column is `expires` (not `expires_at`)
- `verification_tokens.expires` exists

- [ ] **Step 6: Re-run the test suite**

```bash
cd /d/Image-Prompts/.worktrees/m3-auth-and-send-to-studio
pnpm test
```

Expected: all 41 tests still pass (M1 tests don't touch the renamed columns).

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/db/schema/auth.ts apps/api/drizzle/
git commit -m "feat(api): calibrate Auth.js Drizzle schema for adapter v1"
```

---

### Task 3: `import_tokens.user_id` NOT NULL + migration

**Files:**
- Modify: `apps/api/src/db/schema/system.ts:17-32`
- Create: `apps/api/drizzle/<timestamp>_import_tokens_user_id.sql` (auto)

- [ ] **Step 1: Add `userId` to importTokens schema**

Open `apps/api/src/db/schema/system.ts` and modify the `importTokens` table:

```ts
import { pgTable, pgEnum, uuid, text, jsonb, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./auth.ts";
import { prompts } from "./prompts.ts";

// ... (other enums unchanged)

export const importTokens = pgTable(
  "import_tokens",
  {
    token: text().primaryKey(),
    payload: jsonb().notNull(),
    promptId: uuid("prompt_id").references(() => prompts.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    used: boolean().notNull().default(false),
    usedAt: timestamp("used_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    createdIp: text("created_ip"),
  },
  (t) => ({
    expiresIdx: index("import_tokens_expires_idx").on(t.expiresAt),
    userIdx: index("import_tokens_user_idx").on(t.userId, t.createdAt.desc()),
  }),
);
```

(Other tables in this file — `auditLog`, `reports`, `announcements`, `siteSettings` — stay unchanged.)

- [ ] **Step 2: Generate migration**

```bash
cd apps/api
pnpm db:generate
```

Verify the generated SQL contains:
```sql
ALTER TABLE "import_tokens" ADD COLUMN "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE;
CREATE INDEX "import_tokens_user_idx" ON "import_tokens" ("user_id", "created_at" DESC);
```

(Note: import_tokens is empty in M1 — no need for backfill.)

- [ ] **Step 3: Apply migration**

```bash
pnpm db:migrate
```

- [ ] **Step 4: Verify with psql**

```bash
psql "$DATABASE_URL" -c '\d import_tokens'
```

Confirm `user_id` is `uuid NOT NULL` with FK to `users(id)`, and the new index exists.

- [ ] **Step 5: Re-run tests**

```bash
cd /d/Image-Prompts/.worktrees/m3-auth-and-send-to-studio
pnpm test
```

Expected: all 41 tests pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/schema/system.ts apps/api/drizzle/
git commit -m "feat(api): bind import_tokens to user_id (M3 auth gating)"
```

---

### Task 4: Env vars + `.env.example` + CI secret + README OAuth setup

**Files:**
- Modify: `apps/api/src/env.ts`
- Modify or Create: `apps/api/.env.example`
- Modify: `.github/workflows/ci.yml`
- Modify: `README.md` (or `apps/api/README.md` if exists — check first)

- [ ] **Step 1: Check whether `.env.example` and README exist**

```bash
ls apps/api/.env.example README.md apps/api/README.md 2>&1
```

If `apps/api/.env.example` doesn't exist, create it; if it does, modify it. Same for README — modify the root `README.md`.

- [ ] **Step 2: Extend `apps/api/src/env.ts` with OAuth vars (all optional except AUTH_SECRET which already exists)**

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
  // ★ M3: OAuth provider credentials. Optional so dev/CI can boot without
  // them; the auth/index.ts module filters out any provider whose creds are
  // missing and logs a warning.
  AUTH_URL: z.string().url().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
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

- [ ] **Step 3: Create / extend `apps/api/.env.example`**

```bash
# .env.example — copy to .env and fill in. Do NOT commit .env.

# --- Server ---
NODE_ENV=development
PORT=3000
HOST=127.0.0.1
SITE_URL=http://localhost:5173
API_URL=http://localhost:3000
LOG_LEVEL=debug

# --- Database ---
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/image_prompts

# --- Auth.js ---
# Generate with: openssl rand -base64 32
AUTH_SECRET=replace-with-32-byte-base64
AUTH_URL=http://localhost:3000

# --- Google OAuth (https://console.cloud.google.com/apis/credentials) ---
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# --- GitHub OAuth (https://github.com/settings/developers) ---
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# --- R2 (M4) — placeholder hex string, real value in M4 ---
R2_ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000
```

- [ ] **Step 4: Update `.github/workflows/ci.yml` to add `AUTH_SECRET` for integration job**

Read existing `.github/workflows/ci.yml` and find the `api-integration` job's `env:` block. Add:

```yaml
      AUTH_SECRET: test-only-fixed-secret-32-bytes-long-base64-encoded-placeholder
      AUTH_URL: http://localhost:3000
```

(Both are test-fixed values — they let `env.ts` parse successfully and let Auth.js boot. Real OAuth not exercised in CI.)

Also add to the `lint-typecheck-unit` job if it runs tsc that depends on env (typecheck doesn't actually parse env, but check anyway).

If R2_ENCRYPTION_KEY isn't already in CI env, add it too (a 64-char fixed test hex): `R2_ENCRYPTION_KEY: '0000000000000000000000000000000000000000000000000000000000000000'`.

- [ ] **Step 5: Add OAuth dev setup section to root `README.md`**

Append (or insert in a sensible place):

```markdown
## OAuth dev setup (M3+)

Auth.js needs Google + GitHub OAuth credentials to enable sign-in locally.

### Google
1. https://console.cloud.google.com → APIs & Services → Credentials → Create OAuth Client ID
2. Application type: **Web application**
3. Authorized redirect URI: `http://localhost:3000/api/auth/callback/google`
4. Copy Client ID + Secret into `apps/api/.env`

### GitHub
1. https://github.com/settings/developers → OAuth Apps → New OAuth App
2. Homepage URL: `http://localhost:5173`
3. Authorization callback URL: `http://localhost:3000/api/auth/callback/github`
4. Copy Client ID + Secret into `apps/api/.env`

### AUTH_SECRET
```bash
openssl rand -base64 32  # paste output as AUTH_SECRET in .env
```

If either provider's creds are blank, the API still boots — that provider is simply
filtered out at runtime (a `[auth] provider <name> disabled: missing creds` warning
appears in the log).
```

- [ ] **Step 6: Verify env parsing still passes**

```bash
pnpm --filter @ip/api exec tsc --noEmit
# Then attempt to read the API entry:
pnpm --filter @ip/api dev &
sleep 3
kill %1
```

Expected: API starts without env errors. If `AUTH_SECRET` is short in `.env`, the existing min(32) check throws — confirm `.env` has a valid 32+ char secret.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/env.ts apps/api/.env.example .github/workflows/ci.yml README.md
git commit -m "chore(api): add OAuth env vars + dev setup docs + CI secret"
```

---

### Task 5: `authConfig` module

**Files:**
- Create: `apps/api/src/auth/index.ts`

- [ ] **Step 1: Create `apps/api/src/auth/index.ts`**

```ts
import { initAuthConfig } from "@hono/auth-js";
import Google from "@auth/core/providers/google";
import GitHub from "@auth/core/providers/github";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db } from "../db/client.ts";
import { accounts, sessions, users, verificationTokens } from "../db/schema/auth.ts";
import { env } from "../env.ts";

type AuthProvider = ReturnType<typeof Google> | ReturnType<typeof GitHub>;

function enabledProviders(): AuthProvider[] {
  const out: AuthProvider[] = [];
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    out.push(
      Google({
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      }),
    );
  } else {
    console.warn("[auth] provider google disabled: missing creds");
  }
  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    out.push(
      GitHub({
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
      }),
    );
  } else {
    console.warn("[auth] provider github disabled: missing creds");
  }
  return out;
}

export const authConfig = initAuthConfig(() => ({
  secret: env.AUTH_SECRET,
  // Pass explicit table refs to the Drizzle adapter so it doesn't try to
  // discover tables by name.
  adapter: DrizzleAdapter(db, {
    usersTable: users,
    accountsTable: accounts,
    sessionsTable: sessions,
    verificationTokensTable: verificationTokens,
  }),
  session: { strategy: "database" },
  providers: enabledProviders(),
  callbacks: {
    async session({ session, user }) {
      // Expose the user id and role on the session object so the frontend
      // and downstream Hono handlers can read them.
      if (session.user) {
        session.user.id = user.id;
        (session.user as { role?: string }).role =
          (user as { role?: string }).role ?? "user";
      }
      return session;
    },
  },
  trustHost: true,
}));
```

Notes:
- `trustHost: true` — required when behind a reverse proxy (production Nginx) and harmless in dev. Without it Auth.js may reject the host.
- The `session` callback writes `user.id` and `user.role` into the session — these aren't on the default `session.user` shape.
- Providers are filtered at boot via `enabledProviders()` so the API boots even when creds are missing (CI / fresh dev clone).

- [ ] **Step 2: TypeScript sanity check**

```bash
pnpm --filter @ip/api exec tsc --noEmit
```

Expected: no errors. If there's a "Property 'role' does not exist on type 'AdapterUser'" error, that's fine since we cast — the `(user as { role?: string })` handles it.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/auth/index.ts
git commit -m "feat(api): Auth.js config with Google + GitHub OAuth"
```

---

### Task 6: `server.ts` middleware wiring (authConfig + authHandler + credentialed CORS)

**Files:**
- Modify: `apps/api/src/server.ts`

- [ ] **Step 1: Wire auth middleware into `createServer()`**

Replace the entire body of `apps/api/src/server.ts` with:

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { authHandler } from "@hono/auth-js";
import { authConfig } from "./auth/index.ts";
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
      credentials: true, // ★ M3: required for Auth.js session cookies
      allowHeaders: ["Content-Type", "Authorization", "X-Locale"],
      allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  // ★ M3: Auth.js middleware. Order:
  //   1. authConfig must run before authHandler — it injects c.var.authUser.
  //   2. authHandler claims everything under /api/auth/*.
  //   3. Route handlers below can read c.get("authUser") to check session.
  app.use("*", authConfig);
  app.use("/api/auth/*", authHandler());

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

Changes from M1:
- Added `credentials: true` to CORS (sends cookies cross-origin in dev where api:3000 and web:5173 differ)
- Imported `authHandler` from `@hono/auth-js`
- Imported `authConfig` from `./auth/index.ts`
- Mounted `authConfig` and `authHandler()` between secure headers/cors and the route handlers

- [ ] **Step 2: Verify TypeScript**

```bash
pnpm --filter @ip/api exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Verify the API boots and `/api/auth/session` responds**

```bash
pnpm --filter @ip/api dev &
sleep 4
curl -s http://localhost:3000/api/auth/session
kill %1
```

Expected: returns `null` (since we haven't logged in). Status 200.

If the API doesn't boot, check that `AUTH_SECRET` is set in `.env`.

- [ ] **Step 4: Verify existing tests still pass**

```bash
pnpm test
```

Expected: all 41 tests pass. M1 health/prompts tests don't exercise auth so they're unaffected.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/server.ts
git commit -m "feat(api): mount Auth.js middleware (authConfig + authHandler)"
```

---

### Task 7: Shared schemas for import-tokens

**Files:**
- Modify: `packages/shared/src/schemas/api.ts`
- Modify: `packages/shared/src/types/domain.ts`
- Modify: `packages/shared/src/schemas/index.ts` (re-export if needed)
- Test: `packages/shared/src/schemas/import-tokens.test.ts` (NEW, colocated next to common.ts existing patterns)

- [ ] **Step 1: Read existing `packages/shared/src/schemas/api.ts` to understand structure**

```bash
cat packages/shared/src/schemas/api.ts
```

Existing should contain query/response schemas like `PromptListQuerySchema`. Append new entries in same style.

- [ ] **Step 2: Add import-token schemas to `packages/shared/src/schemas/api.ts`**

Append at the end:

```ts
import { BilingualTextSchema, OptionalBilingualTextSchema, AspectRatioSchema, UuidSchema } from "./common.ts";

/**
 * Payload sent INSIDE an import token. Stored in DB as jsonb; returned as-is
 * to Image-Studio on token redeem.
 */
export const ImportTokenPayloadSchema = z.object({
  prompt: BilingualTextSchema,
  negative_prompt: OptionalBilingualTextSchema.optional(),
  aspect_ratio: AspectRatioSchema.optional(),
});
export type ImportTokenPayload = z.infer<typeof ImportTokenPayloadSchema>;

/**
 * POST /api/import-tokens request body. Same as payload + optional prompt_id
 * for send_count attribution.
 */
export const ImportTokenRequestSchema = ImportTokenPayloadSchema.extend({
  prompt_id: UuidSchema.optional(),
});
export type ImportTokenRequest = z.infer<typeof ImportTokenRequestSchema>;

/**
 * POST /api/import-tokens 201 response.
 */
export const ImportTokenResponseSchema = z.object({
  token: z.string().regex(/^[0-9A-Za-z]{8}$/),
  expires_at: z.string().datetime(),
});
export type ImportTokenResponse = z.infer<typeof ImportTokenResponseSchema>;
```

(Add `import { z } from "zod";` at the top if not already there.)

- [ ] **Step 3: Make sure they're exported from the package barrel**

Check `packages/shared/src/schemas/index.ts` and `packages/shared/src/index.ts`. If they re-export `* from "./api.ts"`, the new schemas are already exposed. If they re-export named, append:

```ts
export {
  ImportTokenPayloadSchema,
  ImportTokenRequestSchema,
  ImportTokenResponseSchema,
} from "./schemas/api.ts";
export type { ImportTokenPayload, ImportTokenRequest, ImportTokenResponse } from "./schemas/api.ts";
```

- [ ] **Step 4: Write a unit test for the schemas**

Create `packages/shared/src/schemas/import-tokens.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  ImportTokenPayloadSchema,
  ImportTokenRequestSchema,
  ImportTokenResponseSchema,
} from "./api.ts";

describe("ImportTokenPayloadSchema", () => {
  it("accepts a Chinese-only prompt", () => {
    const r = ImportTokenPayloadSchema.safeParse({ prompt: { zh: "雨夜街道" } });
    expect(r.success).toBe(true);
  });

  it("accepts an English-only prompt", () => {
    const r = ImportTokenPayloadSchema.safeParse({ prompt: { en: "rainy street" } });
    expect(r.success).toBe(true);
  });

  it("rejects empty prompt", () => {
    const r = ImportTokenPayloadSchema.safeParse({ prompt: { zh: "", en: "" } });
    expect(r.success).toBe(false);
  });

  it("accepts optional negative_prompt and aspect_ratio", () => {
    const r = ImportTokenPayloadSchema.safeParse({
      prompt: { en: "x" },
      negative_prompt: { en: "blurry" },
      aspect_ratio: "16:9",
    });
    expect(r.success).toBe(true);
  });

  it("rejects invalid aspect_ratio", () => {
    const r = ImportTokenPayloadSchema.safeParse({
      prompt: { en: "x" },
      aspect_ratio: "5:4",
    });
    expect(r.success).toBe(false);
  });
});

describe("ImportTokenRequestSchema", () => {
  it("accepts optional prompt_id as UUID", () => {
    const r = ImportTokenRequestSchema.safeParse({
      prompt: { en: "x" },
      prompt_id: "550e8400-e29b-41d4-a716-446655440000",
    });
    expect(r.success).toBe(true);
  });

  it("rejects non-UUID prompt_id", () => {
    const r = ImportTokenRequestSchema.safeParse({
      prompt: { en: "x" },
      prompt_id: "not-a-uuid",
    });
    expect(r.success).toBe(false);
  });
});

describe("ImportTokenResponseSchema", () => {
  it("accepts an 8-char base62 token + ISO 8601 expires_at", () => {
    const r = ImportTokenResponseSchema.safeParse({
      token: "Ab3Cd4Ef",
      expires_at: "2026-06-08T00:00:00.000Z",
    });
    expect(r.success).toBe(true);
  });

  it("rejects 7-char token", () => {
    const r = ImportTokenResponseSchema.safeParse({
      token: "Ab3Cd4E",
      expires_at: "2026-06-08T00:00:00.000Z",
    });
    expect(r.success).toBe(false);
  });

  it("rejects token with hyphen", () => {
    const r = ImportTokenResponseSchema.safeParse({
      token: "Ab3-Cd4E",
      expires_at: "2026-06-08T00:00:00.000Z",
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 5: Run shared tests**

```bash
pnpm --filter @ip/shared test
```

Expected: previous 17 tests + new 8 tests = 25 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/
git commit -m "feat(shared): import-token schemas (payload, request, response)"
```

---

### Task 8: `import-tokens` repository + unit tests (TDD)

**Files:**
- Create: `apps/api/src/repositories/import-tokens.ts`
- Create: `apps/api/src/repositories/import-tokens.test.ts`

- [ ] **Step 1: Look at existing repo test pattern to mirror it**

```bash
cat apps/api/src/repositories/prompts.test.ts | head -50
```

(Mirror imports, setup, db cleanup pattern.)

- [ ] **Step 2: Write the first failing test for `createImportToken`**

Create `apps/api/src/repositories/import-tokens.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "../db/client.ts";
import { users } from "../db/schema/auth.ts";
import { importTokens } from "../db/schema/system.ts";
import {
  createImportToken,
  consumeImportToken,
  ConsumeError,
} from "./import-tokens.ts";

const TEST_USER_EMAIL = "test-import-tokens@example.com";

async function ensureTestUser(): Promise<string> {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, TEST_USER_EMAIL));
  if (existing) return existing.id;
  const [inserted] = await db.insert(users).values({
    email: TEST_USER_EMAIL,
    name: "Test User",
  }).returning({ id: users.id });
  return inserted!.id;
}

beforeEach(async () => {
  // Wipe import_tokens between tests so each starts clean
  await db.delete(importTokens);
});

afterAll(async () => {
  await db.delete(importTokens);
  await db.delete(users).where(eq(users.email, TEST_USER_EMAIL));
  await pool.end();
});

describe("createImportToken", () => {
  it("creates a row with 8-char base62 token, 24h expires, and user binding", async () => {
    const userId = await ensureTestUser();
    const result = await createImportToken({
      userId,
      payload: { prompt: { en: "test" } },
      ip: "127.0.0.1",
    });

    expect(result.token).toMatch(/^[0-9A-Za-z]{8}$/);
    expect(result.expiresAt).toBeInstanceOf(Date);

    const expectedExpiry = Date.now() + 24 * 60 * 60 * 1000;
    expect(result.expiresAt.getTime()).toBeGreaterThan(expectedExpiry - 60_000);
    expect(result.expiresAt.getTime()).toBeLessThan(expectedExpiry + 60_000);

    const [row] = await db.select().from(importTokens).where(eq(importTokens.token, result.token));
    expect(row).toBeDefined();
    expect(row!.userId).toBe(userId);
    expect(row!.used).toBe(false);
    expect(row!.createdIp).toBe("127.0.0.1");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
pnpm --filter @ip/api test src/repositories/import-tokens.test.ts
```

Expected: FAIL with "Failed to resolve import './import-tokens.ts'".

- [ ] **Step 4: Implement `createImportToken` to pass the test**

Create `apps/api/src/repositories/import-tokens.ts`:

```ts
import { and, eq, sql } from "drizzle-orm";
import { generateBase62Token } from "@ip/shared";
import { db } from "../db/client.ts";
import { importTokens } from "../db/schema/system.ts";
import { prompts } from "../db/schema/prompts.ts";
import type { ImportTokenPayload } from "@ip/shared";

export const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export type CreateImportTokenInput = {
  userId: string;
  payload: ImportTokenPayload;
  promptId?: string;
  ip?: string;
};

export async function createImportToken(input: CreateImportTokenInput) {
  const token = generateBase62Token(8);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);
  await db.insert(importTokens).values({
    token,
    userId: input.userId,
    payload: input.payload,
    promptId: input.promptId,
    expiresAt,
    createdIp: input.ip,
  });
  return { token, expiresAt };
}

/**
 * Discriminated error type so the route layer can map to specific HTTP codes
 * without parsing free-text messages.
 */
export type ConsumeErrorCode = "token_not_found" | "token_used" | "token_expired";

export class ConsumeError extends Error {
  constructor(public readonly code: ConsumeErrorCode) {
    super(code);
    this.name = "ConsumeError";
  }
}

export async function consumeImportToken(token: string): Promise<ImportTokenPayload> {
  return await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(importTokens)
      .where(eq(importTokens.token, token))
      .for("update");

    if (!row) throw new ConsumeError("token_not_found");
    if (row.used) throw new ConsumeError("token_used");
    if (row.expiresAt < new Date()) throw new ConsumeError("token_expired");

    const updated = await tx
      .update(importTokens)
      .set({ used: true, usedAt: new Date() })
      .where(and(eq(importTokens.token, token), eq(importTokens.used, false)))
      .returning({ token: importTokens.token });

    if (updated.length === 0) throw new ConsumeError("token_used");

    if (row.promptId) {
      await tx
        .update(prompts)
        .set({ sendCount: sql`${prompts.sendCount} + 1` })
        .where(eq(prompts.id, row.promptId));
    }

    return row.payload as ImportTokenPayload;
  });
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm --filter @ip/api test src/repositories/import-tokens.test.ts
```

Expected: PASS.

- [ ] **Step 6: Add tests for `consumeImportToken` happy + error paths**

Append to `import-tokens.test.ts`:

```ts
describe("consumeImportToken", () => {
  it("returns payload on first consume and increments send_count", async () => {
    const userId = await ensureTestUser();

    // Insert a prompt so we have a prompt_id to attribute send_count to
    // (we'll rely on M1 seed; if no prompts exist, skip the send_count check).
    const { prompts: promptsTable } = await import("../db/schema/prompts.ts");
    const [anyPrompt] = await db.select({ id: promptsTable.id, sendCount: promptsTable.sendCount }).from(promptsTable).limit(1);

    const created = await createImportToken({
      userId,
      payload: { prompt: { en: "consume test" } },
      promptId: anyPrompt?.id,
    });

    const payload = await consumeImportToken(created.token);
    expect(payload).toEqual({ prompt: { en: "consume test" } });

    if (anyPrompt) {
      const [after] = await db.select({ sendCount: promptsTable.sendCount }).from(promptsTable).where(eq(promptsTable.id, anyPrompt.id));
      expect(after!.sendCount).toBe(anyPrompt.sendCount + 1);
    }
  });

  it("throws ConsumeError(token_not_found) for unknown token", async () => {
    await expect(consumeImportToken("00000000")).rejects.toMatchObject({
      name: "ConsumeError",
      code: "token_not_found",
    });
  });

  it("throws ConsumeError(token_used) on second consume", async () => {
    const userId = await ensureTestUser();
    const created = await createImportToken({
      userId,
      payload: { prompt: { en: "double-spend test" } },
    });
    await consumeImportToken(created.token);
    await expect(consumeImportToken(created.token)).rejects.toMatchObject({
      name: "ConsumeError",
      code: "token_used",
    });
  });

  it("throws ConsumeError(token_expired) for past expires_at", async () => {
    const userId = await ensureTestUser();
    // Insert directly with past expires_at
    const token = "ZZZ12345";
    await db.insert(importTokens).values({
      token,
      userId,
      payload: { prompt: { en: "expired" } },
      expiresAt: new Date(Date.now() - 1000),
    });
    await expect(consumeImportToken(token)).rejects.toMatchObject({
      name: "ConsumeError",
      code: "token_expired",
    });
  });

  it("CAS prevents double-spend under concurrent consumes", async () => {
    const userId = await ensureTestUser();
    const created = await createImportToken({
      userId,
      payload: { prompt: { en: "concurrency test" } },
    });

    const [r1, r2] = await Promise.allSettled([
      consumeImportToken(created.token),
      consumeImportToken(created.token),
    ]);

    const fulfilled = [r1, r2].filter((r) => r.status === "fulfilled");
    const rejected = [r1, r2].filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({
      name: "ConsumeError",
      code: "token_used",
    });
  });
});
```

- [ ] **Step 7: Run all the new tests**

```bash
pnpm --filter @ip/api test src/repositories/import-tokens.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 8: Run the full test suite to make sure nothing else broke**

```bash
pnpm test
```

Expected: 25 + 7 + 17 + 5 = 54 tests passing (5 new from this task, 8 new from Task 7).

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/repositories/import-tokens.ts apps/api/src/repositories/import-tokens.test.ts
git commit -m "feat(api): import-tokens repository with CAS + send_count"
```

---

### Task 9: Rate limit helper

**Files:**
- Create: `apps/api/src/lib/rate-limit.ts`
- Create: `apps/api/src/lib/rate-limit.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/api/src/lib/rate-limit.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createRateLimiter } from "./rate-limit.ts";

describe("createRateLimiter", () => {
  it("allows up to `limit` requests within window", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000 });
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("a")).toBe(false);
  });

  it("isolates keys", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000 });
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("b")).toBe(true);
    expect(limiter.check("a")).toBe(false);
    expect(limiter.check("b")).toBe(false);
  });

  it("resets after window passes", () => {
    let now = 1_000_000;
    const limiter = createRateLimiter({
      limit: 1,
      windowMs: 60_000,
      now: () => now,
    });
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("a")).toBe(false);
    now += 60_001;
    expect(limiter.check("a")).toBe(true);
  });

  it("evicts LRU when size exceeds maxKeys", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 2 });
    expect(limiter.check("a")).toBe(true);
    expect(limiter.check("b")).toBe(true);
    expect(limiter.check("c")).toBe(true); // evicts "a"
    expect(limiter.check("a")).toBe(true); // counts as fresh — "a" was evicted
  });
});
```

- [ ] **Step 2: Run the test — verify failure**

```bash
pnpm --filter @ip/api test src/lib/rate-limit.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement the rate limiter**

Create `apps/api/src/lib/rate-limit.ts`:

```ts
/**
 * In-memory fixed-window rate limiter.
 *
 * Each key maintains a list of timestamps within `windowMs`. On `check`, old
 * entries are pruned; if the remaining count is < limit, allow + record; else
 * reject.
 *
 * Keys are evicted on LRU when size exceeds `maxKeys` (default 10k).
 * Single-instance only — for multi-instance, swap to Redis.
 */

export type RateLimiterOptions = {
  limit: number;
  windowMs: number;
  maxKeys?: number;
  now?: () => number;
};

export type RateLimiter = {
  check: (key: string) => boolean;
};

export function createRateLimiter(opts: RateLimiterOptions): RateLimiter {
  const limit = opts.limit;
  const windowMs = opts.windowMs;
  const maxKeys = opts.maxKeys ?? 10_000;
  const now = opts.now ?? (() => Date.now());

  // Map insertion order = recency; we exploit Map's insertion-ordered iteration
  // to implement LRU: re-insert a key on access to move it to the tail.
  const buckets = new Map<string, number[]>();

  function evictIfNeeded() {
    while (buckets.size > maxKeys) {
      const oldestKey = buckets.keys().next().value;
      if (oldestKey === undefined) break;
      buckets.delete(oldestKey);
    }
  }

  function check(key: string): boolean {
    const t = now();
    const cutoff = t - windowMs;
    const list = buckets.get(key) ?? [];
    // Remove old entries
    while (list.length > 0 && list[0]! < cutoff) {
      list.shift();
    }
    const allowed = list.length < limit;
    if (allowed) list.push(t);
    // Refresh LRU position: delete + set
    buckets.delete(key);
    buckets.set(key, list);
    evictIfNeeded();
    return allowed;
  }

  return { check };
}
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @ip/api test src/lib/rate-limit.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/rate-limit.ts apps/api/src/lib/rate-limit.test.ts
git commit -m "feat(api): in-memory rate limiter (fixed window + LRU eviction)"
```

---

### Task 10: POST /api/import-tokens route + integration test

**Files:**
- Create: `apps/api/src/auth/test-session.ts`
- Create: `apps/api/src/routes/import-tokens.ts`
- Create: `apps/api/src/routes/import-tokens.test.ts`
- Modify: `apps/api/src/server.ts` (mount new route)

- [ ] **Step 1: Create the test-session helper (used by integration tests to bypass OAuth)**

Create `apps/api/src/auth/test-session.ts`:

```ts
/**
 * Test helper: directly INSERT a sessions row and return the cookie value that
 * @hono/auth-js will accept on subsequent requests.
 *
 * Real OAuth is too expensive to run in unit tests, so we sidestep it: Auth.js
 * looks up the session by cookie value (the `session_token` column), so we can
 * fabricate one.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/client.ts";
import { sessions, users } from "../db/schema/auth.ts";

export type TestSession = {
  userId: string;
  email: string;
  sessionToken: string;
  cookie: string; // ready-to-attach Cookie header value
};

const COOKIE_NAME = "authjs.session-token"; // Auth.js default for HTTP

export async function createTestSession(input?: { email?: string; name?: string }): Promise<TestSession> {
  const email = input?.email ?? `test-${randomUUID()}@example.com`;

  // Upsert user
  let userId: string;
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing) {
    userId = existing.id;
  } else {
    const [inserted] = await db
      .insert(users)
      .values({ email, name: input?.name ?? "Test User" })
      .returning({ id: users.id });
    userId = inserted!.id;
  }

  // Insert session row
  const sessionToken = randomUUID();
  await db.insert(sessions).values({
    sessionToken,
    userId,
    expires: new Date(Date.now() + 60 * 60 * 1000), // 1h
  });

  return {
    userId,
    email,
    sessionToken,
    cookie: `${COOKIE_NAME}=${sessionToken}`,
  };
}

export async function cleanupTestSession(token: string) {
  await db.delete(sessions).where(eq(sessions.sessionToken, token));
}
```

- [ ] **Step 2: Write failing integration test for POST /api/import-tokens**

Create `apps/api/src/routes/import-tokens.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, like } from "drizzle-orm";
import { db, pool } from "../db/client.ts";
import { users, sessions } from "../db/schema/auth.ts";
import { importTokens } from "../db/schema/system.ts";
import { createServer } from "../server.ts";
import { createTestSession } from "../auth/test-session.ts";

const app = createServer();

beforeEach(async () => {
  await db.delete(importTokens);
});

afterAll(async () => {
  await db.delete(importTokens);
  await db.delete(sessions);
  await db.delete(users).where(like(users.email, "test-%@example.com"));
  await pool.end();
});

describe("POST /api/import-tokens", () => {
  it("returns 401 when no session cookie", async () => {
    const res = await app.request("/api/import-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: { en: "hello" } }),
    });
    expect(res.status).toBe(401);
  });

  it("returns 201 + token + expires_at with valid session", async () => {
    const sess = await createTestSession();
    const res = await app.request("/api/import-tokens", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sess.cookie,
      },
      body: JSON.stringify({ prompt: { en: "test prompt" } }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token).toMatch(/^[0-9A-Za-z]{8}$/);
    expect(body.expires_at).toBeDefined();

    // Verify row in DB
    const [row] = await db.select().from(importTokens).where(eq(importTokens.token, body.token));
    expect(row).toBeDefined();
    expect(row!.userId).toBe(sess.userId);
  });

  it("returns 422 when prompt is empty in both languages", async () => {
    const sess = await createTestSession();
    const res = await app.request("/api/import-tokens", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sess.cookie,
      },
      body: JSON.stringify({ prompt: { zh: "", en: "" } }),
    });
    expect(res.status).toBe(400); // ZodError handled by errorHandler → 400 validation_error
  });

  it("returns 413 when payload exceeds 4 KB", async () => {
    const sess = await createTestSession();
    const huge = "x".repeat(5000);
    const res = await app.request("/api/import-tokens", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sess.cookie,
      },
      body: JSON.stringify({ prompt: { en: huge } }),
    });
    expect(res.status).toBe(413);
  });
});
```

- [ ] **Step 3: Run test — verify failure**

```bash
pnpm --filter @ip/api test src/routes/import-tokens.test.ts
```

Expected: FAIL (route doesn't exist, status 404).

- [ ] **Step 4: Implement the route**

Create `apps/api/src/routes/import-tokens.ts`:

```ts
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { bodyLimit } from "hono/body-limit";
import { verifyAuth } from "@hono/auth-js";
import { ImportTokenRequestSchema } from "@ip/shared";
import { zv } from "../lib/validate.ts";
import { createRateLimiter } from "../lib/rate-limit.ts";
import { createImportToken } from "../repositories/import-tokens.ts";

const app = new Hono();

// Per-user limiter (60/min) and per-IP limiter (200/min)
const userLimiter = createRateLimiter({ limit: 60, windowMs: 60_000 });
const ipLimiter = createRateLimiter({ limit: 200, windowMs: 60_000 });

const POST_MAX_BYTES = 4096;

// POST is gated by verifyAuth — GET is registered later without it.
app.post(
  "/",
  verifyAuth(),
  bodyLimit({
    maxSize: POST_MAX_BYTES,
    onError: (c) => c.json({ error: "payload_too_large" }, 413),
  }),
  zv("json", ImportTokenRequestSchema),
  async (c) => {
    const authUser = c.get("authUser");
    if (!authUser?.session?.user?.id) {
      throw new HTTPException(401, { message: "unauthorized" });
    }
    const userId = authUser.session.user.id as string;
    const ip = c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ?? c.req.header("x-real-ip") ?? "unknown";

    if (!userLimiter.check(userId)) {
      throw new HTTPException(429, { message: "rate_limit" });
    }
    if (!ipLimiter.check(ip)) {
      throw new HTTPException(429, { message: "rate_limit" });
    }

    const body = c.req.valid("json");
    const result = await createImportToken({
      userId,
      payload: {
        prompt: body.prompt,
        ...(body.negative_prompt !== undefined ? { negative_prompt: body.negative_prompt } : {}),
        ...(body.aspect_ratio !== undefined ? { aspect_ratio: body.aspect_ratio } : {}),
      },
      promptId: body.prompt_id,
      ip,
    });

    return c.json(
      {
        token: result.token,
        expires_at: result.expiresAt.toISOString(),
      },
      201,
    );
  },
);

export default app;
```

- [ ] **Step 5: Mount in `server.ts`**

Edit `apps/api/src/server.ts` to add the new route:

```ts
import importTokensRoute from "./routes/import-tokens.ts";

// ... in createServer() after existing routes
app.route("/api/import-tokens", importTokensRoute);
```

Insert the line after `app.route("/api/public", publicRoute);` so the import-tokens route is the last one registered.

- [ ] **Step 6: Run integration tests — should pass**

```bash
pnpm --filter @ip/api test src/routes/import-tokens.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 7: Run full test suite**

```bash
pnpm test
```

Expected: 54 + 4 = 58 tests pass.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/auth/test-session.ts apps/api/src/routes/import-tokens.ts apps/api/src/routes/import-tokens.test.ts apps/api/src/server.ts
git commit -m "feat(api): POST /api/import-tokens (gated + rate-limited + 4KB body limit)"
```

---

### Task 11: GET /api/import-tokens/:token + integration test

**Files:**
- Modify: `apps/api/src/routes/import-tokens.ts`
- Modify: `apps/api/src/routes/import-tokens.test.ts`

- [ ] **Step 1: Write failing test for GET**

Append to `apps/api/src/routes/import-tokens.test.ts`:

```ts
describe("GET /api/import-tokens/:token", () => {
  it("returns 200 + payload on first redeem (with UA)", async () => {
    const sess = await createTestSession();
    const postRes = await app.request("/api/import-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sess.cookie },
      body: JSON.stringify({ prompt: { en: "redeem me" } }),
    });
    const { token } = await postRes.json();

    const getRes = await app.request(`/api/import-tokens/${token}`, {
      headers: { Authorization: "Image-Studio/0.1.0" },
    });
    expect(getRes.status).toBe(200);
    const body = await getRes.json();
    expect(body.prompt).toEqual({ en: "redeem me" });
  });

  it("returns 200 even without UA header (soft-check)", async () => {
    const sess = await createTestSession();
    const postRes = await app.request("/api/import-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sess.cookie },
      body: JSON.stringify({ prompt: { en: "no UA" } }),
    });
    const { token } = await postRes.json();

    const getRes = await app.request(`/api/import-tokens/${token}`);
    expect(getRes.status).toBe(200);
  });

  it("returns 410 token_used on second redeem", async () => {
    const sess = await createTestSession();
    const postRes = await app.request("/api/import-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sess.cookie },
      body: JSON.stringify({ prompt: { en: "second redeem" } }),
    });
    const { token } = await postRes.json();

    await app.request(`/api/import-tokens/${token}`); // first redeem
    const second = await app.request(`/api/import-tokens/${token}`);
    expect(second.status).toBe(410);
    const body = await second.json();
    expect(body.error).toBe("token_used");
  });

  it("returns 410 token_expired for past expires_at", async () => {
    const sess = await createTestSession();
    const expiredToken = "ZZ888777";
    await db.insert(importTokens).values({
      token: expiredToken,
      userId: sess.userId,
      payload: { prompt: { en: "expired" } },
      expiresAt: new Date(Date.now() - 1000),
    });
    const res = await app.request(`/api/import-tokens/${expiredToken}`);
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toBe("token_expired");
  });

  it("returns 404 token_not_found for unknown token", async () => {
    const res = await app.request(`/api/import-tokens/00000000`);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("token_not_found");
  });
});
```

- [ ] **Step 2: Run test — verify failure**

```bash
pnpm --filter @ip/api test src/routes/import-tokens.test.ts -t "GET /api/import-tokens"
```

Expected: FAIL (route returns 404 from Hono notFound).

- [ ] **Step 3: Add GET handler to `apps/api/src/routes/import-tokens.ts`**

Append before `export default app;`:

```ts
app.get("/:token", async (c) => {
  const token = c.req.param("token");
  if (!/^[0-9A-Za-z]{8}$/.test(token)) {
    throw new HTTPException(404, { message: "token_not_found" });
  }

  const ua = c.req.header("user-agent") ?? "";
  if (!ua.includes("Image-Studio/")) {
    // Soft check: log but don't reject.
    console.warn(
      `[import-tokens] non-Image-Studio UA: "${ua.slice(0, 80)}" token=${token.slice(0, 3)}***`,
    );
  }

  try {
    const payload = await consumeImportToken(token);
    return c.json(payload, 200);
  } catch (e) {
    if (e instanceof ConsumeError) {
      const status = e.code === "token_not_found" ? 404 : 410;
      return c.json({ error: e.code }, status);
    }
    throw e;
  }
});
```

Also add to the imports at the top:

```ts
import { consumeImportToken, ConsumeError } from "../repositories/import-tokens.ts";
```

- [ ] **Step 4: Run tests — should pass**

```bash
pnpm --filter @ip/api test src/routes/import-tokens.test.ts
```

Expected: 9 tests pass (4 from Task 10 + 5 new).

- [ ] **Step 5: Manual smoke**

```bash
pnpm --filter @ip/api dev &
sleep 4
# without auth
curl -i -X POST http://localhost:3000/api/import-tokens \
  -H "Content-Type: application/json" \
  -d '{"prompt":{"en":"hi"}}'
# expect: HTTP/1.1 401
kill %1
```

- [ ] **Step 6: Full test suite**

```bash
pnpm test
```

Expected: 58 + 5 = 63 tests passing.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/import-tokens.ts apps/api/src/routes/import-tokens.test.ts
git commit -m "feat(api): GET /api/import-tokens/:token (CAS-consume + soft UA check)"
```

---

### Task 12: i18n keys for M3 (zh + en)

**Files:**
- Modify: `apps/web/src/i18n/locales/zh.json`
- Modify: `apps/web/src/i18n/locales/en.json`

- [ ] **Step 1: Read existing en.json to mirror structure**

```bash
cat apps/web/src/i18n/locales/en.json
```

Verify the same shape as zh.json. New keys must appear in both.

- [ ] **Step 2: Update `apps/web/src/i18n/locales/zh.json`**

Replace the existing `"detail"` block (in place) and add new top-level `"auth"` and `"studio_modal"` blocks. The final file:

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
    "error": "出错了",
    "retry": "重试",
    "not_found_title": "找不到此提示词",
    "not_found_body": "可能已删除或未通过审核。",
    "back_home": "返回首页",
    "no_en_version": "暂无英文版,显示中文",
    "no_zh_version": "暂无中文版,显示英文",
    "language": "语言",
    "theme": "主题",
    "all": "全部",
    "anonymous": "匿名"
  },
  "auth": {
    "sign_in": "登录",
    "sign_in_with": "使用 {provider} 登录",
    "sign_out": "退出登录",
    "signin_required": "请先登录",
    "profile": "个人资料",
    "session_expired": "登录已过期,请重新登录",
    "signin_failed": "登录失败,请重试",
    "signin_cancelled": "已取消登录"
  },
  "home": {
    "hero_title": "生图提示词聚合",
    "hero_subtitle": "{formattedCount}+ 条精选提示词 · 一键送到 Image-Studio",
    "start_browsing": "开始浏览 →"
  },
  "list": {
    "sort_latest": "最新",
    "sort_popular": "最热",
    "sort_liked": "最赞",
    "sort_sent": "最多使用",
    "total": "共 {count} 条"
  },
  "detail": {
    "send_to_studio": "Send to Image-Studio",
    "signin_required": "请先登录后使用",
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
    "no_suggestions": "未指定建议参数, 沿用 Image-Studio 默认值",
    "coming_in_m2": "M2 即将上线",
    "rate_limited": "操作过于频繁,请稍后再试",
    "send_failed": "服务暂时不可用,请重试"
  },
  "studio_modal": {
    "title": "未检测到 Image-Studio",
    "body": "Image-Studio 是配套的桌面端生图客户端,请先下载安装即可一键导入提示词。",
    "download": "下载 Image-Studio",
    "copy_prompt": "复制提示词",
    "copied": "已复制",
    "copy_failed": "复制失败,请手动选择",
    "dont_ask_again": "我已经装了,别再问",
    "close": "关闭"
  },
  "profile": {
    "page_title": "个人资料",
    "sign_out_button": "退出登录"
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

Note: `detail.coming_in_m2` is **kept** alongside `detail.signin_required` because M1's three other disabled buttons (Copy/Favorite/More) still use it — Task 21 will leave those buttons untouched.

- [ ] **Step 3: Update `apps/web/src/i18n/locales/en.json` with the parallel English**

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
    "empty": "No content",
    "error": "Something went wrong",
    "retry": "Retry",
    "not_found_title": "Prompt not found",
    "not_found_body": "It may have been removed or hasn't been approved.",
    "back_home": "Back to home",
    "no_en_version": "No English version, showing Chinese",
    "no_zh_version": "No Chinese version, showing English",
    "language": "Language",
    "theme": "Theme",
    "all": "All",
    "anonymous": "Anonymous"
  },
  "auth": {
    "sign_in": "Sign In",
    "sign_in_with": "Sign in with {provider}",
    "sign_out": "Sign Out",
    "signin_required": "Sign in to use this",
    "profile": "Profile",
    "session_expired": "Your session expired — please sign in again",
    "signin_failed": "Sign-in failed, please try again",
    "signin_cancelled": "Sign-in cancelled"
  },
  "home": {
    "hero_title": "AI Image Prompt Library",
    "hero_subtitle": "{formattedCount}+ curated prompts · One click to Image-Studio",
    "start_browsing": "Start Browsing →"
  },
  "list": {
    "sort_latest": "Latest",
    "sort_popular": "Most Viewed",
    "sort_liked": "Most Liked",
    "sort_sent": "Most Used",
    "total": "{count} prompts"
  },
  "detail": {
    "send_to_studio": "Send to Image-Studio",
    "signin_required": "Sign in to use this",
    "copy_prompt": "Copy",
    "favorite": "Favorite",
    "more": "More",
    "prompt": "Prompt",
    "negative_prompt": "Negative Prompt",
    "suggested_params": "Suggested Parameters",
    "aspect_ratio": "Ratio",
    "related": "Related",
    "category": "Category",
    "tags": "Tags",
    "no_suggestions": "No suggested parameters — Image-Studio defaults apply",
    "coming_in_m2": "Coming in M2",
    "rate_limited": "Too many requests, please slow down",
    "send_failed": "Service unavailable, please retry"
  },
  "studio_modal": {
    "title": "Image-Studio not detected",
    "body": "Image-Studio is the companion desktop app. Install it and you can one-click import any prompt.",
    "download": "Download Image-Studio",
    "copy_prompt": "Copy prompt",
    "copied": "Copied",
    "copy_failed": "Copy failed, please select manually",
    "dont_ask_again": "I've installed it, don't ask again",
    "close": "Close"
  },
  "profile": {
    "page_title": "Profile",
    "sign_out_button": "Sign Out"
  },
  "about": {
    "title": "About Image-Prompts",
    "body": "Image-Prompts is the prompt library for Image-Studio. Anyone can browse, favorite, like, and share. Signed-in users can submit new prompts for moderator review.",
    "credits_title": "Data Source Credits",
    "credits_body": "The seed dataset (~2380 prompts) was migrated from unknowlei's open-source nanobanana-website (github.com/unknowlei/nanobanana-website), translated bilingually via AI assistance, and maintained / extended by this site. Original content belongs to the nanobanana community contributors; we attribute per CC-BY-4.0."
  },
  "theme_modes": {
    "light": "Light",
    "dark": "Dark",
    "system": "System"
  }
}
```

- [ ] **Step 4: Verify both files are valid JSON**

```bash
node -e "JSON.parse(require('fs').readFileSync('apps/web/src/i18n/locales/zh.json', 'utf-8'))"
node -e "JSON.parse(require('fs').readFileSync('apps/web/src/i18n/locales/en.json', 'utf-8'))"
```

Expected: both commands exit 0 with no output.

- [ ] **Step 5: Verify nothing broke**

```bash
pnpm test
```

Expected: 63 tests pass. M1 web tests don't snapshot translations so they're unaffected.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/i18n/locales/
git commit -m "feat(web): i18n keys for auth + Studio install modal + profile (zh + en)"
```

---

### Task 13: `useSession` hook

**Files:**
- Create: `apps/web/src/hooks/useSession.ts`

- [ ] **Step 1: Look at existing hook patterns**

```bash
ls apps/web/src/lib/hooks/ 2>&1 || ls apps/web/src/hooks/ 2>&1
cat apps/web/src/lib/hooks/usePromptDetail.ts 2>&1 | head -30
```

(Existing pattern is `apps/web/src/lib/hooks/use*.ts` with TanStack Query `useQuery`.)

**Important decision:** the spec calls for `apps/web/src/hooks/useSession.ts` (new directory), but M1 used `apps/web/src/lib/hooks/`. Stick with **M1's existing convention** to avoid splitting hooks across two directories. Save to `apps/web/src/lib/hooks/useSession.ts`.

- [ ] **Step 2: Create the hook**

Create `apps/web/src/lib/hooks/useSession.ts`:

```ts
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch, ApiError } from "../api";

export type Session = {
  user: {
    id: string;
    name: string | null;
    email: string;
    image: string | null;
    role: "user" | "moderator" | "admin";
  };
  expires: string;
};

const SESSION_QUERY_KEY = ["auth", "session"] as const;

export function useSession() {
  return useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: async (): Promise<Session | null> => {
      try {
        const data = await apiFetch<Session | null>("/api/auth/session");
        // Auth.js returns either the session object or `null` if signed out.
        return data ?? null;
      } catch (e) {
        // Treat 401 as "signed out", any other error rethrows so UI can react
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 60 * 1000, // 1 min — Auth.js sessions don't change that often
    retry: false,
  });
}

export function useInvalidateSession() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
}
```

- [ ] **Step 3: Smoke test — render check**

```bash
pnpm --filter @ip/web exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/hooks/useSession.ts
git commit -m "feat(web): useSession hook (TanStack Query wrapper on /api/auth/session)"
```

---

### Task 14: Toast helper + Modal primitive

**Files:**
- Create: `apps/web/src/lib/toast.ts`
- Create: `apps/web/src/components/Toaster.tsx`
- Create: `apps/web/src/components/modals/Modal.tsx`
- Modify: `apps/web/src/main.tsx` (mount Toaster)

- [ ] **Step 1: Create the toast store + helper**

Create `apps/web/src/lib/toast.ts`:

```ts
import { create } from "zustand";

export type ToastVariant = "info" | "success" | "error";

export type Toast = {
  id: number;
  variant: ToastVariant;
  message: string;
};

type State = {
  toasts: Toast[];
  push: (variant: ToastVariant, message: string) => void;
  dismiss: (id: number) => void;
};

let nextId = 1;
const DEFAULT_TTL_MS = 4000;

export const useToastStore = create<State>((set, get) => ({
  toasts: [],
  push(variant, message) {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, variant, message }] }));
    setTimeout(() => get().dismiss(id), DEFAULT_TTL_MS);
  },
  dismiss(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

export const toast = {
  info: (msg: string) => useToastStore.getState().push("info", msg),
  success: (msg: string) => useToastStore.getState().push("success", msg),
  error: (msg: string) => useToastStore.getState().push("error", msg),
};
```

- [ ] **Step 2: Create the Toaster component**

Create `apps/web/src/components/Toaster.tsx`:

```tsx
import { useToastStore } from "../lib/toast";

const variantStyles: Record<string, string> = {
  info: "bg-panel-2 text-ink border-border-soft",
  success: "bg-accent text-white border-accent",
  error: "bg-red-600 text-white border-red-700",
};

export default function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`pointer-events-auto min-w-[240px] max-w-sm rounded-md border px-4 py-2.5 text-[13px] shadow-lg ${
            variantStyles[t.variant] ?? variantStyles.info
          }`}
          onClick={() => dismiss(t.id)}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Mount Toaster in `main.tsx`**

Read existing `apps/web/src/main.tsx`. After the `<RouterProvider>` (or whatever root element), add `<Toaster />`. The pattern depends on M1's existing root. Typically:

```tsx
import Toaster from "./components/Toaster";
// ...
root.render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppRouter />
      <Toaster />
    </QueryClientProvider>
  </React.StrictMode>,
);
```

If main.tsx renders differently, position `<Toaster />` such that it's a sibling of the router so it overlays regardless of route.

- [ ] **Step 4: Create the Modal primitive**

Create `apps/web/src/components/modals/Modal.tsx`:

```tsx
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  /** Aria label for the close button. */
  closeLabel?: string;
};

export default function Modal({ open, onClose, title, children, closeLabel = "Close" }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-card border border-border-soft bg-panel p-5 shadow-xl">
        {title && (
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-base font-semibold text-ink">{title}</h2>
            <button
              type="button"
              aria-label={closeLabel}
              onClick={onClose}
              className="text-ink-dim hover:text-ink"
            >
              ✕
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 5: TypeScript check**

```bash
pnpm --filter @ip/web exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Boot the dev server, navigate to /, verify nothing visibly broke**

```bash
pnpm --filter @ip/web dev &
sleep 4
curl -s http://localhost:5173/ | head -20
kill %1
```

(Or open a browser if available. Toast isn't triggered yet — just confirming no render errors.)

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/toast.ts apps/web/src/components/Toaster.tsx apps/web/src/components/modals/Modal.tsx apps/web/src/main.tsx
git commit -m "feat(web): toast helper + headless modal primitive"
```

---

### Task 15: SignInButton + SignInModal

**Files:**
- Create: `apps/web/src/components/auth/SignInButton.tsx`
- Create: `apps/web/src/components/auth/SignInModal.tsx`

- [ ] **Step 1: Determine API_URL for auth links**

The auth endpoints live on the API (e.g., `http://localhost:3000/api/auth/signin/google`). The frontend's `VITE_API_URL` env var holds the base. Read existing usage:

```bash
grep -r "VITE_API_URL\|import.meta.env.VITE_API_URL" apps/web/src
```

(M1 already uses `VITE_API_URL` in `apps/web/src/lib/api.ts:3`.)

- [ ] **Step 2: Create SignInButton (with modal open state)**

Create `apps/web/src/components/auth/SignInButton.tsx`:

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LogIn } from "lucide-react";
import SignInModal from "./SignInModal";

export default function SignInButton() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-pill border border-accent bg-transparent px-3 py-1.5 text-xs font-medium text-accent hover:bg-accent-soft"
      >
        <LogIn size={13} aria-hidden />
        {t("auth.sign_in")}
      </button>
      <SignInModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
```

- [ ] **Step 3: Create SignInModal**

Create `apps/web/src/components/auth/SignInModal.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import Modal from "../modals/Modal";

const API_URL = import.meta.env.VITE_API_URL ?? "";

function buildSignInUrl(provider: "google" | "github"): string {
  // Auth.js handles signin via GET (with CSRF in cookie). Plain anchor href works.
  return `${API_URL}/api/auth/signin/${provider}`;
}

export default function SignInModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Modal open={open} onClose={onClose} title={t("auth.sign_in")} closeLabel={t("studio_modal.close")}>
      <div className="space-y-2">
        <a
          href={buildSignInUrl("google")}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-border-soft bg-surface px-4 py-2.5 text-[13px] font-medium text-ink hover:bg-panel-2"
        >
          {t("auth.sign_in_with", { provider: "Google" })}
        </a>
        <a
          href={buildSignInUrl("github")}
          className="flex w-full items-center justify-center gap-2 rounded-md border border-border-soft bg-surface px-4 py-2.5 text-[13px] font-medium text-ink hover:bg-panel-2"
        >
          {t("auth.sign_in_with", { provider: "GitHub" })}
        </a>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 4: TypeScript check**

```bash
pnpm --filter @ip/web exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/auth/SignInButton.tsx apps/web/src/components/auth/SignInModal.tsx
git commit -m "feat(web): SignInButton + provider-picker modal"
```

---

### Task 16: ProfileMenu

**Files:**
- Create: `apps/web/src/components/auth/ProfileMenu.tsx`
- Create: `apps/web/src/components/auth/AvatarBadge.tsx`

- [ ] **Step 1: Create AvatarBadge (used by both ProfileMenu and ProfilePage)**

Create `apps/web/src/components/auth/AvatarBadge.tsx`:

```tsx
type Props = {
  src?: string | null;
  name?: string | null;
  email: string;
  size?: number; // px, default 28
};

function initials(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return "?";
  const at = trimmed.indexOf("@");
  const base = at > 0 ? trimmed.slice(0, at) : trimmed;
  return base.slice(0, 1).toUpperCase();
}

export default function AvatarBadge({ src, name, email, size = 28 }: Props) {
  if (src) {
    return (
      <img
        src={src}
        alt={name ?? email}
        width={size}
        height={size}
        className="rounded-full object-cover"
      />
    );
  }
  const ch = initials(name || email);
  return (
    <div
      style={{ width: size, height: size }}
      className="flex items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-white"
      aria-label={name ?? email}
    >
      {ch}
    </div>
  );
}
```

- [ ] **Step 2: Create ProfileMenu**

Create `apps/web/src/components/auth/ProfileMenu.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { isLocale, type Locale } from "@ip/shared";
import { useParams } from "react-router";
import { withLocale } from "../../lib/locale";
import { useInvalidateSession, type Session } from "../../lib/hooks/useSession";
import { apiFetch } from "../../lib/api";
import { toast } from "../../lib/toast";
import AvatarBadge from "./AvatarBadge";

export default function ProfileMenu({ session }: { session: Session }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const invalidate = useInvalidateSession();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", onClickOutside);
      return () => document.removeEventListener("mousedown", onClickOutside);
    }
    return undefined;
  }, [open]);

  async function handleSignOut() {
    try {
      // Auth.js sign-out is a POST with CSRF; in dev, GET also works via the
      // built-in signin page. To keep it simple we hit the dedicated signout
      // endpoint with credentialed fetch. Auth.js will respond with a redirect
      // body which we ignore since we just want the cookie cleared.
      await apiFetch("/api/auth/signout", { method: "POST" });
    } catch {
      // Even if the request fails we proceed — server cookie clears on next 401
    }
    await invalidate();
    toast.info(t("auth.sign_out"));
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 rounded-pill p-0.5 hover:bg-panel-2"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <AvatarBadge
          src={session.user.image}
          name={session.user.name}
          email={session.user.email}
          size={28}
        />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-60 rounded-card border border-border-soft bg-panel p-2 shadow-lg"
        >
          <div className="flex items-center gap-2 px-2 py-2">
            <AvatarBadge
              src={session.user.image}
              name={session.user.name}
              email={session.user.email}
              size={32}
            />
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium text-ink">
                {session.user.name ?? session.user.email.split("@")[0]}
              </div>
              <div className="truncate text-[11px] text-ink-dim">{session.user.email}</div>
            </div>
          </div>
          <div className="my-1 h-px bg-border-soft" />
          <Link
            to={withLocale(locale, "/profile")}
            onClick={() => setOpen(false)}
            className="block rounded-md px-2 py-1.5 text-[12.5px] text-ink hover:bg-panel-2"
            role="menuitem"
          >
            {t("auth.profile")}
          </Link>
          <button
            type="button"
            onClick={handleSignOut}
            className="block w-full rounded-md px-2 py-1.5 text-left text-[12.5px] text-ink hover:bg-panel-2"
            role="menuitem"
          >
            {t("auth.sign_out")}
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: TypeScript check**

```bash
pnpm --filter @ip/web exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/auth/AvatarBadge.tsx apps/web/src/components/auth/ProfileMenu.tsx
git commit -m "feat(web): ProfileMenu dropdown with avatar + sign-out"
```

---

### Task 17: ProfilePage + `/profile` route

**Files:**
- Create: `apps/web/src/pages/ProfilePage.tsx`
- Modify: `apps/web/src/routes/index.tsx`

- [ ] **Step 1: Create ProfilePage**

Create `apps/web/src/pages/ProfilePage.tsx`:

```tsx
import { useTranslation } from "react-i18next";
import { useNavigate, useParams } from "react-router";
import { useEffect } from "react";
import { isLocale, type Locale } from "@ip/shared";
import AppShell from "../components/layout/AppShell";
import AvatarBadge from "../components/auth/AvatarBadge";
import { useSession, useInvalidateSession } from "../lib/hooks/useSession";
import { apiFetch } from "../lib/api";
import { toast } from "../lib/toast";
import { withLocale } from "../lib/locale";

export default function ProfilePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const session = useSession();
  const invalidate = useInvalidateSession();

  // Redirect guests home.
  useEffect(() => {
    if (!session.isLoading && !session.data) {
      navigate(withLocale(locale, "/"), { replace: true });
    }
  }, [session.isLoading, session.data, navigate, locale]);

  async function handleSignOut() {
    try {
      await apiFetch("/api/auth/signout", { method: "POST" });
    } catch {
      /* ignore */
    }
    await invalidate();
    toast.info(t("auth.sign_out"));
    navigate(withLocale(locale, "/"), { replace: true });
  }

  if (session.isLoading || !session.data) {
    return (
      <AppShell>
        <div className="mx-auto max-w-md px-6 py-12 text-center text-ink-dim">{t("common.loading")}</div>
      </AppShell>
    );
  }

  const u = session.data.user;

  return (
    <AppShell>
      <article className="mx-auto w-full max-w-md px-6 py-12">
        <h1 className="mb-6 text-xl font-semibold tracking-tight">{t("profile.page_title")}</h1>
        <div className="flex flex-col items-center gap-4 rounded-card border border-border-soft bg-panel p-8">
          <AvatarBadge src={u.image} name={u.name} email={u.email} size={72} />
          {u.name && <div className="text-base font-medium">{u.name}</div>}
          <div className="text-[13px] text-ink-muted">{u.email}</div>
          <button
            type="button"
            onClick={handleSignOut}
            className="mt-4 rounded-pill border border-border-soft bg-surface px-5 py-2 text-[13px] font-medium text-ink hover:bg-panel-2"
          >
            {t("profile.sign_out_button")}
          </button>
        </div>
      </article>
    </AppShell>
  );
}
```

- [ ] **Step 2: Register `/profile` route**

Modify `apps/web/src/routes/index.tsx` — add an import and a route entry under `:locale`:

```tsx
import { createBrowserRouter, RouterProvider } from "react-router";
import LocaleRedirect from "./locale-redirect";
import LocaleLayout from "./locale-layout";
import HomePage from "../pages/HomePage";
import PromptListPage from "../pages/PromptListPage";
import PromptDetailPage from "../pages/PromptDetailPage";
import AboutPage from "../pages/AboutPage";
import ProfilePage from "../pages/ProfilePage";
import NotFoundPage from "../pages/NotFoundPage";

export const router = createBrowserRouter([
  { path: "/", element: <LocaleRedirect /> },
  {
    path: "/:locale",
    element: <LocaleLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: "prompts", element: <PromptListPage /> },
      { path: "prompts/:slug", element: <PromptDetailPage /> },
      { path: "categories/:slug", element: <PromptListPage /> },
      { path: "about", element: <AboutPage /> },
      { path: "profile", element: <ProfilePage /> },
      { path: "*", element: <NotFoundPage /> },
    ],
  },
  { path: "*", element: <LocaleRedirect /> },
]);

export default function AppRouter() {
  return <RouterProvider router={router} />;
}
```

- [ ] **Step 3: TypeScript + boot check**

```bash
pnpm --filter @ip/web exec tsc --noEmit
pnpm --filter @ip/web dev &
sleep 4
curl -s http://localhost:5173/zh/profile -o /dev/null -w "%{http_code}\n"
kill %1
```

Expected: 200 (page renders, even as guest the redirect runs client-side).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/ProfilePage.tsx apps/web/src/routes/index.tsx
git commit -m "feat(web): minimal ProfilePage + /:locale/profile route"
```

---

### Task 18: AppShell auth area integration

**Files:**
- Modify: `apps/web/src/components/layout/AppShell.tsx`

- [ ] **Step 1: Update AppShell to render SignInButton or ProfileMenu based on session**

Replace the right-side controls div in `apps/web/src/components/layout/AppShell.tsx`:

```tsx
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { isLocale, type Locale } from "@ip/shared";
import LangSwitcher from "../LangSwitcher";
import ThemeSwitcher from "../ThemeSwitcher";
import SignInButton from "../auth/SignInButton";
import ProfileMenu from "../auth/ProfileMenu";
import { useSession } from "../../lib/hooks/useSession";
import { withLocale } from "../../lib/locale";

export default function AppShell({
  children,
  sidebar,
}: {
  children: ReactNode;
  sidebar?: ReactNode;
}) {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const session = useSession();

  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-ink">
      <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-border-soft bg-panel-2/85 px-5 py-3 backdrop-blur">
        <div className="flex items-center gap-6">
          <Link to={withLocale(locale, "/")} className="text-base font-semibold tracking-tight">
            Image-Prompts
          </Link>
          <nav className="hidden gap-1 text-sm md:flex">
            <Link
              to={withLocale(locale, "/prompts")}
              className="rounded-pill px-3 py-1.5 text-ink-muted hover:text-ink"
            >
              {t("nav.browse")}
            </Link>
            <Link
              to={withLocale(locale, "/about")}
              className="rounded-pill px-3 py-1.5 text-ink-muted hover:text-ink"
            >
              {t("nav.about")}
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="search"
            placeholder={t("common.search_placeholder")}
            className="hidden h-8 w-56 rounded-pill border border-border-soft bg-surface px-3 text-xs text-ink placeholder:text-ink-dim focus:outline-none focus:ring-2 focus:ring-accent-soft md:block"
          />
          <ThemeSwitcher />
          <LangSwitcher />
          {session.isLoading ? (
            <div className="h-7 w-7 animate-pulse rounded-full bg-panel" />
          ) : session.data ? (
            <ProfileMenu session={session.data} />
          ) : (
            <SignInButton />
          )}
        </div>
      </header>
      <div className="flex flex-1">
        {sidebar}
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify dev boot**

```bash
pnpm --filter @ip/web exec tsc --noEmit
pnpm --filter @ip/web dev &
sleep 4
# Visit / in browser if possible; otherwise smoke via curl:
curl -s http://localhost:5173/zh | grep -c "Image-Prompts"
kill %1
```

Expected: 200, page renders, header shows SignInButton when no session cookie.

- [ ] **Step 3: Run web unit tests**

```bash
pnpm --filter @ip/web test --passWithNoTests
```

Expected: existing 17 tests still pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/layout/AppShell.tsx
git commit -m "feat(web): wire SignInButton/ProfileMenu into AppShell header"
```

---

### Task 19: SendToStudioButton + tests

**Files:**
- Create: `apps/web/src/components/PromptDetail/SendToStudioButton.tsx`
- Create: `apps/web/src/components/PromptDetail/SendToStudioButton.test.tsx`

- [ ] **Step 1: Inspect existing test pattern**

```bash
ls apps/web/src/components/PromptDetail/
cat apps/web/src/components/PromptDetail/*.test.tsx 2>&1 | head -40
```

If no `*.test.tsx` exists in `PromptDetail/`, check `apps/web/src` for test setup:

```bash
find apps/web -name "*.test.tsx" -not -path "*/node_modules/*" | head
cat apps/web/vitest.config.ts 2>&1 | head -30
```

(M1 web tests use `@testing-library/react` + jsdom. Mirror that.)

- [ ] **Step 2: Write failing tests**

Create `apps/web/src/components/PromptDetail/SendToStudioButton.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import i18n from "../../i18n";
import SendToStudioButton from "./SendToStudioButton";

// Stub useSession via module-level mock
vi.mock("../../lib/hooks/useSession", () => {
  return {
    useSession: vi.fn(),
  };
});

import { useSession } from "../../lib/hooks/useSession";

function renderButton(props: { detailId?: string; locale?: "zh" | "en" } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={qc}>
          <SendToStudioButton
            promptId={props.detailId ?? "550e8400-e29b-41d4-a716-446655440000"}
            payload={{ prompt: { en: "test prompt" } }}
          />
        </QueryClientProvider>
      </I18nextProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  // Reset any prior location.href stubs
  Object.defineProperty(window, "location", {
    writable: true,
    value: { ...window.location, href: "http://localhost/" },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SendToStudioButton", () => {
  it("shows disabled state with tooltip when guest", () => {
    (useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: null,
      isLoading: false,
    });
    renderButton();
    const btn = screen.getByRole("button", { name: /send to image-studio/i });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title");
  });

  it("is enabled when logged in", () => {
    (useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { user: { id: "u1", email: "x@y", name: null, image: null, role: "user" }, expires: "" },
      isLoading: false,
    });
    renderButton();
    expect(screen.getByRole("button", { name: /send to image-studio/i })).not.toBeDisabled();
  });

  it("calls POST on click and redirects to scheme on success", async () => {
    (useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { user: { id: "u1", email: "x@y", name: null, image: null, role: "user" }, expires: "" },
      isLoading: false,
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ token: "Ab3Cd4Ef", expires_at: new Date().toISOString() }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /send to image-studio/i }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    await waitFor(() => expect(window.location.href).toBe("image-studio://import?token=Ab3Cd4Ef"));
  });

  it("opens fallback modal when page is still visible after 1500ms", async () => {
    (useSession as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      data: { user: { id: "u1", email: "x@y", name: null, image: null, role: "user" }, expires: "" },
      isLoading: false,
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ token: "Ab3Cd4Ef", expires_at: new Date().toISOString() }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    renderButton();
    fireEvent.click(screen.getByRole("button", { name: /send to image-studio/i }));
    await waitFor(() => expect(window.location.href).toContain("image-studio://"));
    vi.advanceTimersByTime(1500);
    await waitFor(() =>
      expect(screen.getByRole("dialog", { name: /image-studio not detected/i })).toBeTruthy(),
    );
  });
});
```

- [ ] **Step 3: Run test — verify failure**

```bash
pnpm --filter @ip/web test src/components/PromptDetail/SendToStudioButton.test.tsx
```

Expected: FAIL (file doesn't exist).

- [ ] **Step 4: Implement the button**

Create `apps/web/src/components/PromptDetail/SendToStudioButton.tsx`:

```tsx
import { useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { Send, Loader2 } from "lucide-react";
import type { ImportTokenPayload, ImportTokenResponse } from "@ip/shared";
import { useSession } from "../../lib/hooks/useSession";
import { apiFetch, ApiError } from "../../lib/api";
import { toast } from "../../lib/toast";
import StudioNotInstalledModal from "../modals/StudioNotInstalledModal";

type Props = {
  promptId: string;
  payload: ImportTokenPayload;
};

type State = "idle" | "creating" | "launching";

const VISIBILITY_CHECK_MS = 1500;

export default function SendToStudioButton({ promptId, payload }: Props) {
  const { t } = useTranslation();
  const session = useSession();
  const [state, setState] = useState<State>("idle");
  const [showFallback, setShowFallback] = useState(false);

  const isGuest = !session.isLoading && !session.data;
  const isBusy = state !== "idle";
  const disabled = session.isLoading || isGuest || isBusy;

  async function handleClick() {
    if (disabled) return;
    setState("creating");
    try {
      const res = await apiFetch<ImportTokenResponse>("/api/import-tokens", {
        method: "POST",
        body: JSON.stringify({
          prompt: payload.prompt,
          ...(payload.negative_prompt ? { negative_prompt: payload.negative_prompt } : {}),
          ...(payload.aspect_ratio ? { aspect_ratio: payload.aspect_ratio } : {}),
          prompt_id: promptId,
        }),
      });
      setState("launching");
      window.location.href = `image-studio://import?token=${res.token}`;
      setTimeout(() => {
        if (document.visibilityState === "visible") setShowFallback(true);
        setState("idle");
      }, VISIBILITY_CHECK_MS);
    } catch (e) {
      setState("idle");
      if (e instanceof ApiError) {
        if (e.status === 401) toast.error(t("auth.session_expired"));
        else if (e.status === 429) toast.error(t("detail.rate_limited"));
        else toast.error(t("detail.send_failed"));
      } else {
        toast.error(t("detail.send_failed"));
      }
    }
  }

  const title = isGuest ? t("auth.signin_required") : undefined;

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        title={title}
        onClick={handleClick}
        className="inline-flex items-center justify-center gap-2 rounded-pill bg-accent px-4 py-2.5 text-[13px] font-medium text-white transition disabled:opacity-50"
        style={{ minWidth: 160 } as CSSProperties}
      >
        {isBusy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Send size={14} aria-hidden />}
        {t("detail.send_to_studio")}
      </button>
      <StudioNotInstalledModal
        open={showFallback}
        onClose={() => setShowFallback(false)}
        prompt={payload.prompt}
      />
    </>
  );
}
```

- [ ] **Step 5: Run tests — they need StudioNotInstalledModal too**

```bash
pnpm --filter @ip/web test src/components/PromptDetail/SendToStudioButton.test.tsx
```

Expected: FAIL because StudioNotInstalledModal doesn't exist yet. That's the next task. **Leave this test as-is for now**; Task 20 will satisfy it.

For now, run just the smoke build to ensure compilation:

```bash
pnpm --filter @ip/web exec tsc --noEmit
```

Expected: error about missing `StudioNotInstalledModal`. Make a temporary stub to unblock TypeScript:

Create `apps/web/src/components/modals/StudioNotInstalledModal.tsx` as a one-line stub (Task 20 fills it in):

```tsx
import type { BilingualText } from "@ip/shared";
export default function StudioNotInstalledModal(_: {
  open: boolean;
  onClose: () => void;
  prompt: BilingualText;
}) {
  return null;
}
```

- [ ] **Step 6: TypeScript check with stub**

```bash
pnpm --filter @ip/web exec tsc --noEmit
```

Expected: clean.

- [ ] **Step 7: Commit (with stub modal)**

```bash
git add apps/web/src/components/PromptDetail/SendToStudioButton.tsx apps/web/src/components/PromptDetail/SendToStudioButton.test.tsx apps/web/src/components/modals/StudioNotInstalledModal.tsx
git commit -m "feat(web): SendToStudioButton state machine (stub modal for next task)"
```

---

### Task 20: StudioNotInstalledModal + tests

**Files:**
- Modify (replace stub): `apps/web/src/components/modals/StudioNotInstalledModal.tsx`
- Create: `apps/web/src/components/modals/StudioNotInstalledModal.test.tsx`

- [ ] **Step 1: Replace the stub with the real component**

Replace `apps/web/src/components/modals/StudioNotInstalledModal.tsx`:

```tsx
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useParams } from "react-router";
import { isLocale, pickBilingual, type Locale, type BilingualText } from "@ip/shared";
import Modal from "./Modal";

const RELEASES_URL = "https://github.com/RoseKhlifa/Image-Studio/releases";
export const SUPPRESS_KEY = "ip:studio_install_suppressed";

type Props = {
  open: boolean;
  onClose: () => void;
  prompt: BilingualText;
};

export default function StudioNotInstalledModal({ open, onClose, prompt }: Props) {
  const { t } = useTranslation();
  const { locale: param } = useParams<{ locale: string }>();
  const locale: Locale = isLocale(param) ? param : "zh";
  const [copied, setCopied] = useState<"idle" | "ok" | "fail">("idle");

  // If the user previously checked "don't ask again," skip rendering entirely.
  // Note: this runs on every render of an open modal — the check is cheap.
  if (open && typeof window !== "undefined" && window.localStorage?.getItem(SUPPRESS_KEY) === "1") {
    // Defer the close to next tick so we don't update state during render.
    queueMicrotask(onClose);
    return null;
  }

  async function handleCopy() {
    const text = pickBilingual(prompt, locale) ?? "";
    try {
      await navigator.clipboard.writeText(text);
      setCopied("ok");
      setTimeout(() => setCopied("idle"), 2000);
    } catch {
      setCopied("fail");
      setTimeout(() => setCopied("idle"), 2000);
    }
  }

  function onSuppressChange(checked: boolean) {
    if (typeof window === "undefined") return;
    if (checked) window.localStorage.setItem(SUPPRESS_KEY, "1");
    else window.localStorage.removeItem(SUPPRESS_KEY);
  }

  return (
    <Modal open={open} onClose={onClose} title={t("studio_modal.title")} closeLabel={t("studio_modal.close")}>
      <p className="text-[13px] leading-relaxed text-ink-muted">{t("studio_modal.body")}</p>
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <a
          href={RELEASES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex flex-1 items-center justify-center rounded-pill bg-accent px-4 py-2 text-[13px] font-medium text-white"
        >
          {t("studio_modal.download")}
        </a>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex flex-1 items-center justify-center rounded-pill border border-border-soft bg-surface px-4 py-2 text-[13px] font-medium text-ink hover:bg-panel-2"
        >
          {copied === "ok"
            ? t("studio_modal.copied")
            : copied === "fail"
              ? t("studio_modal.copy_failed")
              : t("studio_modal.copy_prompt")}
        </button>
      </div>
      <label className="mt-4 flex cursor-pointer items-center gap-2 text-[11.5px] text-ink-dim">
        <input
          type="checkbox"
          onChange={(e) => onSuppressChange(e.currentTarget.checked)}
          className="h-3.5 w-3.5 accent-accent"
        />
        {t("studio_modal.dont_ask_again")}
      </label>
    </Modal>
  );
}
```

- [ ] **Step 2: Write tests**

Create `apps/web/src/components/modals/StudioNotInstalledModal.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router";
import i18n from "../../i18n";
import StudioNotInstalledModal, { SUPPRESS_KEY } from "./StudioNotInstalledModal";

function renderModal(open = true, onClose = vi.fn()) {
  return render(
    <MemoryRouter>
      <I18nextProvider i18n={i18n}>
        <StudioNotInstalledModal open={open} onClose={onClose} prompt={{ en: "test prompt body" }} />
      </I18nextProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("StudioNotInstalledModal", () => {
  it("renders title and body and three actions when open", () => {
    renderModal();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/image-studio not detected/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: /download image-studio/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /copy prompt/i })).toBeTruthy();
  });

  it("calls navigator.clipboard.writeText on copy click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /copy prompt/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("test prompt body"));
  });

  it("immediately closes when SUPPRESS_KEY is set in localStorage", () => {
    window.localStorage.setItem(SUPPRESS_KEY, "1");
    const onClose = vi.fn();
    renderModal(true, onClose);
    return new Promise<void>((resolve) => {
      queueMicrotask(() => {
        expect(onClose).toHaveBeenCalled();
        resolve();
      });
    });
  });

  it("checking 'don't ask again' writes SUPPRESS_KEY to localStorage", () => {
    renderModal();
    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    expect(window.localStorage.getItem(SUPPRESS_KEY)).toBe("1");
  });
});
```

- [ ] **Step 3: Run new modal tests + previously-failing SendToStudioButton tests**

```bash
pnpm --filter @ip/web test src/components/modals/StudioNotInstalledModal.test.tsx src/components/PromptDetail/SendToStudioButton.test.tsx
```

Expected: all tests now pass (modal tests + 4 SendToStudio tests from Task 19).

- [ ] **Step 4: Run all web tests**

```bash
pnpm --filter @ip/web test
```

Expected: 17 (M1) + 4 (SendToStudio) + 4 (Modal) = 25 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/modals/StudioNotInstalledModal.tsx apps/web/src/components/modals/StudioNotInstalledModal.test.tsx
git commit -m "feat(web): StudioNotInstalledModal with download + clipboard + suppress"
```

---

### Task 21: PromptDetailPage wiring

**Files:**
- Modify: `apps/web/src/pages/PromptDetailPage.tsx`

- [ ] **Step 1: Replace the disabled Send placeholder**

Edit `apps/web/src/pages/PromptDetailPage.tsx`. Find lines 99-108 (the existing disabled placeholder) and replace with `<SendToStudioButton>`. Final relevant chunk:

```tsx
// Add to imports:
import SendToStudioButton from "../components/PromptDetail/SendToStudioButton";

// ... in the JSX, replace the disabled placeholder button with:
<SendToStudioButton
  promptId={d.id}
  payload={{
    prompt: d.prompt,
    ...(d.negativePrompt ? { negative_prompt: d.negativePrompt } : {}),
    ...(d.aspectRatio ? { aspect_ratio: d.aspectRatio } : {}),
  }}
/>
```

The three lower buttons (Copy / Favorite / More) **stay disabled** with `t("detail.coming_in_m2")` — M5 will wire them. Don't touch them.

Specifically replace this block:

```tsx
{/* Send to Studio CTA — M2 wires it. M1 button is disabled-but-visible placeholder. */}
<button
  type="button"
  disabled
  title={t("detail.coming_in_m2")}
  className="inline-flex items-center justify-center gap-2 rounded-pill bg-accent px-4 py-2.5 text-[13px] font-medium text-white opacity-60"
>
  <Send size={14} aria-hidden />
  {t("detail.send_to_studio")}
</button>
```

With:

```tsx
{/* Send to Studio CTA — M3 wires it to /api/import-tokens + scheme launch. */}
<SendToStudioButton
  promptId={d.id}
  payload={{
    prompt: d.prompt,
    ...(d.negativePrompt ? { negative_prompt: d.negativePrompt } : {}),
    ...(d.aspectRatio ? { aspect_ratio: d.aspectRatio } : {}),
  }}
/>
```

Also remove the now-unused `Send` from lucide imports (it's used inside SendToStudioButton).

Updated import line (Heart stays, Send leaves):

```tsx
import { Heart } from "lucide-react";
```

- [ ] **Step 2: TypeScript check**

```bash
pnpm --filter @ip/web exec tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Smoke test the detail page**

```bash
pnpm dev &
sleep 6
# In another shell or browser, hit a known detail URL from M1 seed.
# Example slug from M1 seed: "neon-night-city" — adjust if seed differs.
curl -s http://localhost:5173/zh/prompts/neon-night-city -o /dev/null -w "%{http_code}\n"
kill %1
```

Expected: 200, page renders. (Manual browser test in Task 22.)

- [ ] **Step 4: All tests still pass**

```bash
pnpm test
```

Expected: 25 + 13 (api) + 25 (shared) = 63 total — same as Task 11 + Task 12 + Task 20 cumulative. (numbers approximate; what matters is no regression)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/PromptDetailPage.tsx
git commit -m "feat(web): wire PromptDetailPage Send CTA to SendToStudioButton (M3 lights up)"
```

---

### Task 22: Manual test pass + final review

**Files:** (none — this is verification, not implementation)

- [ ] **Step 1: Ensure OAuth credentials are in `.env`**

If `apps/api/.env` doesn't have `GOOGLE_CLIENT_ID` / etc., follow the README OAuth dev setup section (Task 4 step 5) to register dev apps with Google and GitHub. If you don't have time to register both, register **just Google** — the GitHub provider will be filtered out and that's expected.

If you have **no OAuth creds at all**, skip step 4 below and rely on integration tests (which all passed) for confidence.

- [ ] **Step 2: Boot the full stack**

```bash
pnpm dev
```

Expected: both API (port 3000) + Web (port 5173) start. Logs should show:
```
[auth] provider google disabled: missing creds       (only if missing)
✓ Image-Prompts API running on http://127.0.0.1:3000
  VITE v6.x  ready in NNN ms
  ➜  Local:   http://localhost:5173/
```

- [ ] **Step 3: Smoke test guest browsing**

In a browser, open `http://localhost:5173/zh`. Verify:
- [ ] Header shows "登录" button (Apple Blue outline) on the right
- [ ] Home page renders prompts as before (no regression from M1)
- [ ] Click a prompt → detail page renders
- [ ] On the detail page, "Send to Image-Studio" button is **disabled** with tooltip "请先登录" on hover
- [ ] The three lower buttons (Copy/Favorite/More) are still disabled with "M2 即将上线"

- [ ] **Step 4: OAuth sign-in flow (skip if no creds)**

- [ ] Click "登录" → modal opens with two provider buttons
- [ ] Click "使用 Google 登录" → redirected to Google consent screen
- [ ] Approve → redirected back to `http://localhost:5173/zh` (the AUTH_URL configured)
- [ ] Header now shows your avatar (or initial-circle) instead of SignIn button
- [ ] Click avatar → dropdown shows name + email + Profile + Sign Out

- [ ] **Step 5: Test Send to Studio flow**

- [ ] Open a prompt detail page → Send button is now Apple Blue solid (enabled)
- [ ] Click Send → browser may show OS dialog "Open Image-Studio?" (if you haven't registered the scheme, it'll just say "no app available")
- [ ] Click Cancel on OS dialog → after ~1.5s, modal pops up: "未检测到 Image-Studio" with download link + copy button + don't-ask checkbox
- [ ] Click "复制提示词" → button changes to "已复制" briefly
- [ ] Open browser DevTools → Application → Local Storage → confirm `ip:studio_install_suppressed` is NOT set (since we didn't check the box)
- [ ] Check the box → close modal → click Send again → cancel OS dialog → confirm modal does NOT reappear after 1.5s

- [ ] **Step 6: Test Sign Out**

- [ ] Click avatar → "退出登录"
- [ ] Toast appears "退出登录"
- [ ] Header shows SignIn button again
- [ ] Detail page Send button becomes disabled again

- [ ] **Step 7: Run the full test suite one more time**

```bash
pnpm test
```

Expected: all tests pass. Record the exact counts in the commit message.

- [ ] **Step 8: TypeScript + lint sweep**

```bash
pnpm typecheck
pnpm lint
pnpm format:check
```

Expected: all clean. If `format:check` fails on whitespace, run `pnpm format` and stage the result.

- [ ] **Step 9: Final commit (review cleanup)**

If anything was tweaked during manual test (one-line fixes for visible bugs), commit them:

```bash
git add -A
git commit -m "chore: M3 final cleanup after manual test pass"
```

Otherwise, nothing to commit here.

- [ ] **Step 10: Summary report**

Walk through the spec sections one-by-one and confirm coverage:
- §1.3 scope items: tick each (Auth.js installed ✓, OAuth providers ✓, DB session ✓, header ✓, ProfilePage ✓, POST endpoint ✓, GET endpoint ✓, button state machine ✓, modal ✓, send_count ✓, tests ✓)
- §2.x architecture: all implemented
- §3 schema changes: applied
- §4 endpoints: all live
- §5 button + modal: as specified
- §6 UI surface: header + profile + detail page wired
- §7 errors: each row of the table has a matching toast/code path
- §8 testing: unit + integration counts confirmed

If any item is missing, surface to user before declaring M3 done.

---

## Plan Self-Review

### Spec Coverage

| Spec section | Plan task |
|---|---|
| §1.3 范围内 (10 items) | Task 1–21 each cover one |
| §1.5 锁定决策 (9 rows) | All applied in Tasks 4/5/8/9/10/19 |
| §2.1 库选型 | Task 1 |
| §2.2 Provider 配置 | Task 5 |
| §2.3 中间件挂载 | Task 6 |
| §2.4 环境变量 | Task 4 |
| §3.1 import_tokens.user_id | Task 3 |
| §4.1 端点清单 | Tasks 6 (auth/*) + 10 (POST) + 11 (GET) |
| §4.2 POST contract | Task 10 |
| §4.3 GET contract | Task 11 |
| §4.4 session shape | Task 13 (consumer side) |
| §5.1 时序 | Tasks 8+10+11+19+20 cover all steps |
| §5.2 CAS code | Task 8 |
| §5.3 button state machine | Task 19 |
| §5.4 StudioNotInstalledModal | Task 20 |
| §5.5 安全边界 (9 rows) | Token user_id binding (Task 3) + rate limit key (Task 10) + others inherited from M1 |
| §6.1 Header | Task 18 |
| §6.2 PromptDetailPage replacement | Task 21 |
| §6.3 ProfilePage | Task 17 |
| §6.4 i18n keys | Task 12 |
| §7 错误处理 (11 rows) | Task 19 (toast on 401/429/5xx) + Task 20 (clipboard fallback) + Task 11 (410 errors) |
| §8.1 unit tests | Tasks 8 + 19 + 20 |
| §8.2 integration tests | Tasks 10 + 11 |
| §8.3 OAuth manual coverage | Task 22 |
| §8.4 9-row manual matrix | Task 22 |
| §8.5 CI config | Task 4 |
| §9 Image-Studio contract | Doc-only; spec is the contract. No code task. |
| §10 deployment | Doc-only; README OAuth section in Task 4 |
| §11 risks | Mitigations spread across implementation |

No spec section uncovered.

### Placeholder Scan

Grepped my own plan for "TBD", "TODO", "implement later", "similar to Task N", "add appropriate error handling" — zero matches. Code blocks are concrete throughout. The phrase "similar pattern" appears once in Task 19 step 1 ("Mirror that") but it points to a specific existing file (`vitest.config.ts`) the engineer can read.

### Type Consistency

Cross-checked:
- `ImportTokenPayload` (Task 7) used in `createImportToken` (Task 8) and `SendToStudioButton` props (Task 19) ✓
- `Session.user.id` (Task 13) read in `ProfileMenu` (Task 16) and consumed by SendToStudioButton (Task 19) via session.data ✓
- `ConsumeError.code` (Task 8) consumed by GET route (Task 11) ✓
- `SUPPRESS_KEY` (Task 20) tested by name in Task 20 step 2 ✓
- `useInvalidateSession` (Task 13) used in Tasks 16 + 17 ✓

All consistent.
