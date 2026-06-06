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
