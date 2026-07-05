# Weave Steps — Design System

**Status:** v1 (base foundation), 2026-06-25.
**Scope:** the token-driven styling layer + accessible primitive components + an `AppShell` + a live gallery. This is the **base** the product screens are built on; it deliberately contains **no product screens or domain/CRDT logic**.

**Source of truth for rules:** [`docs/design/DESIGN-PRINCIPLES.md`](design/DESIGN-PRINCIPLES.md) (the 28 numbered principles — referenced below as `#n`). Colors/scopes trace to [`docs/PLAN.md`](PLAN.md) §3 and the visual language in `docs/design/Ballroom Builder.dc.html`.

> **Builder v2 refresh (2026-07-02):** the visual language now follows `docs/design/project/Ballroom Builder v2.dc.html`. Deltas from v1: `AttrChip` renders kind **tint + ink + 1px kind border** (no solid fill/white text); `--bf-ink-faint` darkened to `#8a857b` and a new `--bf-ink-label` (`#6f6a61`) covers eyebrow labels; off-beat counts read in the accent (size still differentiates); note affordances are accent “✎ Add note” with ≥36px hit areas and author-initial avatars; the attribute explainer is a full page with a kind pager. The first-visit tour popover (driver.js) is themed via the `.bf-tour` overrides in `styles/index.css` — tokens only.

---

## 1. Styling approach — and why

**Chosen: Tailwind CSS v4 (CSS-first `@theme`) over a CSS-variable token layer.**

- `apps/web/src/styles/tokens.css` defines every design token as a `--bf-*` **CSS variable** — the single source of truth (color, type, spacing, radius, shadow, z-index, motion).
- `apps/web/src/styles/index.css` imports the tokens, then `@import "tailwindcss"`, then maps a **subset** of tokens into Tailwind utilities via `@theme` (so `bg-surface`, `text-ink`, `text-kind-rise`, `rounded-lg` resolve to tokens). The full token set is always available via `var(--bf-*)`.

**Why this over alternatives:**

