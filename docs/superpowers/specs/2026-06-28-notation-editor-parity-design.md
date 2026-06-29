# Notation Editor — Design Parity

**Date:** 2026-06-28
**Status:** Draft for review
**Scope chosen by user:** Full design parity (large) — bring the figure-notation
editor in line with `docs/design/ballroom-flow.pen`, fold in the concrete
usability bugs found while recreating the design's data.

## Background

Recreating the design's data in the running app (Gold Waltz → Part 1 → Natural
Turn → notate count 1) surfaced a gap between the design's notation model and the
shipped editor:

- The design anchors steps to a **musical beat ruler** (`1 · & · 2 · & · 3` for
  Waltz) with a per-step **duration** helper (Whole / Half / Quarter).
- The design's step **headline is the direction** of the step; foot part,
  rise/fall, sway, position, turn are colored secondary slots.
- The design uses **progressive disclosure** — Footwork first, then one attribute
  kind at a time ("choose one") — with a step-summary card.

The shipped editor (`FigureTimeline` + `AttributeEditor`) instead renders a flat,
hardcoded **1–8 count strip** and, on tapping a count, dumps *every* attribute
category at once.

**Key de-risking finding:** the hard part already exists. `packages/domain`
already models float counts and conventional labels (`timing.ts`: `countLabel` →
`1`/`1&`/`2`, `countToPhrase`, `barsForFigure`) and per-dance phrasing
(`dances.ts`: Waltz = 3 beats/bar, 6-beat phrase). The data layer supports the
beat ruler today — the editor simply never surfaces it. So "full parity" is
mostly **editor UI** plus **one vocabulary change**, not a domain rebuild.

## Decisions (locked with user)

1. **Steps alternate feet automatically** — foot (L/R) is **never stored**. At
   most it is *derived* for display from a per-figure starting foot. The design
   mock's "LF forward" headline was overspecified.
2. **A step's two real dimensions are `direction` and `footwork`** (the foot
   part). Direction is the **headline**; footwork is a secondary slot.
3. **Footwork vocabulary (plain set):** `ball`, `ball flat`, `flat`, `heel`,
   `heel ball`, `toe`, `tap` — single-select, free-text fallback retained.
   Legacy ISTD tokens (`HT/T/TH/H/heel_pull`) map onto these via migration.
4. **`step` registry kind is repurposed → renamed `footwork`** (it already *was*
   the foot-part kind). A **new `direction` kind** is added. No separate
   "pressure" kind.
5. **Per-step duration is derived, not stored** — a step's duration is the gap to
   the next placed count on the beat grid (consistent with the existing
   float-count model; nothing new persisted). The design's Whole/Half/Quarter
   control becomes a *placement helper* that sets where the next step lands. The
   last step's duration displays as "to end of figure".

## Section 1 — Data model & vocabulary (`packages/domain`)

### 1.1 Registry changes (`vocabulary.ts`)

- `StandardRegistry` interface: rename the `step` key to `footwork`; add a
  `direction` key.
- `ATTRIBUTE_REGISTRY`:
  - **`footwork`** (was `step`): `label: "Footwork"`, keep today's color,
    `cardinality: "single"` (was multi — a step has one foot-part),
    `valueType: "enum"`, `values: ["ball","ball flat","flat","heel","heel ball","toe","tap"]`,
    `freeText: true`.
  - **`direction`** (new): `label: "Direction"`, a fresh color token,
    `cardinality: "single"`, `valueType: "enum"`,
    `values: ["forward","back","side","close","diag forward","diag back","in place"]`,
    `builtin: true`.
- Value canonicalisation: store as stable slugs (`ball_flat`, `diag_forward`);
  the human labels above are the display form. Confirm slug style in the plan.

### 1.2 Migration v2 (`migrations.ts`)

- `CURRENT_SCHEMA_VERSION = 2`; add `MIGRATIONS[1]`.
- The step (structure + lenient value transform, per the file's rules — preserve
  unknown values, never touch `figureType`/`dance`):
  - Retag every attribute `kind: "step"` → `kind: "footwork"`.
  - Remap known legacy values: `H → heel`, `T → toe`, `HT → heel ball`,
    `TH → ball heel` (free-text), `heel_pull → heel` (or kept free-text —
    finalize in plan). Unknown values pass through verbatim (`freeText`).
- Round-trip + value-preservation tests in `migrations.test.ts`.
- Note: library catalog figures are not pre-notated with step attributes today,
  so existing-data impact is minimal; the migration is the safety net for any
  authored figures + JSON imports (US-048).

### 1.3 Downstream within domain

- `schemas.ts` (US-012 strict write): validates against the registry, so it
  adapts automatically — audit for any hardcoded `"step"` literal.
- `__fixtures__/*` (sample/factories/types) reference `step` — update to the new
  vocabulary so domain + web tests compile.
- `timing.ts` / `dances.ts`: **no change** (already complete).
- The contract package (`packages/contract`) does **not** enumerate attribute
  kinds/values — no change there.

## Section 2 — Editor rebuild (`apps/web`)

### 2.1 Beat-ruler timeline (`FigureTimeline.tsx`)

- Replace the hardcoded `counts = 8` flat strip with a **dance-aware beat
  ruler** derived from `DANCES[dance]` + `timing.ts`: render the phrase as
  beats with `&` sub-beats (Waltz → `1 · & · 2 · & · 3`, 6-beat phrase; 4/4
  dances → 8), grouping by phrase when a figure spans more than one
  (`barsForFigure`).
