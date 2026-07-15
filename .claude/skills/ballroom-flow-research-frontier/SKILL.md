---
name: ballroom-flow-research-frontier
description: Load when scoping work BEYOND the current milestone in weave-steps — offline editing, attribute-predicate anchors, DO fan-out at scale, the candidate-novel CRDT patterns, Latin/media/billing increments — or when someone proposes claiming anything externally (blog post, paper, benchmark, "we invented X"). Maps each frontier item to its asset in this repo, its first three concrete steps, and the falsifiable bar before any external claim.
---

# Weave Steps — the research frontier

This skill is the map of **what comes after the v5 migration milestone**: the open problems where this project could genuinely advance the state of the art, the smaller product increments whose seams already exist, and the discipline required before claiming anything externally. Every item below is **open / candidate / v1.1 — none of it is shipped**, and nothing here may be started ahead of the active milestone without an explicit owner decision recorded in the owning `docs/concepts/`/`docs/system/` doc (or a new `docs/ideas/` entry).

**When NOT to use this**
- Working the **active milestone** (v5 figure-model migration) → `ballroom-flow-v5-migration-campaign`. Everything in this skill assumes that campaign lands first.
- Learning **how Automerge/CRDTs work here** → `ballroom-flow-crdt-reference`. Understanding the seams → `ballroom-flow-architecture-contract`.
- Re-deriving or checking a **soundness argument** (undo, overlay resolution) → `ballroom-flow-proof-and-analysis`.
- **How to run** a research effort (sources, verification, adversarial review) → `ballroom-flow-research-methodology`.
- Process for landing any of this (TDD, PR into `main`, `docs/concepts/`/`docs/system/` updated in the same change) → `ballroom-flow-change-control`.
- Ballroom terminology (Latin vs Standard, spot vs travelling) → `ballroom-dance-reference`.

**Jargon used below** (one-liners; depth in the reference skills): *CRDT* = data structure whose concurrent edits merge deterministically without a central arbiter; *Automerge* = the CRDT library used here (git-like history per document); *DO* = Cloudflare Durable Object, a single-threaded stateful server instance — this app runs **one DO per document**; *D1* = Cloudflare's SQLite database, used here strictly as a derived index, never as the source of truth.

## Ground rules for all frontier work

