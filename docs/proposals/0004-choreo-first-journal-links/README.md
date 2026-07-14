---
title: Choreo-first journal links with grid placement and scope-last anchoring
wep: 0004
owning-areas: [web, domain, contract, worker]
status: implementable
authors: ["@danielmschmidt"]
approver: owner
created: 2026-07-14
last-updated: 2026-07-14
see-also:
  [
    "PLAN §4.6 (annotation anchors + picker)",
    "PLAN §8 D20/D29",
    "WEP-0003 (predicate anchors — the deferred fourth target)",
    "apps/web/src/components/JournalLinkPicker.tsx (the flow this replaces)",
  ]
replaces: null
superseded-by: null
---

# WEP-0004: Choreo-first journal links with grid placement and scope-last anchoring

## Summary

Replace the journal entry editor's link picker (today: *link type → figure family
(full flat catalog) → scope → choreo → figure → count list*) with a single linear,
**choreo-first** flow: pick one of your choreos, pick a figure **from that choreo**
through a type-ahead filter, place the note on the figure via a read-only rendering
of the **figure-detail attribute grid** (entire figure, or one count with a
leader / follower / both role lens), and choose the sharing **scope last** —
"every dance this family exists in", "all my choreos of this dance", or "only this
choreo". One data-model addition makes the scope step honest for timed notes: the
`figureType` anchor gains optional `count`/`role` fields so a count-pinned note can
scope to *this dance* (never across dances, where counts don't align).

What becomes true that isn't today: the user never scrolls the full ~200-figure
catalog to link a note (the flow starts from the choreo they're journaling about),
the count is picked with the figure's attributes visible instead of from a bare
list of numbers, and a timing note can follow a figure family across all of that
dance's choreos.

## Motivation

### Goals

- Linking a journal entry starts from **the user's own choreography**, not the
  global catalog; the figure list is choreo-scoped and filterable as-you-type.
- Count selection happens **in context**: the same attribute grid the figure
  detail view renders (columns per count, chips per kind, Leader/Follower/Both
  lens), with "entire figure" as the zero-selection default.
- Scope is chosen **after** the target is fully specified, with exactly the
  options the anchor model can honor:
  - whole figure → family across **all dances** (`figureType`/`all`), family in
    **this dance** (`figureType`/dance), or **this choreo only** (`figure`);
  - a specific count → **this dance** (`figureType`/dance + count/role, new) or
    **this choreo only** (`point`) — never across dances.
- The existing anchor consumers (timeline surfacing, journal chips,
  `FigureTypeNoteIndex` co-member visibility per D29) keep working unchanged for
  untimed anchors.

### Non-Goals

- **No catalog fallback.** A figure placed in none of your choreos cannot be
  linked until it is placed (owner decision, 2026-07-14). This deliberately
  removes the current catalog-first "A figure" path.
- No count **ranges** (a note spanning counts 2–3) — single count or whole figure.
- No cross-dance timed notes (`figureType`/`all` + count) — counts don't align
  across dances (a Waltz Whisk's 1-2-3 vs its Quickstep sibling's S-Q-Q).
- No notes stored on the shared global figure doc itself (visibility/ownership
  would leave the D29 account-scoped model — out of scope, no scenario demands it).
- No change to the builder-timeline `AnchorPicker` (it is already figure-contextual;
  the new anchor shape *enables* offering timed this-dance notes there later, but
  that is a follow-up).
- Attribute-predicate targets stay deferred (WEP-0003); this WEP keeps the flow's
  shape compatible with adding them as a target type later.

## Proposal

**Named scenario — the rushed Whisk.** After Tuesday's practice, Dani opens the
journal to log: *"don't rush count 3 — settle before the Chassé."*

*Today:* they tap "add link" and get a three-way fork (Specific place / A figure /
An attribute). Choosing "A figure" drops them into the full alphabetical Waltz
catalog (the screenshot: Back Lock, Back Whisk, Backward Lock, …) with no search
box; the Whisk is ~40 rows down. After the family, they choose scope, *then* maybe
a choreo, *then* the figure instance, and finally a bare list "Count 1 / Count 2 /
Count 3" with no context about what happens on those counts. Choosing "Specific
place" first instead silently commits them to a this-choreo-only note before
they've seen the figure at all.

*Proposed:* "add link" opens the picker on **their choreos** ("WDSF Waltz Basic",
"Comp Waltz 2026", …). They tap *Comp Waltz 2026*; the next step lists only that
choreo's figures with a type-ahead box — typing "wh" narrows to *Whisk* and *Back
Whisk*. Tapping *Whisk* shows the placement step: the figure's attribute grid
(counts 1–3 as columns, the step/rise/sway chips it actually carries, the
Leader/Follower/Both lens defaulting to Both) with an "Entire figure" control
above it. They tap the count-3 column. The final step asks where the note should
live, offering exactly two options *because a count is selected*: **"Every Whisk
in my Waltz choreos"** and **"Only this choreo"**. They pick the first. The saved
anchor is `{ type: "figureType", figureType: "whisk", danceScope: "waltz",
count: 3 }` — the note now surfaces pinned to count 3 on the Whisk in *every* of
their Waltz routines, including ones created next month. Had they left "Entire
figure" selected, the scope step would have offered three options, adding
**"Everywhere this figure exists (all dances)"**.

**Risks & mitigations:**

- *The grid in a bottom sheet is heavier than a list.* Mitigation: render the
  read-only reading-columns grid for **one figure** (the reading view already
  renders it for whole routines); no editor machinery, no overlays.
- *Removing the catalog path orphans "note a figure I haven't placed yet".*
  Accepted deliberately (Non-Goals); the library's family-note surface
  (`FamilyNotes`) still exists for catalog-side notes.
- *A timed family note may not resolve on a sibling figure whose variant has
  fewer counts.* Mitigation (Design Details): surface at whole-figure grain when
  the count doesn't exist — never hide the note.

## Design Details

*(Promoted to `implementable` 2026-07-14 — owner approval on PR #228's merge +
"move on with implementation". The UI prototype lives in the design bundle:
`docs/design/project/Ballroom Builder v3.dc.html`, link-picker section — the
choreo-first step machine with the place-step grid and gated scope step.)*

**Anchor shape (packages/domain/src/doc-types.ts + Zod in schemas.ts +
contract re-export):**

```ts
| {
    type: "figureType";
    figureType: FigureType;
    danceScope: DanceId | "all";
    count?: number;   // NEW — pin to a count; requires danceScope !== "all"
    role?: Role;      // NEW — leader/follower; absent = both (existing convention)
  }
```

- Zod refinement rejects `count`/`role` with `danceScope: "all"`.
- **Back-compat:** additive optional fields — every stored anchor remains valid,
  no migration, no schemaVersion bump. Legacy readers that ignore `count` degrade
  to today's whole-family surfacing (correct, just coarser).
- **Resolution on read:** a timed `figureType` note surfaces on every matching
  figure in the dance, pinned to `count` where the resolved figure has that
  count; where a variant is shorter, it degrades to figure-level surfacing
  (soft fallback, never hidden).
- **D1 / FigureTypeNoteIndex:** in v1 the index rows *carry the note content*
  (migration 0005 — `kind`, `text` live on the row until WEP-0002 moves the
  account doc to a live DO), so a timed note needs two **additive nullable
  columns** (`count REAL`, `role TEXT`; migration 0016). They are content, not
  query keys — no new index, existing queries unchanged. Co-member visibility
  (D29, Q-FIGNOTE-VIS option 2) is untouched.
- **Save routing (unchanged):** `figure`/`point` anchors → `createAnnotation` on
  the routine doc; `figureType` anchors (timed or not) → the account doc's family
  notes (`createFamilyNote`), which WEP-0002 will move onto a live DO — this WEP
  only widens the anchor payload passing through that seam.

**Picker flow (apps/web/src/components/JournalLinkPicker.tsx, rebuilt):**

`choreo → figure (type-ahead, choreo-scoped) → placement (grid) → scope`

- Step 1 lists the user's routines (existing `loadRoutineOptions` seam).
- Step 2 reuses the existing `loadRoutineFigures` seam + filter input; the
  three-way "link type" step and the flat catalog step are removed (the disabled
  "An attribute" teaser row goes with them; WEP-0003's revival re-introduces
  attributes as a *target*, which this linear flow accommodates).
- Step 3 renders the read-only attribute grid (reuse `reading-columns` /
  `windowAttributes` as in the figure detail view) with an "Entire figure"
  control and tappable count columns; a Leader/Follower/Both `SegmentedToggle`
  scopes `role` (Both → `role` absent).
- Step 4 offers scopes gated by the placement: whole figure → 3 options; count →
  2 options (this dance / this choreo). Copy mirrors the scenario labels above.
- Components keep touching data only through `apps/web/src/store/` loaders
  injected as props (locked seam).

## Test Plan

TDD unskip/write-first, per layer:

- **Domain unit** (`packages/domain`): Zod accepts timed dance-scoped anchors,
  rejects `count` with `danceScope: "all"`; surfacing helper pins to `count` when
  present and degrades to figure grain when the resolved figure lacks the count.
- **Component** (`apps/web/src/components/journal.test.tsx` +
  `journal-link-picker` cases): step order; type-ahead narrowing; grid renders
  the picked figure's real attributes; role toggle; scope options gated by
  placement (3 vs 2); produced `JournalLink`/anchor payloads for all five
  outcomes; axe pass on each step.
- **Worker/DO**: none beyond existing pass-through coverage (no boundary or
  index change); coverage thresholds unaffected.
- **E2E**: the ship-gate journey below, `@smoke`-tagged for the core path.

## Ship Gate

`apps/web/e2e/journal-link-picker.spec.ts` — green on the implementing PR:

1. Seed two Waltz routines sharing a Whisk. From the journal entry editor, walk
   choreo → type-ahead ("wh") → Whisk → grid count 3 → "every Whisk in my Waltz
   choreos"; save; assert the note surfaces pinned to count 3 on the Whisk in the
   *other* Waltz routine.
2. Same flow with "Entire figure" → "only this choreo"; assert the note appears
   on that figure instance and *not* in the sibling routine.

Marking `implemented` additionally updates PLAN §4.6 (picker flow + anchor
shape) and `docs/TEST-MAP.md` in the same change.

## Drawbacks

- Figures not yet placed in any choreo can't receive journal links (accepted
  scope cut; the library family-note surface remains the escape hatch).
- The `Anchor` union grows a conditional invariant (`count` ⟂ `"all"`), carried
  by a Zod refinement rather than the type system alone.
- Replaces a shipped flow: existing picker component tests and the design
  bundle's link-picker frames must be reworked, not extended.
- The soft fallback for short variants means a timed family note can render at
  two grains; users may occasionally see the note un-pinned.

## Alternatives

- **Keep the catalog-first path as a fallback alongside choreo-first** — rejected
  by owner (2026-07-14): one linear flow beats two entry points; the rushed-Whisk
  scenario never needs the catalog.
- **Timed notes across all dances** (`figureType`/`all` + count) — rejected:
  counts don't correspond across dances (Waltz 1-2-3 vs Quickstep S-Q-Q); honoring
  it would need a per-dance count mapping nobody asked for.
- **Store "this figure in general" on the shared global figure doc** — rejected:
  moves note ownership/visibility out of the D29 account-scoped model (co-member
  gate, `FigureTypeNoteIndex`) for no scenario benefit; "all my choreos of this
  dance" is what the rushed Whisk actually needs.
- **Offer all three scopes for timed notes and silently widen to whole-figure
  when a broader scope is picked** — rejected: silently discarding the count the
  user just carefully selected in the grid is intent loss.
- **Count ranges in the grid** — rejected (YAGNI): no scenario on the table; a
  range is expressible as two notes today and would be a new anchor shape.
- **Search over the full catalog instead of choreo scoping** — rejected: fixes
  the scrolling, not the context problem (the screenshot list is figures the
  user's choreos don't contain); the journal is about *their* dancing.
