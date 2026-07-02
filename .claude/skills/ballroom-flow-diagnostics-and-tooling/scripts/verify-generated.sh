#!/usr/bin/env bash
# verify-generated.sh — drift check for the two checked-in generated files.
#
# Runs both generators (they rewrite their outputs byte-deterministically) and
# fails if `git diff` shows the committed files differ from a fresh generation.
# Read-only in spirit: on a clean repo the rewrite is byte-identical (no-op).
# If drift IS found, this script deliberately does NOT restore anything — the
# diff is the evidence you need to inspect. It also refuses to run if the
# generated files are already dirty (you would not be able to tell committed
# drift from your own uncommitted edits).
#
# Usage: bash .claude/skills/ballroom-flow-diagnostics-and-tooling/scripts/verify-generated.sh
# Exit 0 = in sync; exit 1 = drift (diffstat printed); exit 2 = precondition failed.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

GENERATED=(
  packages/domain/src/library-data.ts
  packages/domain/src/figure-charts.generated.ts
)

if ! git diff --quiet -- "${GENERATED[@]}"; then
  echo "PRECONDITION FAILED: generated files already have uncommitted changes." >&2
  echo "Commit or stash them first, then re-run — otherwise drift is ambiguous." >&2
  git --no-pager diff --stat -- "${GENERATED[@]}" >&2
  exit 2
fi

echo "==> node scripts/gen-library.mjs"
node scripts/gen-library.mjs
echo "==> node scripts/gen-figure-charts.mjs"
node scripts/gen-figure-charts.mjs

if git diff --quiet -- "${GENERATED[@]}"; then
  echo "OK: generated files are in sync with docs/seed/* sources."
  exit 0
fi

echo "DRIFT: committed generated files differ from a fresh generation:" >&2
git --no-pager diff --stat -- "${GENERATED[@]}" >&2
echo "Someone hand-edited a generated file, or the seed JSON / generator changed" >&2
echo "without regenerating. Inspect 'git diff' before touching anything." >&2
exit 1
