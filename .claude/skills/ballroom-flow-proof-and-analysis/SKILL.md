---
name: ballroom-flow-proof-and-analysis
description: Load when a claim about Ballroom Flow needs PROVING rather than trusting — convergence of a CRDT change, soundness of an undo inverse, safety of an authorization path, correctness of imported figure data, correctness of a data model under concurrency, or performance of a D1 query. Also load when reviewing a PR that touches sync, permissions, undo, ordering, or the figure catalog, or when adjudicating a design dispute.
---

# Ballroom Flow — proof & analysis methods

Seven repeatable methods this project uses to turn "looks right" into "proven right".
Each bit this repo got wrong was *plausible*; each fix was found by one of these
methods, not by staring harder. Every recipe below has a worked example from this
repo's own history with exact code pointers.

**When NOT to use this:**
- You want the *social/process* discipline around research (how to source, when to
  spawn a verifier agent, how to record decisions) → **ballroom-flow-research-methodology**.
  This skill is the *technical proof techniques*; that one is the surrounding workflow.
- You need to *understand* Automerge/CRDT mechanics (heads, changes, actors, merge) →
  **ballroom-flow-crdt-reference**.
- You're diagnosing a live failure, not proving a claim → **ballroom-flow-debugging-playbook**.
- You want the story of a past incident → **ballroom-flow-failure-archaeology**.
- You're regenerating or extending the figure catalog itself → **ballroom-flow-figure-data-pipeline**.

Quick terms (defined once): **CRDT** = Conflict-free Replicated Data Type, a data
structure where concurrent edits merge deterministically without a server arbiter.
**Automerge** = the CRDT library used here (`@automerge/automerge`). **Heads** = the
set of hashes of a doc's latest changes — two docs with equal sorted heads are in the
same logical state. **LWW** = last-writer-wins, Automerge's per-field conflict rule.
**DO** = Cloudflare Durable Object (one per document, hosts the doc). **D1** =
Cloudflare's SQLite database, used here only as an index over docs.

## Method index

| # | Method | Use when the claim is… |
|---|--------|------------------------|
| 1 | Property-based convergence proof | "this edit shape converges under concurrency" |
| 2 | Adversarial refutation | "this imported/generated data is correct" |
| 3 | Authorization analysis by effect | "this endpoint/socket can't be abused" |
| 4 | Inverse/undo soundness reasoning | "this undo/inverse is safe against concurrent peers" |
| 5 | Query-plan proof (EXPLAIN as CI theorem) | "this D1 query is fast / stays fast" |
| 6 | Named-scenario adjudication | "model A is better than model B" (design dispute) |
| 7 | State-transition completeness | "this async lifecycle has no gap states" |

---

## 1. Property-based convergence proof

**Claim shape:** "clients can concurrently do X and every replica ends in the same
state with no lost edits."

Example-based tests cannot prove this — the failure space is *orderings*, and a
hand-picked ordering is exactly the one that works. Use fast-check (property-based
testing library, already a domain devDependency) to generate random edit sequences,
apply them shuffled and partitioned, and assert convergence by **sorted heads**, never
by `save()` bytes (bytes are NOT canonical across merge orders — M0.5 finding, see
docs/spike/SPIKE-FINDINGS.md).

**Recipe**
1. Model the edit as a pure mutation on a domain doc (`packages/domain/src/doc-*.ts` builders).
2. Reuse the fixture helpers in `packages/domain/src/__fixtures__/convergence.ts`:
   - `applyMutations(doc, mutations)` — clones first (Automerge 3.x marks a doc
     "outdated" after change/merge; reusing it throws).
   - `exchangeAndAssertConverged(left, right)` — full bidirectional merge, asserts heads equal.
   - `assertCommutative(base, changes)` — forward vs reversed application.
   - `assertIdempotent(doc, changes)` — duplicate delivery is a no-op (the WS invariant).
   - `assertHeadsEqual(A, a, b)` — sorted-heads comparison; **throws**, so it works
     inside fast-check predicates.
3. For the property: draw writes from a **small key pool** so writes collide on the
   same cell — you want LWW-conflict commutativity, not just independent-change
   commutativity. See `packages/domain/src/convergence.test.ts:66` (keys a–d, 1–8
   writes, `numRuns: 50`).
