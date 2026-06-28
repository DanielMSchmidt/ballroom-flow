# Figure reference resolution — avoiding spurious "Unknown figure"

**Status:** Accepted · **Date:** 2026-06-28

## Problem

Figure cards intermittently render **"Unknown figure"** when the backend hadn't
finished or the data was being re-loaded. The cause is a two-state model — a
reference is either "resolved" or "unknown" — which collapses *"we don't know
yet"* (still loading / refetching) into *"it genuinely doesn't exist"*.

A figure draws on two sources (design-spec §2.1, §2.3):

1. the persisted figure **row** from the routine tree (D1, loaded async via RPC);
2. the static **LibraryFigure catalog** (ships in the client bundle), matched by
   `libraryFigureId` for enrichment (default charts, glossary).

## Decision — three parts

### Part A — identity comes from the row, not the catalog

The figure **row carries `name`** (§2.1). The catalog is *enrichment only*
(seeding default charts at instantiation, glossary). So a missed catalog lookup
degrades to "show the stored name", never to "Unknown figure". Encoded in
`resolveFigure` (`packages/domain/src/figures.ts`).

### Part B — model the reference as three states

`FigureView` is a discriminated union: `loading | resolved | unresolved`.
`loading` (tree not loaded, or figure not in this slice yet) is distinct from
`unresolved` (loaded, but `libraryFigureId` matches nothing — i.e. bundle/version
skew). Only `unresolved` is a real problem, and it still carries the row's name.
Built on the `RemoteData<T>` primitive (`packages/domain/src/remote-data.ts`).

```
loading    → skeleton (never "unknown")
resolved   → render the figure (+ optional catalog enrichment)
unresolved → render the stored name with an "unrecognized" affordance
```

### Part C — keep previous data across refetches

The catalog is synchronous (bundled), so any gap is the routine-tree query.
`useRoutineTree` (`apps/web/src/store/figures.ts`) sets
`placeholderData: keepPreviousData` plus a `staleTime`, so a refetch retains the
prior tree and figures keep resolving instead of flashing. `fromQueryState`
checks `data` before `isError`/pending, preserving this through the seam.

## Consequences

- Components call `useFigure(routineId, figureId)` and branch on three states;
  they never compute an "unknown" fallback themselves (honours §7.1: components
  touch data only through `store/`).
- A genuine `unresolved` becomes a *signal* of version skew — the real remedy is
  the `schemaVersion` minimum-version gate (§8), not a dead-end string.
- The routine-tree RPC route (`/api/routines/:id`) lands in Milestone 2; this
  resolution seam is in place first so the figure UI is built against it.
