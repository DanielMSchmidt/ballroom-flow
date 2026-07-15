# Comment activity fade-out — execution plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The spec is [`docs/ideas/comment-activity-fadeout.md`](comment-activity-fadeout.md) — read it fully before Task 1. The design source is `docs/design/project/Ballroom Builder v3.dc.html` (grep `tCollapsed`, `tStaleLabel`, `showing all · collapse older`, `_margin`, `partitionByActivity`; threads `f3|2` and `f4|1` seed the two named scenarios). Load the `ballroom-flow-change-control` and `ballroom-flow-validation-and-qa` skills before editing.

**Goal:** In the timeline reading view only, render **active** comments by default — `active(c) ⇔ lastActivity(c) ≥ now − 28×24h ∨ lastActivity(c) ≥ anchor − 7×24h`, where `lastActivity(c) = max(c.createdAt, createdAt of c's non-deleted replies)` and `anchor = max(lastActivity)` over the rendered per-anchor list — with the rest collapsed behind ONE honest counted divider that expands in place. Rolling millisecond durations against stored unix-ms timestamps, **never calendar days**. Presentation-only: no data-shape, sync, permission, DO, or D1 change.

**Architecture:** A pure domain partition helper (`partitionByActivity` in a new `packages/domain/src/annotation-activity.ts`) is called at render time by two reading-view surfaces: the thread panel (`AnnotationPanel` thread mode, opened from a margin cell) collapses the stale prefix behind a counted divider row with an expand/collapse toggle; the notes margin (`RoutineReadingView` → `FigureReadout` → `NotesMarginCell`) derives each cell's snippet/avatars from that cell's **active** routine comments only. `now` is captured once per view mount and passed down. The Playwright ship gate seeds backdated `createdAt` through the E2E test-support seed seam, which this plan extends (the UI stamps `Date.now()` on create, so backdating MUST go through seeding).