1. **Sequencing:** the v5 migration (formerly `docs/PLAN.md` §9, now closed history — see `docs/README.md` § For historians) is COMPLETE as of 2026-07-02 (final box shipped in PR #141); only the tracked follow-up tail remains — weigh it before opening a frontier item. Frontier items 1–5 build on the v5 outputs (e.g. offline editing depended on reconnect resend and has since shipped; predicate anchors depend on the settled v5 figure model).
2. **Idea docs are change control.** Starting a frontier item means writing/updating its `docs/ideas/` doc in the same PR (formerly a docs/PLAN.md section) — including the rejected alternatives, the way D10's rejected read-split is now recorded in `docs/system/sync-and-offline.md` § The read/edit split.
3. **Nothing is "novel" until proven.** Every pattern in §4 below is labeled **candidate/unproven**. The reproducibility bar (§4.4) gates any external claim. The project's own data-integrity rule applies to claims about itself: verify, don't fabricate (see the figure-catalog precedent, PRs #117/#118 — unverifiable entries were deleted rather than guessed).
4. **Journey-gated done.** Since 2026-06-26, a feature is done only when its named Playwright journey (`apps/web/e2e/*.spec.ts`) is green on PR. Each item below names its journey.

---

## 1. Offline editing (formerly PLAN §11, v1.1 — SHIPPED since this item was written)

**Status note:** offline editing has since shipped — see `docs/concepts/collaboration.md`
§ Offline and `docs/system/sync-and-offline.md` § Offline editing (as built) for the
current, built behavior. The paragraph below is preserved as the historical frontier-item
framing (the state of the world when this section was written); treat it as superseded
rather than current.

**Why the current state fell short (as of authoring).** v1 was deliberately online-first (formerly `docs/PLAN.md` §11: "Offline *editing* … online-first in v1; additive (Automerge is local-first)"). At the time only the **app shell** worked offline (`vite-plugin-pwa` service worker) — and even that was **unverified**: the `@smoke` offline-shell journey existed in `apps/web/e2e/pwa-a11y.spec.ts` but was skipped pending M9 (`test.skip` at `pwa-a11y.spec.ts:17`). A disconnected user could not edit. In the ecosystem, offline-first CRDT persistence exists off-the-shelf (automerge-repo's IndexedDB storage adapter, Yjs y-indexeddb) — but this repo chose **core Automerge + a thin custom sync** (locked decision D6/D13, now `docs/system/architecture.md` § The shape), so nothing shipped it for free here. The genuinely hard parts were documented, not solved, in `research/critique-sync.md`: rejected offline edits are **silent data loss** unless surfaced; roles can change while a client is offline; a long-offline client can return with old-schema state. (Per the built implementation, silent loss was in fact avoided — see the sync-and-offline doc above.)

**This project's asset.** The `store/` seam: components never touch Automerge or the network (`apps/web/src/store/` is the only consumer of `lib/rpc.ts`), so persistence can be added entirely behind `apps/web/src/store/doc-connection.ts` without touching a component. Reconnect resend (#161) **shipped in PR #134** (2026-07-02): the client merges the server's snapshot catch-up and re-sends the changes the server lacks (`mergeSnapshot`/`resendMissing` in `doc-connection.ts`), plus the `pendingSends` buffer for not-yet-open sockets — offline editing is that machinery generalized from seconds to days. The convergence test harness exists (`apps/web/e2e/support/two-users.ts` — `openTwoUsers`/`expectConverged`), and `apps/web/e2e/convergence.spec.ts` already has a "reconnecting client re-hydrates without duplicating edits" journey. Automerge's merge semantics make the sync-after-partition core a solved problem — the work is persistence, UX truth-telling, and the permission edge.

**First three steps in this repo:**
1. The online prerequisites — **snapshot-frame catch-up** and **reconnect resend (#161)** — **landed in PR #134** (2026-07-02; `doc-connection.ts`/`doc-do.ts`). Verify they're still green (`convergence.spec.ts` @smoke) before building on them; the old PLAN §9 roadmap had no open boxes left (the last, figure-editor undo, shipped in PR #141) — it's now closed history, see `docs/README.md` § For historians.
2. Persist docs behind the seam: write `A.save(doc)` bytes to IndexedDB keyed by docRef (heads-stamped) inside `DocConnection`; on open, hydrate from IndexedDB before the network, then merge the server catch-up. Unit-test convergence with the existing helpers (`packages/domain/src/__fixtures__/convergence.ts` — `assertHeadsEqual`, never compare `save()` bytes across merge orders).
3. Write the journey first (TDD): new `apps/web/e2e/offline-editing.spec.ts` using `context.setOffline` (pattern already in `pwa-a11y.spec.ts`) + `openTwoUsers` — tab A goes offline and edits, tab B edits online, A reconnects, `expectConverged`. Include the ugly case: A's role is revoked while offline (the DO closes revoked sockets with code 1008 via `refreshConnectedRoles`, `apps/worker/src/doc-do.ts:638`) — the client must **surface** the rejected edits, never silently drop them (`research/critique-sync.md`'s core finding).

**You have a result when:** the named journey — *edit offline in two tabs, reconnect, converge with zero lost edits* — is green on PR CI, survives `--repeat-each` (the durability-flake standard set by PR #58), and the revoked-while-offline case shows an explicit user-visible outcome rather than silent loss.

---

## 2. Attribute-predicate annotation anchors (formerly PLAN §11.1, now `docs/ideas/attribute-predicate-anchors.md`, v1.1)

**Why the current state falls short.** v1 annotations anchor to a fixed point, a figure instance, or a `figureType` identity — all **static** sets. A coach's real note is often a predicate: "soften every left-side sway", "watch CBMP on every step that has it". No shipped anchor can target a **dynamic set re-evaluated on read**. In the ecosystem, annotation anchoring is overwhelmingly positional/identity-based; predicate anchors over structured CRDT content are essentially unexplored territory.

**This project's asset.** This is the rare frontier item that is **spec-complete and design-complete**. `docs/ideas/attribute-predicate-anchors.md` (formerly `docs/PLAN.md` §11.1) pins the anchor shape (`attributePredicate { kind, value, role?, scope }`, with `none` as an explicit selectable sentinel), resolution semantics (dynamic, matched by meaning through registry aliases), ownership/visibility (same model as figureType notes), and the UI (v4 wireframe frames 3.6→3.7, already mocked end-to-end — the link-picker "An attribute" target ships **visibly disabled** in the Journal editor today). And the generalization path exists in code: `matchesFigureType` (`packages/domain/src/figuretype.ts:28`) is the identity special-case of the predicate matcher; the **FigureTypeNoteIndex** (`apps/worker/migrations/0005_figure_type_note_index.sql`, queried in `apps/worker/src/db/family-notes.ts` and UNIONed in `db/journal.ts`) is the cross-account index pattern to clone; value normalization already exists (`normalizeValue` + `VALUE_ALIASES`, `packages/domain/src/vocabulary.ts:375-387`); and the content-comparison key is already defined (`attrMeaning` = `kind|count|role|value`, `packages/domain/src/fork.ts:104`).

**First three steps in this repo:**
1. Domain matcher first (pure, unit-testable): a `matchesAttributePredicate(anchor, figure)` beside `figuretype.ts`, built on `normalizeValue`, honoring `role?`, the `none` sentinel, and `appliesToDances` (Tango has no `rise`); extend the `Anchor` union (`packages/domain/src/doc-types.ts:105`) additively — reads are lenient (`parseAttributeRead`), so no data migration, but confirm against `packages/domain/src/migrations.ts` conventions. Property-test with `fast-check` alongside `figuretype-notes.test.ts`.
2. The index: a new D1 migration (next number after `0015_library_entry.sql`) creating `attribute_predicate_note_index` keyed `{kind, value, role?, scope}`, mirroring 0005; project it from account-doc annotations in the DO alarm (the `projectJournalToD1` pattern in `apps/worker/src/doc-do.ts`); gate every query with `expectIndexedQuery` (`apps/worker/src/test-support/explain.ts`).
3. UI last, from the design bundle: the frames already exist — per CLAUDE.md the flow is confirm/refresh the `docs/design/project/*.dc.html` prototype, then enable the disabled link-picker target and render the chip (*"↳ all left sways · every dance"*).

**You have a result when:** a journey shows a note "all left sways / every dance" (a) surfacing on matching steps in two routines in different dances, (b) appearing on a **newly added** matching step without touching the note, (c) disappearing when the sway is retagged, and (d) obeying the co-membership visibility gate — green on PR.

---

## 3. Per-document DO fan-out at scale (the standing watch-item)

**Why the current state falls short.** One Automerge doc = one DO (D23, now `docs/system/architecture.md` § Persistence & the DO lifecycle). A routine placing 30 figures touches up to 31 documents. `docs/PLAN.md` used to name "per-document DO fan-out at scale" a standing watch-item **twice** (§9 milestone outline and the closing note — both now closed history, see `docs/README.md` § For historians); this skill is its tracking location going forward, and it has never been measured — the role-aware read/edit split (D10, PR #95) cut the socket count qualitatively (viewers: zero sockets; editors: one routine WS, figure WS only on editor open), but **no latency, cost, or capacity numbers exist anywhere in the repo**. In the ecosystem, DO-per-entity designs are common but a per-document CRDT graph on DOs is not publicly characterized — which is exactly why guessing is worthless and measuring is publishable.

**This project's asset.** Measurement hooks already exist inside the DO: `debugChangeRowCount` (`apps/worker/src/doc-do.ts:778`), `debugPersistedSize` (:1226), `runAlarmForTest` (:867), `reloadForTest` (:768), with compaction at `COMPACT_THRESHOLD = 64` (:72). The v5 snapshot route also fans out to every variant base's DO — one more reason to measure before optimizing. The worker test layer runs on **real workerd** (`@cloudflare/vitest-pool-workers`), the full local stack scripts exist (`apps/web/e2e/serve.sh`), and staging is live. The load model can come from real product shape: 204-figure catalog (`packages/domain/src/library-data.ts`), 6-figure starter routine, couple+coach membership.

**First three steps in this repo — measure BEFORE optimizing:**
1. Write a load harness at the workerd test layer (`apps/worker/src/`, using `test-support/do-id.ts` + `doc-do-api.ts`): M simulated clients × K figure docs + 1 routine doc, scripted edit traces; record p50/p95 apply→broadcast latency, change-row growth, persisted size, and alarm/compaction cost. Keep it **out of the PR fast gate** (nightly, like the full E2E matrix).
2. Run one measured scenario against **staging** (real network, real hibernation) and pull DO duration/request counts from the Cloudflare dashboard; the cost question is load-bearing (the budget is ~$5/mo Workers Paid, formerly PLAN §1, now `docs/system/architecture.md` § Non-functional requirements; `research/platform.md` records a $134 D1 rows-scanned surprise-bill anecdote as the cautionary tale).
3. Write the numbers into the owning `docs/system/architecture.md` section (formerly `docs/PLAN.md`; dated, with the harness command line) and set an explicit budget (e.g. p95 edit→peer latency and $/active-couple/month at 1×/10×/100× the primary persona's load). Only then pick optimizations — the candidates are already recorded (compaction tuning, figure-socket pooling; snapshot-frame catch-up already shipped in PR #134) — each justified by a before/after delta **on the same harness**.

**You have a result when:** a dated table of measured p95 sync latency and cost at 1×/10×/100× load exists in the repo with a reproducible harness command, and every subsequent optimization PR cites its before/after numbers from that harness. (Anti-result: any optimization merged without a prior number.)

---

## 4. Candidate-novel CRDT engineering patterns — ALL candidate/unproven

Three patterns in this repo *may* be genuine contributions. **None may be called novel today.** Each needs the reproducibility bar (§4.4) first — starting with a literature check against at minimum: automerge-repo, Yjs (incl. UndoManager, y-partyserver/PartyKit), Loro, ElectricSQL, and current local-first community work (localfirstweb.dev, the Ink & Switch corpus).

### 4.1 Per-beat overlay variants over live bases (candidate)
- **What:** `resolveFigure(base, variant)` (`packages/domain/src/fork.ts:132`) resolves a figure per beat — a beat the variant **owns** (`ownedBeats`, :117) reads wholly from the variant; an unowned beat reads wholly from the **live** base, so upstream catalog edits flow into untouched beats only. `spawnVariant` (:205) + `variantAttributesForEdit` (:166, copy-down including tombstones) create ownership on first edit. Pinned by invariants #14–18 (formerly PLAN §2.5.1, now `docs/concepts/figures.md` § Variants) and the Passing Tumble Turn scenario test.
- **Vs the ecosystem:** Yjs/Automerge/Loro give whole-document merge; none ships field-granular *ownership overlays* over a live shared base. Closest prior art to check: Automerge's own branch/merge patterns, Loro's version-control features, operational overlays in collaborative design tools.
- **Honest status:** shipped end-to-end as of 2026-07-02 (HEAD `759b3a8`): the domain layer (PR #132), fork v5 (PR #133), and — via PRs #136/#137 — the store now spawns variants on a global-figure edit and resolves per-beat overlays on read (`apps/web/src/store/routine.ts` `resolveFigure` :1218 → domain overlay), with the worker snapshot supplying variant bases; the variant E2E journey in `fork-and-figures.spec.ts` is green on PR. Still thin for an external claim: zero production soak, and the model **oscillated** — live (v4) → frozen (2026-06-29) → live-with-per-beat-ownership (v5, PR #132) — any write-up must include that history honestly.

### 4.2 History-based per-user undo on Automerge (candidate)
- **What:** `packages/domain/src/undo.ts` — per-actor undo by inverting the actor's last change (`undoLastChange`, :399) with **identity-anchored** inverse ops (never positional indices), at-most-once revert via `ballroom:undo:<hash>` message tags, and a non-blocking `wasSupersededByOthers` hint (:441). Automerge has no built-in undo; this fills that gap.
- **Vs the ecosystem:** Yjs ships `UndoManager` (tracked-origins, scope-based). The comparison that matters: semantics under concurrency (what does "undo my change" mean when a peer edited the same element?), not just performance. The soundness history is a selling point *and* a warning — the first implementation had three real bugs (positional inverse deleted a peer's element; double-undo re-inverted destructively; text-deletion inverse no-opped), fixed in 3725ec9 (PR #132).
- **Bar before any claim:** an independent re-derivation of the soundness argument (use `ballroom-flow-proof-and-analysis`), adversarial property tests beyond the current suite, and a written semantic comparison against Yjs UndoManager on the same concurrent scenarios.

### 4.3 Document-graph-on-DO thin sync (candidate)
- **What:** core `@automerge/automerge` + a hand-rolled change-sync per document over hibernatable WebSockets (`apps/worker/src/doc-do.ts`), instead of automerge-repo — chosen at the M0.5 spike (D6/D13: "automerge-repo may not be needed"; `docs/spike/SPIKE-FINDINGS.md`), with the document *graph* (routine → figure refs, cross-doc permissions cascading via `placement-edge.ts`) layered on top.
- **Vs the ecosystem:** automerge-repo's sync protocol is delta-efficient and battle-tested; PLAN §12 used to explicitly reserve "adopt its sync protocol only if delta-efficiency demands" (now a candidate item tracked in this skill rather than a PLAN Q-entry). y-partyserver is single-doc-per-room (why Yjs lost, formerly PLAN §14, now `docs/README.md`'s history row). The open question is whether the thin sync's simplicity survives at scale — which is item 3's harness.
- **Bar before any claim:** a bytes-on-wire / round-trips benchmark vs automerge-repo on identical edit traces (the item-3 harness extended), plus a written comparison including what the thin sync *lacks* (e.g. no ephemeral/awareness channel, no storage-adapter ecosystem).

### 4.4 The reproducibility bar (applies to every pattern above)

No pattern may be described externally as novel, or even "unusual", until ALL of:

| # | Requirement | Concretely |
|---|---|---|
| 1 | Literature check | Written survey against automerge-repo, Yjs, Loro, ElectricSQL + current local-first work; dated; committed to `research/` |
| 2 | Benchmark vs the named alternative | Same workload, pinned versions, reproducible script committed in this repo, numbers in the doc |
| 3 | Written comparison | Including what the alternative does **better** and this design's limitations |
| 4 | Independent soundness re-derivation | For 4.1/4.2: a second derivation of the correctness argument not by the original author (see `ballroom-flow-proof-and-analysis`) |

---

## 5. Smaller product increments — the seams already exist

| Increment | Status in PLAN | The seam in this repo | First move |
|---|---|---|---|
| **Latin / spot dances** | Out of scope v1 (§11); target versions open (Q-SC1/2, §12) | `travelling: boolean` already on every dance (`packages/domain/src/dances.ts:31`; all 5 Standard dances `travelling: true`); dances, registry applicability (`appliesToDances`, `kindAppliesToDance`) and the figure catalog are **data, not code** | Add one Latin dance to `DANCE_IDS`/`DANCES` + registry applicability rows + seed JSON; note `research/domain.md`: Latin is mostly spot but **Paso Doble travels** — the flag, not the family, must drive alignment/travel UI |
| **Media attachments** | v1.1 (formerly §13 appendix, now `docs/ideas/annotation-media-embeds.md`) | Annotations already carry the shape (`media[]` planned); the Journal entry editor ships a **disabled media affordance** (formerly PLAN §4 T6, now `docs/concepts/annotations.md` § The Journal); Cloudflare R2 is the locked storage | Per `docs/ideas/annotation-media-embeds.md`: R2 **presigned PUT** URLs (browser→R2 direct), client-side compression, object key in annotation metadata; iOS Safari lacks Background Sync → in-app retry queue, not SW-based |
| **Billing** | Deferred (§11) — "quota enforced in v1; charging deferred" | `FREE_ROUTINE_CAP = 3` (`apps/worker/src/db/routines.ts:18`); `users.plan` enum `free\|pro` already in D1 (`apps/worker/src/db/schema.ts`); 402 → `isQuotaError` upsell path in `apps/web/src/store/routines.ts:12`; `routineCapOverride` shipped with v5 step 6 (migration 0014, read by `routineCapFor` in `db/admin.ts` on create AND fork) | Billing is *only* a payment provider flipping `plan` — the enforcement (incl. the override), refusal UX, and upgrade seam are already shipped and journey-tested (`permission-quota-invite.spec.ts`) |

All three follow normal change control: a `docs/concepts/`/`docs/system/` (or `docs/ideas/`) update + design-bundle frames (for UI) + journey first.

---

## 6. External positioning discipline

This repo has **no papers, no releases, no blog posts** — nothing has ever been claimed externally (verified: no such artifacts in the tree as of 2026-07-02). Before the *first* external artifact of any kind:

1. **It must clear §4.4** for any technical claim — literature check, reproducible benchmark, written comparison, independent soundness re-derivation where applicable.
2. **Honest-limitations section is mandatory**, including: single-owner project built in an 8-day burst (2026-06-24 → 07-02, 131 PRs); the v5 store rewiring status at time of writing; the model-oscillation history (§4.1); scale numbers only as measured by item 3's harness, never extrapolated.
3. **Apply the project's own no-oversell rule to itself.** The precedent is the figure catalog: content was re-charted from primary sources, **adversarially re-verified by an independent pass** (160 confirmed / 18 rejected / 23 left-as-is, PR #118, 58a11f6), and 37 unverifiable figures were *deleted rather than guessed* (PR #117, 1f67e38). An external claim about this codebase meets the same standard: an independent agent/person re-verifies every claim against the repo and the benchmark before publication.
4. **Record rejected framings** the way the concept/system docs record rejected designs (D10, in `docs/system/sync-and-offline.md` § The read/edit split) — if a claim was considered and dropped as unsupportable, note why, so it isn't re-litigated.
5. A sane first artifact, in order of least oversell risk: (a) the item-3 **fan-out measurement write-up** (pure numbers, no novelty claim); then (b) the thin-sync-vs-automerge-repo comparison (§4.3); only later (c) any "pattern" write-up (§4.1/4.2), which needs the v5 model shipped and soaked first.

---

## Provenance and maintenance

Written 2026-07-02 against repo HEAD `70eed7e`; refreshed at `3693ff6`; **refreshed again 2026-07-02 — verified at HEAD `759b3a8` (PR #141 figure-editor undo included)** (post-#139/#136/#137 — v5 steps 3/4/6 shipped, store overlay resolution live, admin seams real; only figure-editor undo remains) on `development` (the trunk at the time — merged into `main` and deleted from the remote 2026-07-05, PR #161; read via branch `claude/skill-library-handoff-bidyjh`). Verified directly against: `docs/PLAN.md` v5.0 (§9 v5 checklist, §11/§11.1, §12 watch-items, §13, §14) — since dissolved 2026-07-15 into `docs/README.md` + `docs/concepts/` + `docs/system/` + `docs/ideas/` (see `docs/README.md` § For historians for the citation map used to update the pointers in this file — offline editing, §1 above, is also now confirmed SHIPPED per that newer doc set), `packages/domain/src/fork.ts` / `undo.ts` / `dances.ts` / `figuretype.ts` / `vocabulary.ts` / `library-data.ts` (204 figures), `apps/worker/src/doc-do.ts` / `db/schema.ts` / `db/routines.ts` / `db/admin.ts` / `migrations/` (15 files), `apps/web/src/store/routine.ts` / `doc-connection.ts`, `apps/web/e2e/{convergence,pwa-a11y}.spec.ts`, and `research/critique-sync.md`. Historical claims (PR/commit refs) come from the repo's git history and GitHub PRs.

Things that will drift — re-verify before relying on them:

```bash
# Which PLAN §9 boxes were still open? (zero since 759b3a8 / PR #141; PLAN.md itself is gone — see docs/README.md § For historians)
grep -n "closed" docs/README.md
# Store overlay resolution still live?
grep -n "resolveVariantOverlay" apps/web/src/store/routine.ts
# Reconnect resend (#161, shipped PR #134) still in place?
grep -n "resendMissing\|mergeSnapshot" apps/web/src/store/doc-connection.ts
# Next free D1 migration number:
ls apps/worker/migrations/ | tail -1
# Any fan-out numbers recorded yet?
grep -rn "fan-out" docs/system/architecture.md docs/ideas/
# External artifacts appeared?
ls docs/ research/ | grep -i -E "paper|bench|blog|release" || echo "still none"
```