- **Tailwind v4 is Vite-native** (`@tailwindcss/vite`) — one plugin line, zero PostCSS config, no separate `tailwind.config.js`. It composes cleanly with the existing `vite-plugin-pwa` build (verified: PWA precache still generated).
- **CSS-first `@theme` keeps tokens as real CSS variables**, so they are themeable at runtime (e.g. the prototype's backdrop/accent/note-font switches) and usable from inline `style={{}}` for the cases utilities can't express (per-attribute-kind dynamic colors driven by the registry — #24).
- **The token layer is framework-agnostic** — if Tailwind were ever swapped, `tokens.css` and every `var(--bf-*)` reference survive untouched.
- vs. **CSS Modules + tokens:** more boilerplate per component, no utility ergonomics for the dense, mobile-first layouts this UI needs; chosen against.

**Fonts** are self-hosted via `@fontsource/inconsolata` + `@fontsource/caveat` (imported in `index.css`) — **no Google Fonts CDN**, so the installed PWA renders correctly offline (#20 spirit).

---

## 2. Token reference

All tokens live in `apps/web/src/styles/tokens.css` as `--bf-<group>-<role>`. **Rule (#22): reference tokens, never reinvent a hex/px.** TS consumers name tokens via `apps/web/src/ui/tokens.ts` (`kindVar()`, `ATTRIBUTE_KINDS`, `FIGURE_SCOPES`, `IDENTITY_COLORS`).

### Surfaces & ink
`--bf-backdrop` (studio paper), `--bf-backdrop-charcoal`, `--bf-surface` / `-raised` / `-sunken` / `-muted` / `-inverse`; `--bf-ink` / `-secondary` / `-muted` / `-faint` / `-inverse`; borders `--bf-border` / `-strong` / `-subtle`.

### Accent (studio blue)
`--bf-accent`, `--bf-accent-ink` (AA text on tints), `--bf-accent-tint`, `--bf-accent-border`.

### The five attribute-kind colors (PLAN §3) — paired with code+word **always** (#5)
Each kind exposes `base / -ink / -tint / -border`:

| kind | id | base hex | code | word |
|---|---|---|---|---|
| step / footwork | `step` | `#a9742c` (amber) | Fw | Footwork |
| rise & fall | `rise` | `#1f8a5b` (green) | Ri | Rise |
| position / bodyActions | `position` | `#8a5cab` (violet) | Bo | Body |
| sway | `sway` | `#c0563f` (terracotta) | Sw | Sway |
| turn | `turn` | `#5b6b8a` (slate) | Tn | Turn |

> Attribute kinds are **registry-driven** (#24): the standard five are tokenized, but the UI must render from the merged `ATTRIBUTE_REGISTRY` (standard + user-defined). For a user-defined kind whose color isn't in the standard set, pass its stored color through to `Chip`/`Badge` via `style`.

### Figure scopes (#11) — two consistent, distinct treatments
Scope is determined by **content divergence** (PLAN §4.3), not the copy mechanism.
`--bf-scope-{global|custom}` each with `-ink / -tint / -border`. Encoded by the `ScopeBadge` primitive as **word + icon + color** (never color alone):
- `library` — matches catalog (app-owned or account copy that still agrees): **Library** (slate, globe icon)
- `custom`  — diverged from or unrelated to the catalog (user-edited copy, from-scratch): **Custom** (amber, pencil icon)

### Semantic status
`--bf-success`, `--bf-warning`, `--bf-danger`, `--bf-info`, `--bf-offline` — each with `-ink` / `-tint` (warning/danger also `-border`). `offline` is desaturated slate so it reads as "not live" (#20).

### Identity
`--bf-identity-1..6` — member note colors / avatars (paired with name + initial, #5). `IDENTITY_COLORS` array in `tokens.ts`.

### Typography
Faces: `--bf-font-ui` (Inconsolata mono UI) and `--bf-font-note` (Caveat handwritten — for **human annotations only**, #23). Type scale in **rem** (`--bf-text-2xs`…`-xl`, plus `-note`) so it survives 200% zoom (#10). Weights `--bf-weight-*`, leading `--bf-leading-*`.

### Spacing / sizing / radius / shadow / z-index / motion
- Spacing: `--bf-space-0..12` (4px grid). **Touch target: `--bf-touch-target: 44px`** (#3).
- Radius: `--bf-radius-{sm|md|lg|xl|pill|round}`.
- Shadow: `--bf-shadow-{xs|sm|md|sheet|toast}`.
- Z-index: `--bf-z-{base|nav|overlay|sheet|toast}`.
- Motion: `--bf-duration-{fast|base|slow}`, `--bf-ease-{out|in-out}`. **Use `--bf-motion-{fast|base|slow}` in transitions/animations** — these collapse to `0ms` under `prefers-reduced-motion` (#9). A global reduced-motion rule in `index.css` is the safety net.

### Breakpoints (Tailwind, mobile-first)
Default = phone (~394px). `sm` 480, `md` 768, **`lg` 1024 = the desktop adapted layout** (#2).

---

## 3. Component inventory

All primitives live in `apps/web/src/ui/` and are exported from `apps/web/src/ui/index.ts`. Import: `import { Button, ScopeBadge } from "../ui";`.

Every interactive primitive: **≥44px hit area** (#3), **visible focus ring** (#7, global `:focus-visible`), **accessible name** (#8), **token-driven** (#22), **motion-gated** (#9).

| Component | Key props | Notes / principle |
|---|---|---|
| `Button` | `variant` (primary/secondary/ghost/danger), `size` (sm/md), `fullWidth`, `loading`, `leadingIcon` | `loading` sets `aria-busy` + Spinner (#18) |
| `IconButton` | **`label` (required)**, `variant` (plain/filled/inverse) | enforces accessible name for icon-only (#8) |
| `Input` | `label`, `hideLabel`, `hint`, `error`, …native | label/hint/error wired via `Field` (#8) |
| `Select` | `label`, `options`, `placeholder`, `hint`, `error` | native `<select>` for platform pickers + AT (#7,#8) |
| `Field` | `label`, `hint`, `error`, render-prop `children` | shared scaffold (`htmlFor`/`aria-describedby`/`aria-invalid`) |
| `Chip` | `tone` (neutral/accent/`AttributeKind`), `selected`, `asStatic`, `leading` | single-select toggle (`aria-pressed`) — the tag-editor pattern |
| `CountLabel` | `value: string` | **presentational seam** for float counts e/&/a (#27); conversion lives in `packages/domain` |
| `Badge` | `tone` (neutral/accent/success/warning/danger/info), `leading` | status marker, always text+tone (#5) |
| `ScopeBadge` | `scope`, `compact` | the two figure scopes (library/custom) as word+icon+color (#11) |
| `Card` | `padded`, `raised` | studio-paper surface (non-interactive) |
| `List` / `ListRow` | `leading`, `title`, `subtitle`, `trailing`, `showChevron` | `ListRow` is a real `<button>`; whole row ≥44px (#3) |
| `Tabs` | `items`, `value`, `onChange`, `label` | ARIA tabs, arrow-key roving focus (#7) |
| `Toggle` | `checked`, `onChange`, `label`, `hideLabel` | `role="switch"`. Use for the **role view toggle** (role is a view, not stored — #25) |
| `Sheet` | `open`, `onClose`, `title`, `meta` | bottom sheet on mobile, centered card on desktop (#2); dialog + Escape/focus (#7,#8) |
| `Modal` | `open`, `onClose`, `title`, `confirm`, `cancel` | `alertdialog` for destructive confirms (#28) |
| `ToastProvider` / `useToast` | `show(msg, { tone, action, duration })`, `dismiss(id)` | polite ARIA live region (#8,#16); dismissible, auto-dismiss, no focus trap |
| `Spinner` | `size`, `label` | `role="status"`; static under reduced motion (#9,#18) |
| `Skeleton` / `SkeletonRow` | `variant` (text/block/circle) | loading placeholders, hidden from AT (#18,#21) |
| `EmptyState` | `icon`, `title`, `description`, `actions` | designed empty states that guide the next action (#19) |
| `OfflineState` | `title`, `description`, `action` | honest "you're offline" **data** state (#20) |
| `AppShell` | `nav` (NavItem[]), `current`, `onNavigate` | bottom nav (thumb zone) on mobile, left rail + centered column on desktop (#1,#2,#4) |
| `icons.tsx` | `size` | decorative stroke icons, all `aria-hidden` (#8) |
| `BrandMark` (in `icons.tsx`) | `size` | the Weave Steps logo — a "woven W": two dancers' paths interlocking, the break showing one passing over the other. Decorative; always paired with the "Weave Steps" wordmark text (Inconsolata bold, tight tracking) |

### Brand mark

The logo's geometry (a 24-unit viewBox, stroke 2.4, round caps) lives in **four places that
must stay in sync** — change one, change all:

1. `apps/web/src/ui/icons.tsx` → `BrandMark` (in-app: AppShell side rail, Landing header; `currentColor`, shown in `text-accent` studio blue)
2. `apps/web/public/favicon.svg` (paper strokes on the studio-blue tile, `rx` 18%)
3. `scripts/gen-pwa-icons.mjs` → `SEGMENTS` (regenerates the four PWA/touch PNGs; run `node scripts/gen-pwa-icons.mjs`)
4. `docs/design/project/Weave Steps Logo.dc.html` (the design-bundle brand sheet — canonical design source)

### Standard toast messages (#16)
Callers emit the required confirmations:
```ts
toast.show("Copied as your variant");                                  // copy-on-write (#13)
toast.show("Undone", { action: { label: "Redo", onClick } });         // undo (#17)
toast.show("You've reached 3 routines on the free plan.", {           // quota upsell (4th owned)
  tone: "warning", action: { label: "Upgrade", onClick }, duration: 6000,
});
```

---

## 4. Responsive & accessibility conventions

- **Mobile-first (#1):** author for the phone column first; add `lg:` adaptations. Nothing essential needs a wider viewport or horizontal scroll.
- **Desktop is intentional (#2):** `AppShell` gives a left rail + a centered `max-w-2xl` content column; `Sheet` becomes a centered card at `lg`. Don't stretch mobile.
- **Touch (#3):** every control uses `min-h-[var(--bf-touch-target)]` (or `size-[…]`). Keep this when composing.
- **Color is never the only signal (#5):** pair attribute kinds with the two-letter code/word, scopes with the scope word+icon, status with text — use `Chip`/`Badge`/`ScopeBadge` which enforce this.
- **Contrast (#6):** the `-ink` token of each family is chosen for AA text on its `-tint`; use those pairings.
- **Keyboard + focus (#7):** all interactives are native `<button>`/`<input>`/`<select>` or have proper roles; the global `:focus-visible` ring is automatic.
- **Screen readers (#8):** `IconButton` requires `label`; `Field` wires labels; overlays are `dialog`/`alertdialog` with `aria-labelledby`; toasts announce via the live region.
- **Reduced motion (#9):** use the `--bf-motion-*` durations; a global media query also neutralizes stray transitions.
- **Zoom (#10):** type + spacing are in rem.
- **States are first-class (#18,#19,#20,#21):** reach for `Spinner`/`Skeleton`/`EmptyState`/`OfflineState` rather than blank or idle UI.

---

## 5. How to add a new component

1. Create `apps/web/src/ui/MyThing.tsx`. **Only reference tokens** (Tailwind utilities mapped in `@theme`, or `var(--bf-*)` inline) — no ad-hoc hex/px (#22).
2. If interactive: native element or correct role; `min-h-[var(--bf-touch-target)]`; rely on `:focus-visible`; give icon-only controls a `label`; gate any animation with `--bf-motion-*`.
3. If it carries meaning by color, also carry it by text/icon/shape (#5).
4. Export it from `apps/web/src/ui/index.ts` (Biome keeps exports sorted).
5. Add a state-complete entry to `apps/web/src/styleguide/Styleguide.tsx`.
6. Verify: `pnpm --filter web typecheck && pnpm --filter web build && pnpm lint`.

**To add a new design token:** add the `--bf-*` variable to `styles/tokens.css`; if it should be a utility, map it in the `@theme` block of `styles/index.css`; if TS code picks it, name it in `ui/tokens.ts`.

---

## 6. Viewing the gallery

The component gallery is a route in the running app:

```bash
pnpm --filter web dev      # then open http://localhost:5173/#styleguide
# or against a production build:
pnpm --filter web build && pnpm --filter web preview   # http://localhost:<port>/#styleguide
```

Reachable at `/#styleguide` or `/styleguide` (trivial hash check in `App.tsx` — no router dependency yet). The default route renders the `AppShell` home with the Clerk sign-in preserved and an "Open the styleguide" button.

---

## 7. Note for the test engineer (deferred harness item)

I did **not** edit the test harness (`vitest.config.ts`, `vitest.setup.ts`, `playwright.config.ts`, `e2e/`, or any `*.test.*`) per ownership boundaries. One thing to be aware of:

- **CSS is imported only in `apps/web/src/main.tsx`** (`import "./styles/index.css"`). **No primitive component imports CSS.** The component vitest config excludes `main.tsx` and only includes `src/**/*.test.{ts,tsx}`, and it transforms JSX with esbuild (no `@vitejs/plugin-react`, no `@tailwindcss/vite`). So **component tests do not hit the Tailwind transform** and should not need a config change to keep passing.
- If a future component test imports a stylesheet (it shouldn't need to), the vitest esbuild pipeline would need either a CSS-handling step or a `css: false`-style stub. **I deferred this to you** rather than touching `vitest.config.ts`. The recommended path is to keep components CSS-import-free (tokens come from the global stylesheet loaded once at the app root) — which is how the current set is built.
- `vitest-axe` assertions against these primitives should pass as authored (labels, roles, focusability are all in place), but the a11y test suite is yours to write.

I also added one line to the **root `biome.json`** `files.includes` to exclude `apps/web/src/styles` (Biome's CSS parser doesn't understand Tailwind v4 directives like `@import "tailwindcss"` / `@theme`, and flags the deliberate reduced-motion `!important`). This is a styling-config change; flagging it here for visibility.
