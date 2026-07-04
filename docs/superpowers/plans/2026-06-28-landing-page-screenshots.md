# Landing Page + Screenshot Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a logged-out landing page that explains Weave Steps with real screenshots of an example Waltz routine, produced by a Playwright journey, with a CI pipeline that regenerates the photos, auto-commits them, and posts a before/after PR comment.

**Architecture:** A `Landing` React component replaces the app shell for signed-out users and renders screenshots imported from `apps/web/src/marketing/screenshots/`. A `@screenshots`-tagged Playwright spec drives the real app (via the existing `#191` E2E harness) to build the routine and capture those PNGs. A GitHub Actions workflow runs the journey on PRs, pixel-diffs each image against the base branch, auto-commits regenerated images, and upserts a sticky before/after comment.

**Tech Stack:** React 19 + Vite + Tailwind v4 (design tokens), Clerk (via the `useAppAuth` seam), Playwright (chromium-desktop), Vitest + vitest-axe (component tests), `pixelmatch` + `pngjs` (diff), GitHub Actions.

## Global Constraints

- Package manager: `pnpm` (workspace). Node 22. Run all commands from the worktree root: `/Users/danielschmidt/fun/weave-steps/.claude/worktrees/landing-screenshots`.
- Branch: `feat/landing-screenshots` (already created off `origin/development`). PR targets `development`.
- Lint/format: Biome (`pnpm lint`). Never use `git commit --no-verify`. Never pipe `git commit` through `grep` (fish `$status` masking — see project memory).
- Commit messages end with: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Auth: components read auth ONLY through `useAppAuth()` / `AccountControls` (never Clerk directly) so the E2E build keeps working.
- Styling: use existing `ui` kit (`Button`, `Card`, etc. from `apps/web/src/ui`) and Tailwind tokens (`text-ink`, `text-ink-muted`, `text-ink-secondary`, `border-border-subtle`, `bg-*`). Mobile-first.
- E2E determinism: the `VITE_E2E=1` build disables animations; rely on Playwright auto-waiting (no `waitForTimeout`).
- Example routine is the cited Bronze Waltz amalgamation (see spec §3): Long Side = Natural Spin Turn, Reverse Turn, Double Reverse Spin, Whisk, Chassé from PP, Hesitation Change; Short Side = Reverse Turn, Basic Weave, Chassé from PP. Notate the Natural Spin Turn for the annotation screenshots.

---

## File Structure

New:
- `apps/web/src/marketing/screenshots.manifest.ts` — ordered `{key,file,alt,caption}` list; single source of truth for the landing gallery + diff script.
- `apps/web/src/marketing/screenshots/*.png` — the six committed images (placeholders first, real later).
- `apps/web/src/components/Landing.tsx` — the logged-out marketing page.
- `apps/web/src/components/landing.test.tsx` — component + a11y test.
- `apps/web/src/components/landing-visibility.ts` — pure `shouldShowLanding()` helper.
- `apps/web/src/components/landing-visibility.test.ts` — its unit test.
- `apps/web/e2e/screenshots.spec.ts` — the `@screenshots` journey that produces the PNGs.
- `scripts/screenshot-diff.mjs` — pixel-diff + comment-body builder (exports pure fns + a CLI).
- `scripts/screenshot-diff.test.mjs` — unit test for the diff/classify/comment fns (run via vitest).
- `.github/workflows/screenshots.yml` — the CI pipeline.

Modified:
- `apps/web/src/App.tsx` — render `<Landing/>` for the signed-out, non-invite state.
- `apps/web/package.json` — add `screenshots` script.
- root `package.json` — add `pixelmatch`, `pngjs` devDeps; add a `screenshots:diff` convenience script.

---

## Task 1: Screenshot manifest + placeholder assets

**Files:**
- Create: `apps/web/src/marketing/screenshots.manifest.ts`
- Create: `apps/web/src/marketing/screenshots/{hero,create,sections,notate,lanes,reading}.png` (placeholders)
- Test: `apps/web/src/marketing/screenshots.manifest.test.ts`

**Interfaces:**
- Produces: `export interface Screenshot { key: string; file: string; alt: string; caption: string }` and `export const SCREENSHOTS: Screenshot[]`. The `file` values name the PNGs the journey writes and the landing imports. Consumed by Tasks 2, 4, 5.

- [ ] **Step 1: Write the failing test**

