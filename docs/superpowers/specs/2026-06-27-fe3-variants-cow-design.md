# FE-3 remainder — variants / copy-on-write / cross-routine auto-update

**Date:** 2026-06-27
**Stories:** US-033, US-034, US-035, US-036 (FE-3 figure-library / variant slice)
**Branch:** `story/fe3-variants-cow` (off `development`)

## Goal

Land the copy-on-write variant slice — the v1 document-graph centerpiece:

- **US-034** Editing a figure you own flows into every routine referencing it (auto-update).
- **US-035** Editing a non-owned (global/other's) figure silently creates an account
  variant you own, re-points the placement, shows a "copied as your variant" toast;
  the base is untouched.
- **US-036** An explicit "Fork into variant" action creates an overlay variant whose
  non-overridden steps still inherit live base edits.
- **US-033** Your variants + custom figures appear in the library with a lineage/custom
  badge and "used in N routines".

Notation, library browse (US-032), alignment, and choreo-fork (US-037) already shipped.

## Locked decisions

1. **COW is orchestrated in the web store seam**, not as a routine-DO op — honoring the
   `per-document-do-layering` rule (a per-doc DO never drives a second DO or touches
   another doc's rows). The worker exposes only a *stateless* variant-creation route.
   The old `editReferencedFigure` DO-op test in `figures.test.ts` is rewritten to match.
2. **Full overlay-diff variant editing** (not a frozen snapshot): variant edits are stored
   as overlay overrides/tombstones/additions vs. the live base, so non-overridden base
   edits flow up (US-036 AC-2 — the whole point of overlays vs. a choreo fork).
3. **Ship gate includes the E2E journey**: the two COW journeys in `fork-and-figures.spec.ts`
   get real bodies + are unskipped (the E2E auth harness already exists — the sibling
   `@smoke` choreo-fork and co-edit tests run live against it).

## Architecture

A graph of per-document Automerge DOs; D1 is a pure index. A figure variant is a new
`FigureDoc` with `scope:"account"`, `ownerId:byUser`, `source:"custom"`, `baseFigureRef`
pointing at the shared base, and an `Overlay` of divergences. `resolve(base, overlay)`
computes the effective figure live, so base edits to non-overridden steps flow up.

### COW data flow ("edit a non-owned figure")

1. User edits a step on a global/non-owned figure's timeline.
2. Store `setFigureAttributes` detects the target isn't owned by `currentUserId`
   → domain `copyOnWrite(placement, base, byUser)` → `{ variant, placement }`.
3. Store POSTs the variant to `POST /api/figures` (extended with `baseFigureRef`)
   → `account-figure` registry row + owner membership + variant DO seeded (empty overlay)
   + routine→variant `placement_edge`.
4. Store re-points the placement's `figureRef` → `variant.id` in the routine doc.
5. Store writes the edit to the variant as an **overlay diff vs. the live base**.
6. `FigureTimeline` shows the "copied as your variant" toast; the placement card's
   existing "Variant" badge applies.

### Latent bug fixed

`resolve(base, overlay)` returns the **base's** identity by contract (overlay.ts). The
store's `resolveFigure` returns it un-stamped today, so a resolved variant carries the
base id — misrouting re-points/edits. Fix: stamp the variant's own
`id/scope/ownerId/source/baseFigureRef` onto the resolved result.

## Per-layer changes & tests

### Domain (`packages/domain`)
No new public API. Uses existing `copyOnWrite`, `resolve` (both already green).

### Worker (`apps/worker`)
- Extend `POST /api/figures` to accept optional `baseFigureRef` (+ overlay) → seeds the
  variant DO and projects an `account-figure` row.
- New `GET /api/figures?dance=` (global list) + `GET /api/figures/mine`
  (variants/custom with `usedInCount` from `placement_edge`); both EXPLAIN-indexed.
- Reconcile registry figure types: user figures → `account-figure`, app figures →
  `global-figure` (update `createFigureRows`). Quota (`type='routine'`) and the
  `placement_edge` cascade are unaffected.
- Rewrite `figures.test.ts`: US-034 (one figure DO shared by two routine edges; an
  edit does not fork it) + US-035 (stateless variant route — base untouched,
  `account-figure` row created). Unskip `search.test.ts` US-032/033.

### Web (`apps/web`)
- `FigureTimeline`: add `figureScope` prop; first edit when non-owned → "copied as your
  variant" toast; "Fork into variant" action → "variant of …" lineage badge.
- `FigureLibrary`: add `tab` prop; "mine" tab fetches `/api/figures/mine`, renders
  lineage/custom badge + "used in N routines" (injectable fetch seam for the test).
- `store/routine.ts`: COW-aware `setFigureAttributes`, overlay-diff helper,
  `resolveFigure` identity stamp.
- `Assemble`: pass `figureScope` to `FigureTimeline` (derived from `notatingFigure`
  ownership vs. `currentUserId`).

### E2E (`apps/web/e2e/fork-and-figures.spec.ts`)
Replace the two URL-only stub bodies with real journeys + unskip:
(a) edit your own figure → appears in a second routine;
(b) edit a global figure → variant + toast, original untouched.
Add seed support for a global figure referenced by a routine.

## Tests to turn green (the contract)

- `apps/worker/src/figures.test.ts` — US-034, US-035 (rewritten for store-seam).
- `apps/worker/src/routes/search.test.ts` — US-032/033 figure library list + mine.
- `apps/web/src/components/figure-library.test.tsx` — US-033, US-035, US-036.
- `apps/web/src/store/routine-store.test.ts` — COW path + identity stamp (new assertions).
- `apps/web/e2e/fork-and-figures.spec.ts` — the two COW journeys.

## Risk

The overlay-diff-on-edit (mapping a full-timeline replace back to overrides/tombstones/
additions vs. the live base) is the fiddliest piece. Built as a small, unit-tested store
helper.
