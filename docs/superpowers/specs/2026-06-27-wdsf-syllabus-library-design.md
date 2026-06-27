# WDSF Syllabus → Library, with Step Counts + Actions

**Date:** 2026-06-27
**Status:** Approved design (pending spec review)
**Branch base:** `development`

## Goal

1. **Add the entire WDSF Standard syllabus** to the figure library, **ignoring figures we already know about** (i.e. the figures already in the ISTD-seeded catalog).
2. **Give each added figure its real step counts and actions**, derived from the WDSF syllabus the figure belongs to, and **pre-seed those steps onto the timeline when the figure is picked** (the point of a library is a head start, not a blank slate).

## Source data

`docs/seed/wdsf-standard-figures.json` already exists (184 figures, never integrated). Each figure carries:

```jsonc
{
  "wdsfRef": "2.1.3",
  "figureType": "natural-turn",
  "name": "Natural Turn",
  "dance": "waltz",
  "wdsf": {
    "start":  "RF fwd (Closed Position)",   // step-1 action
    "finish": "LF closes to RF",             // last-step action
    "timing": "123 123",                     // step counts
    "notes":  ["NOTE - General: Steps 1-3 or 4-6 only may be used", ...]
  },
  "attributes": []                            // per-count footwork NOT in the public syllabus
}
```

The public WDSF syllabus gives **timing, start, finish, notes** — not per-count footwork/sway/rise (those live in paid technique books). That is exactly the data we surface; intermediate steps get a count but a blank action.

## Scope: which figures (net-new vs ISTD)

Add only figures whose `(dance, name)` is **not** already in the 122-figure ISTD catalog (`docs/seed/istd-standard-figures.json` → `LIBRARY_FIGURE_DATA`). That is **125 net-new figures**:

| dance | net-new |
|---|---|
| waltz | 27 |
| foxtrot | 31 |
| quickstep | 35 |
| tango | 28 |
| viennese_waltz | 4 |
| **total** | **125** |

**Ratified during implementation (supersedes the earlier "ISTD entries stay attribute-free" wording):** figures present in BOTH syllabi are **enriched** with the WDSF step timeline rather than duplicated — an existing ISTD entry whose figure also appears in the WDSF seed gains that figure's WDSF attributes (so the fundamental figures — Natural Turn, Reverse Turn, etc. — carry step counts too, not just the obscure net-new ones). ISTD identity (figureType/name) always wins; only the per-step timeline is added. **Final catalog: 241 rows total; 184 carry step attributes** (119 net-new WDSF + 65 enriched ISTD overlaps); 57 ISTD-only figures with no WDSF match stay identity-only.

Note: dedup uses a **diacritic-insensitive `(dance, name)`** key, so accent-twins (ISTD `"Chassé from PP"` / WDSF `"Chasse from PP"`, `"Hover Corté"` / `"Hover Corte"`) are recognized as the same figure — the ISTD accented name is kept and enriched, no duplicate row added. Figures that share a `figureType` slug but have genuinely different names (e.g. foxtrot `reverse-turn`: ISTD `"Reverse Wave"` vs WDSF `"Reverse Turn"`) are correctly kept as separate entries.

## Core logic: `parseWdsfTiming` (packages/domain, TDD)

A pure function converts a WDSF timing string into one **`count`** per step — a 1-indexed float beat position on the 1/8 grid that the existing timing model (`packages/domain/src/timing.ts`) and write schema (`parseAttributeWrite`) already understand.