4. Add the three fixed adversarial cases the property can't express: concurrent edit
   to a *moved* element, two concurrent moves of the *same* element, reorder + rename
   vs concurrent soft-delete.
5. Run: `pnpm --filter @ballroom/domain exec vitest run src/convergence.test.ts`
   (8 tests green as of 2026-07-02).

**Worked example — the sortKey reorder proof (internal #63, commit 38dfba7, PR #107).**
Reorder was implemented as a JSON-copy **splice**: delete the placement, re-insert a
plain copy at the new index. Every single-client test passed. What example tests
missed and the convergence cases caught:
- The splice *deleted the Automerge object* — a concurrent edit to the moved
  placement landed on a tombstoned object and was lost.
- Two concurrent splices produced divergent arrays.

The fix is fractional indexing: each element carries a base-62 `sortKey`
(`packages/domain/src/order.ts`, `keyBetween(a, b)` mints a key strictly between two
keys); a move is a **per-field write on a stable object**, never delete-and-reinsert.
The proof tests live in `packages/domain/src/convergence.test.ts:155-277`:
same-section concurrent reorders converge deterministically; a concurrent
`perPlacementAlignment` edit on the *moved* placement **survives** (line 183 — the
exact case the splice lost); same-placement double-move resolves by LWW on `sortKey`
with both replicas agreeing. `order.test.ts:88` adds the fast-check property that
`keyBetween` lands strictly between random valid bounds.

**Rule this proved (bitten twice — see method 4):** never address Automerge list
elements positionally across time; never delete-and-reinsert to move.

---

## 2. Adversarial refutation

**Claim shape:** "this batch of imported/generated data (or bulk mechanical change)
is correct."

The generator of a claim is the worst validator of it. Assign an **independent
verifier whose job is to REFUTE each item against primary sources**, with a skeptical
default: unverifiable = not applied.

**Recipe**
1. The proposing pass produces a *list of discrete cell-level changes*, each with a
   cited source — never a blob diff.
2. A separate verifier (different agent/session — see ballroom-flow-research-methodology
   for how to spawn and brief one) re-fetches every source independently and judges
   each change into exactly three buckets:
   - **CONFIRM** — source clearly supports the new value → apply.
   - **REJECT** — source contradicts, or a correct value was wrongly removed → drop.
   - **UNCLEAR** — source silent/ambiguous → leave the existing value as-is (do NOT
     apply "probably right" changes).
3. Record the tallies and representative catches in the commit message — that's the
   proof artifact.
4. If neither the old nor the proposed value matches the source, the verifier may
   propose its own **source-cited** replacement (a fourth outcome, kept rare).
5. When representation can't express the truth (e.g. an enum too small), **drop the
   change and file the vocabulary gap** rather than mis-stating.

**Worked example — the figure-chart verification (commit 58a11f6, 2026-07-01).**
The charting agents proposed 203 per-step technique corrections to the figure catalog
(`docs/seed/figure-charts.json` → `packages/domain/src/figure-charts.generated.ts`).
The adversarial verifier judged them **160 CONFIRM / 18 REJECT / 23 UNCLEAR-left-as-is**;
40 figures corrected, 0 step counts changed. What the rejections caught:
- A **CBMP-mistaken-for-CBM** addition (CBMP is a *foot position*, CBM is a *body
  action* — distinct concepts; see ballroom-dance-reference). Plausible to anyone,
  wrong to the source.
- Pivot footwork wrongly applied to *entry walks* of natural-pivot/outside-spin.
- Foxtrot Three Step sway removed while its side-leading was kept (source charts both).
- Genuine 5/8–7/8 turns were **dropped, not capped**, because the turn enum then maxed
  at a half — the enum was widened in a separate change (d2d4b75).

Same posture, earlier: 37 figures with no verifiable per-step source were **removed
rather than guessed** (1f67e38, 241→204 figures), and two *designer* errors in the
canonical design bundle were pushed back on rather than adopted (4b9cf8a). Correctness
by verification, not generation.

---

## 3. Authorization analysis by effect, not label

**Claim shape:** "role R cannot do harm through surface S."

Never trust anything the client sends as a *description* of what it's doing. Analyze
what a hostile client actually **controls**, and classify requests by their **observed
effect** on state.

**Recipe**
1. Enumerate every client-controlled input on the surface: WS frame contents, JSON
   body fields (`authorId`, `routineId`, `figureRef`…), URL params, timing (send after
   your role changed), and *replay/repeat* (post an existing id — is the write an upsert?).
2. For each, ask: "if this field lies, what state changes?" Labels lie; effects don't.
3. For CRDT frames: classify by **apply-and-diff** — clone the current doc, apply the
   frame, diff before/after, and gate on what actually changed. Compare with
   tombstones included (a structural soft-delete is still structural).
4. Check identity against the **socket-verified subject** (`sub` from the Clerk
   token), never a client-supplied author field.
5. Check the *time dimension*: is authorization re-evaluated after membership changes,
   or frozen at handshake?
6. Check the *owner asymmetry*: owners have no membership row
   (`resolveEffectiveRole`, `apps/worker/src/db/membership.ts:49` elevates them) — any
   logic built from `listMembers` silently excludes the owner (bit in 92ace53).

**Worked examples (three real holes, all in `apps/worker/src/`):**
- **Effect-based commenter gate** (eb04a33, hardened 99fa1b9):
  `DocDO.commenterChangeAllowed` (`apps/worker/src/doc-do.ts:484`) applies the frame
  to a **clone**, reads before/after with `includeDeleted: true`, and requires
  (1) structure untouched — everything except `annotations` JSON-equal — and
  (2) authorship against the socket's verified `sub`: create only your own annotations,
  reply to anyone's, edit/tombstone only your own, no hard removals. Before the S2 fix
  a commenter could tombstone ANY author's annotation because `authorId` is
  client-controlled. A "this is just an annotation" *label* would have been trivially
  smuggleable; the apply-and-diff *effect* check is not.
- **Upsert-as-escalation** (089dbc0, 2026-07-02): `POST /api/figures` accepted any
  authenticated caller and upserted. Effect analysis: posting an EXISTING `figureRef`
  owned by someone else rewrote the victim's registry title AND inserted the caller as
  editor; an unchecked `routineId` let the caller cascade themselves to editor via the
  placement edge (`apps/worker/src/db/placement-edge.ts:26`). Fix: caller must resolve
  editor/owner on `routineId` first; `createFigureRows` is a guarded insert
  (`onConflictDoNothing` + owner re-read, `apps/worker/src/db/figures.ts:38`) returning
  `"owner_conflict"` → route 409s with **zero writes**.
- **Frozen-role-in-attachment** (99fa1b9 S1): role was resolved once at connect and
  stored in the DO hibernation attachment — a removed editor kept live write access
  until reconnect. Fix: `refreshConnectedRoles()` (`apps/worker/src/doc-do.ts:543`)
  re-resolves every open socket from D1, closes revoked members with code 1008, and
  re-attaches changed roles; called by member-removal and invite-redeem routes.

**Checklist for any new auth surface:** hostile-input inventory · effect not label ·
verified `sub` not client author · re-check on membership change · owner-without-row ·
repeat/replay is not an upsert · failure path writes nothing.

---

## 4. Inverse/undo soundness reasoning

**Claim shape:** "applying the inverse of change C is safe on a doc that has moved on
since C."

Undo here is history-based (no op-log): find the user's own last change, compute its
inverse with `A.diff`, apply it as a *new* change so it merges with concurrent edits
(`packages/domain/src/undo.ts`; PLAN §5.4/D14). The subtlety: an inverse computed
against history is only valid *in* that history.

**Recipe — three obligations, each with a proof step:**
1. **Index validity.** `A.diff(doc, [target.hash], target.deps)` patches carry
   list indices valid only in the historical state. Never replay them positionally
   against the live doc. Instead: reconstruct the historical after-state
   (`A.toJS(A.view(doc, [target.hash]))`, undo.ts:376), replay the patches there
   (where indices are exact) while recording **identity-anchored ops** — "remove
   element with id X", "set field F of object with id X" (`recordIdentityOps`,
   undo.ts:212) — then apply those to the live doc in one `A.change`
   (`applyIdentityOps`, undo.ts:316). A moved element is found by id; a deleted one
   makes the op a no-op.
