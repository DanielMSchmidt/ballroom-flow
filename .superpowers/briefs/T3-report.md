# T3 report — Assemble READING + EDITING parity (frames 1.6–1.9)

**Status:** DONE_WITH_CONCERNS (parity rebuilt + all gates green; a few documented
design-vs-feature deviations + data/store gaps)
**Branch:** `worktree-agent-a89c56c0b38c70404` (based on `parity/design-prototype`)
**Head:** `237a002`

## Worktree base
`git reset --hard parity/design-prototype` succeeded; verified `Assemble.tsx` +
all five T0 primitives (`SegmentedToggle`, `CountPill`, `AttrChip`,
`ScreenHeader`, `SectionDivider`) present. `.superpowers/briefs/` + `.parity-audit/`
are untracked on the branch — copied in from the sibling `keen-mapping-duckling`
worktree (same branch) to read the brief + design PNGs.

## Files changed
- **`apps/web/src/components/reading-columns.ts`** (new) — per-figure column model:
  `usedColumns` (only the kinds a figure uses, ordered Step·Rise·Pos·Sway·Turn·custom),
  `stepChipLabel` (merges direction+footwork → `fwd·HT`), `cellValue`, `isOffBeatCount`.
- **`apps/web/src/components/reading-columns.test.ts`** (new) — 11 unit tests (RED→GREEN).
- **`apps/web/src/components/reading-columns-role.ts`** (new) — `useStoredRoleView`
  hook, persists Leader/Follower to `localStorage["bb_role"]`.
- **`apps/web/src/components/RoutineReadingView.tsx`** (rebuilt) — frame 1.6 reading
  lens: STEPS-FOR `SegmentedToggle`, `SectionDivider` per section, per-figure
  used-columns table, merged Step `AttrChip`, `CountPill`, scope dot, derived "N bars",
  off-beat row dimming, inline step comments (profile-colored dot + Caveat) opening the thread.
- **`apps/web/src/components/Assemble.tsx`** (rebuilt) — `ScreenHeader`
  (‹ back "All routines" · title · reading/editing subtitle · ✎ lens toggle · ↗ Share);
  editing toolbar (Undo/Redo/Make-a-copy moved off the reading header); green collapsible
  section headers (▾/▸ + bars/figs meta); restyled figure cards (scope dot + name + CountPill
  + Custom pill + ⠿ handle + compact reorder/remove); dashed add-figure/add-section; inline
  add-section name panel (frame 1.9, toast "Added <name>"); empty state (frame 1.8); `onBack` prop.
- **`apps/web/src/components/reading-view.test.tsx`** (rewritten) — new column model,
  role-lens flip, off-beat dimming, inline-comment-opens-thread.
- **`apps/web/src/components/assemble.test.tsx`** — updated add-section submit name.
- **`apps/web/src/components/ChoreoFlow.tsx`** — passes `onBack`, drops its standalone
  "← All routines" button (now the ScreenHeader ‹).
- **`apps/web/src/styles/tokens.css`** — new `--bf-section-*` green token family
  (no hard-coded hex in components).
- **`apps/web/e2e/parity-capture.spec.ts`** (new, `@parity`) — drives the real app
  into the four states and captures `.parity-audit/app/assemble-{empty,add-section,editing,reading}.png`.
- **`apps/web/e2e/authoring.spec.ts`** — reading assertion updated for the merged Step chip.

## Per-frame
- **1.6 READING** — compact header; STEPS-FOR Leader|Follower toggle (persisted, flips
  role-aware values via `filterByRoleView`); section dividers; per figure a row of
  scope-dot+name+CountPill+bars, then a column header showing only the used kinds (each in
  its kind color), then step rows with a count cell + per-column `AttrChip`/faint dot; Step
  column merges dir+footwork (`fwd·HT`); off-beat rows dimmed; inline comments + "+ add comment".
- **1.7 EDITING** — filled ✎; green collapsible section headers (bars expanded / figs
  collapsed); figure cards (blue/amber dot + CountPill + Custom pill + ⠿ handle); dashed
  green add-figure / add-section.
- **1.8 EMPTY** — dashed ＋ glyph, "No sections yet", Caveat caption, green add-section button
  (editor only; a viewer sees just the line).
- **1.9 ADD SECTION** — green panel, "NAME THIS SECTION", free-text input, Caveat caption,
  Cancel + "Add section" → appends + toast "Added <name>".

## Screenshot-diff result
`@parity` spec passes on `chromium-desktop` + `mobile-chrome` and writes the four PNGs into
`.parity-audit/app/` next to `design/05–08`. Visual review confirms strong parity:
reading view reproduces the merged Step chips (`fwd·HT`, `side·T`, `close·TH`), STEPS-FOR
toggle, dividers and CountPills; the add-section panel (1.9) and empty state (1.8) match
closely; the editing spine (green sections, figure cards, dashed adds, amber custom styling)
matches. **Note:** Playwright can't pixel-diff against arbitrary design PNGs (different
dimensions/content), so the spec asserts the load-bearing structure of each state and emits
the captures as artifacts for side-by-side review rather than a numeric pixel delta.

## Tests / gates (all green)
- `pnpm --filter web typecheck` — clean.
- `pnpm --filter web test` — **195 passed** (incl. new reading-columns 11, reading-view 6).
- `pnpm lint` (Biome, noExplicitAny=error) — clean.
- E2E against the real #191 worker (chromium-desktop): **full @smoke subset green**
  (authoring, convergence, fork-and-figures incl. COW, permission/quota/invite incl. Share,
  library, template, undo, annotations) + the new `@parity` capture spec.
- One-line: `web 195 unit green; typecheck+lint clean; full @smoke e2e + @parity capture green`.

