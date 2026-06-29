# T0 Report — Additive `ui` primitives for design parity

**Status:** DONE
**Worktree branch:** `worktree-agent-a57b1bdbcceb2b90f`
**Head commit:** `d224cb612a98bb7584aa58503bbc980206a93e39`

## Important environment note (resolved)
My worktree was created off `main` (10fc692, the bare-skeleton release branch with **no app code**),
but the real app + the brief's reference files live on `development` (the integration branch the brief
says to base off). My branch had no work, so I `git reset --hard development` (91bea38) onto the real
app, then implemented there. This matches the documented "branch app-state disconnect" (real app is on
`development`, not `main`). Dependencies were not installed in the fresh worktree; ran `pnpm install
--frozen-lockfile` once.

The `.parity-audit/design/*.png` rendered frames are not checked into this worktree, so I worked from
the authoritative source spec: `docs/design/project/Ballroom Wireframes v4.dc.html`, frame **1.6** (lines
~335–383) and its helper classes (`.hd/.ht/.bk/.cnt/.bdot/.dot/.pin`), which carry the exact inline styles.

## Files created
All under `apps/web/src/ui/` (each primitive + co-located Vitest test):
- `ScreenHeader.tsx`, `ScreenHeader.test.tsx`
- `SegmentedToggle.tsx`, `SegmentedToggle.test.tsx`
- `CountPill.tsx`, `CountPill.test.tsx`
- `AttrChip.tsx`, `AttrChip.test.tsx`
- `SectionDivider.tsx`, `SectionDivider.test.tsx`

## Files changed
- `apps/web/src/ui/index.ts` — added the five primitive + type exports (only additions; nothing removed/changed).
- `apps/web/src/styles/tokens.css` — added two `--bf-*` tokens (see below).

## Prop signatures as built
```ts
// ScreenHeader.tsx
export interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;        // renders a ‹ back IconButton when provided
  backLabel?: string;         // aria-label for back (default "Back")
  actions?: React.ReactNode;  // right-aligned IconButtons
  className?: string;
}

// SegmentedToggle.tsx  (generic over the option value union)
export interface SegmentedToggleProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;          // group label on role="radiogroup"
  className?: string;
}

// CountPill.tsx
export interface CountPillProps {
  counts: string[];           // e.g. ["1","&","2","&","3","a"]
  className?: string;
}

// AttrChip.tsx
export interface AttrChipProps {
  kind: string;               // drives fill via kindVar; unknown kind → uses `color`
  label: string;              // rendered text (step chip passes merged "fwd·HT")
  color?: string;             // explicit color for a user-defined kind
  dimmed?: boolean;           // off-beat / inactive → lowers opacity
  className?: string;
}

// SectionDivider.tsx
export interface SectionDividerProps { label: string; className?: string; }
```

All signatures match the brief exactly.

## New `--bf-*` tokens added (in `apps/web/src/styles/tokens.css`)
- `--bf-offbeat-ink: #9aa7bb;` — muted slate for CountPill off-beat tokens (`&`,`a`,`e`,`i`); value from the
  frame-1.6 off-beat count color (`#9aa7bb`). Used by `CountPill`.
- `--bf-hairline: #e8e3da;` — the 1px section-label rule in the reading view; value from the frame-1.6
  divider rule (`#e8e3da`). Used by `SectionDivider`.

No hard-coded hex in any component file — kind colors go through `kindVar`, everything else through
`var(--bf-*)` tokens. (`AttrChip`'s `color` prop is a caller-supplied value for user-defined kinds, not a
hard-coded literal in the component.)

## Implementation notes
- `ScreenHeader` uses the existing `IconButton` for back + actions (≥44px targets), renders the title as an
  `<h1>`, subtitle as a muted `text-2xs` line; does not position itself (sticky-friendly).
- `SegmentedToggle` implements the ARIA radiogroup pattern on buttons (selected = `bg-accent`/`text-ink-inverse`,
  others = `text-accent` inside a `1.5px` `border-accent-border`), with roving focus + Arrow-key selection
  (mirrors `Tabs.tsx`). Biome's `useSemanticElements` flags `role="radio"` on a `<button>` (it prefers
  `<input type="radio">`, which can't host the segmented fill/touch styling) — suppressed with a file-level
  `// biome-ignore-all`, matching the existing `Lanes.tsx` precedent.
- `CountPill` marks off-beat tokens with `data-offbeat="true"` and dims them via `--bf-offbeat-ink`; on-beat
  detection is `/^[1-8]$/` (presentational only — float→label conversion stays in `packages/domain`).
- `AttrChip` resolves a standard `ATTRIBUTE_KINDS` member to `kindVar(kind)`; an unknown kind uses `color`
  (falling back to `--bf-ink-secondary`). Solid fill, white text, `rounded-[5px]`, `text-2xs` font-bold.
