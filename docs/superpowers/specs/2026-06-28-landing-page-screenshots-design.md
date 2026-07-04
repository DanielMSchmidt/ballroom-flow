# Landing Page + Screenshot Pipeline — Design Specification

**Status:** Approved for planning
**Date:** 2026-06-28
**Branch:** `feat/landing-screenshots` (off `development`); PR targets `development`.

## 1. Problem & Goals

A not-authenticated user who opens Weave Steps today sees the full app shell
with a small "Sign in to build choreography" card (`apps/web/src/App.tsx`,
`AppHome`, `!isSignedIn` branch). There is no explanation of what the product is
and no sense of what it looks like in use.

Goals:

1. **Landing page** — a real logged-out marketing view that explains the product
   and shows it in action with screenshots of a genuine choreography.
2. **Screenshot pipeline** — the photos are produced by a test that builds a real
   routine (with figures + technique annotations) in the *real app* and captures
   screenshots along the way, so the marketing imagery never drifts from reality.
3. **PR feedback** — on every relevant PR, CI regenerates the screenshots,
   compares them to the base branch, and posts a **before/after** comment so UI
   changes are visible at review time. Regenerated images are auto-committed to
   the PR branch so the committed photos always match the current UI.

Non-goals (YAGNI): external image CDN/R2 hosting, visual-regression *gating*
(diffs are informational, not a failing check), any change to the signed-in app
beyond the landing entrypoint.

## 2. Context (verified against `development`)

- The real app lives on `development` (PRs #76/#77 merged): `ChoreoFlow`,
  `FigureLibrary`, `AnnotationPanel`, `Lanes`, `AttributeEditor`,
  `RoutineReadingView`, a URL router (`lib/router.ts`), a `ui` kit, and an auth
  seam (`auth/app-auth.tsx`: `useAppAuth` / `AccountControls`) shared by live
  Clerk and the E2E test path. `main` / `improved-ui` are behind and are NOT a
  viable base for this work.
- A mature Playwright harness exists: `apps/web/playwright.config.ts` (projects
  `chromium-desktop`, `mobile-chrome`, `mobile-safari`; smoke subset via
  `@smoke`; serialized, 1 worker, shared local D1), `apps/web/e2e/serve.sh`
  (builds the SPA with `VITE_E2E=1`, migrates a fresh local D1, runs the real
  worker serving SPA + API + WS at one origin), and support helpers
  `e2e/support/{auth,fixtures,jwt,two-users}.ts` (`resetDb`, `seedDb`,
  `seedAuth`, `gotoRoutine`).
- `e2e/authoring.spec.ts` already performs the target journey shape: create a
  routine → add a section → add a figure → notate a count (footwork "T") → set
  entry alignment → reading view → list. The screenshot journey is modeled on it.
- Styling is Tailwind with design tokens (`text-ink`, `border-border-subtle`,
  etc.); animations are disabled under `VITE_E2E` (the `.bf-e2e` flag), which
  makes screenshots deterministic.
- CI today: `.github/workflows/ci.yml` (lint + typecheck + build + test on PRs)
  and `deploy.yml` (staging←development, production←main). `.gitignore` already
  ignores `playwright-report/` and `test-results/`.

## 3. Example routine (real, cited)

Bronze International Waltz amalgamation, Man starts facing Diagonal Wall (DW),
from Dance Central's waltz choreography reference:

1. Natural Spin Turn
2. Reverse Turn (4–6)
3. Double Reverse Spin
4. Whisk
5. Chassé from Promenade Position
6. Hesitation Change
7. Reverse Turn (1–3, check)
8. Basic Weave (ending PP)
9. Chassé from Promenade Position

Grouped into the app's sections as **Long Side** (figures 1–6) and
**Short Side** (figures 7–9), reflecting the rectangular competition floor.

At least one figure (the Natural Spin Turn) is notated across technique
dimensions for the screenshots using standard textbook technique, e.g.:
footwork HT/T/TH across counts, rise (commence end of 1, up 2–3), sway, and turn.
The journey notates enough to demonstrate the annotation surfaces; it does not
exhaustively notate all nine figures.

Source: <https://www.dancecentral.info/ballroom/international-style/waltz/waltz-choreography>

## 4. Deliverable A — Landing page

### 4.1 Wiring

`App.tsx` `AppHome`: when `!isSignedIn` and the route is not `invite`, render
`<Landing />` instead of the `AppShell`. The landing page is standalone (no
bottom nav). Invite deep-links remain handled by the existing path (sign-in CTA →
post-auth redemption); the landing entrypoint does not break invite flows.

### 4.2 Component

`apps/web/src/components/Landing.tsx` — sections:

- **Hero:** product name, headline, one-line subhead, primary CTA (sign in /
  sign up via the existing auth seam — reuse `AccountControls` / Clerk
  `SignInButton`), and the hero screenshot.
- **Feature blocks (3–4):** each a short explanation paired with a real
  screenshot — (a) build a routine by floor sides, (b) notate steps across
  technique dimensions, (c) Lanes cross-step view, (d) Reading view to share with
  a coach.
- **Closing CTA.**

Mobile-first; uses existing Tailwind tokens + `ui` kit (`Button`, `Card`).

### 4.3 Photos as assets

- Images live at `apps/web/src/marketing/screenshots/*.png` and are imported by
  `Landing.tsx` (Vite fingerprints them at build).
- `apps/web/src/marketing/screenshots.manifest.ts` is the single source of truth:
  an ordered list of `{ key, file, alt, caption }`. Both `Landing.tsx` and the
  CI diff/comment script consume it (ordering + captions + the canonical file
  list). The screenshot journey writes files whose names match `file`.

## 5. Deliverable B — Screenshot pipeline

### 5.1 The journey (the "test that produces the pictures")

`apps/web/e2e/screenshots.spec.ts`, tagged `@screenshots` (excluded from
`@smoke`). Uses the existing harness; runs against the real worker via
`serve.sh`. Steps, capturing `page.screenshot({ path })` into
`apps/web/src/marketing/screenshots/` at each:

1. Choreo list / empty state.
2. Create-routine modal with "Waltz" selected.
3. Assemble view with the two sections (Long Side / Short Side) and the real
   figures placed.
4. A figure's step timeline being notated (footwork / rise & fall / sway / turn
   chips visible).
