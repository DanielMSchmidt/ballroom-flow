---
name: ballroom-flow-diagnostics-and-tooling
description: Load when you need to MEASURE instead of eyeball in ballroom-flow — check a D1 query plan (SCAN vs SEARCH), read coverage thresholds, run/interpret axe a11y sweeps, open Playwright traces, reproduce a flake deterministically (--repeat-each), inspect Durable Object internals (compaction, persistence, alarms), assert CRDT convergence correctly, check bundle size, verify generated-file drift, or decode noisy-but-harmless test/build output.
---

# Ballroom Flow — diagnostics & measurement toolbox

Every claim below was verified against the repo on 2026-07-02 (HEAD `70eed7e`, branch
`development`). This skill is the instrument catalog: what each measurement tool is, how to
run it, and — critically — how to *interpret* what it prints.

**When NOT to use this:**
- Symptom-first triage ("X is broken, why?") → **ballroom-flow-debugging-playbook**.
- Which gates to run before a PR / what "done" means → **ballroom-flow-validation-and-qa**.
- Install/toolchain/secrets/sandbox setup (incl. the Playwright browser-shim workaround) → **ballroom-flow-build-and-env**.
- Automerge/CRDT *semantics* (why heads, what a change is) → **ballroom-flow-crdt-reference**.
- Why an instrument exists historically (the incidents) → **ballroom-flow-failure-archaeology**.

Jargon used throughout: **DO** = Cloudflare Durable Object (one per document, SQLite-backed);
**D1** = Cloudflare's SQLite database (pure index/registry here, no document content);
**Automerge** = the CRDT library the documents are built on.

---

## 1. Shipped scripts (in `scripts/` next to this file)

All three are read-only against the repo and were run-verified on 2026-07-02.

### `verify-generated.sh` — generated-file drift check

Two source files are **generated and checked in**: `packages/domain/src/library-data.ts`
(204 figures) and `packages/domain/src/figure-charts.generated.ts` (147 charts), produced
byte-deterministically by `scripts/gen-library.mjs` / `scripts/gen-figure-charts.mjs` from
`docs/seed/*.json`. Hand-editing them is a bug; so is changing a seed/generator without
regenerating.

```bash
bash .claude/skills/ballroom-flow-diagnostics-and-tooling/scripts/verify-generated.sh
```

Expected output when healthy (runs in seconds; the `Formatted 1 file` line is the generator's
own biome-format step, normal):

```
==> node scripts/gen-library.mjs
Formatted 1 file in 11ms. Fixed 1 file.
wrote 204 figures to packages/domain/src/library-data.ts
==> node scripts/gen-figure-charts.mjs
wrote 147 charts to packages/domain/src/figure-charts.generated.ts
OK: generated files are in sync with docs/seed/* sources.
```

Exit 1 = drift (diffstat printed — inspect `git diff`, do not blindly commit or revert).
Exit 2 = the generated files were already dirty before the run (fix that first, or you can't
tell committed drift from your own edits). The script never runs `git checkout/restore/add`.

### `suite-health.sh` — one-line-per-check gate summary

```bash
bash .claude/skills/ballroom-flow-diagnostics-and-tooling/scripts/suite-health.sh
# or, lint+typecheck only (~15s):
SKIP_TESTS=1 bash .claude/skills/ballroom-flow-diagnostics-and-tooling/scripts/suite-health.sh
```

Runs repo-wide biome lint, then typecheck and tests per workspace, suppressing output and
printing `PASS|FAIL  <check>  <seconds>` per line. Full run ~90s warm; verified output shape:

```
PASS  lint (biome, repo)              1s
PASS  typecheck @ballroom/domain      3s
...
PASS  test worker (workerd)          47s
PASS  test web (jsdom)               26s
RESULT: all checks green
```

