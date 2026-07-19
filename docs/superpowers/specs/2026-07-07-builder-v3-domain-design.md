# Builder v3 — domain features (owner-approved 2026-07-07)

**Ship gate:** the updated `apps/web/e2e/authoring.spec.ts` + `library.spec.ts` journeys (breaks-as-figures, portion add, counts stepper) green on PR #170, plus the existing @smoke set staying green.

**Goal.** Land the five Builder v3 features that the 2026-07-07 UI pass deferred because each
reverses/extends a locked model. The owner confirmed all five are intentional and answered the
four model forks (recorded below — these are now decisions, superseding `Q-V3-DEFERRED` in
PLAN §12).

## Owner decisions (2026-07-07)

| # | Feature | Decision |
|---|---|---|
| ① | Counts-based length | Figure docs author `counts` (beats, 1–64); `bars` is DERIVED everywhere as `⌈counts / beatsPerBar⌉`. Migration v4→v5 converts `bars → counts = bars × beatsPerBar` on figure docs and drops `bars`. |
| ② | Presence attributes | `value: null` is a legal attribute value ("present, no value yet" — the dashed ring). A presence attribute is a FULL CITIZEN: it counts toward the figure's timing span / default length and claims per-beat ownership in variant resolution like any edit. |
| ③ | Portion window | `Placement.part = { fromCount, toCount }` — a float-count WINDOW on the placement. The figure doc stays whole and live: reads window the resolved timeline, so a catalog edit inside the window flows in. A placement's bar contribution is the window's whole-beat span. |
| ④ | Breaks as figures | Each added Break mints its OWN choreo-local figure doc (`name:"Break"`, `counts = beatsPerBar`, no attributes) — independently sized/editable. Legacy `{source:'break'}` placements are MIGRATED (worker-side: mint + project + seed the Break figure docs FIRST, then rewrite the routine doc's placements under the migration actor — never post-hoc CRDT surgery). The reading/edit break UI paths remain as fallback until a doc is migrated. |
| ⑤ | Named variant on add-to-library | The naming input on "＋ Add to library" RENAMES the live shared figure doc (visible in every routine referencing it), then bookmarks it. |

## What already exists — do not rebuild

The 2026-07-07 UI pass (same PR): reading notes margin + column picker, three-state grid cells
(the *present* ring already renders for empty-valued attributes), "Done" confirm, slug chip,
two-line cards. The v5 live-figure machinery: `resolveFigure` per-beat ownership, spawnVariant,
bookmarks (`POST /api/figures/save-to-library`), fork copies, the migration ladder wired into
the DO load path (`migrateDraft`).

## Per-layer changes

**domain** — `CURRENT_SCHEMA_VERSION = 5`; `MIGRATIONS[4]` (figure docs: `counts = bars × bpb`, drop `bars`); `FigureDoc.counts?`; `resolveFigureCounts` / `resolveFigureBars` (derived); `figureCountSlots(counts, dance)` grid source; `Attribute.value: unknown | null` legal on write; `defaultFigureCounts`; `Placement.part?`; `windowAttributes` + windowed beat entries for `numberRoutineBeats`; spawnVariant/fork copy `counts`; `renameFigure` write helper if missing.
**contract** — figure schemas gain `counts` (keep `bars` for lenient reads); placement schema gains `part`.
**worker** — projection (`doc-do.ts`) derives bars via `resolveFigureBars` + respects `part` windows in routine bar sums; `seed-global-figures` authors `counts`; the legacy-break DO-load migration (hard gate: Frontend+Tester+Staff verdicts before merge).
**web** — LENGTH stepper in counts (max 64); tapCell quick-add (presence attr + toast) for optional-value kinds; portion picker in the Add-figure sheet; Break entry mints a local Break figure (add-break UI removed, legacy render kept); variant naming bar (rename + bookmark).

## Out of scope

Latin dances, media, offline creation of figures (stays live-gated — Break add included).
