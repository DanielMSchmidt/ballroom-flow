# WDSF Syllabus Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the 125 net-new WDSF Standard syllabus figures to the figure library, each carrying real per-step counts + actions parsed from the WDSF timing/start/finish, and pre-seed those steps onto the timeline when the figure is picked.

**Architecture:** A pure, tested timing parser in `packages/domain` turns each WDSF timing string into `Attribute[]` (the canonical per-step model). The generator merges the existing `wdsf-standard-figures.json` seed over the ISTD seed (dedup by `(dance, name)`) and emits raw WDSF fields into `library-data.ts`; `library.ts` computes the attributes at module load via the parser. The web store threads a picked catalog figure's attributes through the existing `addPlacement → createFigure → POST /api/figures → seedDoc` seam; the worker validates them before seeding.

**Tech Stack:** TypeScript (strict), Zod, Vitest, pnpm monorepo, Hono (worker), Automerge.

## Global Constraints

- TDD: write the failing test first, watch it fail, then implement. One pure source for the parser — never duplicate the timing logic into the `.mjs` generator.
- Generated data must be deterministic: attribute `id`s are derived strings (`wdsf-<figureType>-<dance>-s<n>`). No `Date.now()` / `Math.random()` in domain or generated data.
- Every generated attribute MUST pass `parseAttributeWrite(attr, { dance })` (count ≥ 1, on the 1/8 grid; `step` kind value is free-text).
- Net-new only: add a WDSF figure only when its `(dance, name)` is absent from the ISTD catalog. Existing ISTD entries stay attribute-free and unchanged.
- Worktree workflow: run gates explicitly (the lefthook hook no-ops here). Commit per task. Push with an explicit refspec; never `--no-verify`.
- Gates: `pnpm -w lint`, `pnpm -w typecheck`, `pnpm -w test` (or the package-scoped equivalents shown per task).

---

### Task 1: `parseWdsfTiming` — timing string → step counts

**Files:**
- Create: `packages/domain/src/wdsf-timing.ts`
- Test: `packages/domain/src/wdsf-timing.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces: `parseWdsfTiming(timing: string): number[]` — one 1-indexed float beat-count per step, on the 1/8 grid.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/wdsf-timing.test.ts
import { describe, expect, it } from "vitest";
import { isOnEighthGrid } from "./timing";
import { parseWdsfTiming } from "./wdsf-timing";

describe("parseWdsfTiming", () => {
  it("numbers across two waltz bars accumulate the beat cursor", () => {
    expect(parseWdsfTiming("123 123")).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("an & splits the preceding symbol into half-beats", () => {
    expect(parseWdsfTiming("1&23")).toEqual([1, 1.5, 2, 3]);
    expect(parseWdsfTiming("12&3")).toEqual([1, 2, 2.5, 3]);
  });

  it("S=2 / Q=1 beats accumulate, spaces are cosmetic", () => {
    expect(parseWdsfTiming("SQQ QQQQ")).toEqual([1, 3, 4, 5, 6, 7, 8]);
    expect(parseWdsfTiming("Q&Q")).toEqual([1, 1.5, 2]);
  });

  it("strips a (… Lady) follower variant, parsing the base timing", () => {
    expect(parseWdsfTiming("123 (12&3 Lady)")).toEqual([1, 2, 3]);
  });

  it("keeps other parenthetical optional steps", () => {
    expect(parseWdsfTiming("S(QQ)")).toEqual([1, 3, 4]);
  });

  it("clamps a leading & (syncopated pickup) to beat 1", () => {
    expect(parseWdsfTiming("&S")).toEqual([1, 1.5]);
  });

  it("every count is >= 1 and on the 1/8 grid for all real timings", () => {
    const all = ["123", "123 123", "1&23 123", "SQ&Q SQQ QQQQ", "QQ& QQS", "SQQ QQ Q&Q"];
    for (const t of all) {
      const cs = parseWdsfTiming(t);
      expect(cs.length).toBeGreaterThan(0);
      for (const c of cs) {
        expect(c).toBeGreaterThanOrEqual(1);
        expect(isOnEighthGrid(c)).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ballroom/domain test -- wdsf-timing`