2. **Single application.** Prove each change is reverted at most once. The mechanism
   is a **ledger in change messages**: each undo change's message is
   `ballroom:undo:<revertedHash>` (redo: `ballroom:redo:<undoHash>`); `revertedSet`
   (undo.ts:79) replays the messages to compute what's currently reverted, and target
   selection skips it. Because the ledger lives in ordinary change messages, it
   survives reloads and merges like all other state.
3. **Inverse totality.** Verify every patch type your data can produce actually
   inverts. Text deletion's inverse silently no-opped until 3725ec9 (the `del`-on-a-
   string-field case now reconstructs the parent string).

**Worked example — commit 3725ec9's three failure modes (all review-verified, none
caught by the existing example tests):**
(a) A and B both insert at index 0 → A's undo, replayed positionally, deleted **B's**
element. (b) A second undo press re-selected and re-inverted the SAME change —
verified sequence: `[x,y]` → insert → undo → undo deleted `y`. (c) String-deletion
inverse was a silent no-op. Regression tests: `packages/domain/src/undo.test.ts`
("a second undo press never re-inverts the same change", :254; "successive undos walk
back … each reverted at most once", :276).

Note this is the second bite of the method-1 rule (positional vs identity addressing).
When reviewing ANY code that replays historical Automerge patches, ask: "against which
state are these indices valid?"

Related soft rule: "superseded by others" is a **hint, never a refusal**
(`wasSupersededByOthers`, undo.ts:441) — undo still applies; the UI may warn.

---

## 5. Query-plan proof — EXPLAIN no-SCAN as a CI-enforced theorem

**Claim shape:** "this D1 query is indexed and will stay indexed."

D1 bills by rows **scanned**, not rows returned, and a missing index is invisible on
small dev data. So the project states index usage as a theorem and has CI check it on
every PR: no `EXPLAIN QUERY PLAN` access path may contain `SCAN`.

**Recipe**
1. Write the query (Drizzle or raw SQL) and its supporting index/migration
   (`apps/worker/migrations/`).
2. In the query's worker test suite, assert the plan:
   ```ts
   import { expectIndexedQuery } from "./test-support/explain"; // apps/worker/src/test-support/explain.ts:42
   await expectIndexedQuery(env.DB, "SELECT role FROM membership WHERE docRef = ? AND userId = ? AND deletedAt IS NULL", ["rt_x", "u1"]);
   ```
   For a typed Drizzle query use `expectIndexedDrizzle(db, query)` (explain.ts:80 —
   feeds `query.toSQL()` through). Run after `applyMigrations()` in the suite's
   `beforeAll` (shared D1; see docs/DEVELOPMENT.md harness conventions).
3. The helper runs `EXPLAIN QUERY PLAN <sql>` and fails the test on any `detail`
   containing `SCAN` unless allow-listed (`opts.allow` — reserve for tiny reference
   tables). `SEARCH … USING INDEX` and covering-index paths pass.
4. Because the worker suite runs in the PR fast-gate (`.github/workflows/ci.yml`),
   a future migration or query change that regresses the plan **fails CI** — the
   theorem is enforced, not documented.

**Worked example — the `forkedFromTitle` self-join.** The Choreo list resolves a
fork's origin title in the same read via a LEFT self-join of `document_registry`
aliased as `origin` on `forkedFromRef` (`apps/worker/src/db/routines.ts:99-124`,
`alias(documentRegistry, "origin")`). The proof that this join is a **PK lookup, not
a table scan** — outer rows from `document_registry_owner_idx`, origin title from the
primary key — is a live test: `apps/worker/src/doc-do.test.ts:727` ("keeps the joined
Choreo-list query indexed (EXPLAIN, no SCAN)"). Additional EXPLAIN assertions ship
with the search, custom-kinds, quota, permissions, and figuretype-visibility suites;
`apps/worker/src/ops.test.ts` holds the catalog of core-path assertions (partly
skipped pending M8 — as of 2026-07-02).

---

## 6. Named-scenario adjudication for model disputes

**Claim shape:** "design A beats design B" — where both are internally coherent and
the argument is going in circles.

Abstract debate rewards eloquence. This project settles model disputes by writing
down **one concrete, named, end-to-end scenario first**, deriving the observations a
correct system must produce, and only THEN scoring each design against them. The
scenario name then becomes the permanent shorthand for the decision.

**Recipe**
1. Write the scenario as a story with real domain objects and a timeline —
   specific figures, specific users, specific edits. Name it.
2. Derive the expected observations *before* evaluating any design ("after the
   catalog edit, placement 1 shows the new values on all beats; placement 2 shows
   them only on its untouched beats").
3. Walk each candidate design through the scenario mechanically. A design that
   cannot produce the observations is dead regardless of its other virtues.
4. Record the decision AND the rejected alternative with its failure inline in
   docs/PLAN.md (§8 decisions / §12 questions) — that's what stops the debate from
   reopening. Pin the scenario with a test named after it.
   (Process details: ballroom-flow-change-control.)

**Worked example A — the Passing Tumble Turn (decided PLAN v5, 2026-07-02).** The
figure model had oscillated: live-overlay (v4) → frozen-copy (2026-06-29, PRs
#97/#99/#100) → back to live. The scenario that ended it (docs/PLAN.md §5.2, and the
v5 banner near the top): *a Slowfox choreo places the catalog Tumble Turn twice — once
plain, once danced as a "Passing Tumble Turn" with the last ~3 beats re-choreographed.
The catalog figure later gains values of a new attribute kind.* Expected observations:
the plain placement shows the new values on every beat (live reference); the Passing
variant shows them on untouched beats only — its re-choreographed beats stay exactly
as authored. Frozen copies fail observation 1; the old v4 whole-figure overlay fails
observation 2. What satisfies both is **per-beat ownership** —
`resolveFigure(base, variant)` (`packages/domain/src/fork.ts:132`): a beat the variant
carries any attribute on (live OR tombstoned) reads wholly from the variant; every
other beat reads live from the base. The scenario is pinned as a test:
`packages/domain/src/fork.test.ts:281` ("the Passing Tumble Turn: base additions reach
untouched beats only (§5.2)").

**Worked example B — the US-015 convergence journeys killing read-by-default
(PR #95, PLAN D10).** First cut: read via REST snapshot + polling for *everyone*,
upgrading to WS on first edit. The named scenario was already executable — the @smoke
two-client convergence journeys (`apps/web/e2e/convergence.spec.ts`, helper
`openTwoUsers`/`expectConverged` in `apps/web/e2e/support/two-users.ts`): a passive
co-editor must see the other editor's change live. On a polled snapshot they'd see it
in ~20s. Five journeys failed; the design was rejected **within the same PR** and
replaced by the role-aware hybrid (viewers zero sockets; editors/commenters one eager
routine WS; per-figure WS on editor open). D10 records the rejected variant and why —
"a passive co-editor on a polled snapshot can't receive another editor's edits live."

Earlier instance of the same pattern: Yjs was the researched recommendation; the
*forking* scenario (full cross-routine fork power) reversed it to Automerge (v4,
370de7c). Product scenario beat library benchmark.

---

## 7. State-transition completeness

**Claim shape:** "this async lifecycle is handled."

The recurring bug family (three incidents in two days, 2026-06-26/28): collapsing
distinct states of an async pipeline into one boolean. For a synced document, **open ≠
hydrated ≠ durable ≠ broadcast** — four separately-acknowledged facts:

| State | Meaning | Acknowledgment mechanism (this repo) |
|---|---|---|
| **open** | socket connected | WS open event — proves nothing about content |
| **hydrated** | server catch-up applied locally | `SYNC_CAUGHT_UP` marker frame (`packages/contract/src/index.ts:140`, sent by the DO at `apps/worker/src/doc-do.ts:430`; client flips to `"live"` only on receiving it, `apps/web/src/store/doc-connection.ts:332`) |
| **durable** | content persisted server-side | server-side `seedDoc` RPC before any client connects (doc-do.ts:208, no-clobber) |
| **broadcast** | other connected clients told | explicit `broadcast` after persist (seedDoc broadcasts its seed, doc-do.ts:222) |

**Recipe**
1. For any async resource, enumerate every state a peer could observe — including the
   embarrassing intermediate ones. Write the enum down as a type, not a boolean
   (`SyncState = "connecting" | "live" | "closed"`, doc-connection.ts:88;
   `FigureLoadStatus = "pending" | "loading" | "live" | "missing" | "error"`,
   `apps/web/src/store/routine.ts:67`).
2. For each transition, name its **explicit acknowledgment signal**. "The next step
   usually runs fast enough" is a localhost-timing proof, i.e. not one.
3. Prove each distinct state renders/behaves distinctly — loading must never render
   as missing (the "Unknown figure" saga: null figure now renders a skeleton, 621721e).
4. Flush the transitions with `--repeat-each` on the E2E journey (how 4ef16ac's
   durability hole was caught) and by killing the connection between steps.

**Worked example — the hydration & durability saga (PRs #56/#57/#58 + #81/#94):**
- 97e7fea: store flipped "live" on socket **OPEN**, before catch-up applied — edits
  landed in a not-yet-replayed doc. Passed locally on timing alone. Fix = the
  `SYNC_CAUGHT_UP` marker (open ≠ hydrated).
- 4ef16ac: initial content was written by the **client** after create; an immediate
  reload showed "Untitled routine". Fix = server-side no-clobber `seedDoc` before any
  client connects (hydrated ≠ durable).
- c43ebed: connect catch-up called `getDoc()`, which auto-materialized **and
  persisted** an empty placeholder into an unseeded DO — tripping seedDoc's no-clobber
  guard forever; and seedDoc persisted but never **broadcast**, so already-connected
  sockets stayed empty (durable ≠ broadcast). Fixes: `loadPersisted` (no
  auto-materialize) on the catch-up path (doc-do.ts:159) + seedDoc broadcasts.
- 9509d30: client opened the figure's DO connection **before** `POST /api/figures`
  seeded it → empty catch-up. Fix: connect only after create resolves.

Same family, still open as of 2026-07-02 (PLAN §9, D10): reconnect resend of
unacknowledged local changes (a change sent into a dying socket must not be silently
lost) and broadcast-send failure → mark socket for resync. If you touch sync, these
are the transitions to prove next — see ballroom-flow-v5-migration-campaign.

---

## Choosing a method (symptom → proof)

| You're about to say… | Prove it with |
|---|---|
| "concurrent edits to this can't conflict" | 1 (property convergence + fixed adversarial cases) |
| "the imported data looks right" | 2 (independent refutation, CONFIRM/REJECT/UNCLEAR) |
| "only editors can do that" | 3 (hostile-input inventory + apply-and-diff) |
| "undo just re-applies the diff" | 4 (identity ops + reverted ledger + inverse totality) |
| "SQLite will use the index" | 5 (expectIndexedQuery in the suite CI runs) |
| "model A is obviously better" | 6 (named scenario first, judge second) |
| "once the socket's open we're fine" | 7 (state enum + per-transition ack) |

## Provenance and maintenance

Authored 2026-07-02 against repo HEAD 70eed7e on `development`. Verified directly:
`packages/domain/src/convergence.test.ts` and `order.test.ts` read in full and run
green (8 and 23 tests); `__fixtures__/convergence.ts` helper signatures;
`undo.ts` internals (revertedSet :79, recordIdentityOps :212, applyIdentityOps :316,
invertChange :372); `fork.ts` `resolveFigure` :132 / `ownedBeats` :117;
`apps/worker/src/doc-do.ts` `commenterChangeAllowed` :484 / `refreshConnectedRoles`
:543 / SYNC_CAUGHT_UP send :430; `test-support/explain.ts` in full;
`db/routines.ts` self-join :99-124 and its EXPLAIN test `doc-do.test.ts:727`;
commit messages of 38dfba7, 58a11f6, eb04a33, 089dbc0, 99fa1b9, 3725ec9, 97e7fea,
4ef16ac, 9edab0a. Internal ledger numbers (#63, #161, #202, #205) do NOT resolve on
GitHub; PR numbers and hashes do.

Re-verify if drifted:
- `grep -n "assertHeadsEqual" packages/domain/src/__fixtures__/convergence.ts`
- `grep -n "commenterChangeAllowed\|refreshConnectedRoles" apps/worker/src/doc-do.ts`
- `grep -n "recordIdentityOps\|revertedSet" packages/domain/src/undo.ts`
- `grep -rn "expectIndexedQuery" apps/worker/src --include='*.test.ts' | head`
- `grep -n "Tumble Turn" docs/PLAN.md packages/domain/src/fork.test.ts`
- Line numbers cited above will drift first; symbol names and file paths are the stable anchors.
