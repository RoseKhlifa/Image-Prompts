# Image-Prompts

中英双语生图提示词聚合站,Image-Studio 配套产品。

## Repository Structure

This is a pnpm monorepo:

- `apps/web` — React + Vite SPA (frontend)
- `apps/api` — Hono server (backend API)
- `packages/shared` — Shared Zod schemas, TS types, i18n utilities
- `docs/superpowers/specs` — Design specs
- `docs/superpowers/plans` — Implementation plans
- `scripts` — One-off migration / data tasks

## Prerequisites

- Node.js 22 LTS (`nvm install 22 && nvm use 22`)
- pnpm 9 (`npm i -g pnpm@9`)
- PostgreSQL 16 running locally on `localhost:5432`
- A dev database:
  ```bash
  createdb image_prompts_dev
  psql -d image_prompts_dev -c "CREATE USER ip_app WITH PASSWORD 'devpassword' SUPERUSER;"
  ```

Run `bash scripts/check-prereqs.sh` to validate.

> **No Docker is required for local development.** Docker is only used for production deployment (M8).

## Quick Start

```bash
pnpm install
cp apps/api/.env.example apps/api/.env       # then edit secrets
pnpm db:migrate                              # creates 19 tables
pnpm db:seed                                 # inserts demo prompts
pnpm dev                                     # starts api:3000 + web:5173 in parallel
```

Open <http://localhost:5173>.

## Useful Commands

```bash
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
```

## CI

GitHub Actions runs `pnpm check` plus an integration test job (PG service container) on every PR.
See `.github/workflows/ci.yml`.

## Design

See `docs/superpowers/specs/2026-06-06-image-prompts-design.md`. Implementation milestones live in `docs/superpowers/plans/`.

## Roadmap (8 milestones)

- **M1** Skeleton + public browsing ✅ (this milestone)
- M2 Send to Studio integration
- M3 User submission flow
- M4 Admin review + R2 account pool
- M5 Likes / favorites / related discovery
- M6 Full bilingual content + AI translation
- M7 Reports / announcements / system settings
- M8 nanobanana data migration + production deploy
