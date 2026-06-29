# Task T3 — Assemble READING + EDITING parity (the spine)

Rebuild the Assemble screen's **reading** and **editing** lenses to match design frames 1.6–1.9. This is the
centerpiece and the most divergent screen. You OWN these files for this task; work sequentially and keep the
authoring `@smoke` journey green throughout.

## Files
- Modify: `apps/web/src/components/Assemble.tsx` (the screen + mode toggle + section/placement rendering),
  `apps/web/src/components/RoutineReadingView.tsx` (the read-only programme view), and the placement-card +
  section-header bits they use.
- Consume (NEW T0 primitives, already merged): `ScreenHeader`, `SegmentedToggle`, `CountPill`, `AttrChip`,
  `SectionDivider` from `@/ui` (or `../ui`). Also `ui/Sheet`, `ui/Toast`, `ui/IconButton`.
- Data: ONLY via the store seam (`store/routine.ts`, `store/routine-view.ts`). Do not touch Automerge/RPC.
- Tests: `Assemble.test.tsx`, `reading-view.test.tsx` (extend), keep `apps/web/e2e/authoring.spec.ts` green.

## Reference (read the frame PNGs + source HTML before coding)
- Reading: `.parity-audit/design/05_1.6_Assemble_READING_attribute_columns_only_what_s.png`
- Editing: `.parity-audit/design/06_1.7_Assemble_EDITING_sections_figures.png`,
  `.parity-audit/design/07_1.8_Assemble_EDITING_new_empty.png`,
  `.parity-audit/design/08_1.9_Add_section_inline_free_text_name.png`
- Source HTML `docs/design/project/Ballroom Wireframes v4.dc.html`: frame 1.6 (~lines 335–383), 1.7 (~387–417),
  1.8 (~421–440), 1.9 (~444–471). The inline styles there are the exact spec.
- Current app baselines: `.parity-audit/app/assemble-reading.png`, `.parity-audit/app/assemble-editing.png`.

## READING view (frame 1.6) — the big rebuild
Replace the current busy text-button header + always-on abbreviated columns + tall white step-cards with:
1. **Compact header** via `ScreenHeader`: `‹` back → routine list; title = routine name; subtitle = "reading";
   trailing actions = `✎` (mode toggle → editing) and `↗` (Share). Move Undo/Redo/Make-a-copy OUT of the
   header into the editing affordances or a compact menu (they are NOT in the reading frame — reading is the
   clean programme). Keep their functionality reachable (editing view / overflow), just off the reading header.
2. **`STEPS FOR` SegmentedToggle** (Leader | Follower) at top of the body; persist the choice (the app already
   persists role via `localStorage bb_role` — reuse it). Follower flips role-aware values.
3. **Per-section** `SectionDivider` (uppercase label + hairline), e.g. "1ST LONG SIDE".
4. **Per figure:** a row of scope dot (blue=library / amber=custom) + figure name + `CountPill` (the figure's
   actual counts, off-beats dimmed) + optional scope pill + "N bars". Then a **column-header row showing ONLY
   the attribute kinds this figure actually uses** (each header in its kind color: Step/Rise/Pos/Sway/Turn/
   Head…). Then **step rows**: count cell + per-column `AttrChip` or a faint empty dot. The **Step column chip
   merges direction+footwork** into one blue chip (`fwd·HT`). **Off-beat rows (`&`/`a`) are dimmed** (muted
   surface + slate count).
5. **Inline comments** under a step (latest ~2, truncated, profile-colored dot + Caveat text) + "+ add comment"
   — tapping opens the thread. (Wiring the thread itself is T8; here render the inline comment line from the
   annotation store read model and make "+ add comment"/a comment open the existing annotation panel.)
6. Figure name tap → Figure detail (existing open-figure flow).

The columns-shown logic: for each figure, compute the set of attribute kinds that have ≥1 value across its
counts (respecting the merged registry + dance gating, e.g. Tango omits Rise), and render only those columns.

## EDITING view (frames 1.7/1.8/1.9)
1. Header: `‹` + title + "editing" subtitle + **dark/active `✎`** (toggles back to reading).
2. **Section header** (green): `▾/▸` collapse toggle + name + green meta "N bars" (or "N figs"). Tap toggles
   collapse/expand.
3. **Figure cards**: scope dot (blue/amber) + name + `CountPill` + `⠿` drag handle affordance (the drag
   *gesture* can stay as the existing reorder mechanism; match the handle look). Custom figures show the amber
   dot + a "custom"/"variant · X" pill.
4. Dashed **"＋ add figure"** (green dashed) inside each section → Add-figure sheet (existing).
5. Dashed **"＋ add section"** (green dashed) at the end → inline add-section panel (frame 1.9): green panel,
   "NAME THIS SECTION" label, free-text input, caption "e.g. 1st Long Side · Corner · Intro · Spin section —
   anything you like", cancel + "add section"; on add → append empty section + toast "Added <name>".
6. **Empty state** (frame 1.8): dashed ＋ icon, "No sections yet", caption "Add a section (e.g. \"1st Long
   Side\"), then drop figures into it.", green "＋ add section" button. A freshly-created/forked-empty routine
   lands here.

## Constraints
- Permissions: editing affordances only when `canEdit` (commenter/viewer see reading, no edit controls).
- No hard-coded hex — tokens / `kindVar` / T0 primitives. Studio-paper system.
- Keep the existing copy-on-write, undo/redo, fork, reading/edit data plumbing working (you're restyling +
  restructuring the render, not changing the store contract).

## Acceptance
- Reading + editing + empty + add-section states match frames 1.6–1.9 at phone width (extend
  `apps/web/e2e/parity-capture.spec.ts`, screenshot, diff against the design PNGs, iterate).
- Leader/Follower toggle persists + flips role values; only-used columns render; off-beats dimmed; inline
  comments appear and open the thread.
- `authoring.spec.ts` (and other Assemble journeys) stay green; component tests cover the new
  columns-shown logic + mode toggle + empty/add-section.
- Gates: `pnpm --filter web typecheck && pnpm --filter web test && (cd ../../ && pnpm lint)`.
- TDD; small commits; own worktree branch; no push/PR. Report to `.superpowers/briefs/T3-report.md` (branch +
  head SHA + test summary + any store-data gaps for inline comments / columns-shown / bars).