- `SectionDivider` is an uppercase letter-spaced muted eyebrow + a flex-filling `1px` `--bf-hairline` rule
  (the rule is `aria-hidden`).

## Tests
Test files (co-located): the five `*.test.tsx` listed above. Vitest + Testing Library via the
`apps/web/src/test-support/render` harness, with `axeCheck` a11y sweeps on each. RED→GREEN followed for
every primitive (failing test seen first — module-not-found — then implemented to green), small commit each.

New-primitive test counts: ScreenHeader 7, SegmentedToggle 7, CountPill 5, AttrChip 7, SectionDivider 4 (30 new).

### Exact gate commands run + output
- `pnpm --filter web typecheck` → `tsc --noEmit -p tsconfig.json` — **pass** (no output/errors).
- `pnpm --filter web test` → `vitest run` — **pass: Test Files 30 passed (30), Tests 180 passed (180)**.
- Lint: `apps/web` has no `lint` script, so the brief's `pnpm --filter web lint` is not a defined script;
  the repo lint gate is root `pnpm lint` → `biome check .` — **pass: Checked 243 files, No fixes applied**
  (also `biome check apps/web/src` → Checked 108 files, clean). The lefthook pre-commit hook (biome +
  workspace typecheck) ran green on all five commits.

## Commits (small, per primitive)
- `bdced9d` feat(ui): add ScreenHeader primitive
- `9e4b2c9` feat(ui): add SegmentedToggle primitive
- `5663f09` feat(ui): add CountPill primitive + --bf-offbeat-ink token
- `f8692b2` feat(ui): add AttrChip primitive
- `d224cb6` feat(ui): add SectionDivider primitive + --bf-hairline token

## Concerns
- **Worktree base mismatch:** my worktree was branched off `main` (no app); I reset onto `development`. The
  branch (`worktree-agent-a57b1bdbcceb2b90f`) now sits on top of `development`. Whoever integrates should
  merge/rebase this branch into `development`, not `main`.
- **`pnpm --filter web lint` is not a real script** (only root `pnpm lint` exists); I satisfied the lint gate
  via `biome check .`. If a per-package lint script is expected, that's a pre-existing repo gap, not from T0.
- The `.parity-audit` PNGs weren't present in this worktree; parity was matched against the frame-1.6 source
  HTML inline styles. Primitives are not yet wired into any screen — that's the later parity tasks, per brief.
- `--bf-offbeat-ink` / `--bf-hairline` are raw `--bf-*` tokens only (not mapped into the Tailwind `@theme`
  utility layer), consistent with how components consume non-utility tokens via `var(--bf-*)` (e.g. `Chip`).

## Fix wave 1

Three review findings addressed, all in the SegmentedToggle + AttrChip files (same branch/worktree).

### 1. IMPORTANT (a11y) — SegmentedToggle roving focus actually moves DOM focus
`apps/web/src/ui/SegmentedToggle.tsx`: added a `buttons` ref array (`useRef<(HTMLButtonElement | null)[]>`),
each segment registers itself via `ref={(el) => { buttons.current[idx] = el; }}`, and `onKeyDown` now calls
`buttons.current[next]?.focus()` after `onChange`. Arrow keys now move real DOM focus (true ARIA radiogroup
roving focus), not just selection state.
Test updated: the ArrowRight case now asserts `expect(screen.getByRole("radio", { name: "Follower" })).toHaveFocus()`.

### 2. MINOR — symmetric ArrowLeft test
`apps/web/src/ui/SegmentedToggle.test.tsx`: added "moves selection and focus with ArrowLeft" — focuses
"Follower" (value="follower"), presses `{ArrowLeft}`, asserts `onChange` called with `"leader"` AND
`getByRole("radio", { name: "Leader" })` has focus. SegmentedToggle test count 7 → 8.

### 3. MINOR — non-fragile unknown-kind in AttrChip test
`apps/web/src/ui/AttrChip.test.tsx`: replaced `kind="head"` with the clearly-synthetic, non-promotable
`kind="custom-x"` in both the explicit-color test and the axe test, so the `color`-prop path stays valid even
if real kinds (e.g. Head) are later promoted into the standard palette.

### Command run + output
`pnpm --filter web exec vitest run src/ui/SegmentedToggle.test.tsx src/ui/AttrChip.test.tsx`
```
 ✓ src/ui/AttrChip.test.tsx (7 tests) 45ms
 ✓ src/ui/SegmentedToggle.test.tsx (8 tests) 72ms
 Test Files  2 passed (2)
      Tests  15 passed (15)
```
Also re-verified clean: `biome check` on the three changed files (no fixes) and `pnpm --filter web typecheck`
(no errors).