`apps/web/src/marketing/screenshots.manifest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { SCREENSHOTS } from "./screenshots.manifest";

describe("screenshots manifest", () => {
  it("has the six expected keys in order", () => {
    expect(SCREENSHOTS.map((s) => s.key)).toEqual([
      "hero",
      "create",
      "sections",
      "notate",
      "lanes",
      "reading",
    ]);
  });

  it("every entry has a unique .png file and non-empty alt + caption", () => {
    const files = SCREENSHOTS.map((s) => s.file);
    expect(new Set(files).size).toBe(files.length);
    for (const s of SCREENSHOTS) {
      expect(s.file).toMatch(/^[a-z]+\.png$/);
      expect(s.alt.length).toBeGreaterThan(0);
      expect(s.caption.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run src/marketing/screenshots.manifest.test.ts`
Expected: FAIL — cannot resolve `./screenshots.manifest`.

- [ ] **Step 3: Create the manifest**

`apps/web/src/marketing/screenshots.manifest.ts`:

```ts
// Single source of truth for the landing-page gallery AND the CI diff/comment
// script. The Playwright @screenshots journey writes a PNG per `file`; Landing
// imports them; scripts/screenshot-diff.mjs diffs them in this order.
export interface Screenshot {
  /** Stable id used by the journey + diff classification. */
  key: string;
  /** File name under apps/web/src/marketing/screenshots/. */
  file: string;
  /** Accessible alt text (also the landing <img> alt). */
  alt: string;
  /** Human caption shown under the image on the landing page. */
  caption: string;
}

export const SCREENSHOTS: Screenshot[] = [
  {
    key: "hero",
    file: "hero.png",
    alt: "A Waltz routine laid out in Weave Steps",
    caption: "Your whole routine, figure by figure.",
  },
  {
    key: "create",
    file: "create.png",
    alt: "Creating a new Waltz routine",
    caption: "Start a routine in seconds — pick a dance and go.",
  },
  {
    key: "sections",
    file: "sections.png",
    alt: "A routine organised into Long Side and Short Side sections",
    caption: "Organise figures by the floor: Long Side, Short Side, corners.",
  },
  {
    key: "notate",
    file: "notate.png",
    alt: "Notating a figure across technique dimensions",
    caption: "Annotate every step — footwork, rise & fall, sway, turn.",
  },
  {
    key: "lanes",
    file: "lanes.png",
    alt: "The Lanes cross-step technique grid",
    caption: "See one technique across every step in the Lanes grid.",
  },
  {
    key: "reading",
    file: "reading.png",
    alt: "The read-only reading view for sharing with a coach",
    caption: "Share a clean reading view with your partner and coach.",
  },
];
```

- [ ] **Step 4: Create placeholder PNGs**

These let the landing build before the real journey runs (Task 4 overwrites them). Run from worktree root:

```bash
mkdir -p apps/web/src/marketing/screenshots
for f in hero create sections notate lanes reading; do
  magick -size 1600x1000 "xc:#e5e7eb" \
    -gravity center -pointsize 48 -fill "#6b7280" -annotate 0 "$f (placeholder)" \
    "apps/web/src/marketing/screenshots/$f.png"
done
```

