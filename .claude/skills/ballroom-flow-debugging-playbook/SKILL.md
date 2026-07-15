---
name: ballroom-flow-debugging-playbook
description: Load when something in Weave Steps is broken, flaky, or weird — a failing or flaky test, UI flicker/reset, "Unknown figure" or stuck loading, edits lost on reload, divergent CRDT replicas, wrong/vanishing routine cards, permission or quota/invite anomalies, worker-test state leaks, or noisy CI logs — and you need triage BEFORE touching code. Maps symptoms to discriminating experiments and known fix patterns.
---

# Weave Steps debugging playbook

Symptom-first triage for this repo: a collaborative choreography PWA where each document
is an Automerge CRDT (a data structure that merges concurrent edits deterministically)
hosted in a Cloudflare Durable Object ("DO" — a single-threaded stateful worker instance),
with D1 (Cloudflare's SQLite) as a pure derived index. That architecture creates a
specific bestiary of bugs; almost every one below has already been hit and root-caused.

## Rule zero: root-cause, never retry-until-green

This project's history (131 PRs in 8 days) shows every "random flake" was deterministic
once split correctly. **Never re-run CI to make a failure go away.** Instead:

1. **Classify the flake before hypothesizing.** Flake classes that look identical but have
   different causes were tracked separately here — e.g. "editor shows stale content"
   split into a *hydration* class (socket open ≠ catch-up applied, fixed in 97e7fea) and a
   *durability* class (client-side seeding lost on reload, fixed separately in 4ef16ac).
   The residual flake after the first fix was a *different bug*, not a bad fix.
2. **Reproduce deterministically**: `pnpm exec playwright test <spec> --repeat-each=10 --project=chromium-desktop`
   (run from `apps/web/`) is how the durability bug was caught.
3. **Find the discriminating experiment** (tables below) that splits the hypothesis space.
4. Fix the root cause; if the symptom is in the "known noise" table, do nothing.

**When NOT to use this skill:** for the full history/postmortems behind these entries use
**ballroom-flow-failure-archaeology**; for Automerge/CRDT concepts and convergence theory
use **ballroom-flow-crdt-reference**; for the test-harness/tooling deep dive (debug hooks,
trace viewing, coverage, CI layout) use **ballroom-flow-diagnostics-and-tooling**; for
build/install/env problems (pnpm allowlist, Playwright browser pinning, secrets) use
**ballroom-flow-build-and-env**; for "how do I run the app" use **ballroom-flow-run-and-operate**.

## Symptom → triage index

| # | Symptom | Prime suspect | Fixed by / pattern |
|---|---------|--------------|--------------------|
| 1 | Editor flickers, caret resets, or overlay closes during background sync | New object identity per sync frame; effect keyed on inline closure | 42f7d39, 90bed2d |
| 2 | "Unknown figure" badge, or figure card stuck on skeleton | Seed race: connect-before-seed; two-state load model | c43ebed, 9509d30, 2cdeee8 |
| 3 | Edits/title lost on reload ("Untitled routine") | "open" ≠ "hydrated" ≠ "durable" | 97e7fea, 4ef16ac |
| 4 | Two replicas show different content after both idle | False alarm from wrong comparison, or real convergence bug | sorted heads, never bytes |
| 5 | Routine card shows wrong owner/title, vanishes from lists, owner can't delete | Alarm's D1 projection clobbered the registry row | 9edab0a |
| 6 | Permission anomalies: owner missing own notes; removed editor still writing | Owner-has-no-membership-row; role frozen at handshake | 92ace53, 99fa1b9 |
| 7 | Quota/invite oddities: 402s, invite grants commenter not editor, "already redeemed" | Working as designed — check the rules first | FREE_ROUTINE_CAP, applyEditableCap |
| 8 | Worker test fails only with other tests / on re-run | DO id reuse under `isolatedStorage: false` | `test-support/do-id.ts` |
| 9 | Worker test "no such table" flake | Shared-D1 migration bookkeeping race | direct SQL in `test-support/seed.ts` |
| 10 | `a11y.test.tsx` axe timeouts under CI load | axe is O(DOM nodes) | render one dance + headroom |
| 11 | Scary wrangler/workerd/jsdom log lines | Known harmless noise | §11 → diagnostics §3 — do nothing |
| 12 | Peer/RPC change silently ignored: `applyRawChange`/`ingestChange` returns false, heads unchanged | Live-doc vs persisted-lineage divergence | 903d109 (PR #139): `migrateOnLoad` adopts the migrated doc |

---

### 1. Editor flicker / state reset on background sync

Every remote change re-renders through the store. Two distinct root causes, both fixed:

- **Unstable materialization** (42f7d39, PR #121): the store called `A.toJS` on every sync
  frame → fresh object identity per render; plus the role-aware hybrid could swap a stale
  REST snapshot under an open editor. Fix pattern: `DocConnection.materialized()` is
  **memoized by Automerge heads** (`apps/web/src/store/doc-connection.ts:266-276` — an
  unchanged doc returns the *same* object reference), `readPlacements` reuses arrays, the
  view latches to live once hydrated, and the step editor waits for the figure's own live doc.
- **Effect keyed on an inline closure** (90bed2d, PR #130): `useOverlay` keyed its effect on
  the caller's inline `onClose` (fresh identity each render) → every sync frame tore down and
  re-ran focus-grab + scroll-lock. Fix pattern: read the callback through a ref, key the
  effect on `open` alone (`apps/web/src/ui/useOverlay.ts:16-26`).

**Discriminating experiment:** open the affected screen with a second client editing
(`apps/web/e2e/support/two-users.ts` → `openTwoUsers`), and add a render-count log or React
DevTools profiler. If the component re-renders with *deep-equal but referentially-new*
props each sync frame → materialization identity (fix at the store seam). If renders are
stable but an *effect* re-runs → `git grep -n "useEffect" <component>` and look for a
dependency whose identity changes per render (closure, inline object, array literal).

**Fix pattern:** memoize at the store seam keyed on heads — never in components; never key
effects on caller-supplied closures (ref them). Components must not touch Automerge
directly (store-seam rule, CLAUDE.md §3), so identity bugs belong in `apps/web/src/store/`.

### 2. "Unknown figure" / figure stuck loading

The 2026-06-28 seed-race cluster (PRs #78/#79/#80 superseded by #81, then #94):

- **Client raced the seed** (9509d30): `addPlacement` opened the figure-doc WebSocket
  *before* `POST /api/figures` had seeded the DO → empty catch-up, figure "missing"
  until reload. Fix: the `pendingFigures` gate (`apps/web/src/store/routine.ts:479`) —
  connect only after create resolves. (⟳v5 note: placing a CATALOG figure no longer POSTs
  at all — it's a live `global:` reference; the gate now guards custom/variant creates.)
- **Server side** (c43ebed): connect catch-up used `getDoc()`, which auto-materialized
  **and persisted** an empty placeholder into an unseeded DO, tripping `seedDoc`'s
  no-clobber guard forever; and `seedDoc` persisted but never broadcast to already-connected
  sockets. Fix: `loadPersisted` (no auto-materialize) on the connect path
  (`apps/worker/src/doc-do.ts:195,511-517`); `seedDoc` broadcasts (`doc-do.ts:294`).
- **Two-state model collapse** (621721e, then 2cdeee8/PR #94): "null figure" used to render
  "Unknown figure" while still loading. Now there are **five** states —
  `FigureLoadStatus = "pending" | "loading" | "live" | "missing" | "error"`
  (`apps/web/src/store/routine.ts:72`) — plus a registry preflight to distinguish missing
  vs failed, and `DocConnection` auto-reconnect with capped backoff.

**Discriminating experiment:** which of the five states is the placement actually in
(`figureStatus`, `routine.ts:567`)? `pending` stuck → the create POST never resolved (check
network / worker 4xx). `loading` stuck → WS catch-up never completed (check for
`SYNC_CAUGHT_UP` arrival; server-side, `debugChangeRowCount` on the figure DO — see
ballroom-flow-diagnostics-and-tooling). `missing` → registry row exists but doc unseeded
(the c43ebed placeholder signature). If the UI says "Unknown figure" *at all*, that's a
regression of 621721e — loading must render a skeleton.

**Fix pattern:** never collapse loading into missing; never connect before seed resolves;
never auto-materialize on a read path that can precede `seedDoc`.

### 3. Edits or title lost on reload

Two separate bugs that look identical (the flake-class lesson — see Rule zero):

- **Hydration** (97e7fea, PR #57): the store flipped "live" on socket **OPEN**, before
  catch-up applied — edits went into a not-yet-replayed doc. Passed on localhost timing
  only. Fix: the DO sends `SYNC_CAUGHT_UP` (`"ballroom:sync:caught-up"`,
  `packages/contract/src/index.ts:149`; sent at `apps/worker/src/doc-do.ts:522`, after the
  one-frame snapshot catch-up since PR #134) and "live" means catch-up-applied
  (`apps/web/src/store/doc-connection.ts:296`, snapshot merge at `mergeSnapshot` :385).
- **Durability** (4ef16ac, PR #58): initial content was written by the **client** after
  create — an immediate reload showed "Untitled routine". Fix: server-side
  `seedDoc(content)` DO RPC, no-clobber, seeded before any client connects. Caught only by
  `--repeat-each`.

**Discriminating experiment:** is the data *in the DO* after the symptom?
Reproduce in a worker test using `reloadForTest()` (drops in-memory state, forces reload
from SQLite; `apps/worker/src/doc-do.ts:768`) and inspect the doc. Data present but the UI
missed it → hydration/broadcast class (client). Data absent → durability class (the write
never reached the DO, or was clobbered — check `seedDoc` ordering and no-clobber).
In E2E, `--repeat-each=10` on the journey plus a hard reload step separates
"sometimes stale" (hydration) from "always lost after reload" (durability).

**Fix pattern:** every lifecycle transition (open → hydrated → durable → broadcast) needs
an explicit acknowledged signal; never infer one from another. Reconnect resend
(unacknowledged local changes, internal #161) **shipped in PR #134** — the client merges the
catch-up snapshot and re-sends what the server lacks (`doc-connection.ts` `mergeSnapshot`
:385 / `resendMissing` :424) — so "edits lost across a reconnect" is now a regression of
that fix, not an open item. Also check row 12 (lineage divergence) before blaming resend.

### 4. Replicas appear to diverge

**First: verify divergence correctly.** Two Automerge docs with identical content can
serialize to different bytes (`A.save()` output depends on history/compaction). The repo
convention: compare **sorted heads** — `assertHeadsEqual`
(`packages/domain/src/__fixtures__/convergence.ts:136`); `assertBytesEqual` (`:146`) exists
only for storage round-trip identity tests, never convergence. If your "divergence" is a
bytes or JSON-order comparison, it is probably a false alarm.

**If heads genuinely differ after both peers are idle and connected:** a change was never
delivered/applied. Check, in order: (a) the sender was actually live (row 3 — writes before
`SYNC_CAUGHT_UP`); (b) the receiver's socket survived (`DocConnection` reconnect/backoff);
(c) the DO broadcast it (`doc-do.ts` `broadcast` :721 — since PR #134 a failed `send` closes
that socket with `SYNC_RESYNC_CLOSE_CODE` so the client reconnects to a fresh snapshot);
(d) the change wasn't rejected at the boundary as a permission violation (row 6); (e) the
change wasn't silently deferred on a diverged lineage (row 12). **If heads match but
rendered content differs** → not a CRDT bug: stale materialization (row 1) or the store's
read path.

**If content *converges* but wrongly** (e.g. concurrent reorder loses an edit): identity-vs-
position bug. Reorder was once a delete-and-reinsert splice that clobbered concurrent
edits (38dfba7, internal #63); fixed with `sortKey` fractional indexing
(`packages/domain/src/order.ts`). Rule: never address list elements by index across time;
never move by delete+reinsert. Property tests for merge algebra live in
`packages/domain/src/convergence.test.ts`. Concepts: ballroom-flow-crdt-reference.

### 5. Routine card wrong owner/title, vanishes from lists, owner loses delete

Fixed root cause (9edab0a, PR #132 review): the DO alarm's D1 projection upserted
`ownerId=''` / `title=NULL` / `type='routine'` over the eagerly-created registry row —
production never calls `setMetadata`, so once a doc hit the compaction threshold (64
changes) or gained one annotation, the alarm clobbered the row. Owner lost DELETE rights;
routines vanished from quota/owned lists.

**Discriminating experiment:** read the registry row (locally:
`pnpm exec wrangler d1 execute DB --local --command "SELECT docRef, ownerId, title, type, deletedAt FROM document_registry WHERE docRef='<ref>'"`
from `apps/worker/`; for the E2E database add
`--env e2e --persist-to apps/worker/.wrangler/e2e-state` — that's where `e2e/serve.sh`
keeps its state). Empty `ownerId` or NULL `title` on a doc that has content → a
destructive projection wrote it. Also check `deletedAt` — everything is soft-deleted;
"vanished" rows are usually tombstoned, and every list query filters `deletedAt IS NULL`.
In tests, drive the alarm deterministically with `runAlarmForTest()` (`doc-do.ts:867`).

**Fix pattern:** D1 is a *derived* index — the doc is the source of truth. Projections
must derive identity **from the loaded doc** and upsert non-destructively (CASE/COALESCE,
see `projectToD1`, `doc-do.ts:926`). Related: alarm steps (compact / project / journal /
expire invites) each run in their own try/catch (6c3b8ab) so one failure can't skip the
rest — a "missing" side effect may be a swallowed, logged step failure, not a logic bug.

### 6. Permission anomalies

Two verified traps, one enforcement rule:

- **Owners have NO membership row** (internal #168; symptom fix 92ace53). The registry's
  `ownerId` elevates via `resolveEffectiveRole` (`apps/worker/src/db/membership.ts:65-84`;
  since PR #137 the same function also resolves the global-figure boundary — any signed-in
  user is a viewer of a `type='global-figure'` doc, only an admin is an editor, :81).
  Any feature that builds a user set from `listMembers` alone silently excludes the owner —
  that's how an owner's own figureType notes vanished from their own routine.
- **Role was frozen at the WS handshake** (99fa1b9): a removed editor kept live write
  access until reconnect, because the role lived in the hibernation attachment. Fix:
  `refreshConnectedRoles()` (`doc-do.ts:638`) re-resolves from D1 and closes revoked
  sockets with code 1008; it's called by member-removal and invite-redeem. A stale-role
  symptom means some *new* membership-mutation path forgot to call it.
- Commenters are gated by **effect, not label** (eb04a33; `commenterChangeAllowed`,
  `doc-do.ts:579`): a frame is classified by applying it and diffing; annotation authorship
  is checked against the socket-verified Clerk `sub`, never a client-sent `authorId`.

**Discriminating experiment:** `GET /api/docs/:id/access` (the 401/403/200-with-role
preflight) tells you what the server *currently* resolves for the user; compare with what
the open socket is doing. Mismatch → a missing `refreshConnectedRoles` call. Correct role
but wrong behavior for the *owner specifically* → the membership-row asymmetry.

**Fix pattern:** permissions are enforced per-document at the DO sync boundary and the
REST surface — never by post-hoc CRDT cell rejection (CLAUDE.md §4). Gate by verified
identity + observed effect; re-check on every membership change; remember owners aren't in
the members table.

### 7. Quota / invite oddities

Most reports here are **working as designed** — check the rules before debugging:

| Observation | Rule (verified in code) |
|---|---|
| `POST /api/routines` or fork → 402 | Free plan cap: `FREE_ROUTINE_CAP = 3` owned routines (`apps/worker/src/db/routines.ts:18`); 402 is the upsell signal |
| Editor invite granted **commenter** | `applyEditableCap` (`db/invites.ts:129`): a free user already at the editable-routine cap redeeming an *editor* invite to a *routine* they can't already edit gets commenter; result flagged `downgraded` |
| "already_redeemed" on first click | Invites are atomic single-use (`redeemInvite`, `invites.ts:87-108`: UPDATE-where-NULL claim) — a double-fired request or a second user consumed it |
| Invite silently dead after a week | `DEFAULT_TTL_MS` = 7 days (`invites.ts:21`); the DO alarm expires them (`expireInvites`) |
| Redeem didn't demote an existing editor | Redemption is upgrade-only by design (`invites.ts:80`) |

**Discriminating experiment:** inspect the invite row (`redeemedAt`, `expiresAt`, `role`)
and count the user's owned routines (`deletedAt IS NULL`) in D1. If behavior contradicts
the table above, *then* it's a bug — start at `POST /api/invites/:token/redeem`
(`apps/worker/src/index.ts:651`) and check that `refreshConnectedRoles` fired (row 6).
One D31 wrinkle since PR #137: the cap is `routineCapFor` (`db/admin.ts`) — an admin-granted
`routineCapOverride` beats `FREE_ROUTINE_CAP`, on create AND fork; check `/api/me`'s
`routineCap` before calling a non-402 a bug.

### 8. Worker test failures from DO id reuse

`apps/worker/vitest.config.ts:32` sets `isolatedStorage: false` — mandatory because
SQLite-backed DOs break vitest-pool-workers' isolated-storage teardown (`-shm`/`-wal`
sidecars; M0.5 spike finding). Consequence: **DO and D1 storage persist across every test
in the run.** A test that reuses a DO name inherits another test's doc.

**Symptoms:** a worker test passes alone (`vitest run <file>`) but fails in the full suite,
or fails on the second run; assertions find unexpected pre-existing changes/rows;
`seedDoc` no-clobber trips "randomly".

**Fix pattern:** every test must mint a unique DO id via
`uniqueDocStub(env.DOC_DO, "routine")` from `apps/worker/src/test-support/do-id.ts`
(UUID-suffixed names). Never hardcode a DO name; never share one across tests. Debug
hooks for asserting DO-internal state (`reloadForTest`, `debugChangeRowCount`,
`buildChangeForTest`, `runAlarmForTest`, `debugPersistedSize`) are catalogued in
ballroom-flow-diagnostics-and-tooling.

### 9. Shared-D1 migration collisions ("no such table")

Same shared-storage root: D1 is one database for the whole worker test run, and every
suite migrates it. The historical race: `applyD1Migrations`'s `d1_migrations` bookkeeping
collided under concurrency, making a suite skip its CREATEs → "no such table" (~4 tests,
internal #173/#203; an earlier half-fix was even lost in a squash race, 79b927d — see traps).

**Current fix (do not regress):** `apps/worker/src/test-support/seed.ts` runs the migration
SQL **directly** (idempotent `CREATE … IF NOT EXISTS`), deliberately *not* via
`applyD1Migrations` (comment at `seed.ts:98-104`). If you see "no such table" today: a new
migration file probably isn't idempotent, or a suite bypasses the shared seed helper. Do
not reintroduce the bookkeeping or an error-swallow that masks a missing schema.

### 10. Axe (accessibility) test timeouts

Root-caused as deterministic, not random (b419e0a, ad22e16): axe cost is O(DOM nodes). A
prop-less `<FigureLibrary/>` renders the entire ~240-figure catalog (~3000 nodes) →
13–17s under parallel CI load vs a 5s default timeout — a timeout-*edge*, not a flake.

**Fix pattern** (already in `apps/web/src/components/a11y.test.tsx:34-40`): render ONE
dance (~585 nodes; every distinct element kind is still exercised since figure cards are
structurally identical) plus timeout headroom (`AXE_TIMEOUT_MS = 20_000`,
`a11y.test.tsx:50`, as of 2026-07-02). If a *new* screen's axe sweep
times out, count its nodes first — shrink the fixture to the distinct-markup subset before
touching timeouts.

### 11. Known noise that is NOT an error

Wrangler telemetry 403s, workerd `Broken pipe` at E2E shutdown, jsdom's
`Failed to parse URL` stderr, the deliberate `doc-do alarm ... projection failed`
error-path test line, and the Vite chunk-size warning are all verified harmless (as
of 2026-07-02, HEAD `c9622c9`; `pnpm lint` is warning-free at this HEAD — the old
`fork.test.ts:282` baseline warning is gone) — do not
"fix" them, do not let them distract a triage. The canonical table with per-line
interpretation lives in **ballroom-flow-diagnostics-and-tooling** §3; the rule of
thumb: a line is only noise if the run's exit code and test verdicts are green.

Also not a code bug: Playwright browser-version mismatches in sandboxes (`playwright
install` blocked by proxy) — that's an environment issue; see ballroom-flow-build-and-env.

### 12. A change is silently swallowed (`ingestChange`/`applyRawChange` → false, heads unchanged)

`ingestChange` treats "heads unchanged after apply" as a duplicate — but Automerge also
leaves heads unchanged when it **defers** a change whose deps are missing, so a change built
on a lineage the live doc never applied is silently dropped. That mechanism is permanent
knowledge; its one known instance is the 2026-07-02 **migrateOnLoad incident** (#133/#135
interaction, **FIXED by PR #139/`903d109`**): `migrateOnLoad` persisted its migration change
during transient reads (`getFigureSnapshot`, connect catch-up — both call `loadPersisted`
directly, not `getDoc`) without advancing the instance's materialized `this.doc`, so the
persisted change log and the live doc forked. The fix: `migrateOnLoad` now **adopts the
migrated clone** (`this.doc = fresh`, `apps/worker/src/doc-do.ts:265`, in `migrateOnLoad`
:241) — safe because every ingested change is persisted immediately, so `this.doc` is always
a prefix of what SQLite replays. Seeing this symptom today means a **new** path persists
without advancing the in-memory doc, or a regression of that fix.

**Discriminating experiment:** decode the persisted change log (`A.decodeChange` over the
DO's stored changes; `debugChangeRowCount` for the count) and compare against
`A.getAllChanges(live doc)` / their heads. If the persisted log contains a change the live
doc lacks (the incident's signature: persisted = `[seed, ballroom:migrate(deps seed)]`,
live = `[seed]`), you have lineage divergence — the swallowed change is *deferred*, not
duplicate.

**Fix pattern:** the change log must never contain a change the live doc hasn't applied —
any path that persists a change must also advance (or adopt) the in-memory doc (PR #139's
fix), the invariant `ingestChange` itself maintains by persisting only after a successful
apply. Pattern 2 in **ballroom-flow-failure-archaeology** ("open ≠ hydrated ≠ durable").

---

## Traps that cost real time

- **The wrong-base-branch incident** (PRs #83/#85): a whole figure-library package was
  built from stale `main` instead of `development`, duplicating existing code; fully
  reverted (~1269 lines discarded) and redone. Check your base branch before writing code
  — the pre-push hook now blocks direct pushes to `main`/`development`.
- **The deployed auth-bypass build** (e71d06d): E2E built its `VITE_E2E=1` bypass bundle
  into the same `apps/web/dist` the deploy shipped — every "successful" staging deploy
  served the bypass. Fixed by *output isolation* (`dist-e2e`, separate wrangler env), not
  step reordering. Never point a deploy and a test build at the same artifact dir.
- **Fix lost in a squash race** (79b927d): the shared-D1 fix was half-dropped when a
  concurrent squash-merge clobbered it; ~4 tests failed on re-runs. After any squash/merge
  race, re-verify that *your* hunks survived.
- **Right idea, retired architecture** (PR #90, closed unmerged): a load-state fix was
  built against the already-replaced online-only RPC design. Before fixing a store/sync
  bug, confirm which seam is current (`apps/web/src/store/` is the only Automerge/RPC seam).
- **Skipped tests with stale reasons** (d49fb52): E2E convergence journeys sat skipped as
  "not built yet" long after the machinery existed. When triaging coverage, read skip
  reasons skeptically and check `docs/TEST-MAP.md`.
- **Two bugs, one symptom** (97e7fea then 4ef16ac): the reload-loss flake survived its
  "fix" because it was two flake classes. If a symptom persists after a correct fix,
  re-classify instead of doubting the fix.

## Diagnostic tooling quick pointers

Depth for all of these lives in **ballroom-flow-diagnostics-and-tooling**; the four you'll
reach for during triage:

- **`--repeat-each`** — `pnpm exec playwright test <spec> --repeat-each=10 --project=chromium-desktop`
  (from `apps/web/`) for durability/timing flakes; this is what caught 4ef16ac.
- **Two-user E2E helpers** — `openTwoUsers` / `expectConverged` in
  `apps/web/e2e/support/two-users.ts` for any convergence or flicker repro.
- **DO debug hooks** — `reloadForTest`, `debugChangeRowCount`, `buildChangeForTest`,
  `runAlarmForTest`, `debugPersistedSize` on `DocDO` (`apps/worker/src/doc-do.ts:768-867,1226`)
  for hydrated-vs-durable and alarm questions.
- **Playwright traces** — config already sets `retries: 1` + `trace: "on-first-retry"`
  (`apps/web/playwright.config.ts:21,32`); a CI E2E failure's second attempt has a full
  trace. E2E runs serialized (`workers: 1`, shared D1) — don't parallelize it to "speed up
  debugging".

When the fix is scoped: TDD + PR-into-`main` rules are in
**ballroom-flow-change-control**; keep `docs/concepts/` + `docs/system/` in sync in the same change.

## Provenance and maintenance

Written 2026-07-02 against repo HEAD `70eed7e`; refreshed at `3693ff6`; **refreshed again
2026-07-02 — verified at HEAD `c9622c9`** (after PRs #139/#136/#137 — line anchors in
`doc-do.ts`/`doc-connection.ts`/`routine.ts`/`membership.ts` re-verified; row 12's incident
now FIXED by PR #139/`903d109`; PR #140 closed as superseded) on `development`. All file:line pointers,
enum values, table/column names, and commit hashes verified directly against the working
tree and `git log` on that date; historical narratives cross-checked against commit
messages and in-code comments (e.g. `seed.ts:98-104`, `do-id.ts` header, `a11y.test.tsx`
comments). Internal issue numbers (#63, #168, #173, #202…) are from a gitignored ledger
and do NOT resolve on GitHub; PR numbers and hashes do.

Re-verification one-liners for drift-prone facts:

```bash
grep -n "FigureLoadStatus" apps/web/src/store/routine.ts        # five load states (:72)
grep -n "SYNC_CAUGHT_UP" packages/contract/src/index.ts         # hydration marker (:149)
grep -n "isolatedStorage" apps/worker/vitest.config.ts          # false → unique DO ids
grep -n "FREE_ROUTINE_CAP" apps/worker/src/db/routines.ts       # quota cap (=3)
grep -n "DEFAULT_TTL_MS" apps/worker/src/db/invites.ts          # invite TTL (7d)
grep -n "refreshConnectedRoles\|seedDoc\|runAlarmForTest" apps/worker/src/doc-do.ts
grep -n "trace\|retries" apps/web/playwright.config.ts
git log -1 --format='%h %s' 42f7d39 90bed2d 9edab0a 99fa1b9     # cited fixes still reachable
```
