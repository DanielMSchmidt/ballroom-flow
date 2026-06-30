#!/usr/bin/env bash
# E2E server (#191): build the SPA in E2E mode, migrate a FRESH local D1, then run
# the worker (which serves the SPA + API + WS at one origin) with the test
# CLERK_JWT_KEY. Playwright's webServer points at this. NEVER used for deploys.
#
# The E2E build goes to `dist-e2e`, NOT the deployable `dist`. The E2E bundle has
# the VITE_E2E=1 auth bypass baked in (no Clerk; a hardcoded "Signed in" marker),
# so it must never reach a real deploy. Sharing `dist` was exactly that bug: the
# deploy job's E2E-smoke step rebuilt `dist` in E2E mode, and the later
# `wrangler deploy` shipped it — staging served the bypass build (looked signed
# in but landed on the marketing page). Keeping E2E in its own dir makes that
# impossible regardless of CI step ordering. The e2e wrangler env points here.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PORT="${E2E_PORT:-4173}"
STATE="$ROOT/apps/worker/.wrangler/e2e-state"

echo "[e2e] building SPA (VITE_E2E=1) → dist-e2e…"
( cd "$ROOT/apps/web" && VITE_E2E=1 pnpm exec vite build --outDir dist-e2e --emptyOutDir )

echo "[e2e] resetting local D1 state…"
rm -rf "$STATE"

cd "$ROOT/apps/worker"
echo "[e2e] applying D1 migrations…"
pnpm exec wrangler d1 migrations apply DB --local --env e2e --persist-to "$STATE"

echo "[e2e] starting worker on :$PORT …"
exec pnpm exec wrangler dev --env e2e --ip 127.0.0.1 --port "$PORT" --persist-to "$STATE"