Rules (walk left→right with a beat cursor starting at `1.0`; each symbol places a step at the cursor, then advances it by the symbol's duration):

| symbol | meaning | duration |
|---|---|---|
| `S` | slow | 2 beats |
| `Q` | quick | 1 beat |
| digit `1`–`9` | beat | 1 beat |
| `&` | "and" off-beat | 0.5 beat |

- An `&` **splits the preceding symbol**: a symbol immediately followed by `&` advances only 0.5 (the `&` takes the other half). So `"Q&Q"` → counts `[1, 1.5, 2]`; `"1&23"` → `[1, 1.5, 2, 3]`.
- Spaces are bar separators (cosmetic); the cursor accumulates across them. `"SQQ QQQQ"` → `[1, 3, 4, 5, 6, 7, 8]`.
- Verified to produce only valid (≥1, on-1/8-grid) counts across **all 24 distinct timing strings** in the seed.

### Documented approximations (the long tail)

- **`(… Lady)` parentheticals** describe the follower's *different* timing for the same figure. v1 strips them and parses the **base (leader) timing** only; the figure's two charts are not split per-role from the syllabus.
- **Other parentheses** (optional steps, e.g. `"S(QQ)"`, `"1 (23)"`) are kept as steps with the parens dropped.
- **A leading `&`** (a syncopated pickup before beat 1, e.g. tango `"&S"`) is clamped to count `1.0` (the schema floor is 1).
- **One VW figure** (`"QQQQ QQQQ QQQQ QQQQ Q(Q Q)aQ"`, a 20-step continuous spin) has an `a`-quarter-beat tail that the v1 grid approximates. Documented in the generator.

These choices are recorded in code comments and this spec; values are **data**, refinable later (per the seed's own `Q-LIBSEED` note) without code changes.

## Where the data lands

### Attribute shape

Each parsed step becomes an `Attribute` (the canonical per-step model in `doc-types.ts`):

```ts
{ id: "wdsf-natural-turn-waltz-s1", kind: "step", count: 1, value: "RF fwd (Closed Position)", role: null }
```

- `id` is **deterministic** (`wdsf-<figureType>-<dance>-s<n>`) — no `Date.now()`/random, so the generated file is stable and reproducible.
- `value` (the "step" kind is free-text, carrying footwork/action): **step 1 = `wdsf.start`**, **last step = `wdsf.finish`**, middle steps = `""`.
- Every generated attribute must pass `parseAttributeWrite(attr, { dance })`.

### Catalog enrichment

`LibraryFigure` / `LibraryFigureData` gain optional fields (existing ISTD entries simply omit them):

```ts
export interface LibraryFigure {
  dance: DanceId;
  figureType: string;
  name: string;
  attributes?: Attribute[];   // WDSF-derived per-step timeline
  timing?: string;            // raw WDSF timing string (provenance/display)
  notes?: string[];           // WDSF notes
}
```

`scripts/gen-library.mjs` is extended to **merge the WDSF seed on top of ISTD**: read both files, dedup by `(dance, name)`, run `parseWdsfTiming` for each net-new WDSF figure, and emit the enriched `LIBRARY_FIGURE_DATA`. The generated `library-data.ts` header comment is updated to name both sources.

## Data flow: pre-seed steps when a figure is picked

The figure seed is **server-side** today: `addPlacement` → `createFigure({figureRef, name, dance, figureType})` → `POST /api/figures` → the figure DO's `seedDoc(content)` → `buildDoc`. We thread attributes through this existing seam:

```
Assemble picker (figureType)
  → store.addPlacement(sectionId, name, figureType)
      → look up LIBRARY_FIGURES by (dance, figureType); if it has `attributes`, attach them
      → createFigure({ figureRef, name, dance, figureType, attributes })
          → POST /api/figures  { ..., attributes }
              → worker validates each attribute (parseAttributeWrite, per dance) — reject bad data
              → seedDoc({ ...figureDoc, attributes })  → buildFigureDoc persists them
  → figureConn(figureRef) replays the server-seeded steps into the local store
```

Picking an ISTD figure (no `attributes`) behaves exactly as today (empty timeline). Picking a WDSF figure lands its steps as a starting point the user can edit (US-028 editing flow unchanged afterward).

### Touch list

- `packages/domain/src/wdsf-timing.ts` (new) — `parseWdsfTiming` + step→attribute builder. Pure, tested.
- `packages/domain/src/library.ts` / `library-data.ts` — enriched `LibraryFigure` type + generated data.
- `scripts/gen-library.mjs` — merge WDSF seed, invoke the parser.
- `apps/web/src/store/routine.ts` — `addPlacement` catalog lookup; `CreateFigureFn` / figure payload gains `attributes`.
- `apps/worker` — `/api/figures` accepts + validates `attributes`, forwards into `seedDoc`.

## Testing

- **`wdsf-timing.test.ts`** (unit, RED-first): the rule table above — `"123 123"`, `"SQQ QQQQ"`, `"Q&Q"`, `"1&23"`, `(Lady)` stripping, leading-`&` clamp, optional-paren retention; every output count is ≥1 and on the 1/8 grid.
- **Generated-data invariant** (`library.test.ts` or new): every catalog attribute passes `parseAttributeWrite` for its dance; bump/relax the existing `LIBRARY_FIGURES.length` assertion (now ~247); assert a known WDSF figure (e.g. waltz `"Natural Turn"`) carries the expected step count and start/finish actions.
- **Web store** (`routine-store.test.ts`): picking a catalog figure with attributes posts them in the `createFigure` payload; picking one without stays attribute-free.
- **Worker** (`figures.test.ts`): `/api/figures` seeds forwarded attributes into the DO and **rejects** structurally/timing-invalid attributes.

## Out of scope

- Per-count footwork/sway/rise/turn (not in the public syllabus; the seed ships them empty by design).
- Splitting leader vs follower charts from `(Lady)` timing (v1 keeps base timing only).
- Enriching the existing ISTD entries with step data.
- ISTD↔WDSF system-attribution UI (figures are merged into one catalog; provenance lives in the `timing`/source comments).