Expected: FAIL — "Cannot find module './wdsf-timing'" / `parseWdsfTiming is not a function`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/domain/src/wdsf-timing.ts
// Parse a WDSF syllabus timing string into one float beat-count per step.
//
// The WDSF Standard syllabus states each figure's timing as syllable counts
// (S=slow, Q=quick, digits, & = the off-beat "and"). This converts that string
// into the figure's per-step `count` positions — 1-indexed floats on the 1/8
// grid (timing.ts), the same model the attribute write schema validates.
//
// Walk left→right with a beat cursor at 1.0: each beat symbol places a step at
// the cursor, then advances it by the symbol's duration (S=2, Q=1, digit=1,
// &=0.5). An `&` SPLITS the preceding symbol — a symbol immediately followed by
// `&` advances only 0.5, the `&` taking the other half (so "Q&Q" → 1,1.5,2).
// Spaces are bar separators (cosmetic; the cursor already accumulates).
//
// Approximations (documented; the public syllabus lacks the rest, refinable
// later per Q-LIBSEED): a "(… Lady)" group is the follower's variant — stripped,
// leaving the base/leader timing; other parens are kept as optional steps; a
// leading `&` is clamped to the beat-1 floor the write schema enforces.

const DURATION: Record<string, number> = { S: 2, Q: 1, "&": 0.5 };