- Steps anchor to their float `count`; an occupied beat shows its step's
  direction headline + colored attribute slots (the design's step card).
- Preserve the existing **role lens** (US-030 leader/follower view toggle) and
  entry/exit **alignment** controls (US-031) — both stay.

### 2.2 Progressive step-entry flow (`AttributeEditor.tsx` → sheet flow)

- Tapping a beat opens a focused **Footwork/Direction** entry (the design's hero
  sheet): direction grid + footwork chips + the Whole/Half/Quarter **duration
  placement helper**; confirm advances the cursor to the next count by the chosen
  duration.
- Then attribute kinds are presented **one at a time** ("choose one · <kind>"),
  with a persistent **step-summary card** at top (headline + colored slots),
  replacing today's all-categories-at-once dump. This also eliminates the
  **reflow-on-tap mis-tap** bug (selecting a chip no longer pushes a freshly
  inserted summary row into the tap target).
- **Custom kind creation** matches the design's New-attribute-kind sheet: name /
  colour / cardinality (one vs many) / applies-to-dances. (Registry merge via
  `mergeRegistry` already exists.)

### 2.3 Tokens & registry-driven surfaces

- `ui/tokens.ts`: update `ATTRIBUTE_KINDS` (add `footwork`, `direction`; note
  `bodyActions` is currently absent from this list) and add color CSS vars for
  the new/renamed kinds.
- Reading view (`RoutineReadingView`) and any lanes view render off the registry,
  so they should adapt — **verify** they display `direction` + `footwork`
  correctly after the rename.

## Section 3 — Usability bug fixes (fold in)

1. **"Unknown figure" flash** (`Assemble.tsx:539`,
   `figure?.name ?? "Unknown figure"`): the figure doc is undefined while its
   per-doc connection hydrates, so a just-placed figure reads "Unknown figure"
   until reload. Fix: distinguish *loading* from *genuinely missing* — render a
   name **skeleton/placeholder** while the figure doc is connecting; only show a
   true "missing" state if it resolves absent.
   **Implemented (2026-06-28) as the full RemoteData pattern**, since the root
   cause was broader than a flash — each figure is its own Automerge doc on its
   own connection, and a dropped/never-hydrated connection left a figure blank
   until a full page reload. The store now exposes a per-figure
   `FigureLoadStatus` (`pending | loading | live | missing | error`) on each
   `ResolvedPlacement` (`store/routine.ts`), and:
   - **`DocConnection` auto-reconnects** with capped backoff (`store/
     doc-connection.ts`): a warm drop self-heals; a handshake that never opens
     (missing/forbidden/server-down) retries a bounded number of times then goes
     terminally `closed`. This removes the whole "had to reload" class.
   - **Registry-backed missing detection**: a connection that gives up is
     disambiguated via the existing `GET /api/docs/:id/access` preflight (it
     mirrors the WS authorization incl. the routine→figure cascade) — a 403 →
     `missing`, accessible-but-failed → `error`.
   - **Hydration timeout** escalates a figure that never loads to a retryable
     `error` (no forever-skeleton); `store.retryFigure(ref)` forces a reconnect.
   - **Both surfaces render the states**: `PlacementCard` (skeleton / unavailable
     / retry) and `RoutineReadingView` (skeleton / unavailable, no retry in the
     read-only view) — no figure ever silently vanishes or reads "Unknown".
2. **Reflow-on-tap mis-taps** — resolved by the §2.2 progressive flow (no more
   list-shifting summary row). No separate fix needed.
3. **Library figure shows "Custom"** (`Assemble.tsx:742`): placing a catalog
   figure mints an account-scope copy with no `baseFigureRef`, so the badge logic
   reads "Custom". This is technically correct under the current copy-on-add
   model (it matches the known COW behavior). **Proposed (optional):** when a
   placed figure's `figureType` matches a library catalog entry, label its
   lineage as catalog-origin (e.g. a "Library" tag) instead of bare "Custom".
   Flagged as a labeling refinement that interacts with the figure-scope/COW
   model — confirm desired behavior before implementing; lowest priority.

> **Dropped:** an earlier-suspected "figure picker isn't dance-filtered" bug —
> verified false. The picker already filters via `libraryFiguresForDance(dance)`
> and the figures seen are correctly tagged `dance: "waltz"`.

## Section 4 — Testing

- **Domain:** migration v2 round-trip + value-preservation (`migrations.test.ts`);
  updated `vocabulary.test.ts` (new kinds, cardinality); fixtures compile.
- **Web units:** beat ruler renders the right phrase per dance; progressive
  entry flow (direction → footwork → one-kind-at-a-time); role lens + alignment
  preserved; "Unknown figure" loading state shows a skeleton not the word
  "Unknown".
- **E2E** (`apps/web/e2e/authoring.spec.ts`): extend the notation step to set a
  direction + footwork on a Waltz figure and assert it renders in both the
  timeline and the reading view; keep `@smoke` green.

## Suggested phasing (for the implementation plan)

These are independently shippable and ordered to de-risk:

1. **Vocabulary + migration v2** (domain) — self-contained, fully unit-tested.
2. **"Unknown figure" loading-state fix** — small, isolated, ships independently.
3. **Beat-ruler timeline** (read/render side) — surfaces the existing timing model.
4. **Progressive step-entry flow** (write side) — the largest UI piece; also
   retires the reflow bug.
5. **Custom-kind sheet + reading-view/lanes verification.**
6. **(Optional) library-figure lineage labeling.**

## Out of scope

- Latin/spot dances (v1 excludes them — `dances.ts`).
- Storing per-step duration as a persisted field (derived instead).
- Storing foot (L/R) (alternates automatically).
- Any change to the contract package or sync/permission boundary.