Exits non-zero if anything failed; re-run the failing check directly (e.g.
`pnpm --filter worker test`) to see its real output. Baseline as of 2026-07-02 (HEAD `3693ff6`,
post-#133/#134/#135): domain 232 passed/3 skipped, contract 11, web 333, worker 161 passed/7
skipped **+ 1 known deterministic failure** (`fork.test.ts` "is independent of the origin" —
the migrateOnLoad incident, fix pending as PR #140; 162/7 once it lands). A red worker suite
matching exactly that test is the known incident, not your change.

### `explain-query.mjs` — query-plan probe against the real D1 schema

Applies all 13 migrations in `apps/worker/migrations/` to a throwaway in-memory SQLite DB
(D1 *is* SQLite, so the planner output matches) and runs `EXPLAIN QUERY PLAN` on your SQL.
No worker, no Cloudflare state, no network.

```bash
node .claude/skills/ballroom-flow-diagnostics-and-tooling/scripts/explain-query.mjs \
  "SELECT * FROM membership WHERE docRef = ?"
node .claude/skills/ballroom-flow-diagnostics-and-tooling/scripts/explain-query.mjs --tables
```

Verified output (exit 0 on all-indexed, exit 1 on any SCAN):

```
EXPLAIN QUERY PLAN (schema: 13 migrations applied)
  ✓  SEARCH membership USING INDEX membership_doc_idx (docRef=?)
OK: every access path uses an index or PK search.
```

`--tables` lists every table + index in the schema. The node:sqlite `ExperimentalWarning`
on stderr is harmless (Node 22).

---

## 2. Instrument catalog

### 2.1 EXPLAIN QUERY PLAN / `expectIndexedQuery` — is this D1 query indexed?

- **Where:** `apps/worker/src/test-support/explain.ts` — `expectIndexedQuery(db, sql, params?, {allow?})`
  (line 42) runs `EXPLAIN QUERY PLAN <sql>` and throws on any `detail` row containing `SCAN`;
  `expectIndexedDrizzle(db, query)` (line 80) accepts a Drizzle builder via `query.toSQL()`.
  Used across the worker suites (permissions, search, quota, custom-kinds, doc-do tests).
- **Interpretation:** each plan row's `detail` names one access path.
  `SEARCH <table> USING [COVERING ]INDEX <name> (col=?)` = indexed lookup, good.
  `SEARCH <table> USING INTEGER PRIMARY KEY` = PK lookup, good.
  `SCAN <table>` = full-table scan, **fail** — unless allow-listed via `opts.allow` for a tiny
  reference table.
- **Why it's a hard gate:** PLAN.md §7 NFR — "Index every D1 query (EXPLAIN in CI)". Beyond
  latency, Cloudflare **bills D1 by rows read**: a SCAN reads every row in the table on every
  request, so an unindexed hot query's cost grows with your data even when it returns one row.
- **Ad-hoc check for a query you're designing:** use `explain-query.mjs` above; then encode the
  guarantee as an `expectIndexedQuery`/`expectIndexedDrizzle` assertion in the worker test that
  covers the route.

### 2.2 Coverage — per-workspace, threshold semantics

```bash
pnpm coverage                              # all workspaces (~65s)
pnpm --filter @ballroom/domain coverage    # one workspace
pnpm --filter worker coverage
```

Istanbul provider; text summary to stdout, HTML/artifacts under each workspace's `coverage/`.

The per-workspace threshold table and measured actuals are single-homed in
**ballroom-flow-validation-and-qa** §6 (configs: `packages/domain/vitest.config.ts` and
`apps/worker/vitest.config.ts` thresholds blocks; web collects coverage but arms none).

Semantics: the config numbers are **armed ratchet floors, not targets** — set at the measured
floor so coverage can't silently regress (a drop below any number fails `pnpm coverage`, which
CI runs for domain and worker). PLAN.md §10.3 targets are higher (domain ≥95, worker ≥90);
ratchet the config numbers *up* as branches get covered, never down. The worker "All files"
number is permanently depressed by `src/routes/test-seed.ts` (E2E-only fixture route exercised
by Playwright, not vitest) — a constant drag, not a regression.

### 2.3 vitest-axe — component a11y sweeps (axe is O(nodes))

- **Where:** `apps/web/src/components/a11y.test.tsx` (US-051) — one axe sweep per
  presentational screen via `axeCheck`/`renderUi` from `apps/web/src/test-support/render.tsx`.
  Run with `pnpm --filter web test`.
- **The lesson (b419e0a, the dominant CI flake for a day):** axe runtime scales with DOM node
  count. Prop-less `<FigureLibrary/>` rendered the whole ~240-figure catalog (~3000 nodes) →
  13–17s under parallel CI load vs vitest's 5s default timeout — a deterministic timeout-edge
  that *looked* random. Fix pattern, when adding a screen to the sweep: render **minimal real
  props** that still exercise every *distinct* markup element (a11y violations are properties
  of the markup, which repeats per item — one dance ≈ 585 nodes gives identical coverage), and
  the suite already carries `AXE_TIMEOUT_MS = 20_000` headroom.
- Screens needing a live store/WS (Assemble, Share) are deliberately NOT in the vitest sweep —
  their a11y lives in the real-browser journey `apps/web/e2e/pwa-a11y.spec.ts`.

### 2.4 Playwright instruments — traces, flake reproduction, filters

All from `apps/web/` (or root `pnpm test:e2e` / `pnpm test:e2e:smoke`). Sandbox note: only
`--project=chromium-desktop` runs in sandboxes; browser-shim details in
**ballroom-flow-build-and-env**.

| Instrument | Command / config | What it gives you |
|---|---|---|
| Trace on flake | `retries: 1` + `trace: "on-first-retry"` (`apps/web/playwright.config.ts`) | A test that fails once then passes leaves a full trace of the *failing* attempt under `apps/web/test-results/<test-slug>/trace.zip` |
| Open a trace | `pnpm exec playwright show-trace test-results/<slug>/trace.zip` | Time-travel DOM snapshots, network, console per action |
| Reproduce a durability flake | `pnpm exec playwright test <spec> --repeat-each=10 --project=chromium-desktop` | Runs each test N times in one session — this is what caught the write-durability bug where client-seeded content vanished on immediate reload (PR #58, `4ef16ac`) |
| Smoke subset | `--grep @smoke` (24 tests as of 2026-07-02); inverse: `--grep-invert @smoke` | The PR-gate subset |
| One device | `--project=chromium-desktop` (also `mobile-chrome`, `mobile-safari`) | Skip the matrix |
| List without running | `pnpm exec playwright test --list` | 87 tests / 14 files / 3 projects as of 2026-07-02 |

Interpretation notes: `expect` timeout is raised to 10s (config comment: wrangler-dev can
stall briefly under load — a correct assertion rides it out, a broken one still fails). The
suite is **serialized** (`workers: 1`, `fullyParallel: false`) because all journeys share one
local D1 — never "fix" slowness by parallelizing it. A pass-on-retry in CI is still a signal:
open the trace, root-cause it (repo doctrine: flakes get root-caused, not retried away).

### 2.5 DO test hooks — inspecting Durable Object internals

The per-document DO (`apps/worker/src/doc-do.ts`, class `DocDO`) persists an Automerge doc as
a SQLite **change log** (`changes` table, one row per change) plus a folded **snapshot** row;
an **alarm** compacts the log and projects index metadata to D1. Test-only RPC hooks let a
vitest-pool-workers test observe/drive this without reaching into storage. Typed surface:
`apps/worker/src/test-support/doc-do-api.ts`; heavy use in `apps/worker/src/doc-do.test.ts`.

| Hook (doc-do.ts line) | What it does | What it proves |
|---|---|---|
| `reloadForTest()` :756 | Drops the in-memory doc, re-runs cold load from SQLite | **Eviction survival**: the pool keeps a DO warm, so without this the rehydration/replay path is never exercised |
| `debugChangeRowCount()` :766 | `SELECT COUNT(*) FROM changes` | Persistence is **incremental** (one row per change, not full-doc rewrites); also gate assertions — a rejected viewer frame must add **zero** rows |
| `buildChangeForTest(op)` :776 | Mints valid, lineage-compatible change bytes against the current doc **without applying** | Feed real bytes through `webSocketMessage` to prove the socket role gate: same bytes dropped for a viewer, applied for an editor |
| `runAlarmForTest()` :855 | Runs the alarm body synchronously (no timer) | Deterministically drive compaction, D1 index projection, journal projection, invite expiry — and their **isolation** (one step failing must not skip the rest) |
| `debugPersistedSize()` :1203 | `SUM(LENGTH(data))` over snapshot + change log | **Compaction bounds storage**: after the alarm folds changes into the snapshot, persisted bytes must not grow unbounded with edit count |
| `catchUpFramesForTest()` :743 | Returns the frames a fresh connect would receive | Post-#134, exactly ONE tagged `SYNC_FRAME_SNAPSHOT` for a seeded doc — pins the one-frame catch-up |

Companion facts: `COMPACT_THRESHOLD = 64` (doc-do.ts:71) — the change log triggers a coalesced
compaction alarm past 64 rows (doc-do.test.ts asserts `debugChangeRowCount() < 70` after a
burst). Worker tests run with `isolatedStorage: false` (SQLite DOs break the pool's teardown —
M0.5 finding), so storage persists across tests: **every test must mint a unique DO id** via
`uniqueDocStub(env.DOC_DO, prefix)` / `uniqueDocName()` in `apps/worker/src/test-support/do-id.ts`.

### 2.6 Convergence assertions — heads vs bytes

Helpers in `packages/domain/src/__fixtures__/convergence.ts`; used by
`packages/domain/src/convergence.test.ts` (E2E equivalent: `expectConverged` in
`apps/web/e2e/support/two-users.ts`, which asserts on observable UI state).

- **`assertHeadsEqual(A, a, b)`** (line 136) — compares **sorted heads** (the set of current
  change hashes). This is the canonical "same logical state" signal and it is
  **merge-order-independent**. Use it for any cross-replica convergence claim. Higher-level
  wrappers: `exchangeAndAssertConverged`, `assertCommutative`, `assertIdempotent`.
- **`assertBytesEqual(a, b)`** (line 146) — raw `Uint8Array` equality. **Never valid for
  convergence**: two docs with identical heads/content can `A.save()` to *different bytes*
  depending on merge order, so a byte comparison spuriously fails. It is only valid when
  asserting byte-level identity of one serialization — e.g. "this persisted blob was not
  rewritten". (As of 2026-07-02 no test uses it; it exists so nobody reinvents it wrongly.)

Why the fixtures dynamic-import Automerge (`loadAutomerge()`): top-level-importing the WASM
module from a skipped suite breaks test collection — the repo-wide lazy-import convention
(see CLAUDE.md §4).

### 2.7 Bundle size — the WASM baseline

```bash
pnpm --filter web build     # tsc --noEmit + vite build, ~13s
```

Verified output as of 2026-07-02 (the numbers to watch):

```
dist/assets/automerge_wasm_bg-….wasm   2,749.80 kB │ gzip: 918.12 kB
dist/assets/index-….js                   890.04 kB │ gzip: 150.48 kB
precache  6 entries (3596.13 KiB)
```

Interpretation: the Automerge WASM dominates everything and its **~920 KiB gzip** figure is
the M0.5-measured baseline recorded in PLAN.md §7 (~line 373: worker bundle "~920 KiB gzipped
… well under the 10 MB paid limit"). The `(!) Some chunks are larger than 500 kB` Vite warning
is expected — do not "fix" it by splitting the WASM. What IS a signal: the *app JS* gzip
(150 KiB baseline) creeping up, or the PWA precache total growing — compare against these
numbers, not the warning. Lighthouse perf budgets are deferred to M9 (nightly.yml has a stub).

### 2.8 Screenshot diff — pixelmatch, CI-only

`scripts/screenshot-diff.mjs` pixel-diffs the committed marketing screenshots
(`apps/web/src/marketing/screenshots/`) against the PR base branch and posts a sticky
before/after PR comment (marker `<!-- screenshot-bot -->`). `pixelmatch` with
`threshold: 0.1` tolerates anti-aliasing noise; size mismatch counts as changed.

- **Do not run `main()` locally** — it needs PR context (base/head SHAs); it's driven by
  `.github/workflows/screenshots.yml` (root script `pnpm screenshots:diff`).
- Known wart: `scripts/screenshot-diff.test.mjs` is a vitest test wired into **no runner** —
  `node --test` on it fails with `ERR_MODULE_NOT_FOUND vitest`. That failure is the wiring
  gap, not a code bug.

---

## 3. "What does this noise mean" — expected stderr/log lines

This is the **canonical noise table** — sibling skills (debugging-playbook §11,
build-and-env §4) point here rather than re-listing it.

| Noise | Where you see it | Meaning | Action |
|---|---|---|---|
| HTTP 403 to `workers.cloudflare.com` / `sparrow.cloudflare.com` | any `wrangler dev` run (E2E webServer, `pnpm dev`) | wrangler **telemetry** blocked by the sandbox proxy | None — never a test failure cause |
| `workerd … Broken pipe` ERROR | end of an E2E run | workerd's shutdown race when the Playwright webServer is killed | None if tests already reported their verdict |
| `Failed to parse URL from /api/figures` (fetch TypeError on stderr) | `pnpm --filter web test` (jsdom) | jsdom has no origin, so relative `fetch` URLs can't resolve; components under test tolerate the rejected fetch | None — assertions don't depend on it; observed baseline 2026-07-02 |
| `doc-do alarm: D1 index projection failed …` (console.error) | worker suite | The **alarm-isolation error-path test** (`doc-do.test.ts` ~:455) deliberately forces the projection to throw to prove the other alarm steps still run | None when the suite is green — it's the test doing its job. The same line in *production* logs IS a real signal (see ballroom-flow-run-and-operate) |
| biome: 1 warning, `fork.test.ts:282` unused `variantAttributesForEdit` | `pnpm lint` | Known pre-existing warning (not an error; lint still exits 0) | Leave it unless you're touching that test |
| `(!) Some chunks are larger than 500 kB` + the 2.75 MB Automerge WASM asset | `pnpm build` | Known, accepted for v1 (see §2.7 — the WASM dominates by design) | None — do not "fix" by splitting the WASM |
| `ExperimentalWarning: SQLite is an experimental feature` | `explain-query.mjs` | Node 22's `node:sqlite` flag status | None |

Rule of thumb: a line is only "noise" if the run's **exit code and test verdicts are green**.
The same text with a red suite means start at **ballroom-flow-debugging-playbook**.

---

## Provenance and maintenance

Authored 2026-07-02 against HEAD `70eed7e`; suite-baseline counts refreshed same day against
HEAD `3693ff6` (post-#133/#134/#135; PR #140 pending — worker suite red on the known
fork.test.ts failure until it merges) on `development`. Every command above was executed
(scripts run-verified end-to-end: `verify-generated.sh` exit 0, `suite-health.sh` full run all
green in ~100s, `explain-query.mjs` verified on indexed/SCAN/`--tables` cases); every
file:line was read from source. Volatile facts (test counts, coverage floors, bundle sizes,
smoke-test count) are date-stamped inline.

Re-verification one-liners for the things most likely to drift:

```bash
grep -n "COMPACT_THRESHOLD" apps/worker/src/doc-do.ts                     # compaction threshold (64)
grep -n "thresholds" -A5 packages/domain/vitest.config.ts apps/worker/vitest.config.ts  # coverage floors
grep -n "reloadForTest\|debugChangeRowCount\|buildChangeForTest\|runAlarmForTest\|debugPersistedSize" apps/worker/src/doc-do.ts
grep -n "retries\|trace\|workers:" apps/web/playwright.config.ts          # trace/retry/serialization config
grep -n "920 KiB" docs/PLAN.md                                            # WASM gzip baseline claim
node scripts/gen-library.mjs && node scripts/gen-figure-charts.mjs && git diff --stat  # generator determinism
pnpm exec playwright test --list --grep @smoke 2>/dev/null | tail -1      # smoke count (from apps/web)
```