## Deviations from the idealized frames (functional, documented)
- **Section/figure management retained inline.** Frames 1.7/1.9 show no rename/move/delete on
  the section header (gesture/figure-detail implied). US-026/US-027 + their tests require these,
  so they're kept as compact icon buttons (✎ ↑ ↓ ✕) in the green header / figure card. At phone
  width this squeezes long names to a truncation (e.g. "1st Long…"). Moving them into an overflow
  menu would fully match the frame but needs a reworked US-026 interaction model — left as follow-up.
- **Attribute summary + alignment chips on the editing card.** Not in frame 1.7 but required by
  US-018/US-031 (and their tests); kept as a subtle sub-line.
- **Share (↗) also on the editing header.** Frame 1.7 shows only ✎, but an editor opens in the
  editing lens and US-024 expects Share reachable without switching lenses — kept in both.
- **Mode-toggle accessible names** stay "Reading view"/"List view" (on the ✎ IconButton) to keep
  the existing reading-toggle journeys/tests stable across the redesign.

## Store / data gaps
- **Columns-shown is data-driven and honest:** library figures resolved via the catalog arrive
  pre-notated with only `direction`+`footwork`, so in the live capture only the **Step** column
  renders (richer figures show Rise/Pos/Sway/Turn automatically). No gap — just reflects seeded data.
- **"Head" column (frame 1.6 teal):** there is no `head` attribute kind in the registry/tokens
  (`ATTRIBUTE_KINDS` = direction/footwork/rise/position/sway/turn). The code handles any custom
  kind generically (own titled column, kind color via `kindVar` with a slate fallback), so a
  user-defined "Head" kind would render — but the design's built-in Head column has no backing
  model. **Open question for the domain owner: is `head` a planned standard kind?**
- **Inline comments are figure-anchored per step via `point` anchors** (count match). The read
  model exists (`store.readAnnotations()` → `Annotation.anchors` with `{type:"point",count}`),
  profile color is derived by hashing `authorId` into `IDENTITY_COLORS` — **there is no
  per-author identity-color field on `Annotation`**, so the dot color is a stable hash, not the
  member's real profile color. Tapping a comment / "+ add comment" opens the existing annotation
  panel (the thread wiring proper is T8).
- **Derived bar count** uses `barsForFigure(counts, dance)` summed across a section's figures;
  correct, but only meaningful once figures are notated (un-notated figures contribute 0).

---

## Fix wave 1 (review QUAL-1 / QUAL-4 / QUAL-3)

**New head:** `<filled in after commit>`

### QUAL-1 — "+ add comment" reachable at zero comments
`InlineComments` no longer early-returns `null` on `comments.length === 0`. `StepRow`
now renders the comment block when `comments.length > 0 || canComment`, and the
"+ add comment" button renders whenever `canComment` (independent of comment count).
The dead `|| onOpenThread` guard is gone. Files: `RoutineReadingView.tsx`.

### QUAL-4 — capability-gate the affordance
Threaded a `canComment` boolean through `RoutineReadingView → FigureReadout → StepRow →
InlineComments`. `Assemble.tsx` passes `canComment={can(role, "canAnnotate")}` — commenters
and editors get it; a pure viewer does not (a viewer still READS existing comments).
Tests added to `reading-view.test.tsx`:
- "shows '+ add comment' with ZERO comments when the user can comment" (renders + click → onOpenThread).
- "hides '+ add comment' for a viewer (cannot comment)" (comment still readable; add button absent).

### QUAL-3 — finding + fix
**Finding: the write path does NOT strictly block an inapplicable value.**
`appliesToDances` is consumed only as a UI affordance — `AttributeEditor.tsx:50` and
`FigureTimeline.tsx:148` hide the rise section for Tango — and is round-tripped for custom
kinds in the worker DB. But the actual write, `store.setFigureAttributes` (`store/routine.ts:667`),
persists the attribute array to the figure doc with **no dance-based validation**; there is no
`appliesToDances` enforcement in any domain write/validation function (grep across
`packages/domain/src` shows it only in the type def, the registry, fixtures, and tests).
So a `rise` value could be persisted onto a Tango figure via a non-UI path / migration / a
custom kind keyed `rise`.
**Fix (as instructed): threaded `dance` into `usedColumns`.** `usedColumns(attrs, dance?)` now
skips any standard kind whose builtin-registry `appliesToDances` excludes the dance
(`kindAppliesToDance`), so the reading view defends itself — Tango never renders a Rise column
even if a stray rise value is present. Test added to `reading-columns.test.ts`
("excludes the Rise column for Tango … even with a stray value"). `RoutineReadingView` passes
the routine's `dance` into `usedColumns`.

### Commands + output
```
pnpm --filter web typecheck   # clean
pnpm lint                     # Biome: Checked 246 files. No fixes applied. (clean)
pnpm --filter web test        # Test Files 31 passed (31) · Tests 198 passed (198)
  - reading-columns.test.ts   # 12 passed
  - reading-view.test.tsx     # 8 passed
playwright annotations --grep @smoke --project=chromium-desktop   # 1 passed
playwright authoring   --grep @smoke --project=chromium-desktop   # 3 passed (incl. viewer read-only)
```

### Files touched this wave
- `apps/web/src/components/reading-columns.ts` (dance-gated `usedColumns` + `kindAppliesToDance`)
- `apps/web/src/components/reading-columns.test.ts` (+1 Tango test)
- `apps/web/src/components/RoutineReadingView.tsx` (`canComment` thread; zero-comment add affordance; `usedColumns(live, dance)`)
- `apps/web/src/components/reading-view.test.tsx` (+2 capability tests)
- `apps/web/src/components/Assemble.tsx` (passes `canComment={can(role, "canAnnotate")}`)