5. Lanes cross-step view.
6. Reading view (`data-testid="reading-view"`).

Determinism: rely on `VITE_E2E` animation-disable; mask any nondeterministic
regions; seed a fixed user (and, where useful for the share/coach shot, a second
member) via `seedDb`. Capture in the `chromium-desktop` project by default; the
manifest may include a mobile-captured shot if a feature block calls for it.

### 5.2 Local command

`pnpm --filter web screenshots` runs only the `@screenshots` Playwright project
(its own `webServer` via `serve.sh`). Used once during implementation to commit
the initial baseline (so the landing page ships non-broken) and for offline
regeneration. A root alias may be added for convenience.

### 5.3 CI workflow

`.github/workflows/screenshots.yml`:

- **Trigger:** `pull_request` to `development` filtered to relevant paths
  (`apps/web/**`, `apps/worker/**`, `packages/**`, the workflow itself), plus
  `workflow_dispatch`.
- **Loop guard:** the job skips when the head commit is the bot's own screenshot
  commit (author/marker check) and the auto-commit message carries `[skip ci]`.
- **Steps:**
  1. Checkout PR head with full history; `pnpm install --frozen-lockfile`.
  2. Install Playwright browsers (chromium).
  3. Run the `@screenshots` project (builds + boots the real worker via
     `serve.sh`).
  4. **Diff:** for each PNG under `marketing/screenshots/`, compare the freshly
     generated image against the base branch version (`git show <base>:<path>`)
     using a pixel-diff tool (`pixelmatch` or `odiff`). Classify each as
     changed / new / removed / unchanged.
  5. **Auto-commit:** if anything changed/new/removed, commit the regenerated
     PNGs to the PR branch and push (message includes `[skip ci]` and a bot
     marker). Same-repo PRs use the default `GITHUB_TOKEN`.
  6. **Comment:** upsert a single sticky PR comment (hidden marker for
     idempotency) containing a 2-column markdown table per changed image —
     **Before** = `raw.githubusercontent.com/<owner>/<repo>/<baseSHA>/<path>`,
     **After** = same at the pushed head SHA — plus lists of new / removed /
     unchanged. No external hosting: the images are committed, so raw URLs
     resolve.

### 5.4 Edge cases

- **First run (this feature's own PR):** the initial baseline is committed
  locally during implementation, so the landing page is never broken; the first
  CI run reports "unchanged" or the deltas from the locally committed set.
- **New screenshot key:** appears under "new" in the comment; committed.
- **Removed key:** flagged "removed"; file deleted in the auto-commit; the
  manifest must be updated in the same PR (CI surfaces a mismatch if a manifest
  entry has no file or vice versa).
- **Fork PRs:** out of scope for this single-owner repo. Both the push and the PR
  comment steps require a same-repo write token; on a fork PR both will fail or
  be skipped by GitHub. There is no artifact fallback.

## 6. Testing

- Component test `apps/web/src/components/landing.test.tsx`: renders hero +
  CTA + the manifest images; a11y via the repo's existing axe matchers.
- The `@screenshots` spec is the E2E that exercises the real journey.
- Standard gates apply: `pnpm lint`, `pnpm -r typecheck`, `pnpm -r build`,
  `pnpm -r test`.

## 7. File inventory

New:

- `apps/web/src/components/Landing.tsx`
- `apps/web/src/components/landing.test.tsx`
- `apps/web/src/marketing/screenshots.manifest.ts`
- `apps/web/src/marketing/screenshots/*.png` (generated, committed)
- `apps/web/e2e/screenshots.spec.ts`
- `.github/workflows/screenshots.yml`
- CI helper script(s) for diff + comment (e.g. `scripts/screenshot-diff.mjs`),
  location finalized in the plan.

Changed:

- `apps/web/src/App.tsx` (render `<Landing/>` for the logged-out, non-invite
  state).
- `apps/web/package.json` (add the `screenshots` script; pixel-diff devDep).

## 8. Open risks

- **Determinism across CI vs local** (font rendering, viewport). Mitigation:
  pin the Playwright project/device, rely on `VITE_E2E` animation-disable, mask
  volatile regions; accept a small pixel-diff threshold to avoid noise.
- **Auto-commit + CI interaction.** Mitigation: `[skip ci]` + bot-author skip
  guard (§5.3).
- **CI minutes** (heavy job). Mitigation: path-filtered trigger +
  `workflow_dispatch`; excluded from the smoke path.
