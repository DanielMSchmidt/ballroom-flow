# Weave Steps — documentation index

**Read this first, every session.** This page gives you the mental model of the product and
routes you to the detail. The documentation has two layers, and keeping both true is part of
every change (§ The rule that keeps this alive, below).

## What this is

Weave Steps is a collaborative, mobile-first **PWA for building and annotating ballroom
choreography**, built on an **Automerge CRDT document graph** on Cloudflare. Guiding
principle: *quality and maintainability over feature count* — YAGNI everywhere **except** the
deliberate document-graph/fork investment, which is the product's centerpiece. The v1 roadmap
is complete and the app is live (staging: `weave-steps-staging.danielmschmidt.workers.dev`);
new work starts as an idea in [`docs/ideas/`](ideas/README.md).

## The mental model in one screen

- A **choreography** ("choreo") is named sections of **placements**, each *referencing* a
  figure — choreos never contain figures. Placements can window a portion of a figure;
  breaks are ordinary little figures. → [`concepts/choreography.md`](concepts/choreography.md)
- A **figure** is a reusable timeline of technique. **Figures are live wherever referenced**:
  editing one changes it in every choreo that places it — propagation over isolation, with
  "used in N choreos" visibility and forking as the escape hatch. The admin-curated **global
  catalog** is protected by **variants**: editing a catalog figure spawns your own figure
  that owns only the beats you touched, while untouched beats keep receiving catalog
  improvements (per-beat ownership — the *Passing Tumble Turn* rule). Your **library is a
  set of bookmarks** over shared live figures, never copies. Figures have a cross-dance
  **family** identity (a Feather exists in three dances, one family).
  → [`concepts/figures.md`](concepts/figures.md)
- **Notation** = attributes: one `{kind, count, role, value}` per piece of technique, on a
  float-count timeline (`e`/`&`/`a` off-beats), validated by a data-driven **registry** of
  kinds (standard + user-defined). Figures have an explicit length in beats; bars are always
  derived. Leader/follower is a lens; editing adds a **Both** lens that writes mirrored/
  shared/leader-only per kind. → [`concepts/notation.md`](concepts/notation.md)
- **Annotations** unify comments and the journal: anchored to a point, a figure, or a whole
  figure **family** (one dance or all dances, optionally timed), with author-owned family
  notes visible to co-members of shared choreos.
  → [`concepts/annotations.md`](concepts/annotations.md)
- **Collaboration** is flat (viewer/commenter/editor/owner **per document**, invite links,
  role cascade choreo→figures). Concurrent edits merge; **undo is per-person** and follows
  the surface being edited; **nothing is ever hard-deleted**; already-opened docs are
  **editable offline** with replay on reconnect. Free tier: 3 owned routines.
  → [`concepts/collaboration.md`](concepts/collaboration.md)
- Underneath: one Automerge doc per **Durable Object** (routine / figure / account docs),
  **D1 as a pure index** with alarm-written projections, permissions enforced **at each
  document's boundary**, client-generated ULIDs, a snapshot-hydrated read path with
  per-document WebSocket sync for editors. → [`system/architecture.md`](system/architecture.md)

## Document map

