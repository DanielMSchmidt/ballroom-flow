# Task T0 — Additive `ui` primitives for design parity

You are adding **five new presentational primitives** to the Ballroom Flow design system so later
screen-parity tasks consume them instead of redefining markup. This task is **purely additive** — do NOT
change existing primitives or their consumers (one tiny export addition to `ui/index.ts` is fine).

## Where this fits
Ballroom Flow is a built React PWA being brought to pixel-parity with a canonical mobile design. UI is built
from `apps/web/src/ui` primitives + CSS `--bf-*` tokens (Tailwind v4 maps them via `@theme`). These five
primitives are the shared atoms the Assemble reading/editing/timeline screens need.

## Canonical visual reference (study before coding)
- Rendered design frames (PNG): `.parity-audit/design/05_1.6_Assemble_READING_attribute_columns_only_what_s.png`
  (the attribute-column grid — your chips/pills/headers must match these), and
  `.parity-audit/design/06_1.7_Assemble_EDITING_sections_figures.png`.
- The source HTML for exact styles: `docs/design/project/Ballroom Wireframes v4.dc.html`, frame **1.6**
  (search for `1.6 · Assemble — READING`, ~lines 335–383). The exact inline styles there are your spec.

## Read first (current system — match its conventions)
- `apps/web/src/ui/index.ts` (export surface), `apps/web/src/ui/tokens.ts` (`kindVar(kind, role)`,
  `ATTRIBUTE_KINDS`), `apps/web/src/ui/Chip.tsx`, `apps/web/src/ui/Toggle.tsx`, `apps/web/src/ui/cx.ts`.
- `apps/web/src/styles/tokens.css` — confirm token names (`--bf-kind-<kind>`, `--bf-kind-<kind>-ink/-tint/
  -border`, ink/surface/hairline tokens). **Never hard-code hex** — use tokens / `kindVar`. If a needed shade
  has no token, add it to `tokens.css` with a `--bf-*` name and use it.
- A co-located test file already exists for most primitives (e.g. `Chip.test.tsx`) — follow that test style
  (Vitest + Testing Library, `apps/web/src/test-support` render harness, axe where used).

## The five primitives (create each as `apps/web/src/ui/<Name>.tsx` + `<Name>.test.tsx`, export from index.ts)

### 1. `ScreenHeader`
Compact per-screen header used on inner screens (replaces the busy header). Frame 1.6 header = `‹` back,
title + small subtitle ("reading"), trailing action slots (`✎`, `↗`).
```ts
export interface ScreenHeaderProps {
  title: string;
  subtitle?: string;
  onBack?: () => void;          // renders a ‹ back IconButton when provided
  backLabel?: string;           // aria-label for back (default "Back")
  actions?: React.ReactNode;    // right-aligned action buttons (use IconButton)
  className?: string;
}
```
Layout: row, back button left, title (Inconsolata 700) + subtitle (Inconsolata 500, muted) stacked, actions
right. Use existing `IconButton` for back/actions. ≥44px touch targets. Sticky-friendly (no position itself).

### 2. `SegmentedToggle`
Two/few-option segmented control (frame 1.6 "STEPS FOR [Leader|Follower]"). Selected segment = studio-blue
fill + white text; others = blue text on transparent, inside a `1.5px` blue-tinted rounded border.
```ts
export interface SegmentedToggleProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;            // group label (role="radiogroup" or use Tabs-style a11y)
  className?: string;
}
```
A11y: arrow-key roving focus, `aria-pressed`/`role=radio` semantics (mirror `Tabs.tsx` patterns). Min touch
target on each segment.

### 3. `CountPill`
Renders a figure's count tokens inline (frame 1.6 shows `1 2 3`, `1 & 2 & 3 a`, `1 & 2`). On-beat counts
(`1`–`8`) normal; off-beat tokens (`&`, `a`, `e`, `i`) **dimmed** (muted slate). Rounded light-blue pill.
```ts
export interface CountPillProps {
  counts: string[];             // e.g. ["1","&","2","&","3","a"]
  className?: string;
}
```
Background `--bf-kind-direction-tint` (light blue) or an existing light surface token; on-beat ink studio-blue,
off-beat ink a muted slate token (add `--bf-offbeat-ink` if none fits, value ~`#9aa7bb`). Font Inconsolata 700.

### 4. `AttrChip`
The small attribute chip rendered in grid cells and column rows (frame 1.6). Two forms:
- **Step chip** (merged): direction + footwork as one chip, e.g. `fwd·HT`, `side·T`, `close·TH` — solid
  studio-blue (`--bf-kind-direction` / `kindVar("direction")`) bg, white text.
- **Kind chip**: a single attribute value tinted by its kind — e.g. Rise `comm`/`up`/`low` (green
  `kindVar("rise")`), Position `Closed`/`PP` (purple `kindVar("position")`), Sway `to R` (red
  `kindVar("sway")`), Turn `¼R`/`⅛R` (slate `kindVar("turn")`), Head/custom (teal).
```ts
export interface AttrChipProps {
  kind: string;                 // attribute kind id (drives color via kindVar; unknown kind → pass `color`)
  label: string;                // the rendered text (Step chip caller passes the merged "fwd·HT")
  color?: string;               // explicit color for a user-defined kind not in the standard palette
  dimmed?: boolean;             // off-beat / inactive rows
  className?: string;
}
```
Solid fill = kind base color, white text; font Inconsolata 700 ~8px, radius ~5px, padding `2px 4px`. `dimmed`
lowers opacity. Empty cell is NOT this component — the grid renders a faint dot; do not add that here.

### 5. `SectionDivider`
The uppercase section label row in reading view (frame 1.6: "1ST LONG SIDE" + a hairline rule filling the row).
```ts
export interface SectionDividerProps { label: string; className?: string; }
```
Label: Inconsolata 700 ~8px, muted, letter-spacing; followed by a `1px` hairline (`--bf-hairline`) flexing to
fill width.

## Acceptance
- All five primitives created with co-located Vitest tests (render + key props + a11y where relevant: toggle
  keyboard nav, ScreenHeader back-button aria). RED→GREEN: write a failing test first, see it fail, implement,
  see it pass.
- Exported from `apps/web/src/ui/index.ts` (+ types). No existing primitive or consumer changed in behavior.
- No hard-coded hex in component files — tokens / `kindVar` only (new tokens added to `tokens.css` if needed).
- Gates green: `pnpm --filter web typecheck`, `pnpm --filter web test`, `pnpm --filter web lint`.
- Match the frame 1.6 chip/pill/header look (compare against the rendered PNG; they need not be wired into a
  screen yet — that's later tasks).

## TDD + workflow
Follow superpowers:test-driven-development (RED→GREEN→REFACTOR). Commit per primitive (small commits).
Work on your isolated worktree branch. Do not push; do not open a PR — report your branch + head SHA.