**Tech Stack:** TypeScript (strict), Vitest + fast-check (domain), jsdom + Testing Library + vitest-axe (web component), Playwright (E2E vs the real worker via the #191 harness), pnpm monorepo, typed i18n catalogs.

## Global Constraints

- **TDD:** write the failing test first, watch it fail, then implement. One commit per task.
- **This is the app's first wall-clock-dependent rendering.** EVERY covering test injects `now` — domain tests pass it as an argument, component tests pass the `now` prop. `Date.now()` never appears inside the domain helper's logic path (it appears only as the component-mount default that E2E exercises with real backdated seeds).
- **Referential stability must survive** (docs/system/sync-and-offline.md § Flicker): the store's heads-keyed materialization + `reconcile` structural sharing keep annotation/placement identities stable across unrelated sync frames — the partition is derived per render from stable inputs plus a mount-stable `now`, so `React.memo` bail-outs in `RoutineReadingView` keep working. Never store the partition; never generate a fresh `now` per render. A view left open across a boundary re-evaluates on next data change or remount — that is correct, do not add a ticker.
- **No `any`, no type assertions** (`as` is a Biome/GritQL error; `as const` allowed). No `@ts-expect-error`. Narrow with type guards; the seed-route payload is runtime-validated with Zod, never cast.
- **Components never touch Automerge or the RPC client** — annotations keep arriving through `apps/web/src/store/` (`store.readAnnotations()`); the domain helper is a pure function components may import directly (the established pattern — `RoutineReadingView` already imports `numberRoutineBeats` etc. from `@weavesteps/domain`).
- **All user-facing strings via the typed locale seam** `apps/web/src/i18n/` — one catalog file per surface, `de: typeof en` makes a missing/extra German key a compile error. Stored values are never translated.
- **Reading view only.** No change to the Journal, the library family-note surface, the figure-detail standard-mode panel (filter bar + compose), or the editing lens. No reordering, no read/unread, no persistence of the expanded state.
- **Soft-delete respected:** tombstoned annotations are already dropped by `readAnnotations()`; tombstoned **replies** must NOT count as activity (the helper filters them).
- Branch `feat/comment-activity-fadeout` off `main`; PR into `main`; **never commit to `main` directly, never `--no-verify`**, don't merge red. Run gates explicitly: `pnpm -w lint`, `pnpm -w typecheck`, package-scoped tests per task.
- Package filters: domain = `@weavesteps/domain`, web = `web`, contract = `@weavesteps/contract`, worker = `worker`.

## Exact signatures this plan builds on (verbatim from the codebase)

- `Reply` / `Annotation` — `packages/domain/src/doc-types.ts`:

  ```ts
  export type Reply = {
    id: string;
    authorId: string;
    text: string;
    createdAt: number;
    deletedAt?: number | null;
  };

  export type Annotation = {
    id: string;
    authorId: string;
    kind: AnnotationKind;
    text: string;
    tags: string[];
    anchors: Anchor[];
    replies: Reply[];
    createdAt: number;
    deletedAt?: number | null;
  };
  ```

- Store read (the only annotation source components see) — `apps/web/src/store/routine.ts`:
  `/** Routine-scoped annotations (US-039), tombstones dropped. */ readAnnotations(): Annotation[];`
  (on both `RoutineReadModel` and the writable store; `routine-view.ts` delegates:
  `readAnnotations: () => readSource().readAnnotations(),`). `Assemble.tsx` feeds surfaces with
  `annotations={store.readAnnotations()}`.
- Thread panel — `apps/web/src/components/AnnotationPanel.tsx`: props include
  `annotations?: Annotation[]`, `threadTitle?: string` (**when set, the panel renders in THREAD MODE**);
  thread mode renders `<p className="text-2xs text-ink-muted">{t.commentCount(visible.length)}</p>` and
  `<ul aria-label={t.commentThread} ...>{visible.map((a) => <li key={a.id}><ThreadComment .../></li>)}</ul>`.
  It is mounted per anchor by `ThreadSheetContents` in `Assemble.tsx` (the sheet opened from a margin cell),
  which computes `threadAnnotations = annotations.filter((a) => a.deletedAt == null && a.anchors.some(...))`.
- Margin — `apps/web/src/components/RoutineReadingView.tsx`:
  `interface MarginNote { id: string; authorId: string; text: string; createdAt: number; family: boolean }`;
  `function annotationMarginNote(a: Annotation): MarginNote`;
  `function mergeMarginNotes(routine: MarginNote[], family: MarginNote[]): MarginNote[]` (newest-first, id tiebreak);
  inside `FigureReadout`: `const figureComments = annotations.filter((a) => a.deletedAt == null && a.anchors.some((an) => an.type === "point" && an.figureRef === figure.id));` and
  `const wholeFigureComments = annotations.filter(... an.type === "figure" ...)`;
  `NotesMarginCell({ label, notes, canComment, ... })` reads `const latest = notes[0];` for the snippet and
  collects up to 3 distinct authors for avatars. Cell labels: `notesForCount: (count: string) => `Notes — count ${count}``,
  `notesForFigure: (name: string) => `Notes — ${name}`` (`i18n/messages/timeline.ts`).
- i18n seam — `apps/web/src/i18n/messages.ts`: `useMessages<T>(catalog: Catalog<T>): T`,
  `pickMessages<T>(catalog: Catalog<T>): T`; catalogs are `const en = {...}; const de: typeof en = {...};
  export const journalMessages = { en, de };`. `AnnotationPanel` uses `journalMessages`
  (existing keys: `thread: "Thread"`, `commentThread: "comment thread"`, `commentCount: (n: number) => `${n} comments``);
  the margin uses `timelineMessages`. Locale switching in tests: `setLocale` / `resetLocaleForTests` (`../i18n`).
- Component-test harness — `apps/web/src/test-support/render.tsx`: `renderUi(ui, opts?): RenderResult`,
  `axeCheck(container: HTMLElement): Promise<AxeResults>` (assert `toHaveNoViolations()`); dynamic import via
  `importComponent<T>()` (`test-support/import-component.ts`) — the reading-view/annotations tests' pattern.
- Domain fixtures — `packages/domain/src/__fixtures__/factories.ts`:
  `makeAnnotation(overrides: Partial<Annotation> = {}): Annotation` (defaults `createdAt: 0`, `replies: []`),
  `pointAnchor(figureRef: string, count: number, role: Role = null): Anchor`. fast-check is an existing
  domain devDependency (`convergence.test.ts`, `order.test.ts`).
- E2E seed seam (**the gap Task 5 closes**):
  - `apps/web/e2e/support/fixtures.ts` — `SeedSpec.docs[]`: `{ docRef; type; ownerId; ...; sections?: { id; name; placements: { id; figureRef }[] }[] }`; `seedDb(page, spec)` POSTs `/api/test/seed`.
  - `packages/contract/src/index.ts` — `zSeedBody` `docs` entries end at `sections` (no annotations field); it already imports from `@weavesteps/domain` (`DANCE_IDS`), and the domain exports `zAnchor` (`export { parseAnchors, parseAttributeRead, parseAttributeWrite, zAnchor } from "./schemas";`).
  - `apps/worker/src/routes/test-seed.ts` — the routine-DO server-seed **hardcodes `annotations: []`** inside `if (doc.type === "routine" && doc.sections) { ... seedDoc({ ..., annotations: [], ... }) }`. Backdated comments cannot be seeded today.
  - Journey conventions: unique doc refs per run (resetDb wipes only D1 — DO CRDT state survives; see the header of `journal-link-picker.spec.ts`), `seedAuth(page, user)`, `page.goto(`/routines/${docRef}`)`, reading lens via `page.getByRole("button", { name: /reading view/i })`.
- Prototype (design-canonical, `docs/design/project/Ballroom Builder v3.dc.html`):
  - `partitionByActivity(list)` (~line 1547) — day-granular prototype of the same rule; the product helper uses **ms**, per the idea.
  - Collapsed divider (~510): hairline · pill (`{{ tStaleLabel }}` = `stale.length + ' more comment(s)'`) · hairline; expanded bar (~517): hairline · `showing all · collapse older` · hairline; both one tap target (`onToggleStale`), sitting **above** the comment list; collapsed list = `_all.filter(c => active.includes(c))`, expanded = `_all` (order preserved, ~1838).
  - `_margin` (~1904): `const src = this.partitionByActivity(list).active;` — avatars (≤3 distinct authors, newest first) and the latest snippet come from `src`; `count:list.length` stays the full count.
  - Seed threads (~1148–1150): `'f3|2'` = the comeback burst (9 comments at 68–73 days + 3 at 4–5 days), `'f4|1'` = the quiet >28d pair (45/42 days, no divider).

**Resolved design points (read before Task 2/3; record them in the Task 6 docs delta):**

1. **Family notes are exempt from fade-out.** The margin merges account-scoped family notes into the same cells, but the prototype's `_margin` partitions routine threads only; a co-member family note's REST projection can lack an authored time (`createdAt ?? 0` — fabricated epoch, not evidence of staleness), and the thread panel behind the cell shows routine comments only, so a collapsed family note would have **no expander anywhere** — violating the idea's "collapse never reads as loss" mitigation. Partition routine annotations only; family notes always render.
2. **The thread header count stays honest to the FULL thread** (`t.commentCount` over the whole per-anchor list, not the visible subset) — the divider carries the stale count.
3. **Partition granularity = the rendered per-anchor list** (the idea's "comments sharing one anchor"): the thread panel partitions its `threadAnnotations`; each margin cell partitions its own per-count / whole-figure list. Same rule, same helper, same `now` per mount.
4. The expanded state is plain `useState` — it resets on unmount (idea non-goal: no per-device persistence).

---

### Task 1: Domain — `partitionByActivity` + window constants

**Files:**
- Create: `packages/domain/src/annotation-activity.ts`
- Create: `packages/domain/src/annotation-activity.test.ts`
- Modify: `packages/domain/src/index.ts` (export)

**Interfaces:**
- Consumes: nothing (pure; structurally typed so it accepts `Annotation`, and any reply-less comment-like shape).
- Produces: `ACTIVE_WINDOW_MS`, `SESSION_GAP_WINDOW_MS`, `lastActivity(c)`, `partitionByActivity(list, now)`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/annotation-activity.test.ts
// Comment activity fade-out (docs/ideas/comment-activity-fadeout.md § The rule):
//   active(c) ⇔ lastActivity(c) ≥ now − 28×24h  (absolute window)
//             ∨ lastActivity(c) ≥ anchor − 7×24h (session-gap window)
// Rolling ms durations, both windows INCLUSIVE. `now` is always injected —
// this suite (and every consumer) never reads the wall clock.
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { makeAnnotation } from "./__fixtures__/factories";
import {
  ACTIVE_WINDOW_MS,
  lastActivity,
  partitionByActivity,
  SESSION_GAP_WINDOW_MS,
} from "./annotation-activity";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000; // fixed, injected — never Date.now()

const at = (msAgo: number, id: string) => makeAnnotation({ id, createdAt: NOW - msAgo });

describe("window constants", () => {
  it("are rolling ms durations (28d absolute, 7d session gap) — never calendar days", () => {
    expect(ACTIVE_WINDOW_MS).toBe(28 * DAY);
    expect(SESSION_GAP_WINDOW_MS).toBe(7 * DAY);
  });
});

describe("lastActivity", () => {
  it("is the max of createdAt and the LIVE replies' createdAt", () => {
    const a = makeAnnotation({
      createdAt: NOW - 100 * DAY,
      replies: [
        { id: "r1", authorId: "u2", text: "old", createdAt: NOW - 90 * DAY, deletedAt: null },
        { id: "r2", authorId: "u2", text: "fresh", createdAt: NOW - 1 * DAY, deletedAt: null },
      ],
    });
    expect(lastActivity(a)).toBe(NOW - 1 * DAY);
  });

  it("ignores tombstoned replies", () => {
    const a = makeAnnotation({
      createdAt: NOW - 100 * DAY,
      replies: [
        { id: "r1", authorId: "u2", text: "deleted", createdAt: NOW - 1 * DAY, deletedAt: NOW },
      ],
    });
    expect(lastActivity(a)).toBe(NOW - 100 * DAY);
  });
});

describe("partitionByActivity — window edges (both inclusive)", () => {
  it("absolute window: exactly 28d old is active; 1ms older is stale (given a fresh anchor)", () => {
    const fresh = at(0, "fresh");
    const onEdge = at(28 * DAY, "edge");
    const past = at(28 * DAY + 1, "past");
    const { active, stale } = partitionByActivity([past, onEdge, fresh], NOW);
    expect(active.map((a) => a.id)).toEqual(["edge", "fresh"]);
    expect(stale.map((a) => a.id)).toEqual(["past"]);
  });

  it("relative window: exactly 7d behind the anchor is active; 1ms further is stale", () => {
    // Quiet routine: everything is far outside the 28d window — only the
    // session-gap clause decides. Anchor at 40d ago.
    const anchor = at(40 * DAY, "anchor");
    const inBurst = at(47 * DAY, "in-burst"); // anchor − 7d exactly
    const before = at(47 * DAY + 1, "before"); // 1ms past the burst
    const { active, stale } = partitionByActivity([before, inBurst, anchor], NOW);
    expect(active.map((a) => a.id)).toEqual(["in-burst", "anchor"]);
    expect(stale.map((a) => a.id)).toEqual(["before"]);
  });

  it("a reply to a stale thread REACTIVATES it (activity is per thread)", () => {
    const mayComment = makeAnnotation({
      id: "may",
      createdAt: NOW - 70 * DAY,
      replies: [
        { id: "r", authorId: "u2", text: "again today", createdAt: NOW - 1 * DAY, deletedAt: null },
      ],
    });
    const other = at(70 * DAY, "other");
    const fresh = at(0, "fresh");
    const { active, stale } = partitionByActivity([mayComment, other, fresh], NOW);
    expect(active.map((a) => a.id)).toEqual(["may", "fresh"]);
    expect(stale.map((a) => a.id)).toEqual(["other"]);
  });

  it("a tombstoned reply is NOT activity", () => {
    const old = makeAnnotation({
      id: "old",
      createdAt: NOW - 70 * DAY,
      replies: [
        { id: "r", authorId: "u2", text: "gone", createdAt: NOW - 1 * DAY, deletedAt: NOW },
      ],
    });
    const fresh = at(0, "fresh");
    expect(partitionByActivity([old, fresh], NOW).stale.map((a) => a.id)).toEqual(["old"]);
  });

  it("returns empty partitions for an empty list", () => {
    expect(partitionByActivity([], NOW)).toEqual({ active: [], stale: [] });
  });
});

describe("partitionByActivity — properties", () => {
  // Comment-like inputs across a heavy-tailed 3-year age range, with optional replies.
  const arbList = fc.array(
    fc
      .record({
        ageMs: fc.integer({ min: 0, max: 1000 * DAY }),
        replyAgesMs: fc.array(fc.integer({ min: 0, max: 1000 * DAY }), { maxLength: 3 }),
      })
      .map(({ ageMs, replyAgesMs }, ) =>
        makeAnnotation({
          createdAt: NOW - ageMs,
          replies: replyAgesMs.map((r, i) => ({
            id: `r${i}-${r}`,
            authorId: "u2",
            text: "reply",
            createdAt: NOW - r,
            deletedAt: null,
          })),
        }),
      ),
    { minLength: 1, maxLength: 40 },
  );

  it("non-empty input ⇒ non-empty active set (never-empty guarantee)", () => {
    fc.assert(
      fc.property(arbList, (list) => {
        expect(partitionByActivity(list, NOW).active.length).toBeGreaterThan(0);
      }),
    );
  });

  it("the newest (max lastActivity) comment is always active", () => {
    fc.assert(
      fc.property(arbList, (list) => {
        const newest = list.reduce((a, b) => (lastActivity(b) > lastActivity(a) ? b : a));
        expect(partitionByActivity(list, NOW).active).toContain(newest);
      }),
    );
  });

  it("active ∪ stale is an order-preserving partition (no reorder, no loss, no dupes)", () => {
    fc.assert(
      fc.property(arbList, (list) => {
        const { active, stale } = partitionByActivity(list, NOW);
        const activeSet = new Set(active);
        expect(active).toEqual(list.filter((c) => activeSet.has(c)));
        expect(stale).toEqual(list.filter((c) => !activeSet.has(c)));
        expect(active.length + stale.length).toBe(list.length);
      }),
    );
  });

  it("everything with lastActivity within 28d is active regardless of the anchor", () => {
    fc.assert(
      fc.property(arbList, (list) => {
        const { stale } = partitionByActivity(list, NOW);
        for (const c of stale) {
          expect(lastActivity(c)).toBeLessThan(NOW - ACTIVE_WINDOW_MS);
        }
      }),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @weavesteps/domain exec vitest run annotation-activity`
Expected: FAIL — "Cannot find module './annotation-activity'".

- [ ] **Step 3: Write the implementation**

```ts
// packages/domain/src/annotation-activity.ts
// Comment activity fade-out (docs/concepts/annotations.md § Where notes appear):
// the reading view renders ACTIVE comments by default and collapses the rest
// behind a counted expander. A comment is active when its thread saw activity
// within the last 28 days, OR within 7 days of the newest activity in its
// rendered list (a session-gap window — guarantees a quiet routine's last
// conversation never goes dark). PURE and wall-clock-free: `now` is always
// injected (the app's first wall-clock-dependent rendering; tests inject it).
// Rolling ms durations against stored unix-ms timestamps — never calendar
// days, so the set is timezone-independent and doesn't flip at midnight.

/** 28 days in ms — the absolute recency window. */
export const ACTIVE_WINDOW_MS = 28 * 24 * 60 * 60 * 1000;
/** 7 days in ms — the session-gap window, relative to the list's newest activity. */
export const SESSION_GAP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * The structural shape the partition needs — Annotation satisfies it, and so
 * does any comment-like object carrying a unix-ms `createdAt` (replies optional).
 */
export type ActivitySource = {
  createdAt: number;
  replies?: readonly { createdAt: number; deletedAt?: number | null }[];
};

/** A thread's latest activity: max of its own createdAt and its LIVE replies'.
 *  Tombstoned replies never count — a deleted reply is not activity. */
export function lastActivity(c: ActivitySource): number {
  let latest = c.createdAt;
  for (const r of c.replies ?? []) {
    if (r.deletedAt == null && r.createdAt > latest) latest = r.createdAt;
  }
  return latest;
}

/**
 * Partition a rendered per-anchor comment list into { active, stale }, order
 * preserved within each side. Both windows are INCLUSIVE (≥); the relative
 * window includes its own anchor, so a non-empty list always has a non-empty
 * active set (never-empty guarantee — an all-stale non-empty cell cannot occur).
 */
export function partitionByActivity<T extends ActivitySource>(
  list: readonly T[],
  now: number,
): { active: T[]; stale: T[] } {
  if (list.length === 0) return { active: [], stale: [] };
  let anchor = Number.NEGATIVE_INFINITY;
  for (const c of list) anchor = Math.max(anchor, lastActivity(c));
  const active: T[] = [];
  const stale: T[] = [];
  for (const c of list) {
    const a = lastActivity(c);
    if (a >= now - ACTIVE_WINDOW_MS || a >= anchor - SESSION_GAP_WINDOW_MS) active.push(c);
    else stale.push(c);
  }
  return { active, stale };
}
```

- [ ] **Step 4: Export from the domain barrel**

In `packages/domain/src/index.ts` (alphabetical with neighbors, after the `./dances` export):

```ts
export {
  ACTIVE_WINDOW_MS,
  type ActivitySource,
  lastActivity,
  partitionByActivity,
  SESSION_GAP_WINDOW_MS,
} from "./annotation-activity";
```

- [ ] **Step 5: Verify green**

Run: `pnpm --filter @weavesteps/domain exec vitest run annotation-activity && pnpm -w typecheck && pnpm -w lint`
Expected: all tests PASS; typecheck + lint clean (domain coverage threshold ≥90 lines still holds — the module is fully covered).

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/annotation-activity.ts packages/domain/src/annotation-activity.test.ts packages/domain/src/index.ts
git commit -m "feat(domain): partitionByActivity — the comment activity fade-out rule (28d + 7d session gap)"
```

---

### Task 2: Thread panel — collapse the stale prefix behind one counted divider

**Files:**
- Modify: `apps/web/src/components/AnnotationPanel.tsx` (thread mode only)
- Modify: `apps/web/src/i18n/messages/journal.ts` (divider strings — en AND de; the `de: typeof en` seam makes them inseparable from first use, so they land here rather than in Task 4, which pins their behavior)
- Create: `apps/web/src/components/comment-fadeout.test.tsx`

**Design (recreate the prototype pixel-for-pixel — `Ballroom Builder v3.dc.html` lines ~509–523):** one full-width tap row ABOVE the comment list — hairline · pill · hairline. Collapsed: the pill reads the honest count (`9 more comments`, bordered pill, `font:700 10px`, faint ink). Expanded: the same row reads `showing all · collapse older` (no pill border, fainter, `font:600 9px`). One `<button type="button">` with `aria-expanded`, min 44px touch target (`min-h-[var(--bf-touch-target)]`), hairlines via `style={{ background: "var(--bf-border-subtle)" }}`, pill via `border-[1.5px] rounded-[12px] text-ink-faint bg-surface`.

**Behavior:**
- Thread mode only (`threadTitle` set). Props gain `now?: number`; the evaluation instant is captured once per mount: `const [mountNow] = useState(() => Date.now()); const evalNow = now ?? mountNow;` (the `Date.now()` default is what E2E exercises; every component test injects `now`).
- `const { active, stale } = partitionByActivity(visible, evalNow);` — `visible` is the full per-anchor list in thread mode (the filter is only a standard-mode feature).
- `const [showOlder, setShowOlder] = useState(false);` — resets on unmount by design.
- Render: when `stale.length > 0 && !showOlder` → divider row (count = `stale.length`) + `active` in original order; when `stale.length > 0 && showOlder` → "showing all · collapse older" row + the FULL list in original order; when `stale.length === 0` → no row at all (all-recent and all-within-session lists look exactly as today).
- The header count stays the FULL list: `{t.commentCount(visible.length)}` (unchanged expression — `visible` is the whole thread here; do NOT switch it to the collapsed subset).
- Standard mode (filter bar + compose) is untouched.

**i18n keys (journal.ts, `── Annotation panel ──` block):**

```ts
// en
moreComments: (n: number) => (n === 1 ? "1 more comment" : `${n} more comments`),
showingAllCollapseOlder: "showing all · collapse older",
// de
moreComments: (n) => (n === 1 ? "1 weiterer Kommentar" : `${n} weitere Kommentare`),
showingAllCollapseOlder: "alle angezeigt · ältere einklappen",
```

- [ ] **Step 1: Write the failing tests** (`apps/web/src/components/comment-fadeout.test.tsx`)

Follow the annotations/reading-view test conventions: `importComponent<T>()`, `renderUi`, `screen`, `userEvent`, `axeCheck` from `../test-support/render`. Build `Annotation[]` inline (import the type from `@weavesteps/domain`), with a fixed `const NOW = 1_800_000_000_000; const DAY = 86_400_000;` and `now={NOW}` injected on EVERY render. Seed shapes mirror the prototype threads: the comeback burst (`f3|2`: 9 comments at 68–73d + 1–3 fresh) and the quiet pair (`f4|1`: 45d/42d).

```tsx
// apps/web/src/components/comment-fadeout.test.tsx
// Comment activity fade-out — thread panel + notes margin (reading view only).
// docs/concepts/annotations.md § Where notes appear. EVERY render injects `now`
// (first wall-clock-dependent rendering — the rule, not a convenience).
```

Thread-mode cases (render `<AnnotationPanel role="commenter" threadTitle="Whisk · step 3" annotations={...} now={NOW} />`):
1. **Comeback burst:** 9 comments at ~70d + 1 at 1h → exactly the fresh comment's text is visible; a `button` named `9 more comments` with `aria-expanded="false"`; the May texts are NOT in the document.
2. **Expand in place:** `userEvent.click` the divider → all 10 texts visible; `getAllByRole("listitem")` order matches the original (oldest first, fresh last); the row now reads `showing all · collapse older` with `aria-expanded="true"`; clicking it again collapses back to 1 + `9 more comments` (the collapse affordance).
3. **All-recent list** (3 comments ≤ 5d) → no divider button, all visible.
4. **All-within-session list** (the quiet `f4|1` pair: 45d + 42d, nothing newer) → BOTH visible, no divider (the relative window at work).
5. **Reply reactivation:** a 70d comment with a live 1d reply + a fresh comment + a 70d comment without replies → divider says `1 more comment` (singular) and the replied-to comment is visible while collapsed.
6. **Honest header:** the comeback thread's header still reads `10 comments` while collapsed.
7. **axe on both states:** `expect(await axeCheck(container)).toHaveNoViolations()` collapsed AND expanded.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter web exec vitest run comment-fadeout`
Expected: FAIL — no divider button rendered, stale texts still visible.

- [ ] **Step 3: Implement** (per the Behavior/Design specs above; import `partitionByActivity` from `@weavesteps/domain`; add the two catalog keys to BOTH locales in `journal.ts`)

- [ ] **Step 4: Verify green + no regressions**

Run: `pnpm --filter web exec vitest run comment-fadeout && pnpm --filter web exec vitest run annotations && pnpm -w typecheck && pnpm -w lint`
Expected: new suite PASS; the existing `annotations.test.tsx` suite untouched-green (standard mode unchanged; thread-mode tests there use fresh `createdAt: 0`? — **check**: `makeAnnotation`-style inline fixtures in that file default `createdAt: 0`, i.e. epoch = stale. If any existing thread-mode test renders multi-comment lists without `now`, inject `now: 0` or recent timestamps there rather than weakening the new behavior — epoch comments within one list are all inside each other's session window, so most lists stay fully visible; fix forward, never loosen).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/AnnotationPanel.tsx apps/web/src/i18n/messages/journal.ts apps/web/src/components/comment-fadeout.test.tsx
git commit -m "feat(web): thread panel collapses stale comments behind an honest counted divider"
```

---

### Task 3: Notes margin — snippet/avatars from ACTIVE comments only

**Files:**
- Modify: `apps/web/src/components/RoutineReadingView.tsx`
- Modify: `apps/web/src/components/comment-fadeout.test.tsx` (add the margin describe)

**Design source:** the `_margin` function in `Ballroom Builder v3.dc.html` (~line 1904): `const src = this.partitionByActivity(list).active;` — avatars and the latest snippet derive from `src`; nothing else about the cell changes (＋ affordance, tap target, 29% basis, two-line Caveat snippet all stay).

**Behavior:**
- `RoutineReadingView` props gain `now?: number`; capture once per mount (`const [mountNow] = useState(() => Date.now()); const evalNow = now ?? mountNow;`) and thread `now={evalNow}` into each `FigureReadout` (a stable scalar — the existing `React.memo` bail-outs and `useStableAnnotationsByFigure` identity guarantees are untouched).
- In `FigureReadout`, partition **per rendered cell list** (the rule's granularity — same lists the thread panel shows):
  - header cell: `partitionByActivity(wholeFigureComments, now).active.map(annotationMarginNote)` merged with `familyWholeFigure` as today;
  - each `StepRow`: `partitionByActivity(figureComments.filter((a) => a.anchors.some((an) => an.type === "point" && an.count === count)), now).active.map(annotationMarginNote)` merged with `familyByCount.get(count) ?? []`.
- **Family notes are exempt** (resolved design point 1) — they merge in unpartitioned, exactly as today.
- Partition BEFORE `annotationMarginNote` (the partition needs `replies` for reply-reactivation; `MarginNote` doesn't carry them).
- No divider in the margin — the cell is one tap target opening the thread, where the expander lives. `mergeMarginNotes` ordering (newest-first by `createdAt`) is unchanged: no reordering.

- [ ] **Step 1: Write the failing tests** (new describe in `comment-fadeout.test.tsx`, harness copied from `reading-view.test.tsx`: local `figure()`/`attr()` builders, `renderUi(<RoutineReadingView routine={...} placements={...} roleView="leader" annotations={...} now={NOW} />)`)

1. **Comeback margin:** 9 comments at ~70d + 1 fresh, all `pointAnchor`-shaped on count 1 of the figure → the cell (`getByRole("button", { name: "Notes — count 1" })`) shows the FRESH snippet text; a May text is NOT in the cell; only the fresh author's avatar renders (query `[data-avatar]` within the cell — 1, not 3).
2. **Quiet cluster:** only 3 comments at 45/43/42d → the cell shows the newest (42d) snippet and all three authors' avatars (≤3) — active by the session window.
3. **Reply reactivation in the margin:** a 70d comment with a 1d live reply is the only comment → its text still shows as the snippet.
4. **Family-note exemption:** a 70d-old family note merged with a fresh routine comment → the family author's avatar still present (family notes never fade).
5. **Whole-figure header cell** honors the same rule (a stale whole-figure comment's text absent from the header cell, fresh one present).

- [ ] **Step 2: Run to verify failure** — `pnpm --filter web exec vitest run comment-fadeout` → the new describe FAILS (stale snippets still render).

- [ ] **Step 3: Implement** (per Behavior above).

- [ ] **Step 4: Verify green + no regressions**

Run: `pnpm --filter web exec vitest run comment-fadeout && pnpm --filter web exec vitest run reading-view && pnpm -w typecheck && pnpm -w lint`
Expected: PASS. `reading-view.test.tsx` fixtures use `createdAt: 0`-era or small timestamps within one list — if any margin test there mixes ages across the windows, inject `now` in that test to pin its intent (fix forward).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/RoutineReadingView.tsx apps/web/src/components/comment-fadeout.test.tsx
git commit -m "feat(web): margin cells derive snippet/avatars from active comments only"
```

---

### Task 4: i18n — pin the divider strings in both locales

**Files:**
- Modify: `apps/web/src/components/comment-fadeout.test.tsx` (locale describe)
- Modify (only if a gap is found): `apps/web/src/i18n/messages/journal.ts`

The catalog keys landed with their first use in Task 2 (`de: typeof en` is compile-enforced — a missing key can't exist). This task pins the RENDERED strings behaviorally so future edits can't silently degrade either locale. These tests may pass immediately; they are regression pins, and that is their point.

- [ ] **Step 1: Write the tests**

Using `setLocale` / `resetLocaleForTests` from `../i18n` (reset in `afterEach`):
1. **en singular:** a thread with exactly 1 stale comment → button named `1 more comment` (not "1 more comments").
2. **de plural + singular:** under `setLocale("de")`, the comeback thread's divider reads `9 weitere Kommentare`; the single-stale thread reads `1 weiterer Kommentar`; expanded bar reads `alle angezeigt · ältere einklappen`.

- [ ] **Step 2: Run** — `pnpm --filter web exec vitest run comment-fadeout`; if anything fails, fix the catalog (`journal.ts`), never the assertion.

- [ ] **Step 3: Verify** — `pnpm --filter web test && pnpm -w typecheck && pnpm -w lint` (full web suite once — locale switching leaks are the classic failure here; `resetLocaleForTests` in `afterEach` is mandatory).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/comment-fadeout.test.tsx apps/web/src/i18n/messages/journal.ts
git commit -m "test(web): pin the fade-out divider strings in en and de"
```

---

### Task 5: Ship gate — `comment-activity-fadeout.spec.ts` (+ the backdated-seed seam it needs)

**Files:**
- Create: `apps/web/e2e/comment-activity-fadeout.spec.ts`
- Modify: `packages/contract/src/index.ts` (`zSeedBody` docs entry: optional `annotations`)
- Modify: `apps/worker/src/routes/test-seed.ts` (seed them into the routine DO)
- Modify: `apps/web/e2e/support/fixtures.ts` (`SeedSpec` mirror)

**Why the seam change:** the UI stamps `Date.now()` on create, so backdated `createdAt` MUST arrive via seeding — but today `test-seed.ts` hardcodes `annotations: []` in the routine-DO seed and `zSeedBody` has no annotations field. This is an **E2E-fixtures-only** surface (mounted solely under `E2E_TEST_ROUTES === "1"`), not a product data-shape change; it is runtime-validated with Zod (no casts). It still touches `apps/worker` — flag it for the hard review gate in the PR description.

- [ ] **Step 1: Write the failing spec FIRST**

```ts
// apps/web/e2e/comment-activity-fadeout.spec.ts
import { expect, test } from "@playwright/test";
import { seedAuth } from "./support/auth";
import { resetDb, seedDb } from "./support/fixtures";

// ─────────────────────────────────────────────────────────────────────────
// Comment activity fade-out ship gate (docs/concepts/annotations.md § Where
// notes appear): the reading view shows ACTIVE comments by default — last 28
// days, plus anything within 7 days of the newest activity in the list — and
// collapses the rest behind ONE honest counted divider that expands in place.
// Backdated createdAt is seeded through the E2E seed seam (the UI stamps now).
// Runs against the REAL worker (D1 + per-document DOs) via the #191 harness.
//
// @smoke — this journey is the feature's PR gate (delivery model, CLAUDE.md §3).
// ─────────────────────────────────────────────────────────────────────────

const DAY = 24 * 60 * 60 * 1000;
const USER = "user_fadeout";

/** Unique refs per run: resetDb wipes only D1 — DO CRDT state survives, so a
 *  reused routine ref would inherit a previous run's annotations (the same
 *  reused-DO-name trap as journal-link-picker.spec.ts). */
function refs() {
  const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  return { WHISK: `fig_fade_whisk_${run}`, RT: `rt_fade_${run}` };
}

const whiskFigure = (docRef: string) => ({
  docRef,
  scope: "global" as const,
  ownerId: "app",
  figureType: "whisk",
  dance: "waltz",
  name: "Whisk",
  attributes: [
    { id: "at1", kind: "footwork", count: 1, role: null, value: "HT" },
    { id: "at2", kind: "footwork", count: 2, role: null, value: "T" },
    { id: "at3", kind: "footwork", count: 3, role: null, value: "TH" },
  ],
});

const note = (figureRef: string, id: string, text: string, createdAt: number) => ({
  id,
  authorId: USER,
  kind: "note" as const, // "note" keeps the journal_entry alarm projection out of this journey
  text,
  anchors: [{ type: "point" as const, figureRef, count: 1, role: null }],
  createdAt,
});

test.describe("@smoke comment activity fade-out (reading view)", () => {
  test("comeback Waltz: a 9-comment backdated burst collapses behind '9 more comments'; expand restores all ten in order", async ({
    page,
  }) => {
    const { WHISK, RT } = refs();
    const now = Date.now();
    const mayTexts = Array.from({ length: 9 }, (_, i) => `settled May note ${i + 1}`);
    await resetDb(page);
    await seedDb(page, {
      users: [{ id: USER, displayName: "Dani", identityColor: "#1f8a5b" }],
      figures: [whiskFigure(WHISK)],
      docs: [
        {
          docRef: RT,
          type: "routine",
          ownerId: USER,
          title: "Comp Waltz 2026",
          dance: "waltz",
          sections: [
            { id: "sec1", name: "Intro", placements: [{ id: "pl1", figureRef: WHISK }] },
          ],
          annotations: [
            // The May burst: 9 comments, 73d…68d ago (outside 28d, >7d behind the anchor).
            ...mayTexts.map((text, i) => note(WHISK, `ann_may_${i}`, text, now - (73 - i) * DAY)),
            // September: one fresh comment — the anchor.
            note(WHISK, "ann_fresh", "arm line collapsed again — video from Tue", now - 60 * 60 * 1000),
          ],
        },
      ],
      memberships: [{ docRef: RT, userId: USER, role: "editor" }],
      placementEdges: [{ routineRef: RT, figureRef: WHISK }],
    });
    await seedAuth(page, USER);
    await page.goto(`/routines/${RT}`);

    // Reading lens → the count-1 margin cell derives its snippet from the ACTIVE comment only.
    await page.getByRole("button", { name: /reading view/i }).click();
    const cell = page.getByRole("button", { name: "Notes — count 1" });
    await expect(cell).toContainText("arm line collapsed again", { timeout: 15_000 });
    await expect(cell).not.toContainText("settled May note");

    // Open the thread: fresh comment + ONE honest divider; May stays collapsed.
    await cell.click();
    const thread = page.getByRole("region", { name: /^thread$/i });
    await expect(thread.getByText("arm line collapsed again — video from Tue")).toBeVisible({
      timeout: 15_000,
    });
    const divider = thread.getByRole("button", { name: "9 more comments" });
    await expect(divider).toBeVisible();
    await expect(divider).toHaveAttribute("aria-expanded", "false");
    await expect(thread.getByText("settled May note 1")).toHaveCount(0);
    await expect(thread.getByText(/10 comments/i)).toBeVisible(); // header stays honest

    // Expand in place: all ten, original order (oldest first, fresh last).
    await divider.click();
    const items = thread.getByRole("list", { name: /comment thread/i }).getByRole("listitem");
    await expect(items).toHaveCount(10);
    await expect(items.first()).toContainText("settled May note 1");
    await expect(items.last()).toContainText("arm line collapsed again");

    // The expanded state offers a collapse affordance and it works.
    const collapse = thread.getByRole("button", { name: /showing all · collapse older/i });
    await expect(collapse).toHaveAttribute("aria-expanded", "true");
    await collapse.click();
    await expect(items).toHaveCount(1);
    await expect(thread.getByRole("button", { name: "9 more comments" })).toBeVisible();
  });

  test("quiet Tango half: a 3-comment >28d cluster renders fully — no divider", async ({
    page,
  }) => {
    const { WHISK, RT } = refs();
    const now = Date.now();
    await resetDb(page);
    await seedDb(page, {
      users: [{ id: USER, displayName: "Dani", identityColor: "#1f8a5b" }],
      figures: [whiskFigure(WHISK)],
      docs: [
        {
          docRef: RT,
          type: "routine",
          ownerId: USER,
          title: "Quiet Waltz",
          dance: "waltz",
          sections: [
            { id: "sec1", name: "Intro", placements: [{ id: "pl1", figureRef: WHISK }] },
          ],
          annotations: [
            note(WHISK, "ann_q1", "PP shape collapsing — open the right side", now - 45 * DAY),
            note(WHISK, "ann_q2", "lead it from the back, not the arm", now - 43 * DAY),
            note(WHISK, "ann_q3", "better — keep the left side up", now - 42 * DAY),
          ],
        },
      ],
      memberships: [{ docRef: RT, userId: USER, role: "editor" }],
      placementEdges: [{ routineRef: RT, figureRef: WHISK }],
    });
    await seedAuth(page, USER);
    await page.goto(`/routines/${RT}`);

    await page.getByRole("button", { name: /reading view/i }).click();
    const cell = page.getByRole("button", { name: "Notes — count 1" });
    await expect(cell).toContainText("keep the left side up", { timeout: 15_000 });

    await cell.click();
    const thread = page.getByRole("region", { name: /^thread$/i });
    await expect(thread.getByText("PP shape collapsing — open the right side")).toBeVisible({
      timeout: 15_000,
    });
    await expect(thread.getByText("lead it from the back, not the arm")).toBeVisible();
    await expect(thread.getByText("better — keep the left side up")).toBeVisible();
    await expect(thread.getByRole("button", { name: /more comment/i })).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails for the RIGHT reason**

Run (sandbox setup per `ballroom-flow-build-and-env`): `pnpm --filter web exec playwright test comment-activity-fadeout --project=chromium-desktop`
Expected: FAIL at `seedDb` — `zSeedBody.parse` strips the unknown `annotations` key silently (zod default) and the thread renders 0 comments, OR the spec's first `toContainText` times out. Either way: annotations never reach the DO.

- [ ] **Step 3: Extend the seed seam (contract → worker → e2e types)**

In `packages/contract/src/index.ts`, extend the domain import (`DANCE_IDS` → add `zAnchor`) and the `zSeedBody` docs entry after `sections`:

```ts
        /** E2E-only: server-seed routine annotations with EXPLICIT createdAt —
         *  the UI stamps Date.now(), so backdated comments (comment activity
         *  fade-out journeys) must arrive through this seam. */
        annotations: z
          .array(
            z.object({
              id: z.string(),
              authorId: z.string(),
              kind: z.enum(["note", "lesson", "practice"]),
              text: z.string(),
              anchors: z.array(zAnchor),
              createdAt: z.number(),
              replies: z
                .array(
                  z.object({
                    id: z.string(),
                    authorId: z.string(),
                    text: z.string(),
                    createdAt: z.number(),
                  }),
                )
                .optional(),
            }),
          )
          .optional(),
```

In `apps/worker/src/routes/test-seed.ts`, replace the hardcoded `annotations: []` in the routine-DO seed with the pass-through (values are already Zod-parsed — no casts):

```ts
        annotations: (doc.annotations ?? []).map((a) => ({
          id: a.id,
          authorId: a.authorId,
          kind: a.kind,
          text: a.text,
          tags: [],
          anchors: a.anchors,
          replies: (a.replies ?? []).map((r) => ({
            id: r.id,
            authorId: r.authorId,
            text: r.text,
            createdAt: r.createdAt,
            deletedAt: null,
          })),
          createdAt: a.createdAt,
          deletedAt: null,
        })),
```

In `apps/web/e2e/support/fixtures.ts`, mirror on `SeedSpec.docs`:

```ts
    /** Routine annotations server-seeded with explicit (backdatable) createdAt. */
    annotations?: {
      id: string;
      authorId: string;
      kind: "note" | "lesson" | "practice";
      text: string;
      anchors: unknown[];
      createdAt: number;
      replies?: { id: string; authorId: string; text: string; createdAt: number }[];
    }[];
```

- [ ] **Step 4: Run the gate green**

Run: `pnpm --filter web exec playwright test comment-activity-fadeout --project=chromium-desktop` (then the smoke set once: `pnpm test:e2e:smoke`)
Expected: both journeys PASS; no other smoke journey regressed (the seed seam change is additive — existing specs pass no `annotations`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/comment-activity-fadeout.spec.ts packages/contract/src/index.ts apps/worker/src/routes/test-seed.ts apps/web/e2e/support/fixtures.ts
git commit -m "feat(e2e): comment-activity-fadeout ship gate + backdatable annotation seeding (E2E seam)"
```

---

### Task 6: Fold the mental-model delta into the doc layers; delete the idea + this plan; PR

**Files:**
- Modify: `docs/concepts/annotations.md` (§ Where notes appear)
- Modify: `docs/system/sync-and-offline.md` (§ Flicker & referential stability)
- Modify: `docs/system/testing.md` (Layer ownership — component bullet)
- Modify: `docs/TEST-MAP.md` (new row)
- Delete: `docs/ideas/comment-activity-fadeout.md`
- Delete: `docs/ideas/comment-activity-fadeout.plan.md` (this file)

- [ ] **Step 1: `docs/concepts/annotations.md` § Where notes appear** — replace the closing *"(A planned refinement — fading long-settled comments behind a counted expander — is specified in docs/ideas/comment-activity-fadeout.md)"* paragraph with the shipped behavior, including: the one-sentence user rule (*"comments from the last 4 weeks, plus the last conversation"*); the margin cell's snippet/avatars derive from **active** routine comments only; the thread panel collapses stale comments behind ONE honest counted divider that expands in place (and collapses again); a reply reactivates its thread; a non-empty list never renders empty; nothing is deleted/resolved/reordered; **family notes are exempt** (no authored time for co-members + no expander of their own); reading view only — journal, library family notes, and the editing lens are untouched.

- [ ] **Step 2: `docs/system/sync-and-offline.md` § Flicker & referential stability** — append one sentence: comment fade-out is the app's first wall-clock-dependent rendering — `now` is captured once per view mount and passed down, the partition is derived per render from identity-stable inputs (never stored), so memo bail-outs hold and a view left open across a window boundary re-evaluates on the next data change or remount.

- [ ] **Step 3: `docs/system/testing.md`** — in Layer ownership, extend the Component bullet (or add one line under Fixtures): wall-clock-dependent rendering is tested by INJECTING `now` at every layer (domain argument, component prop); E2E backdates `createdAt` through the `/api/test/seed` annotations seam; `Date.now()` never appears in a covering test's assertion path.

- [ ] **Step 4: `docs/TEST-MAP.md`** — add a coverage row:
  `| — | Comment activity fade-out (28d + 7d session-gap; divider expand-in-place; active-only margin) | domain + component + E2E | packages/domain/src/annotation-activity.test.ts, apps/web/src/components/comment-fadeout.test.tsx, apps/web/e2e/comment-activity-fadeout.spec.ts |`

- [ ] **Step 5: Delete the idea file AND this plan file** (`git rm docs/ideas/comment-activity-fadeout.md docs/ideas/comment-activity-fadeout.plan.md`) — shipping an idea folds its delta into the two doc layers and deletes the idea in the same change (CLAUDE.md §1). The `.dc.html` prototype stays — it is the canonical design source.

- [ ] **Step 6: Full gates, push, PR**

Run: `pnpm -w lint && pnpm -w typecheck && pnpm test && pnpm test:e2e:smoke`
Expected: all green (docs changes ride the same PR as the code — never split).

```bash
git add -A docs
git commit -m "docs: fold comment activity fade-out into concepts/system layers; retire the idea"
git push -u origin feat/comment-activity-fadeout
gh pr create --title "feat: comment activity fade-out in the timeline reading view" \
  --body "$(cat <<'BODY'
Reading view only: active comments (last 28 days, plus anything within 7 days of the
newest activity in the list) render by default; the rest collapse behind ONE honest
counted divider that expands in place. Margin cells derive snippet/avatars from active
comments only. Pure render-time rule over existing timestamps — no data-shape, sync,
permission, DO, or D1 change. Rolling ms durations, never calendar days; every covering
test injects `now`.

- domain: `partitionByActivity` + window constants (unit + property tests)
- web: thread-panel divider (expand/collapse in place, en/de, axe both states); active-only margin
- E2E ship gate: `apps/web/e2e/comment-activity-fadeout.spec.ts` (@smoke) — comeback burst + quiet >28d cluster
- **worker-touching (review hard-gate):** E2E-only seed seam now accepts backdated routine
  annotations (`zSeedBody` + `test-seed.ts`, Zod-validated, mounted only under `E2E_TEST_ROUTES`)
- docs: concepts/annotations.md + system notes folded in; idea + plan files deleted

Design source: docs/design/project/Ballroom Builder v3.dc.html (threads f3|2, f4|1).
Idea: docs/ideas/comment-activity-fadeout.md (deleted in this PR).

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

---

## Self-Review

**Spec coverage:**
- The rule, verbatim (both windows inclusive, ms, reply reactivation, tombstoned replies ignored, never-empty) → Task 1. ✓
- Thread panel: ONE divider above the active tail, honest count, expand-in-place + collapse affordance, `now` per mount, no divider for all-recent / all-within-session, axe both states → Task 2. ✓
- Margin: active-only snippet/avatars (prototype `_margin`), per-cell partition, family-note exemption recorded → Task 3. ✓
- en/de via the typed seam; singular/plural pinned in both locales → Tasks 2 + 4. ✓
- Ship gate: the two named journeys with backdated seeds → Task 5 (including the seam the idea presumes but the code lacks). ✓
- Delta folded + idea and plan deleted in the same PR → Task 6. ✓

**Idea-vs-code discrepancies found while grounding this plan (all resolved above):**
1. `test-seed.ts` hardcodes `annotations: []` and `zSeedBody` has no annotations field — the "test-support document builders" for backdated comments don't exist yet; Task 5 builds them (E2E-only, Zod-validated, worker-touching → review hard-gate).
2. Family notes fold into the margin cells but have no per-item authored time for co-members and no expander of their own — exempted from fade-out (documented in Task 6).
3. The prototype partitions in whole days (`c.days`); the idea mandates rolling ms — the product follows the idea; the prototype is the visual source.
4. Thread-mode header count (`t.commentCount(visible.length)`) must stay the FULL thread count once collapsing exists — pinned in Tasks 2 and 5.

**Type consistency:** `partitionByActivity<T extends ActivitySource>(list, now)` defined in Task 1 is consumed by Tasks 2 (over `Annotation[]` — has `replies`) and 3 (over the per-cell `Annotation[]` lists BEFORE `annotationMarginNote` flattening); the seed-seam shapes in Task 5 match `Annotation`/`Reply` from `doc-types.ts` field-for-field (with `tags: []`, `deletedAt: null` filled server-side). No casts anywhere; the one payload boundary is Zod-parsed.