| Layer | Document | What's in it |
|---|---|---|
| **Concepts** (the world view — implementation-detached) | [`concepts/choreography.md`](concepts/choreography.md) | Choreos, sections, placements, portions, breaks, forking, list/reading views |
| | [`concepts/figures.md`](concepts/figures.md) | Live figures, catalog, variants & per-beat ownership, library bookmarks, families, badges |
| | [`concepts/notation.md`](concepts/notation.md) | Attributes, the kind registry, timing, figure length, presence values, role lenses, the editor |
| | [`concepts/annotations.md`](concepts/annotations.md) | Notes, anchors, family notes & visibility, the Journal, the link picker |
| | [`concepts/collaboration.md`](concepts/collaboration.md) | Roles, invites, merging, undo, deleting, offline, quotas, identity, i18n |
| **System** (how it works underneath) | [`system/architecture.md`](system/architecture.md) | The document graph, DOs, D1 index & projections, permissions enforcement, ordering, undo internals, seeding, NFRs |
| | [`system/sync-and-offline.md`](system/sync-and-offline.md) | The read/edit split, the sync wire, heartbeat, offline persistence/replay, version skew |
| | [`system/testing.md`](system/testing.md) | Layer ownership, the E2E-journey "done" bar, CI, coverage, fixtures |
| **Working docs** | [`DEVELOPMENT.md`](DEVELOPMENT.md) | Install, run, test-layer commands, harness conventions |
| | [`TOOLING.md`](TOOLING.md) | What dev/test tooling exists and why |
| | [`DESIGN-SYSTEM.md`](DESIGN-SYSTEM.md) | Tokens, UI primitives (`apps/web/src/ui`), a11y conventions |
| | [`TEST-MAP.md`](TEST-MAP.md) | Feature/story key → test file × layer matrix |
| | [`design/`](design/README.md) | **The canonical design source** (Claude Design bundle) — UI is recreated from `design/project/*.dc.html` pixel-for-pixel; prototype changes there first |
| **Change process** | [`ideas/`](ideas/README.md) | Future ideas — designed, not built; each explicit about its mental-model delta; deleted when shipped |
| **Ops** | [`../OPS.md`](../OPS.md), [`../PROVISIONING.md`](../PROVISIONING.md) | Operator runbook; accounts & secrets |
| **History** (background, not current truth) | [`spike/SPIKE-FINDINGS.md`](spike/SPIKE-FINDINGS.md), [`../research/`](../research/), [`superpowers/`](superpowers/), [`seed/`](seed/) | The M0.5 spike, the research behind the architecture, pre-process specs/plans, seed data + provenance |

## The rule that keeps this alive

**Every change that alters behavior updates both layers in the same change:**

1. **The mental model** — the affected `docs/concepts/` docs must read true afterwards.
2. **The technical understanding** — the affected `docs/system/` (and working) docs must
   read true afterwards.

A divergence between these docs and the code **is a bug**, with the same priority as a
failing test. There is deliberately no "current state" mega-spec anymore: these two layers
*are* the source of truth, and the concept docs win a conflict with a skill or an old
comment.

**Substantive future work starts as an idea** in [`ideas/`](ideas/README.md) — a
WEP-style document with a named concrete scenario, a Playwright ship gate, and an explicit
**mental-model delta**. Shipping an idea folds its delta into the two layers and deletes the
idea file. When something is settled and an idea would relitigate it, the recorded
rationale/rejected alternatives in the concept & system docs are the first stop (plus the
`ballroom-flow-failure-archaeology` skill for the deeper history).

## For historians: where the old docs went

Until 2026-07-15 current state lived in a single `docs/PLAN.md` (v5.0) and changes went
through numbered WEPs in `docs/proposals/`. Both were dissolved into this structure; git
history has the originals. Old citations decode as follows:

| Old reference | Now lives in |
|---|---|
| PLAN §1 (overview/goals/persona/quota) | this index + `concepts/collaboration.md` |
| PLAN §2 (domain model), §3 (vocabularies) | `concepts/` (figures, choreography, notation, annotations) + `system/architecture.md` (D1/registry detail) |
| PLAN §4 (features by screen) | the relevant `concepts/` doc per surface |
| PLAN §5 (collaboration/fork/undo) | `concepts/collaboration.md`, `concepts/figures.md` + `system/architecture.md` § Undo |
| PLAN §6 (architecture), §7 (NFRs) | `system/architecture.md`, `system/sync-and-offline.md` |
| PLAN §8 (locked decisions D1–D33), §12 (Q-entries) | rationale woven into the concept/system docs where each rule lives; full ledger only in git history |
| PLAN §9 (roadmap/milestones) | closed — history only |
| PLAN §10 (testing) | `system/testing.md` |
| PLAN §11.1 / §13 (deferred specs) | `ideas/attribute-predicate-anchors.md`, `ideas/annotation-media-embeds.md` |
| WEP-0001 (the process) | `ideas/README.md` |
| WEP-0002 (account doc DO), 0004 (journal links), 0006 (heartbeat), 0008 (role-scoped editing) | implemented — folded into the concept/system docs |
| WEP-0003, 0005, 0007, 0009 | `ideas/` (same slugs) |
