#!/usr/bin/env bash
# suite-health.sh — one-line-per-check pass/fail/duration summary of the fast
# quality gate: lint (repo-wide biome), then typecheck + tests per workspace.
#
# Read-only against the repo (runs the same checks CI runs; writes nothing).
# Continues past failures so you get the full picture; exits non-zero if any
# check failed. Total runtime ~90s warm (worker tests alone are ~50s).
#
# Usage: bash .claude/skills/ballroom-flow-diagnostics-and-tooling/scripts/suite-health.sh
# Optional: SKIP_TESTS=1 to run only lint+typecheck (~15s).
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

FAILED=0
RESULTS=()

run_check() {
  local label="$1"; shift
  local start end status
  start=$(date +%s)
  if "$@" >/dev/null 2>&1; then
    status="PASS"
  else
    status="FAIL"
    FAILED=1
  fi
  end=$(date +%s)
  RESULTS+=("$(printf '%-5s %-28s %4ss' "$status" "$label" "$((end - start))")")
  printf '%-5s %-28s %4ss\n' "$status" "$label" "$((end - start))"
}

echo "suite-health: lint + typecheck + tests (per workspace)"
echo "------------------------------------------------------"
run_check "lint (biome, repo)"        pnpm lint
run_check "typecheck @ballroom/domain"   pnpm --filter @ballroom/domain typecheck
run_check "typecheck @ballroom/contract" pnpm --filter @ballroom/contract typecheck
run_check "typecheck worker"          pnpm --filter worker typecheck
run_check "typecheck web"             pnpm --filter web typecheck
if [ "${SKIP_TESTS:-0}" != "1" ]; then
  run_check "test @ballroom/domain"   pnpm --filter @ballroom/domain test
  run_check "test @ballroom/contract" pnpm --filter @ballroom/contract test
  run_check "test worker (workerd)"   pnpm --filter worker test
  run_check "test web (jsdom)"        pnpm --filter web test
fi
echo "------------------------------------------------------"
if [ "$FAILED" -ne 0 ]; then
  echo "RESULT: FAIL — re-run the failing check WITHOUT output suppression, e.g.:"
  echo "  pnpm --filter worker test"
  exit 1
fi
echo "RESULT: all checks green"
