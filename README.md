# Image-Prompts

中英双语生图提示词聚合站,Image-Studio 配套产品。

## Repository Structure

This is a pnpm monorepo:

- `apps/web` — React + Vite SPA (frontend)
- `apps/api` — Hono server (backend API)
- `packages/shared` — Shared Zod schemas, TS types, i18n keys
- `docs/superpowers/specs` — Design specs
- `docs/superpowers/plans` — Implementation plans
- `scripts` — One-off migration / data tasks

## Prerequisites

- Node.js 22 LTS (`nvm use`)
- pnpm 9 (`npm i -g pnpm@9`)
- PostgreSQL 16 running locally on `localhost:5432`
- A dev database: `createdb image_prompts_dev`

## Quick Start

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
# Edit apps/api/.env with your local PG credentials and dev R2 creds
pnpm --filter @ip/api db:migrate
pnpm --filter @ip/api db:seed
pnpm dev
```

Then open <http://localhost:5173>.

## Useful Commands

```bash
pnpm dev            # Run all apps in dev mode
pnpm build          # Build all apps
pnpm test           # Run all tests
pnpm typecheck      # Type-check all packages
pnpm lint           # Lint all packages
pnpm format         # Auto-format with Prettier
```
