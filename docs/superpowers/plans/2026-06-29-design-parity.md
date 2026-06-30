# Design-Parity Program — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this
> plan task-by-task (one fresh subagent per workstream task, two-stage review between). Steps use checkbox
> (`- [ ]`) syntax. Each workstream task is its own sub-plan: the dispatching brief carries the concrete
> frame(s), file-map, and acceptance — authored at dispatch from the spec + inventories + rendered frames.

**Goal:** Make the Ballroom Flow PWA look and behave like the canonical wireframes/prototype, with every user
workflow tested and every user-error / edge case handled.

**Architecture:** Parity work on an already-built React PWA. Components consume data only through
`apps/web/src/store/`; UI is built from `apps/web/src/ui` primitives + `--bf-*` tokens (no hard-coded hex).
Verification = run the real app (E2E harness, seeded auth/data, no Clerk) and screenshot each screen against
its rendered design frame. Backend (worker/domain) extended only where parity requires (Save-to-library,
superseded-hint).

**Tech Stack:** React 19 + Vite + Tailwind v4 (`@theme` from `--bf-*`), TanStack Query, hand-rolled router,
Automerge CRDT over a Cloudflare Durable Object, Hono worker, D1 index, Clerk auth (E2E-bypassed), Vitest +
Playwright (real-worker harness #191), Biome.

## Global Constraints

- **Canonical sources:** `docs/PLAN.md` v4.4 (behavior/domain) + `docs/design/project/Ballroom Wireframes
  v4.dc.html` (30 labelled frames; rendered to `.parity-audit/design/NN_*.png`). Treat PLAN as authoritative
  where stories/tests drift.
- **Parity bar:** pixel-faithful at phone width (Pixel 7 / iPhone 14 viewports); desktop must stay usable
  (bottom-nav → `lg:` left side-rail) but is not frame-matched.
- **Visual system (already shared):** studio-paper backdrop `--bf-*`; fonts Inconsolata (UI) + Caveat (notes);
  studio-blue accent `#2f5d8f`. Attribute-kind colors via `kindVar(kind, role)`; never hard-code hex.
- **Controlled vocab (PLAN §2/§3):** dances waltz/viennese_waltz/quickstep/foxtrot/tango; attribute kinds
  direction(enum)/footwork(free)/rise(enum, **omits Tango**)/position(enum)/bodyActions(multi)/sway/turn;
  float-count timing (`e`=.25 `&`=.5 `a`=.75); roles owner/editor/commenter/viewer (per-document, cascade
  never grants delete); free plan = 3 owned routines.
- **Conventions:** TDD RED→GREEN→REFACTOR; soft-delete only; permissions at DO/REST boundary; ULIDs; per-agent
  git worktree; explicit-refspec push; run gates explicitly (`pnpm typecheck`, scoped `pnpm test`, relevant
  `@smoke`); **no `--no-verify`**; never pipe `git commit` through grep; keep `PLAN.md` canonical in the same
  PR as any behavior/backend change.
- **Scope decisions (locked):** mobile-first parity + keep desktop adapt; build full Journal + Save-to-library;
  run-and-screenshot verification; build a **minimal undo "superseded" hint** (US-038 AC-3).

## Per-workstream execution protocol (every task runs this loop)

1. **Worktree:** dispatch into an isolated worktree off the integration branch `parity/design-prototype`.
2. **Read the frame(s):** open the cited `.parity-audit/design/NN_*.png` + the frame's HTML in `Ballroom
   Wireframes v4.dc.html` (its `.lbl` title + `.cap` interaction notes) + the relevant PLAN §.
3. **RED:** write/extend failing component tests (Vitest, `apps/web/src/**/*.test.tsx`) and, for a workflow,
   a Playwright journey (`apps/web/e2e/*.spec.ts`, tag `@smoke` only if it's a core gate). Run, watch fail.
4. **GREEN:** implement against `ui` primitives + tokens + the `store/` seam. Add primitives only when shared
   (announce them so neighbors reuse, not redefine).
5. **VERIFY:** extend `apps/web/e2e/parity-capture.spec.ts` to shoot the screen/states; run
   `npx playwright test parity-capture --project=mobile-chrome`; diff the app PNG vs the design frame PNG;
   iterate until faithful. Attach the before/after comparison to the PR.
6. **GATES:** `pnpm --filter web typecheck && pnpm --filter web test && pnpm --filter web lint`; for
   backend tasks also worker tests. RED→GREEN proven, suite green.
7. **REVIEW:** request review (requesting-code-review). Permission/invariant/backend tasks are **hard-gated**
   (Frontend+Tester+Staff verdicts before merge); pure-UI parity tasks fast-tier + post-merge visual check.
8. **INTEGRATE:** merge the workstream branch into `parity/design-prototype`; keep `@smoke` green.

---

## Task graph (dependencies)

```
T0  Foundation: shared ui primitives + ScopeBadge two-state reconcile   ──┐ (blocks T-CLUSTER)
T1  Shell & nav parity (App.tsx, AppShell)            ─ parallel          │
T2  Choreo list + Open/Fork + New-choreo sheets       ─ parallel          │
T5  Library + Save-to-library + personal library      ─ parallel (backend)│
T6  Journal tab (net-new)                              ─ parallel (backend)│
T7  Profile + Share parity                             ─ parallel          │
T3  Assemble READING + EDITING (cluster, sequential)  ◀── needs T0 ───────┤
T4  Figure timeline + editors + info + add-kind        ◀── needs T0, T3 ──┘
T8  Thread + inline comments (needs T3 reading layout)
T9  Workflow + error-case test coverage (continuous; finalize last)
T10 Doc reconciliation: USER-STORIES/TEST-MAP→PLAN v4.4; record backend + superseded-hint
T11 Cleanup: remove throwaway parity harness; final full-gate + @smoke matrix; PR(s) to development
```

Parallel wave A (independent files): **T1, T2, T5, T6, T7** after **T0**.
Sequential spine (shared big files): **T0 → T3 → T4 → T8**.
Continuous: **T9, T10**; final **T11**.

---

### Task T0: Foundation — shared `ui` primitives + ScopeBadge reconcile

**Files:**
- Modify: `apps/web/src/ui/ScopeBadge.tsx`, `apps/web/src/ui/tokens.ts` (FigureScope → two-state by divergence)
- Create (as needed, shared atoms the spine consumes): `apps/web/src/ui/ScreenHeader.tsx` (compact
  `‹ · title/subtitle · actions` header), `apps/web/src/ui/SegmentedToggle.tsx` (Leader/Follower & similar),
  `apps/web/src/ui/CountPill.tsx` (`1 2 3` / `1 & 2 & 3 a`), `apps/web/src/ui/AttrChip.tsx` (merged `fwd·HT`
  Step chip + kind chips), `apps/web/src/ui/SectionDivider.tsx`.
- Test: co-located `*.test.tsx` per primitive.

**Interfaces produced (the spine relies on these exact names):**
- `ScreenHeader({ onBack?, title, subtitle?, actions? })`
- `SegmentedToggle<T>({ options: {value:T,label:string}[], value, onChange, ariaLabel })`
- `CountPill({ counts: string[] })` (renders the figure's count tokens; off-beats dimmed)
- `AttrChip({ kind, label, role?, dimmed? })` — color from `kindVar(kind)`; Step chip merges direction+footwork
- `ScopeBadge({ scope: "library" | "custom", lineage?, compact? })` — two-state by content divergence (PLAN
  §4.3): unchanged catalogue pick = **Library**; diverged/from-scratch = **Custom**. Keep `lineage` for the
  personal-library "based on X".

**Acceptance:** primitives render to the design's chip/pill/header look at phone width; `ScopeBadge` no longer
exposes `variant`; existing consumers updated; web typecheck/test/lint green. (Subagent authors the bite-sized
RED→GREEN steps per primitive following the protocol.)

---

### Task T1: Shell & navigation parity

**Files:** `apps/web/src/App.tsx`, `apps/web/src/ui/AppShell.tsx`, `apps/web/src/lib/router.ts` (optional tab
routing behind existing seam), `apps/web/src/components/landing-visibility.ts`.
**Frames:** tab bar in every frame; no persistent app-name header inner.
**Acceptance:** inner screens drop the persistent "Ballroom Flow / Signed in" header (each screen owns its
compact header via `ScreenHeader`); tab bar icons + active styling match (Choreo/Library/Journal/Profile);
desktop side-rail intact; first-run onboarding nudge preserved. Optionally deep-link tabs.

---

### Task T2: Choreo list + sheets

**Files:** `apps/web/src/components/ChoreoList.tsx`, `ChoreoFlow.tsx`; sheet via `ui/Sheet`.
**Frames:** 1.1 list, 1.2 empty (exact copy: "No choreos yet" / "Each dance gets its own routine — plus extras
for practice. Start your first." / "＋ Create choreo"), 1.3 many+forked (amber card + "forked from X"), 1.4
Open/Fork sheet, 1.5 New-choreo sheet (dance chips + name + bars-math note).
**Acceptance:** cards show dance-color dot, `dance · barLabel · created`, `⋯` → Open/Fork sheet; forked cards
amber + lineage; New-choreo sheet matches; quota upsell preserved; empty/many states match; journey test
green.

---

### Task T3: Assemble READING + EDITING (cluster — sequential, needs T0)

**Files:** `apps/web/src/components/Assemble.tsx`, `RoutineReadingView.tsx`, `PlacementCard` (+ section header
bits). Consumes T0 primitives.
**Frames:** 1.6 reading (compact header, L/F toggle, per-figure only-set type-coloured columns, merged Step
chips, dimmed off-beat rows, count pills, inline comments), 1.7 editing, 1.8 editing-empty, 1.9 add-section.
**Acceptance:** reading view rebuilt to 1.6 structurally + visually; editing view matches 1.7/1.8/1.9 (green
collapse section headers w/ "N bars/figs", scope dot + count pill + `⠿` handle on figure cards, dashed "＋ add
figure"/"＋ add section", inline add-section panel, empty-state copy); role toggle persisted; reading/editing
parity screenshots attached; authoring `@smoke` journey still green.

---

### Task T4: Figure timeline + editors (needs T0, T3)

**Files:** `apps/web/src/components/FigureTimeline.tsx`, `AttributeEditor.tsx`, `Lanes.tsx`, info-sheet,
add-kind picker, custom-type builder; Profile attribute-types (1.17).
**Frames:** 1.11 grid (sticky count column, only-set vs all-columns by mode, `*` required Step, add-timing
chooser `& a 1 2 3 4`), 1.12 attribute editor (Same-for-both ⇄ Per-role rails, direction+footwork pickers,
remove, toast "copied into this choreo"), 1.13 info sheet, 1.15 add-kind picker, 1.16 custom-type builder.
**Acceptance:** timeline + editors match frames; COW toast wording correct; Tango omits Rise; registry-driven;
notate `@smoke` journey green; screenshots attached.

---

### Task T5: Library + Save-to-library + personal library (backend — hard-gated)

**Files:** `apps/web/src/components/FigureLibrary.tsx`, `apps/web/src/store/figures.ts` (+ a save-to-library
store fn), worker route + DO/domain promotion path if needed, `packages/domain` if a promotion helper is
needed; `PLAN.md` §4.2/§5.2 in the same PR.
**Frames:** 2.1 global (grouped by figureType + dance filter chips), 2.2 filtered, 2.3 personal library
(lineage "based on X"/"your own", "used in N routines", edit), 2.4 personal empty per-dance.
**Acceptance:** "↟ Save to my library" promotes a choreo figure to an account personal-library figure (frozen
copy semantics per PLAN); personal library lists with lineage + usage count; editing a personal-library figure
ripples to all referencing routines; library/save journey green; reconcile the stale "Mine/variants" tab to
this model; PLAN updated. **Permission + data-shape review required.**

---

### Task T6: Journal tab (net-new — backend touch, hard-gated)

**Files:** create `apps/web/src/components/Journal.tsx` (+ entry editor + link picker subcomponents); wire
`App.tsx` (replace "Coming soon"); reuse the annotation/journal store (`store/family-notes.ts`,
annotation store) + add a journal-list read if needed; worker read route if entries aren't already listable.
**Frames:** 3.1 list (author-coloured Lesson/Practice cards + link chips + filters all/lessons/practice/by
figure), 3.2 empty, 3.3 entry editor (Lesson/Practice toggle, text, link chips, media "coming soon"), 3.4 link
type → 3.5 figure → 3.7 scope (3.6 attribute disabled v1.1).
**Acceptance:** journal surfaces lesson/practice annotations app-wide; create/edit/link/scope works; filters
work; empty + disabled + media-coming-soon states match; `journal.spec.ts` journey green; PLAN §4.6 confirmed.

---

### Task T7: Profile + Share parity

**Files:** `apps/web/src/components/Profile.tsx`, `Share.tsx`.
**Frames:** 4.1 profile (swatches + selected ring/check + preview + "Leader/Follower is a timeline toggle"
microcopy), 4.2 share (owner/partner role pills + labels, shared-figure info card, "⑂ Fork" CTA, "+ invite").
**Acceptance:** profile + share match frames; role microcopy (US-024 AC-4) asserted; existing share/invite
journeys green; screenshots attached.

---

### Task T8: Thread + inline comments (needs T3)

**Files:** `apps/web/src/components/AnnotationPanel.tsx` (+ thread view), reading-view inline comment line
(from T3).
**Frames:** 1.14 thread (profile-coloured comments, relative time, reply composer tinted with your color).
**Acceptance:** thread matches 1.14; reading-view inline latest-comments + "+ add comment" open the thread;
annotations journey green.

---

### Task T9: Workflow + error-case test coverage (continuous; finalize last)

**Files:** `apps/web/e2e/*.spec.ts`, worker/domain `*.test.ts`, component `*.test.tsx`.
**Covers (spec §6 ⚠ gaps + new surfaces):** two-client section reorder + soft-delete merge (US-026 AC-3);
undo superseded-hint assertion (built in T-hint); Share role microcopy (US-024 AC-4); Journal + Save-to-library
journeys + their error/empty states; the skipped all-dances family-note E2E slice; re-confirm permission /
quota / validation / COW / offline / invite error paths each have a green assertion.
**Acceptance:** every workflow in spec §5 has a green journey; every error/edge case in spec §6 has an explicit
graceful-handling test; coverage gates hold.

---

### Task T-hint: Minimal undo "superseded" soft hint (US-038 AC-3) (backend-ish — hard-gated)

**Files:** `packages/domain` (detect: my undoable change was built upon by another actor in the same doc) +
`apps/web/src/store/routine.ts` surface + a small `ui` hint; `PLAN.md` records the v1 realization.
**Acceptance:** when others built on your last change, undo still works (CRDT merges) but shows a soft
"others built on this — undone anyway" hint (no hard refusal); domain + web test assert it; PLAN updated.

---

### Task T10: Doc reconciliation

**Files:** `docs/USER-STORIES.md`, `docs/TEST-MAP.md`, `docs/DESIGN-SYSTEM.md` (ScopeBadge), `docs/PLAN.md`
(record any backend extension + superseded-hint).
**Acceptance:** retired overlay/variant "flow-up" wording replaced with PLAN v4.4 frozen-copy model;
ScopeBadge/toast copy aligned; no known PLAN↔code↔design divergence.

---

### Task T11: Cleanup & ship

**Files:** remove `apps/web/_parity_capture.mjs`, `apps/web/e2e/parity-capture.spec.ts`, `.parity-audit/`
(and their `.gitignore` lines).
**Acceptance:** `pnpm build && pnpm -r test && pnpm lint && pnpm typecheck` clean; full `@smoke` E2E green on
the 3-device matrix; open PR(s) from `parity/design-prototype` into `development` with the screenshot
comparisons; success criteria (spec §1) all met.

---

## Self-review

- **Spec coverage:** §3 gaps → T1–T8; §5 workflows → journeys in T2–T8 + T9; §6 error cases → T9 (+ inline in
  each screen task); net-new (Journal, Save-to-library) → T6, T5; superseded-hint → T-hint; doc drift → T10;
  verification harness → protocol step 5 + T11 cleanup. No spec section is unmapped.
- **Placeholders:** per-task acceptance is concrete (exact frames, files, copy); bite-sized RED→GREEN steps are
  authored per primitive/screen at dispatch (subagent-driven-development), grounded in the cited frame — not
  deferred vaguely.
- **Type consistency:** T0 fixes `ScopeBadge` to `"library" | "custom"`; all later tasks use that + the named
  T0 primitives (`ScreenHeader`, `SegmentedToggle`, `CountPill`, `AttrChip`, `SectionDivider`).