(If `magick` is unavailable, use `convert` with the same args.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter web exec vitest run src/marketing/screenshots.manifest.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/marketing
git commit -m "feat(web): screenshot manifest + placeholder marketing assets

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Landing component

**Files:**
- Create: `apps/web/src/components/Landing.tsx`
- Test: `apps/web/src/components/landing.test.tsx`

**Interfaces:**
- Consumes: `SCREENSHOTS` from `../marketing/screenshots.manifest`; `AccountControls` from `../auth/app-auth`; `Button`, `Card` from `../ui`.
- Produces: `export function Landing(): React.JSX.Element`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/components/landing.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { SCREENSHOTS } from "../marketing/screenshots.manifest";
import { renderUi, screen } from "../test-support/render";

// Stub the auth seam: the real AccountControls renders Clerk components that
// need a ClerkProvider not present in jsdom.
vi.mock("../auth/app-auth", () => ({
  AccountControls: () => <button type="button">Sign in</button>,
}));

describe("Landing", () => {
  it("renders a hero headline and a sign-in CTA", async () => {
    const { Landing } = await import("./Landing");
    renderUi(<Landing />);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /sign in/i }).length).toBeGreaterThan(0);
  });

  it("renders every manifest screenshot with its alt text", async () => {
    const { Landing } = await import("./Landing");
    renderUi(<Landing />);
    for (const s of SCREENSHOTS) {
      expect(screen.getByAltText(s.alt)).toBeInTheDocument();
    }
  });

  it("has no axe violations", async () => {
    const { Landing } = await import("./Landing");
    const { container } = renderUi(<Landing />);
    expect(await axe(container)).toHaveNoViolations();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run src/components/landing.test.tsx`
Expected: FAIL — cannot resolve `./Landing`.

- [ ] **Step 3: Implement the component**

`apps/web/src/components/Landing.tsx`:

```tsx
import { AccountControls } from "../auth/app-auth";
import { SCREENSHOTS, type Screenshot } from "../marketing/screenshots.manifest";
import { Card } from "../ui";

// Resolve the committed PNGs to fingerprinted asset URLs at build time. The
// manifest's `file` field is the key into this map.
const IMAGES = import.meta.glob<{ default: string }>("../marketing/screenshots/*.png", {
  eager: true,
});

function imageUrl(file: string): string {
  const entry = IMAGES[`../marketing/screenshots/${file}`];
  return entry?.default ?? "";
}

function shot(key: string): Screenshot {
  const s = SCREENSHOTS.find((x) => x.key === key);
  if (!s) throw new Error(`unknown screenshot key: ${key}`);
  return s;
}

function Shot({ s, className }: { s: Screenshot; className?: string }): React.JSX.Element {
  return (
    <img
      src={imageUrl(s.file)}
      alt={s.alt}
      loading="lazy"
      className={`w-full rounded-xl border border-border-subtle shadow-sm ${className ?? ""}`}
    />
  );
}

const FEATURES = ["sections", "notate", "lanes", "reading"] as const;

/**
 * Logged-out marketing page. Standalone (no app shell / nav). The sign-in CTA
 * goes through the auth seam (AccountControls) so it works in both the live-Clerk
 * and E2E builds.
 */
export function Landing(): React.JSX.Element {
  const hero = shot("hero");
  return (
    <div className="min-h-dvh bg-surface text-ink">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
        <span className="text-lg font-bold tracking-tight">Weave Steps</span>
        <AccountControls />
      </header>

      <main className="mx-auto max-w-5xl px-5">
        {/* Hero */}
        <section className="flex flex-col items-center gap-8 py-10 text-center lg:py-16">
          <div className="flex max-w-2xl flex-col items-center gap-4">
            <h1 className="text-3xl font-bold tracking-tight lg:text-5xl">
              Build ballroom choreography, step by step.
            </h1>
            <p className="text-sm text-ink-secondary lg:text-base">
              Weave Steps is a mobile-first studio for couples and coaches to assemble routines,
              annotate every step's technique, and keep it all in sync across your devices.
            </p>
            <div className="mt-2">
              <AccountControls />
            </div>
          </div>
          <Shot s={hero} className="max-w-3xl" />
        </section>

        {/* Feature blocks, alternating sides */}
        <section className="flex flex-col gap-12 py-8 lg:gap-20">
          {FEATURES.map((key, i) => {
            const s = shot(key);
            return (
              <div
                key={s.key}
                className={`flex flex-col items-center gap-6 lg:flex-row lg:gap-10 ${
                  i % 2 === 1 ? "lg:flex-row-reverse" : ""
                }`}
              >
                <div className="flex-1">
                  <Shot s={s} />
                </div>
                <p className="flex-1 text-base font-medium text-ink lg:text-lg">{s.caption}</p>
              </div>
            );
          })}
        </section>

        {/* Closing CTA */}
        <section className="py-12 lg:py-20">
          <Card>
            <div className="flex flex-col items-center gap-4 py-6 text-center">
              <h2 className="text-xl font-bold tracking-tight lg:text-2xl">
                Ready to build your next routine?
              </h2>
              <AccountControls />
            </div>
          </Card>
        </section>
      </main>

      <footer className="mx-auto max-w-5xl px-5 py-8 text-2xs text-ink-muted">
        Weave Steps
      </footer>
    </div>
  );
}
```

Note: if `bg-surface` is not a defined token, substitute the page background token used by `AppShell` (check `apps/web/src/ui/AppShell.tsx` and `styles/tokens.css`); keep the rest unchanged.

- [ ] **Step 4: Run test + typecheck to verify they pass**

Run: `pnpm --filter web exec vitest run src/components/landing.test.tsx`
Expected: PASS (3 tests).
Run: `pnpm --filter web typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/Landing.tsx apps/web/src/components/landing.test.tsx
git commit -m "feat(web): logged-out Landing marketing page

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Wire Landing into the signed-out app

**Files:**
- Create: `apps/web/src/components/landing-visibility.ts`
- Test: `apps/web/src/components/landing-visibility.test.ts`
- Modify: `apps/web/src/App.tsx`

**Interfaces:**
- Produces: `export function shouldShowLanding(isSignedIn: boolean, routeName: string): boolean`.
- Consumes (in App.tsx): `useAppAuth().isSignedIn`, `useRoute().name`, `Landing`.

- [ ] **Step 1: Write the failing test**

`apps/web/src/components/landing-visibility.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { shouldShowLanding } from "./landing-visibility";

describe("shouldShowLanding", () => {
  it("shows the landing page when signed out on a normal route", () => {
    expect(shouldShowLanding(false, "home")).toBe(true);
    expect(shouldShowLanding(false, "routine")).toBe(true);
  });

  it("does NOT show it on an invite route (let invite redemption run)", () => {
    expect(shouldShowLanding(false, "invite")).toBe(false);
  });

  it("never shows it when signed in", () => {
    expect(shouldShowLanding(true, "home")).toBe(false);
    expect(shouldShowLanding(true, "invite")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run src/components/landing-visibility.test.ts`
Expected: FAIL — cannot resolve `./landing-visibility`.

- [ ] **Step 3: Implement the helper**

`apps/web/src/components/landing-visibility.ts`:

```ts
// Pure gate for the logged-out landing page, isolated so it's unit-testable
// without rendering the whole app shell.
export function shouldShowLanding(isSignedIn: boolean, routeName: string): boolean {
  if (isSignedIn) return false;
  // Invite deep-links must still reach the redemption flow (which prompts sign-in).
  return routeName !== "invite";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web exec vitest run src/components/landing-visibility.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire into App.tsx**

In `apps/web/src/App.tsx`, add imports near the existing component imports:

```tsx
import { Landing } from "./components/Landing";
import { shouldShowLanding } from "./components/landing-visibility";
```

Then, inside `AppHome`, immediately after the existing hooks (`const me = useMe();` … and before the `return (<AppShell …>`), add the early return:

```tsx
  if (shouldShowLanding(isSignedIn, route.name)) return <Landing />;
```

This replaces the small "Sign in to build choreography" card path for the signed-out, non-invite case with the full landing page (no app shell). Leave the existing signed-out `Card` JSX in place; it now only renders on the invite route when signed out.

- [ ] **Step 6: Verify build + tests + lint**

Run: `pnpm --filter web typecheck`
Expected: no errors.
Run: `pnpm --filter web exec vitest run src/components/landing-visibility.test.ts src/components/landing.test.tsx`
Expected: PASS.
Run: `pnpm lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/landing-visibility.ts apps/web/src/components/landing-visibility.test.ts apps/web/src/App.tsx
git commit -m "feat(web): show Landing for signed-out, non-invite users

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Screenshot journey + generate real images

**Files:**
- Create: `apps/web/e2e/screenshots.spec.ts`
- Modify: `apps/web/package.json` (add `screenshots` script)
- Modify (overwrite): `apps/web/src/marketing/screenshots/*.png` (real captures)

**Interfaces:**
- Consumes: `resetDb`, `seedDb` (`./support/fixtures`); `seedAuth` (`./support/auth`); `SCREENSHOTS` (for output paths).
- Produces: the six PNGs under `apps/web/src/marketing/screenshots/`, names matching `SCREENSHOTS[].file`.

- [ ] **Step 1: Add the `screenshots` script**

In `apps/web/package.json` `scripts`, add:

```json
    "screenshots": "playwright test --grep @screenshots --project=chromium-desktop",
```

- [ ] **Step 2: Write the journey spec**

`apps/web/e2e/screenshots.spec.ts`. It mirrors `authoring.spec.ts` (same harness + selectors) but uses the real Bronze Waltz figures and captures a PNG at each milestone. The output dir resolves relative to this file → `../src/marketing/screenshots`.

```ts
import { fileURLToPath } from "node:url";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { seedAuth } from "./support/auth";
import { resetDb, seedDb } from "./support/fixtures";

// ─────────────────────────────────────────────────────────────────────────
// @screenshots — NOT in @smoke. Drives the REAL app (via the #191 harness) to
// build the cited Bronze International Waltz amalgamation and capture the
// landing-page photos. Output PNGs are the committed marketing assets.
// Source routine: dancecentral.info International Waltz choreography.
// ─────────────────────────────────────────────────────────────────────────

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/marketing/screenshots");
const shot = (name: string) => path.join(OUT, name);

// Long Side then Short Side of the floor (the app's section model).
const LONG_SIDE = [
  "Natural Spin Turn",
  "Reverse Turn",
  "Double Reverse Spin",
  "Whisk",
  "Chassé from PP",
  "Hesitation Change",
];
const SHORT_SIDE = ["Reverse Turn", "Basic Weave", "Chassé from PP"];

test.describe("@screenshots landing imagery", () => {
  test("build a Waltz routine and capture the marketing screenshots", async ({ page }) => {
    const user = "user_demo";
    await resetDb(page);
    await seedDb(page, {
      users: [{ id: user, displayName: "Ava Lindqvist", identityColor: "#b8336a" }],
    });
    await seedAuth(page, user);
    await page.goto("/");

    // 1. Create-routine modal (Waltz).
    await page.getByRole("button", { name: /new choreo/i }).click();
    await page.getByLabel("Routine name").fill("Bronze Waltz");
    await page.getByLabel("Dance").selectOption("waltz");
    await page.screenshot({ path: shot("create.png") });
    await page.getByRole("button", { name: "Create" }).click();

    // Editor ready.
    await expect(page.getByRole("button", { name: "Add section" })).toBeVisible({ timeout: 15_000 });

    // 2. Two sections + their figures.
    for (const [section, figures] of [
      ["Long Side", LONG_SIDE],
      ["Short Side", SHORT_SIDE],
    ] as const) {
      await page.getByRole("button", { name: "Add section" }).click();
      await page.getByLabel("Section name").fill(section);
      await page.getByLabel("Section name").press("Enter");
      await expect(page.getByRole("heading", { name: section })).toBeVisible({ timeout: 15_000 });
      for (const figure of figures) {
        await page.getByRole("button", { name: "Add figure" }).first().click();
        await page.getByLabel("Figure name").fill(figure);
        await page.getByLabel("Figure name").press("Enter");
        await expect(page.getByText(figure).first()).toBeVisible({ timeout: 15_000 });
      }
    }
    await page.screenshot({ path: shot("sections.png"), fullPage: true });

    // 3. Notate the Natural Spin Turn across technique dimensions.
    await page.getByRole("button", { name: /edit steps: Natural Spin Turn/i }).first().click();
    await page.getByRole("button", { name: /count 1/i }).click();
    await page.getByRole("button", { name: /^T$/ }).click();
    await expect(page.getByLabel(/count 1 attributes/i).getByText("T")).toBeVisible();
    await page.screenshot({ path: shot("notate.png") });
    await page.keyboard.press("Escape");

    // 4. Lanes cross-step grid.
    await page.getByRole("button", { name: "Lanes" }).click();
    await expect(page.getByRole("grid")).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: shot("lanes.png"), fullPage: true });

    // 5. Reading view (read-only share surface) → also the hero image.
    await page.getByRole("button", { name: /reading view/i }).click();
    await expect(page.getByTestId("reading-view")).toBeVisible({ timeout: 15_000 });
    await page.screenshot({ path: shot("reading.png"), fullPage: true });
    await page.screenshot({ path: shot("hero.png"), fullPage: true });
  });
});
```

Note for the implementer: selector names (`Add figure`, `edit steps: …`, `Lanes`, `reading view`, `Add section`, `Routine name`, `Dance`) are copied from `authoring.spec.ts`/`annotations.spec.ts`. If any differ in the live UI, fix the selector (the journey must drive the real controls) — do NOT change app code to match.

- [ ] **Step 3: Run the journey to generate real images**

Run: `pnpm --filter web screenshots`
Expected: 1 passed; the six PNGs under `apps/web/src/marketing/screenshots/` are now real captures (no longer the grey placeholders). If the worker server step is slow on first run, the config's 180s `webServer.timeout` covers it.

- [ ] **Step 4: Sanity-check the landing renders the real images**

Run: `pnpm --filter web exec vitest run src/components/landing.test.tsx`
Expected: PASS (images still resolve by alt text).
Run: `pnpm --filter web build`
Expected: build succeeds (Vite bundles the PNGs).

- [ ] **Step 5: Commit the spec, script, and real images**

```bash
git add apps/web/e2e/screenshots.spec.ts apps/web/package.json apps/web/src/marketing/screenshots
git commit -m "feat(web): @screenshots journey + real Bronze Waltz marketing captures

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Pixel-diff + PR-comment script

**Files:**
- Create: `scripts/screenshot-diff.mjs`
- Test: `scripts/screenshot-diff.test.mjs`
- Modify: root `package.json` (devDeps `pixelmatch`, `pngjs`; `screenshots:diff` script)

**Interfaces:**
- Produces (exports from `scripts/screenshot-diff.mjs`):
  - `classify(baseBuf: Buffer | null, headBuf: Buffer | null): { status: "unchanged"|"changed"|"new"|"removed", diffPixels: number }`
  - `renderComment(rows: { key: string; file: string; status: string }[], ctx: { owner: string; repo: string; baseSha: string; headSha: string; basePath: string }): string`
  - a `main()` CLI (run when invoked directly) that reads the manifest, compares working-tree PNGs against `git show <base>:<path>`, writes `screenshot-comment.md`, and prints a `changed=true|false` line for the workflow.

- [ ] **Step 1: Add devDeps**

Run: `pnpm -w add -D pixelmatch pngjs`
Then add to root `package.json` `scripts`:

```json
    "screenshots:diff": "node scripts/screenshot-diff.mjs",
```

- [ ] **Step 2: Write the failing test**

`scripts/screenshot-diff.test.mjs` (run via vitest from root):

```js
import { describe, expect, it } from "vitest";
import { PNG } from "pngjs";
import { classify, renderComment } from "./screenshot-diff.mjs";

function png(color) {
  const p = new PNG({ width: 4, height: 4 });
  for (let i = 0; i < p.data.length; i += 4) {
    p.data[i] = color[0];
    p.data[i + 1] = color[1];
    p.data[i + 2] = color[2];
    p.data[i + 3] = 255;
  }
  return PNG.sync.write(p);
}

describe("classify", () => {
  it("identical images are unchanged", () => {
    const a = png([10, 20, 30]);
    expect(classify(a, Buffer.from(a)).status).toBe("unchanged");
  });
  it("different images are changed", () => {
    expect(classify(png([0, 0, 0]), png([255, 255, 255])).status).toBe("changed");
  });
  it("missing base is new, missing head is removed", () => {
    expect(classify(null, png([0, 0, 0])).status).toBe("new");
    expect(classify(png([0, 0, 0]), null).status).toBe("removed");
  });
});

describe("renderComment", () => {
  const ctx = {
    owner: "o",
    repo: "r",
    baseSha: "BASE",
    headSha: "HEAD",
    basePath: "apps/web/src/marketing/screenshots",
  };
  it("shows a before/after table for changed rows and a marker", () => {
    const md = renderComment([{ key: "hero", file: "hero.png", status: "changed" }], ctx);
    expect(md).toContain("<!-- screenshot-bot -->");
    expect(md).toContain("raw.githubusercontent.com/o/r/BASE/apps/web/src/marketing/screenshots/hero.png");
    expect(md).toContain("raw.githubusercontent.com/o/r/HEAD/apps/web/src/marketing/screenshots/hero.png");
  });
  it("reports no changes when all unchanged", () => {
    const md = renderComment([{ key: "hero", file: "hero.png", status: "unchanged" }], ctx);
    expect(md).toContain("No screenshot changes");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm exec vitest run scripts/screenshot-diff.test.mjs`
Expected: FAIL — cannot resolve `./screenshot-diff.mjs`.

- [ ] **Step 4: Implement the script**

`scripts/screenshot-diff.mjs`:

```js
// Pixel-diff the committed marketing screenshots against the PR base branch and
// build a sticky before/after PR-comment body. Pure fns are exported for tests;
// main() is the CLI used by .github/workflows/screenshots.yml.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const MARKER = "<!-- screenshot-bot -->";
const SCREENSHOT_DIR = "apps/web/src/marketing/screenshots";

/** Compare two PNG buffers (or nulls). Threshold tolerates AA noise. */
export function classify(baseBuf, headBuf) {
  if (!baseBuf && !headBuf) return { status: "unchanged", diffPixels: 0 };
  if (!baseBuf) return { status: "new", diffPixels: 0 };
  if (!headBuf) return { status: "removed", diffPixels: 0 };
  const a = PNG.sync.read(baseBuf);
  const b = PNG.sync.read(headBuf);
  if (a.width !== b.width || a.height !== b.height) {
    return { status: "changed", diffPixels: Number.POSITIVE_INFINITY };
  }
  const diffPixels = pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.1 });
  return { status: diffPixels > 0 ? "changed" : "unchanged", diffPixels };
}

const raw = (ctx, sha, file) =>
  `https://raw.githubusercontent.com/${ctx.owner}/${ctx.repo}/${sha}/${ctx.basePath}/${file}`;

/** Build the markdown comment body. */
export function renderComment(rows, ctx) {
  const changed = rows.filter((r) => r.status === "changed");
  const added = rows.filter((r) => r.status === "new");
  const removed = rows.filter((r) => r.status === "removed");
  const lines = [MARKER, "## 📸 Screenshot changes", ""];

  if (changed.length === 0 && added.length === 0 && removed.length === 0) {
    lines.push("No screenshot changes in this PR. ✅");
    return lines.join("\n");
  }

  if (changed.length) {
    lines.push("### Changed", "", "| Screenshot | Before | After |", "| --- | --- | --- |");
    for (const r of changed) {
      lines.push(
        `| \`${r.key}\` | <img width="320" src="${raw(ctx, ctx.baseSha, r.file)}"> | <img width="320" src="${raw(ctx, ctx.headSha, r.file)}"> |`,
      );
    }
    lines.push("");
  }
  if (added.length) {
    lines.push("### New", "", "| Screenshot | Image |", "| --- | --- |");
    for (const r of added)
      lines.push(`| \`${r.key}\` | <img width="320" src="${raw(ctx, ctx.headSha, r.file)}"> |`);
    lines.push("");
  }
  if (removed.length) {
    lines.push("### Removed", "", ...removed.map((r) => `- \`${r.key}\` (\`${r.file}\`)`), "");
  }
  return lines.join("\n");
}

/** Read a file from a git ref, or null if it doesn't exist there. */
function gitShow(ref, file) {
  try {
    return execFileSync("git", ["show", `${ref}:${file}`], { maxBuffer: 64 * 1024 * 1024 });
  } catch {
    return null;
  }
}

async function main() {
  // Args: base SHA, owner, repo, head SHA.
  const [baseSha, owner, repo, headSha] = process.argv.slice(2);
  if (!baseSha || !owner || !repo || !headSha) {
    throw new Error("usage: screenshot-diff.mjs <baseSha> <owner> <repo> <headSha>");
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  const manifestUrl = pathToFileURL(
    path.resolve(here, "../apps/web/src/marketing/screenshots.manifest.ts"),
  ).href;
  // The manifest is TS; read its file list with a tolerant regex (no TS loader in CI node).
  const manifestSrc = readFileSync(new URL(manifestUrl), "utf8");
  const files = [...manifestSrc.matchAll(/file:\s*"([^"]+\.png)"/g)].map((m) => m[1]);
  const keys = [...manifestSrc.matchAll(/key:\s*"([^"]+)"/g)].map((m) => m[1]);

  const rows = files.map((file, i) => {
    const rel = `${SCREENSHOT_DIR}/${file}`;
    const baseBuf = gitShow(baseSha, rel);
    let headBuf = null;
    try {
      headBuf = readFileSync(rel);
    } catch {
      headBuf = null;
    }
    return { key: keys[i] ?? file, file, status: classify(baseBuf, headBuf).status };
  });

  const ctx = { owner, repo, baseSha, headSha, basePath: SCREENSHOT_DIR };
  writeFileSync("screenshot-comment.md", renderComment(rows, ctx));
  const anyChange = rows.some((r) => r.status !== "unchanged");
  console.log(`changed=${anyChange}`);
}

// Run main() only when invoked as a CLI (not when imported by tests).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run scripts/screenshot-diff.test.mjs`
Expected: PASS (5 tests).

- [ ] **Step 6: Verify lint passes on the new JS**

Run: `pnpm lint`
Expected: no errors. (If Biome flags the `.mjs` files, follow existing repo conventions; do not add `--no-verify`.)

- [ ] **Step 7: Commit**

```bash
git add scripts/screenshot-diff.mjs scripts/screenshot-diff.test.mjs package.json pnpm-lock.yaml
git commit -m "feat(ci): screenshot pixel-diff + before/after comment builder

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: CI workflow

**Files:**
- Create: `.github/workflows/screenshots.yml`

**Interfaces:**
- Consumes: `pnpm --filter web screenshots` (Task 4), `node scripts/screenshot-diff.mjs` (Task 5).

- [ ] **Step 1: Write the workflow**

`.github/workflows/screenshots.yml`:

```yaml
name: Screenshots

# Regenerate the landing-page screenshots on PRs, auto-commit changes, and post a
# before/after comment. Heavy job → path-filtered + manual dispatch; excluded
# from the smoke critical path.
on:
  pull_request:
    branches: [development]
    paths:
      - "apps/web/**"
      - "apps/worker/**"
      - "packages/**"
      - ".github/workflows/screenshots.yml"
      - "scripts/screenshot-diff.mjs"
  workflow_dispatch:

# Need to push regenerated images to the PR branch and upsert a comment.
permissions:
  contents: write
  pull-requests: write

concurrency:
  group: screenshots-${{ github.ref }}
  cancel-in-progress: true

jobs:
  screenshots:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.ref }}
          fetch-depth: 0

      # Loop guard: skip if HEAD is the bot's own screenshot commit.
      - name: Should run?
        id: guard
        run: |
          author="$(git log -1 --format='%an')"
          subject="$(git log -1 --format='%s')"
          if [ "$author" = "screenshot-bot" ] || echo "$subject" | grep -q '\[skip ci\]'; then
            echo "run=false" >> "$GITHUB_OUTPUT"
          else
            echo "run=true" >> "$GITHUB_OUTPUT"
          fi

      - uses: pnpm/action-setup@v4
        if: steps.guard.outputs.run == 'true'
      - uses: actions/setup-node@v4
        if: steps.guard.outputs.run == 'true'
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install --frozen-lockfile
        if: steps.guard.outputs.run == 'true'
      - run: pnpm --filter web exec playwright install --with-deps chromium
        if: steps.guard.outputs.run == 'true'

      - name: Generate screenshots
        if: steps.guard.outputs.run == 'true'
        run: pnpm --filter web screenshots

      - name: Diff vs base + build comment
        if: steps.guard.outputs.run == 'true'
        id: diff
        run: |
          base="${{ github.event.pull_request.base.sha }}"
          node scripts/screenshot-diff.mjs "$base" "${{ github.repository_owner }}" "${{ github.event.repository.name }}" "$GITHUB_SHA" | tee diff-out.txt
          grep -q 'changed=true' diff-out.txt && echo "changed=true" >> "$GITHUB_OUTPUT" || echo "changed=false" >> "$GITHUB_OUTPUT"

      - name: Auto-commit regenerated screenshots
        if: steps.guard.outputs.run == 'true' && steps.diff.outputs.changed == 'true'
        run: |
          git config user.name "screenshot-bot"
          git config user.email "screenshot-bot@users.noreply.github.com"
          git add apps/web/src/marketing/screenshots
          git commit -m "chore(screenshots): regenerate landing imagery [skip ci]"
          git push origin HEAD:${{ github.event.pull_request.head.ref }}

      - name: Re-point comment to pushed commit
        if: steps.guard.outputs.run == 'true' && steps.diff.outputs.changed == 'true'
        run: |
          head="$(git rev-parse HEAD)"
          node scripts/screenshot-diff.mjs "${{ github.event.pull_request.base.sha }}" "${{ github.repository_owner }}" "${{ github.event.repository.name }}" "$head"

      - name: Upsert PR comment
        if: steps.guard.outputs.run == 'true'
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const body = fs.readFileSync('screenshot-comment.md', 'utf8');
            const { owner, repo } = context.repo;
            const issue_number = context.payload.pull_request.number;
            const marker = '<!-- screenshot-bot -->';
            const { data: comments } = await github.rest.issues.listComments({ owner, repo, issue_number });
            const existing = comments.find((c) => c.body && c.body.includes(marker));
            if (existing) {
              await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
            } else {
              await github.rest.issues.createComment({ owner, repo, issue_number, body });
            }
```

Note: the "Re-point comment" step re-runs the diff after the auto-commit so the **After** raw URLs reference the just-pushed SHA (the images now exist at that commit). The base "Before" URLs reference `pull_request.base.sha`, where the previous images live.

- [ ] **Step 2: Validate the workflow YAML locally**

Run: `node -e "const y=require('fs').readFileSync('.github/workflows/screenshots.yml','utf8'); require('child_process')" ` is not sufficient; instead confirm indentation by eye and, if `actionlint` is available, run `actionlint .github/workflows/screenshots.yml`.
Expected: no parse/lint errors. (If `actionlint` isn't installed, skip — the workflow is exercised on the PR.)

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/screenshots.yml
git commit -m "ci: screenshots workflow (regenerate, auto-commit, before/after PR comment)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 4: Push the branch + open the PR (verifies the pipeline end-to-end)**

```bash
git push -u origin feat/landing-screenshots
gh pr create --base development --head feat/landing-screenshots \
  --title "Landing page + screenshot pipeline" \
  --body "Adds a logged-out landing page with real Bronze Waltz screenshots, a @screenshots Playwright journey that produces them, and a CI pipeline that regenerates + auto-commits images and posts a before/after comment. Spec: docs/superpowers/specs/2026-06-28-landing-page-screenshots-design.md"
```

Expected: CI `verify` (existing) green; `Screenshots` workflow runs, and (on a follow-up change touching the UI) posts a before/after comment. Confirm the comment appears and the landing page renders the committed images.

---

## Self-Review

**Spec coverage:**
- §4 landing page → Tasks 2, 3. ✅
- §4.3 photos as imported assets + manifest → Tasks 1, 2. ✅
- §5.1 screenshot journey → Task 4. ✅
- §5.2 local command → Task 4 (`screenshots` script). ✅
- §5.3 CI: trigger/loop-guard/diff/auto-commit/before-after comment → Tasks 5, 6. ✅
- §5.4 edge cases (new/removed/first-run/fork) → `classify` statuses (Task 5) + workflow guards (Task 6); fork fallback is documented in the spec (push step simply no-ops without write scope). ✅
- §6 testing (component + axe + gates) → Tasks 2, 3, 5. ✅
- §3 real routine → Task 4 figure lists + Global Constraints. ✅

**Placeholder scan:** No TBD/TODO; every code step has complete code. The only deferred detail is the `bg-surface` token substitution note (Task 2), which gives an explicit fallback (check `AppShell`/`tokens.css`) rather than leaving it open.

**Type consistency:** `Screenshot`/`SCREENSHOTS` (Task 1) used identically in Tasks 2, 4. `shouldShowLanding(boolean, string)` defined and consumed (Task 3). `classify`/`renderComment` signatures match between the script and its test (Task 5) and the workflow's CLI args (Task 6: `<baseSha> <owner> <repo> <headSha>`).

Known follow-up for the implementer: selector names in the journey (Task 4) are copied from existing specs; verify against the live UI and adjust selectors (not app code) if any differ.