export function parseWdsfTiming(timing: string): number[] {
  // Drop follower-specific "(... Lady ...)" alternatives, keep the base timing.
  const base = timing.replace(/\([^()]*Lady[^()]*\)/gi, "");
  // Remaining parens denote optional steps — keep their contents, drop the parens.
  const tokens = [...base.replace(/[()]/g, "")].filter((ch) => /[SQ&1-9]/.test(ch));

  const counts: number[] = [];
  let cursor = 1;
  for (let i = 0; i < tokens.length; i++) {
    counts.push(Math.round(cursor * 8) / 8); // snap to the 1/8 grid
    const next = tokens[i + 1];
    let dur = DURATION[tokens[i]] ?? 1; // a digit is one beat
    if (next === "&") dur = 0.5; // the & steals the second half of this symbol
    cursor += dur;
  }
  return counts;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ballroom/domain test -- wdsf-timing`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/wdsf-timing.ts packages/domain/src/wdsf-timing.test.ts
git commit -m "feat(domain): parse WDSF syllabus timing into per-step counts"
```

---

### Task 2: `buildWdsfAttributes` — counts + start/finish → Attribute[]

**Files:**
- Modify: `packages/domain/src/wdsf-timing.ts`
- Modify: `packages/domain/src/wdsf-timing.test.ts`
- Modify: `packages/domain/src/index.ts` (export both functions)

**Interfaces:**
- Consumes: `parseWdsfTiming` (Task 1); `Attribute` from `./doc-types`; `parseAttributeWrite` from `./schemas`; `DanceId` from `./dances`.
- Produces: `buildWdsfAttributes(input: { figureType: string; dance: DanceId; timing: string; start?: string; finish?: string }): Attribute[]` — one `{ kind: "step" }` attribute per step; step 1 `value` = `start`, last step `value` = `finish`, middles `""`; deterministic ids.

- [ ] **Step 1: Write the failing test (append to wdsf-timing.test.ts)**

```ts
import { parseAttributeWrite } from "./schemas";
import { buildWdsfAttributes } from "./wdsf-timing";

describe("buildWdsfAttributes", () => {
  const natural = buildWdsfAttributes({
    figureType: "natural-turn",
    dance: "waltz",
    timing: "123 123",
    start: "RF fwd (Closed Position)",
    finish: "LF closes to RF",
  });

  it("emits one step attribute per parsed count with deterministic ids", () => {
    expect(natural).toHaveLength(6);
    expect(natural.map((a) => a.id)).toEqual([
      "wdsf-natural-turn-waltz-s1",
      "wdsf-natural-turn-waltz-s2",
      "wdsf-natural-turn-waltz-s3",
      "wdsf-natural-turn-waltz-s4",
      "wdsf-natural-turn-waltz-s5",
      "wdsf-natural-turn-waltz-s6",
    ]);
    expect(natural.every((a) => a.kind === "step")).toBe(true);
    expect(natural.map((a) => a.count)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("puts start on step 1, finish on the last step, blanks between", () => {
    expect(natural[0].value).toBe("RF fwd (Closed Position)");
    expect(natural[5].value).toBe("LF closes to RF");
    expect(natural.slice(1, 5).every((a) => a.value === "")).toBe(true);
  });

  it("produces only attributes the strict write schema accepts", () => {
    for (const a of natural) {
      expect(() => parseAttributeWrite(a, { dance: "waltz" })).not.toThrow();
    }
  });

  it("a single-step figure carries both start and finish on that step", () => {
    const one = buildWdsfAttributes({
      figureType: "x", dance: "tango", timing: "S", start: "LF fwd", finish: "weight fwd",
    });
    expect(one).toHaveLength(1);
    expect(one[0].value).toBe("LF fwd"); // start wins the lone step
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ballroom/domain test -- wdsf-timing`
Expected: FAIL — `buildWdsfAttributes is not a function`.

- [ ] **Step 3: Write minimal implementation (append to wdsf-timing.ts)**

```ts
import type { DanceId } from "./dances";
import type { Attribute } from "./doc-types";

/**
 * Build a figure's per-step `step` attributes from its WDSF timing + actions.
 * The public syllabus gives only the first action (`start`) and last (`finish`);
 * intermediate steps get their count but a blank action (footwork lives in the
 * paid technique books — left for the content workstream). Ids are deterministic
 * so the generated catalog is stable and reproducible.
 */
export function buildWdsfAttributes(input: {
  figureType: string;
  dance: DanceId;
  timing: string;
  start?: string;
  finish?: string;
}): Attribute[] {
  const counts = parseWdsfTiming(input.timing);
  const last = counts.length - 1;
  return counts.map((count, i) => ({
    id: `wdsf-${input.figureType}-${input.dance}-s${i + 1}`,
    kind: "step",
    count,
    role: null,
    value: i === 0 ? (input.start ?? "") : i === last ? (input.finish ?? "") : "",
    deletedAt: null,
  }));
}
```

- [ ] **Step 4: Export from the domain barrel**

In `packages/domain/src/index.ts`, add next to the other exports:

```ts
export { buildWdsfAttributes, parseWdsfTiming } from "./wdsf-timing";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @ballroom/domain test -- wdsf-timing`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/wdsf-timing.ts packages/domain/src/wdsf-timing.test.ts packages/domain/src/index.ts
git commit -m "feat(domain): build per-step attributes from WDSF timing + actions"
```

---

### Task 3: Enrich the catalog type + merge the WDSF seed in the generator

**Files:**
- Modify: `packages/domain/src/library.ts` (enrich `LibraryFigure`, compute attributes)
- Modify: `packages/domain/src/library-data.ts` (regenerated — do not hand-edit)
- Modify: `scripts/gen-library.mjs` (merge WDSF seed, emit raw WDSF fields)
- Modify: `packages/domain/src/library.test.ts`

**Interfaces:**
- Consumes: `buildWdsfAttributes` (Task 2).
- Produces: enriched `LibraryFigure { dance; figureType; name; timing?; notes?; attributes? }`; `LIBRARY_FIGURES` with WDSF figures' attributes precomputed.

- [ ] **Step 1: Write the failing test (replace/extend library.test.ts assertions)**

```ts
// add to packages/domain/src/library.test.ts
import { parseAttributeWrite } from "./schemas";

it("includes the net-new WDSF figures with parsed step attributes", () => {
  // ~247 = 122 ISTD + 125 net-new WDSF
  expect(LIBRARY_FIGURES.length).toBeGreaterThanOrEqual(240);

  const natural = libraryFiguresForDance("waltz").find(
    (f) => f.figureType === "natural-turn" && f.name === "Natural Turn",
  );
  expect(natural?.attributes).toBeDefined();
  expect(natural?.attributes).toHaveLength(6); // "123 123"
  expect(natural?.attributes?.[0].value).toBe("RF fwd (Closed Position)");
  expect(natural?.attributes?.at(-1)?.value).toBe("LF closes to RF");
});

it("every catalog attribute is a valid strict-write attribute for its dance", () => {
  for (const f of LIBRARY_FIGURES) {
    for (const a of f.attributes ?? []) {
      expect(() => parseAttributeWrite(a, { dance: f.dance })).not.toThrow();
    }
  }
});
```

Update the existing count assertion (currently `expect(LIBRARY_FIGURES.length).toBeGreaterThan(50)`) — leave it (still true) or raise to `toBeGreaterThanOrEqual(240)`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ballroom/domain test -- library`
Expected: FAIL — `natural.attributes` is undefined (catalog not yet enriched).

- [ ] **Step 3: Enrich the `LibraryFigure` type + compute attributes in `library.ts`**

Replace the type + `LIBRARY_FIGURES` export in `packages/domain/src/library.ts`:

```ts
import type { Attribute } from "./doc-types";
import { buildWdsfAttributes } from "./wdsf-timing";

/** One catalog figure: identity + (for WDSF figures) its parsed step timeline. */
export interface LibraryFigure {
  dance: DanceId;
  figureType: string;
  name: string;
  /** Raw WDSF timing string (provenance/display); absent for ISTD-only figures. */
  timing?: string;
  /** WDSF syllabus notes, if any. */
  notes?: string[];
  /** Per-step timeline parsed from the WDSF timing + start/finish actions. */
  attributes?: Attribute[];
}

// ...keep LibraryGroup unchanged...

/** The whole catalog. WDSF figures carry a parsed `attributes` timeline. */
export const LIBRARY_FIGURES: readonly LibraryFigure[] = LIBRARY_FIGURE_DATA.map((d) => {
  if (!d.timing) return { dance: d.dance, figureType: d.figureType, name: d.name };
  return {
    dance: d.dance,
    figureType: d.figureType,
    name: d.name,
    timing: d.timing,
    notes: d.notes,
    attributes: buildWdsfAttributes({
      figureType: d.figureType,
      dance: d.dance,
      timing: d.timing,
      start: d.start,
      finish: d.finish,
    }),
  };
});
```

- [ ] **Step 4: Teach the generator to merge the WDSF seed**

Replace the seed-reading + row-building section of `scripts/gen-library.mjs` so it reads BOTH seeds, dedups by `(dance, name)` (ISTD wins — it is the system of record), and emits raw WDSF fields for net-new figures:

```js
const istd = JSON.parse(
  readFileSync(resolve(root, "docs/seed/istd-standard-figures.json"), "utf8"),
);
const wdsf = JSON.parse(
  readFileSync(resolve(root, "docs/seed/wdsf-standard-figures.json"), "utf8"),
);
const DANCE_ORDER = ["waltz", "viennese_waltz", "quickstep", "foxtrot", "tango"];

const seen = new Set();
const rows = [];
// ISTD first (system of record): identity only.
for (const f of istd.figures) {
  const key = `${f.dance}::${f.name}`;
  if (seen.has(key)) continue;
  seen.add(key);
  rows.push({ dance: f.dance, figureType: f.figureType, name: f.name });
}
// WDSF net-new: carry timing/start/finish/notes so library.ts can parse steps.
for (const f of wdsf.figures) {
  const key = `${f.dance}::${f.name}`;
  if (seen.has(key)) continue;
  seen.add(key);
  rows.push({
    dance: f.dance,
    figureType: f.figureType,
    name: f.name,
    timing: f.wdsf?.timing ?? "",
    start: f.wdsf?.start ?? "",
    finish: f.wdsf?.finish ?? "",
    notes: f.wdsf?.notes ?? [],
  });
}
rows.sort(
  (a, b) =>
    DANCE_ORDER.indexOf(a.dance) - DANCE_ORDER.indexOf(b.dance) || a.name.localeCompare(b.name),
);
```

And replace the row-emit + `LibraryFigureData` interface in the generated output template. The body line per row:

```js
const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const body = rows
  .map((r) => {
    const fields = [
      `dance: "${r.dance}"`,
      `figureType: "${esc(r.figureType)}"`,
      `name: "${esc(r.name)}"`,
    ];
    if (r.timing) {
      fields.push(`timing: "${esc(r.timing)}"`);
      fields.push(`start: "${esc(r.start)}"`);
      fields.push(`finish: "${esc(r.finish)}"`);
      fields.push(`notes: [${(r.notes ?? []).map((n) => `"${esc(n)}"`).join(", ")}]`);
    }
    return `  { ${fields.join(", ")} },`;
  })
  .join("\n");
```

And the generated interface (in the `out` template string) becomes:

```ts
export interface LibraryFigureData {
  dance: DanceId;
  figureType: string;
  name: string;
  timing?: string;
  start?: string;
  finish?: string;
  notes?: string[];
}
```

Update the file header comment in the template from "GENERATED from docs/seed/istd-standard-figures.json" to "GENERATED from docs/seed/istd-standard-figures.json + docs/seed/wdsf-standard-figures.json (net-new merged; see scripts/gen-library.mjs)".

- [ ] **Step 5: Regenerate the catalog data**

Run: `node scripts/gen-library.mjs`
Expected: prints `wrote 247 figures to packages/domain/src/library-data.ts` (122 + 125).

- [ ] **Step 6: Run tests + typecheck to verify they pass**

Run: `pnpm --filter @ballroom/domain test -- library` then `pnpm -w typecheck`
Expected: PASS; typecheck clean (the generated `start`/`finish` fields are consumed by `library.ts`).

- [ ] **Step 7: Commit**

```bash
git add packages/domain/src/library.ts packages/domain/src/library-data.ts packages/domain/src/library.test.ts scripts/gen-library.mjs
git commit -m "feat(domain): merge WDSF syllabus into the figure catalog with step attributes"
```

---

### Task 4: Extend the `zCreateFigure` contract with `attributes`

**Files:**
- Modify: `packages/contract/src/index.ts`
- Test: `packages/contract/src/index.test.ts` (create if absent)

**Interfaces:**
- Produces: `zCreateFigure` now accepts an optional `attributes` array (defaulting to `[]`); `CreateFigure` type gains the field.

- [ ] **Step 1: Write the failing test**

```ts
// packages/contract/src/index.test.ts
import { describe, expect, it } from "vitest";
import { zCreateFigure } from "./index";

describe("zCreateFigure", () => {
  it("accepts an optional attributes timeline, defaulting to []", () => {
    const base = { figureRef: "fig_1", name: "Natural Turn", dance: "waltz", figureType: "natural-turn" };
    expect(zCreateFigure.parse(base).attributes).toEqual([]);

    const withAttrs = zCreateFigure.parse({
      ...base,
      attributes: [{ id: "a1", kind: "step", count: 1, role: null, value: "RF fwd", deletedAt: null }],
    });
    expect(withAttrs.attributes).toHaveLength(1);
  });

  it("rejects a structurally invalid attribute", () => {
    const bad = {
      figureRef: "fig_1", name: "X", dance: "waltz", figureType: "x",
      attributes: [{ id: "a1", count: 1 }], // missing kind/value
    };
    expect(zCreateFigure.safeParse(bad).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ballroom/contract test`
Expected: FAIL — `attributes` is stripped/undefined (not in the schema).

- [ ] **Step 3: Write minimal implementation**

In `packages/contract/src/index.ts`, add a structural attribute schema and extend `zCreateFigure` (matching domain's `baseAttribute` shape — value is unknown, role is leader/follower/null):

```ts
export const zAttribute = z.object({
  id: z.string().min(1),
  kind: z.string().min(1),
  count: z.number(),
  role: z.enum(["leader", "follower"]).nullish(),
  value: z.unknown(),
  deletedAt: z.number().nullish(),
});

export const zCreateFigure = z.object({
  figureRef: z.string().min(1),
  name: z.string().trim().min(1, "Give the figure a name").max(80, "Keep the name under 80 chars"),
  dance: z.enum(DANCE_IDS),
  figureType: z.string().trim().min(1),
  attributes: z.array(zAttribute).default([]),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @ballroom/contract test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contract/src/index.ts packages/contract/src/index.test.ts
git commit -m "feat(contract): zCreateFigure accepts an optional attributes timeline"
```

---

### Task 5: Thread a picked figure's attributes through the web store

**Files:**
- Modify: `apps/web/src/store/routine.ts`
- Modify: `apps/web/src/store/routine-store.test.ts`

**Interfaces:**
- Consumes: `LIBRARY_FIGURES`, `Attribute` from `@ballroom/domain`.
- Produces: `CreateFigureFn` payload gains `attributes: Attribute[]`; `addPlacement` looks the picked figure up in the catalog and forwards its attributes (empty for custom / ISTD figures).

- [ ] **Step 1: Write the failing test (add to routine-store.test.ts)**

```ts
it("forwards a library figure's attributes to createFigure on pick", async () => {
  const { opts, sockets } = fakeWiring();
  const seen: Array<{ figureType: string; attributes?: unknown[] }> = [];
  const createFigure = vi.fn((meta: (typeof seen)[number]) => {
    seen.push(meta);
    return Promise.resolve();
  });
  const store = await openRoutine("rt_sample", { ...opts, createFigure });
  await catchUp(sockets); // however the suite advances the routine doc to ready
  store.addSection("Intro");
  // "natural-turn" in waltz is a WDSF net-new figure carrying attributes.
  store.addPlacement(firstSectionId(store), "Natural Turn", "natural-turn");

  expect(createFigure).toHaveBeenCalledTimes(1);
  expect(seen[0].figureType).toBe("natural-turn");
  expect((seen[0].attributes ?? []).length).toBe(6);
});

it("forwards an empty attributes list for a custom (non-catalog) figure", async () => {
  const { opts, sockets } = fakeWiring();
  const seen: Array<{ attributes?: unknown[] }> = [];
  const createFigure = vi.fn((meta: (typeof seen)[number]) => {
    seen.push(meta);
    return Promise.resolve();
  });
  const store = await openRoutine("rt_sample", { ...opts, createFigure });
  await catchUp(sockets);
  store.addSection("Intro");
  store.addPlacement(firstSectionId(store), "My Move"); // no figureType → custom
  expect((seen[0].attributes ?? []).length).toBe(0);
});
```

> Note for the implementer: reuse the suite's existing helpers for advancing the
> fake sockets and reading the first section id (see the existing `#187 figure
> projection` test at `routine-store.test.ts:118`); mirror its `fakeWiring()` /
> `createFigure` spy pattern rather than inventing new harness.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ballroom/web test -- routine-store`
Expected: FAIL — `seen[0].attributes` is undefined (not forwarded yet).

- [ ] **Step 3: Extend `CreateFigureFn` and `addPlacement`**

In `apps/web/src/store/routine.ts`:

Add to imports: `import { LIBRARY_FIGURES, type Attribute } from "@ballroom/domain";`

Extend the `CreateFigureFn` payload type:

```ts
export type CreateFigureFn = (figure: {
  figureRef: string;
  name: string;
  dance: string;
  figureType: string;
  attributes: Attribute[];
}) => Promise<void>;
```

Update the default `createFigure` POST body (already passes the whole `figure` object — `attributes` rides along, no change needed beyond the type).

In `addPlacement`, after computing `figureType` and `dance`, look up the catalog and forward attributes:

```ts
const dance = readRoutineSafe().dance;
// A library pick carries the catalog's per-step timeline (US-032 + WDSF seed);
// a custom figure has none. Match on (dance, figureType) — the picked identity.
const preset = LIBRARY_FIGURES.find((f) => f.dance === dance && f.figureType === figureType);
const attributes = preset?.attributes ?? [];
// ...
createFigure({ figureRef, name, dance, figureType, attributes }).then(() => {
  figureConn(figureRef);
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ballroom/web test -- routine-store`
Expected: PASS. Also re-run the existing `#187` test to confirm no regression.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/store/routine.ts apps/web/src/store/routine-store.test.ts
git commit -m "feat(web): pre-seed a picked library figure's step timeline"
```

---

### Task 6: Validate + seed the attributes in the worker `/api/figures` route

**Files:**
- Modify: `apps/worker/src/index.ts`
- Modify: `apps/worker/src/routes/figures.test.ts`

**Interfaces:**
- Consumes: `zCreateFigure` (now with `attributes`, Task 4); `parseAttributeWrite` from `@ballroom/domain`.
- Produces: `/api/figures` validates each attribute (strict, per dance), seeds them into the figure DO, and returns 400 on an invalid attribute.

- [ ] **Step 1: Write the failing test (add to figures.test.ts)**

```ts
it("seeds forwarded attributes into the figure DO", async () => {
  const res = await app.request("/api/figures", {
    method: "POST",
    headers: authHeaders(), // the suite's authenticated-request helper
    body: JSON.stringify({
      figureRef: "fig_attrs", name: "Natural Turn", dance: "waltz", figureType: "natural-turn",
      attributes: [
        { id: "wdsf-natural-turn-waltz-s1", kind: "step", count: 1, role: null, value: "RF fwd", deletedAt: null },
      ],
    }),
  }, env);
  expect(res.status).toBe(201);
  // Assert via the DO/seedDoc spy the suite already uses for the #205 seed test.
  expect(seededContentFor("fig_attrs").attributes).toHaveLength(1);
});

it("rejects an attribute off the timing grid", async () => {
  const res = await app.request("/api/figures", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      figureRef: "fig_bad", name: "X", dance: "waltz", figureType: "x",
      attributes: [{ id: "a1", kind: "step", count: 0.5, role: null, value: "x", deletedAt: null }],
    }),
  }, env);
  expect(res.status).toBe(400);
});
```

> Note for the implementer: reuse the existing figures-route harness — the
> authenticated-request helper and the `seedDoc` spy from the `#205` server-seed
> test already in `figures.test.ts`. Add `seededContentFor` only if no equivalent
> accessor exists.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ballroom/worker test -- figures`
Expected: FAIL — attributes are not seeded (seedDoc still sends `attributes: []`); the bad-grid case returns 201, not 400.

- [ ] **Step 3: Validate + forward in the route**

In `apps/worker/src/index.ts`:

Add `parseAttributeWrite` to the domain import:

```ts
import { can, newId, parseAttributeWrite } from "@ballroom/domain";
```

In the `/api/figures` handler, after `const { figureRef, name, dance, figureType } = parsed.data;` add validation, then seed the real attributes:

```ts
const { figureRef, name, dance, figureType, attributes } = parsed.data;

// Strict write-validate every seeded attribute (count on the 1/8 grid ≥ 1,
// known-enum kinds in range) so the catalog/seed can't inject bad timeline data.
try {
  for (const a of attributes) parseAttributeWrite(a, { dance });
} catch {
  return c.json({ error: "invalid_attribute" }, 400);
}

await createFigureRows(c.env.DB, { figureRef, ownerId: user.sub, name, dance, figureType });
await c.env.DOC_DO.get(c.env.DOC_DO.idFromName(figureRef)).seedDoc({
  id: figureRef,
  scope: "account",
  ownerId: user.sub,
  figureType,
  dance,
  name,
  source: "custom",
  attributes,
  schemaVersion: 1,
  deletedAt: null,
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @ballroom/worker test -- figures`
Expected: PASS (seed + reject cases). Re-run the existing `#187`/`#205` figure tests to confirm no regression.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/src/routes/figures.test.ts
git commit -m "feat(worker): validate + seed forwarded figure attributes on create"
```

---

### Task 7: Full-suite gates + push

**Files:** none (verification only).

- [ ] **Step 1: Run the full gates**

Run: `pnpm -w lint && pnpm -w typecheck && pnpm -w test`
Expected: all green. (If `pnpm -w` script names differ, use the per-package scripts each task used.)

- [ ] **Step 2: Sanity-check the catalog size**

Run: `node -e "import('@ballroom/domain').then(m=>console.log(m.LIBRARY_FIGURES.length, m.LIBRARY_FIGURES.filter(f=>f.attributes).length))"` (or a small Vitest assertion if ESM resolution needs the build).
Expected: `247 125` (247 total, 125 carrying attributes).

- [ ] **Step 3: Push the branch**

```bash
git push origin story/wdsf-syllabus-library:story/wdsf-syllabus-library
```

- [ ] **Step 4: Open the PR** (target `development`)

```bash
gh pr create --base development --head story/wdsf-syllabus-library \
  --title "feat: add WDSF Standard syllabus to the figure library with step counts + actions" \
  --body "$(cat <<'BODY'
Adds the 125 net-new WDSF Standard syllabus figures (dedup by (dance, name) vs the ISTD catalog), each carrying a real per-step timeline parsed from the WDSF timing + start/finish actions. Picking a WDSF figure now pre-seeds those steps onto the timeline.

- `parseWdsfTiming` / `buildWdsfAttributes` (packages/domain, tested)
- generator merges the WDSF seed over ISTD; catalog gains optional `attributes`/`timing`/`notes`
- attributes threaded through addPlacement → /api/figures → seedDoc, validated strict server-side

Design: docs/superpowers/specs/2026-06-27-wdsf-syllabus-library-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

---

## Self-Review

**Spec coverage:**
- "Add entire WDSF syllabus, ignore known figures" → Task 3 (merge + dedup by `(dance, name)`). ✓
- "Right step counts + actions from the syllabus" → Tasks 1–2 (parser + start/finish placement). ✓
- "Pre-seed on pick" → Tasks 4–6 (contract → web store → worker seed). ✓
- Documented approximations (Lady/parens/leading-&) → Task 1 code + comments. ✓
- Tests: parser unit, generated-data invariant, web store, worker seed/reject → Tasks 1–6. ✓

**Type consistency:** `parseWdsfTiming` / `buildWdsfAttributes` signatures match across Tasks 1–3 and 5; `Attribute` shape (`id/kind/count/role/value/deletedAt`) is identical in domain `baseAttribute`, contract `zAttribute`, and the seed payload; `CreateFigureFn` gains `attributes: Attribute[]` (Task 5) consumed by `zCreateFigure.attributes` (Task 4) and the worker route (Task 6). ✓

**Placeholder scan:** No TBD/TODO; every code step shows real code. Two test tasks (5, 6) reference existing suite harness helpers by file:line rather than reproducing them — intentional, since reproducing private test scaffolding would be wrong, and the exact helper names are suite-local. ✓
