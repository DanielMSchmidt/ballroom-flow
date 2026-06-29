# Task T2 — Choreo list + Open/Fork sheet + New-choreo sheet (design parity)

Bring the Choreo (home) tab to parity with design frames 1.1–1.5. Touch only the Choreo components — do NOT
edit the app shell/header (`App.tsx`/`AppShell.tsx`) or other tabs; another task owns those.

## Files
- Modify: `apps/web/src/components/ChoreoList.tsx`, `apps/web/src/components/ChoreoFlow.tsx`
- Use: `ui/Sheet`, `ui/ScreenHeader` (NEW from T0 — compact header), `ui/Button`, `ui/IconButton`,
  `ui/EmptyState`, `ui/Chip` (dance chips), the routine store hooks (`store/routines.ts`: `useRoutines`,
  `useCreateRoutine`, `useForkRoutine`, `isQuotaError`), `store/me.ts` (`useMe` for plan/cap).
- Tests: co-located `ChoreoList.test.tsx` (+ existing `choreo-list.test`), and extend the authoring or a new
  Playwright journey only if a flow changes (keep `@smoke` green).

## Reference
- Frames (rendered PNG + source HTML `docs/design/project/Ballroom Wireframes v4.dc.html`, frames 1.1–1.5,
  ~lines 161–326):
  - `.parity-audit/design/00_1.1_Choreo_list_a_few_items.png`
  - `.parity-audit/design/01_1.2_Choreo_list_empty_first_run_.png`
  - `.parity-audit/design/02_1.3_Choreo_list_many_scrolls_forked.png`
  - `.parity-audit/design/03_1.4_Open_Fork_sheet_overlay.png`
  - `.parity-audit/design/04_1.5_New_choreo_sheet_overlay.png`
- Current app baseline: `.parity-audit/app/choreo-list.png`, `.parity-audit/app/choreo-empty.png`.

## Required parity changes
1. **Header (within the Choreo screen):** title **"My Choreos"** (Inconsolata 700 16px) + a round studio-blue
   **＋** button (26px, white glyph) at right — NOT the current "Choreography" + black "New Choreo" pill.
   (The persistent "Ballroom Flow / Signed in" bar is the shell's; another task removes it — do not add your
   own app-name bar.)
2. **Routine card (frame 1.1):** left a **dance-coloured rounded square** (34px, radius 9px) with the choreo
   glyph (the vertical-bars `Steps`/library icon in dance colour bg, white); title (Inconsolata 700 12px);
   meta line **`Dance · <bars> · <date>`** with dot separators (Inconsolata 500 9px, muted). Trailing **`⋯`**
   menu button.
   - **Bars label:** prefer a derived bar count → `"7 bars"`; when the routine has no figures show
     **`"no figures yet"`**. Use whatever the store/index already exposes for this; if a derived bar count is
     NOT available without loading each routine doc, fall back to the dance's bar label and record the data
     gap in your report (do NOT load every routine doc on the list — that's out of scope).
   - **Date:** human format like `"Jun 2025"` / `"today"` (not `6/29/2026`).
   - Dance colour for the icon: map dance→`--bf-*` (waltz studio-blue, quickstep green, foxtrot purple, tango
     red, viennese slate) — reuse existing dance-colour mapping if one exists; else add a small token-based map.
3. **Forked card (frame 1.3):** amber tint surface + amber border, title in amber ink, and a second line
   **`⑂ forked from <origin>`** (fork glyph + lineage). Drive off the routine's lineage/forkedFrom data from
   the store (whatever field exists; if none, render only when present and note the gap).
4. **Empty state (frame 1.2), exact copy:** heading **"No choreos yet"**, caption **"Each dance gets its own
   routine — plus extras for practice. Start your first."**, dark button **"＋ Create choreo"**. Use
   `ui/EmptyState`.
5. **`⋯` → Open / Fork sheet (frame 1.4):** a `ui/Sheet` with two options — **"Open"** (subtitle "view & edit
   this routine") → opens the routine; **"Fork — make it your own"** (amber, subtitle "a frozen, independent
   copy you fully own") → forks (existing `useForkRoutine`, quota-checked) and opens the copy with toast
   **"Forked — independent copy"**. Tapping scrim dismisses.
6. **New-choreo sheet (frame 1.5):** keep using `ui/Sheet`; **dance as selectable chips** (Waltz · Viennese
   Waltz · Quickstep · Foxtrot · Tango; selected = studio-blue fill) instead of a `<Select>`; a NAME input
   (placeholder "e.g. Gold Waltz — comp routine"); buttons **cancel** + **create choreo** (dark). On create →
   open Assemble editing (existing behavior), quota-checked (4th owned → existing upsell; keep it).
7. **Search:** the current search box (US-046) is NOT in the design frame. Keep it functional but visually
   subordinate (don't let it dominate the header); place/style it so the list matches the design's density. If
   it reads as clutter, collapse it behind the existing pattern — but do not remove the capability or its test.

## Acceptance
- All five frames matched at phone width (compare your screenshots to the design PNGs — extend
  `apps/web/e2e/parity-capture.spec.ts` to shoot the list, empty, sheet, and new-choreo states, run
  `npx playwright test parity-capture --project=mobile-chrome`, diff, iterate).
- `⋯` Open/Fork sheet works; fork toast correct; New-choreo dance chips work; empty/forked states correct copy.
- Quota upsell preserved; search still works (test green).
- Gates: `pnpm --filter web typecheck && pnpm --filter web test && (cd ../../ && pnpm lint)`; existing
  choreo/authoring journeys green.
- No hard-coded hex; tokens only. TDD: failing test first for each behavior change.

## Workflow
TDD (RED→GREEN→REFACTOR), small commits, your own worktree branch, no push/PR. The E2E server: run
`E2E_PORT=<pick a free port, e.g. 4183> bash apps/web/e2e/serve.sh` in the background for screenshot capture
(set `baseURL`/`E2E_PORT` accordingly), or reuse :4173 if free. Report branch + head SHA + test summary +
any data gaps (bars/lineage) to `.superpowers/briefs/T2-report.md`.
