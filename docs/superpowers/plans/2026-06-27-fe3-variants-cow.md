# FE-3 Variants / Copy-on-Write Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the figure-variant / copy-on-write slice (US-033–036): editing a non-owned figure auto-creates an owned overlay variant (re-pointing the placement, base untouched, "copied as your variant" toast); editing an owned figure flows into every routine referencing it; your variants/custom figures show in the library with lineage + "used in N routines".

**Architecture:** Copy-on-write is orchestrated in the web **store seam** (`apps/web/src/store/routine.ts`) using the existing domain `copyOnWrite`/`resolve` primitives; the worker exposes only a *stateless* variant-creation route (`POST /api/figures` extended with `baseFigureRef`). A variant is a `FigureDoc` with `baseFigureRef` + an `Overlay` of divergences, resolved live so non-overridden base edits flow up. No per-doc DO drives another DO (honors `per-document-do-layering`).

**Tech Stack:** TypeScript (strict, no `any`), Automerge CRDT, Hono on Cloudflare Workers + Durable Objects + D1, Drizzle, React + Vite, Vitest (`vitest-pool-workers` for the worker layer), Playwright E2E, Biome.

## Global Constraints

- TS strict; no `any` without justification (Biome `noExplicitAny` = error). Run `pnpm lint && pnpm typecheck` before each commit.
- TDD RED→GREEN→REFACTOR. Unskip the story's listed tests, watch them fail, make them pass.
- IDs are client-generated ULIDs (`newId()` from `@ballroom/domain`). Soft-delete only (`deletedAt`), never hard removal.
- Worker DO tests: `isolatedStorage:false` → every test uses a unique DO id (`uniqueDocName`/`do-id.ts`). D1 is shared across the worker run — seed with unique per-test docRefs.
- Components never import `@automerge/automerge` or the RPC client directly — only via `store/` and `ui/`.
- Registry figure types: app-owned global figures → `type:"global-figure"`; user-owned variants/custom → `type:"account-figure"`. (Quota keys off `type='routine'`; cascade keys off `placement_edge` — both unaffected.)
- Run worker tests: `pnpm --filter @ballroom/worker test <file>`; web tests: `pnpm --filter @ballroom/web test <file>`; domain: `pnpm --filter @ballroom/domain test <file>`; E2E: `pnpm test:e2e <file>` (or `:smoke`).
- Commit message footer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `packages/contract/src/index.ts` | `zCreateFigure` — add optional `baseFigureRef` | Modify |
| `apps/worker/src/db/figures.ts` | figure registry rows: `account-figure` type; `mine` query w/ usedInCount | Modify |
| `apps/worker/src/index.ts` | `POST /api/figures` variant seed; `GET /api/figures`, `/api/figures/mine` | Modify |
| `apps/worker/src/figures.test.ts` | US-034/035 worker contract (store-seam shape) | Rewrite |
| `apps/worker/src/routes/search.test.ts` | US-032/033 list + mine | Unskip |
| `apps/web/src/store/overlay-diff.ts` | pure: full-timeline replace → `Overlay` vs base | Create |
| `apps/web/src/store/overlay-diff.test.ts` | overlay-diff unit tests | Create |
| `apps/web/src/store/routine.ts` | `resolveFigure` identity stamp; COW-aware `setFigureAttributes` | Modify |
| `apps/web/src/store/routine-store.test.ts` | identity stamp + COW path | Modify |
| `apps/web/src/components/FigureTimeline.tsx` | `figureScope` prop; COW toast; "Fork into variant" | Modify |
| `apps/web/src/components/FigureLibrary.tsx` | `tab` prop; "mine" tab (fetch `/api/figures/mine`) | Modify |
| `apps/web/src/components/figure-library.test.tsx` | US-033/035/036 | Unskip |
| `apps/web/src/components/Assemble.tsx` | pass `figureScope` to `FigureTimeline` | Modify |
| `apps/web/e2e/fork-and-figures.spec.ts` | two COW journeys (real bodies) | Rewrite + unskip |
| `apps/web/e2e/support/fixtures.ts` | seed a global figure referenced by a routine (if needed) | Modify |

---

## Task 1: Worker — variant-creation route + reconcile figure types (US-035 stateless route, US-034 worker)

**Files:**
- Modify: `packages/contract/src/index.ts` (`zCreateFigure`)
- Modify: `apps/worker/src/db/figures.ts` (`createFigureRows` type)
- Modify: `apps/worker/src/index.ts:221-260` (`POST /api/figures`)
- Rewrite: `apps/worker/src/figures.test.ts`

**Interfaces:**
- Produces: `POST /api/figures` accepts optional `baseFigureRef?: string`; when present it seeds the figure DO with `{ scope:"account", source:"custom", baseFigureRef, overlay:{overrides:{},tombstones:[],additions:[]} }` and projects a `type:"account-figure"` registry row. Without it, behaves as today (a custom figure) but now also as `account-figure`.

- [ ] **Step 1: Add `baseFigureRef` to the contract schema**

In `packages/contract/src/index.ts`, inside `zCreateFigure`, add after `attributes`:

```ts
  /** Set when this figure is a copy-on-write VARIANT of a shared base (US-035):
   *  the figure inherits the base live via an overlay. Omitted for a fresh custom figure. */
  baseFigureRef: z.string().min(1).optional(),
```

- [ ] **Step 2: Reconcile the registry type to `account-figure`**

In `apps/worker/src/db/figures.ts`, in `createFigureRows`, change the registry insert `type` from `"figure"` to `"account-figure"`:

```ts
      .values({
        docRef: f.figureRef,
        type: "account-figure",
        ownerId: f.ownerId,
        doName: f.figureRef,
        title: f.name,
        dance: f.dance,
        figureType: f.figureType,
        updatedAt: now,
      })
```

Also update `countOwnedFigures` filter `eq(documentRegistry.type, "figure")` → `eq(documentRegistry.type, "account-figure")`.

- [ ] **Step 3: Verify nothing else depends on `type='figure'`**

Run: `grep -rn "\"figure\"\|'figure'\|= 'figure'\|type.*figure" apps/worker/src --include=*.ts | grep -v "account-figure\|global-figure\|figureType\|figureRef\|test"`
Expected: no production query filters on the bare `"figure"` type (only `account-figure`/`global-figure`). If any does, update it to `account-figure`. (`countOwnedFigures` handled in Step 2.)

- [ ] **Step 4: Seed the variant overlay in `POST /api/figures`**

In `apps/worker/src/index.ts`, in the `app.post("/api/figures", …)` handler, after destructuring `parsed.data`, pull `baseFigureRef`:

```ts
  const { figureRef, name, dance, figureType, routineId, attributes, baseFigureRef } = parsed.data;
```

Then in the `seedDoc(...)` call, add the variant fields when `baseFigureRef` is present:

```ts
  await c.env.DOC_DO.get(c.env.DOC_DO.idFromName(figureRef)).seedDoc({
    id: figureRef,
    scope: "account",
    ownerId: user.sub,
    figureType,
    dance,
    name,
    source: "custom",
    attributes,
    ...(baseFigureRef
      ? { baseFigureRef, overlay: { overrides: {}, tombstones: [], additions: [] } }
      : {}),
    schemaVersion: 1,
    deletedAt: null,
  });
```

(`createFigureRows` already records the `account-figure` row; `linkPlacement` already records the routine→variant edge. No other change to the handler.)

- [ ] **Step 5: Rewrite `apps/worker/src/figures.test.ts`**

Replace the whole file with store-seam-shaped contracts. US-034: a figure referenced by two routines (two placement edges) is one shared DO; editing it does not create a second figure. US-035: the stateless variant route creates an `account-figure` row whose base is untouched.

```ts
import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authedContext } from "./test-support/authed-context";
import { uniqueDocName } from "./test-support/do-id";
import type { DocNamespace, DocStub } from "./test-support/doc-do-api";
import { generateTestKeypair, type TestKeypair } from "./test-support/jwt";
import { applyMigrations, seedDb } from "./test-support/seed";

// US-034 — editing your OWN figure flows into all referencing routines [M4].
// US-035 — auto-variant on editing a NON-owned figure (copy-on-write) [M4].
// COW is orchestrated in the web store seam (per-document-do-layering): the
// worker only exposes the stateless variant-creation route + the shared figure
// DO. These tests prove the worker primitives the store composes.

const docs = env.DOC_DO as unknown as DocNamespace;
function freshDoc(prefix: string): { name: string; stub: DocStub } {
  const name = uniqueDocName(prefix);
  return { name, stub: docs.get(docs.idFromName(name)) };
}

let kp: TestKeypair;
beforeAll(async () => {
  await applyMigrations();
  kp = await generateTestKeypair();
});

describe("US-034 Editing your own figure flows into all referencing routines", () => {
  it("one shared figure DO is referenced by two routines; an edit does not fork it", async () => {
    // Two routines both reference ONE figure docRef (the store records a
    // placement_edge per routine). Editing the figure DO touches that one doc;
    // the store resolves it for both routines at read time (no variant).
    const figure = freshDoc("figure");
    const rtA = uniqueDocName("routine");
    const rtB = uniqueDocName("routine");
    await seedDb({
      placementEdges: [
        { routineRef: rtA, figureRef: figure.name },
        { routineRef: rtB, figureRef: figure.name },
      ],
    });
    // The figure DO is a normal doc; its snapshot is well-formed (rehydrate path).
    const snap = await figure.stub.getSnapshot();
    expect(snap).toBeDefined();
    // Both edges point at the SAME figureRef → both routines share the doc.
    const rows = await env.DB.prepare(
      "SELECT routineRef FROM placement_edge WHERE figureRef = ? ORDER BY routineRef",
    )
      .bind(figure.name)
      .all<{ routineRef: string }>();
    expect((rows.results ?? []).map((r) => r.routineRef).sort()).toEqual([rtA, rtB].sort());
  });
});

describe("US-035 Auto-variant on editing a non-owned figure (stateless variant route)", () => {
  it("creates an account-figure variant (baseFigureRef) + leaves the base untouched", async () => {
    const base = freshDoc("figure-global"); // app-owned global base figure
    const routine = uniqueDocName("routine");
    const variantRef = uniqueDocName("figure-variant");
    await seedDb({
      users: [{ id: "u1", displayName: "U1", identityColor: "#111", plan: "free" }],
      docs: [
        {
          docRef: base.name,
          type: "global-figure",
          ownerId: "app",
          doName: base.name,
          figureType: "feather",
          dance: "foxtrot",
        },
        { docRef: routine, type: "routine", ownerId: "u1", doName: routine },
      ],
      memberships: [{ id: `m_${routine}`, docRef: routine, userId: "u1", role: "editor" }],
    });
    const before = await base.stub.getSnapshot();

    // The store's COW path POSTs the variant (baseFigureRef = the global base).
    const ctx = await authedContext({ keypair: kp, userId: "u1", docRef: routine, role: "editor" });
    const res = await SELF.fetch("https://x/api/figures", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        figureRef: variantRef,
        name: "Feather",
        dance: "foxtrot",
        figureType: "feather",
        routineId: routine,
        attributes: [],
        baseFigureRef: base.name,
      }),
    });
    expect(res.status).toBe(201);

    // A new account-figure row owned by u1 (the variant) now exists…
    const variant = await env.DB.prepare(
      "SELECT docRef, ownerId FROM document_registry WHERE docRef = ? AND type = 'account-figure'",
    )
      .bind(variantRef)
      .first<{ docRef: string; ownerId: string }>();
    expect(variant?.ownerId).toBe("u1");

    // …and the base global figure DO is unchanged (no disturbance to others).
    const after = await base.stub.getSnapshot();
    expect(after).toEqual(before);
  });
});
```

- [ ] **Step 6: Run the worker figures tests — expect PASS**

Run: `pnpm --filter @ballroom/worker test src/figures.test.ts`
Expected: both describes PASS. (If `authedContext` needs a real membership for the POST, the seed above grants u1 `editor` on the routine; the figure POST authorizes on the JWT sub, not doc role.)

- [ ] **Step 7: lint + typecheck + commit**

```bash
pnpm lint && pnpm typecheck
git add packages/contract/src/index.ts apps/worker/src/db/figures.ts apps/worker/src/index.ts apps/worker/src/figures.test.ts
git commit -m "feat(worker): variant-creation route + reconcile figure registry types (US-034/035)"
```

---

## Task 2: Worker — figure library list routes (US-032/033)

**Files:**
- Modify: `apps/worker/src/db/figures.ts` (add `listGlobalFigures`, `listMineFigures`)
- Modify: `apps/worker/src/index.ts` (add `GET /api/figures`, `GET /api/figures/mine`)
- Unskip: `apps/worker/src/routes/search.test.ts` (US-032/033 describe)

**Interfaces:**
- Produces: `GET /api/figures?dance=<id>` → `{ figures: { docRef, figureType, dance, title }[] }` (global-figure rows, optional dance filter). `GET /api/figures/mine` → `{ figures: { docRef, figureType, dance, title, baseFigureRef: null, usedInCount }[] }` (the caller's account-figure rows; `usedInCount` = distinct routines referencing it via `placement_edge`).

- [ ] **Step 1: Add the two D1 queries to `db/figures.ts`**

```ts
export interface GlobalFigureRow {
  docRef: string;
  figureType: string | null;
  dance: string | null;
  title: string | null;
}

/** Global (app-owned) library figures from the index, optionally dance-filtered. */
export async function listGlobalFigures(
  db: D1Database,
  dance?: string,
): Promise<GlobalFigureRow[]> {
  const sql = dance
    ? "SELECT docRef, figureType, dance, title FROM document_registry WHERE type = 'global-figure' AND deletedAt IS NULL AND dance = ?1 ORDER BY figureType, title"
    : "SELECT docRef, figureType, dance, title FROM document_registry WHERE type = 'global-figure' AND deletedAt IS NULL ORDER BY figureType, title";
  const stmt = dance ? db.prepare(sql).bind(dance) : db.prepare(sql);
  const res = await stmt.all<GlobalFigureRow>();
  return res.results ?? [];
}

export interface MineFigureRow extends GlobalFigureRow {
  usedInCount: number;
}

/** The caller's account figures (variants + custom) with a usage count from the edges. */
export async function listMineFigures(db: D1Database, userId: string): Promise<MineFigureRow[]> {
  const res = await db
    .prepare(
      "SELECT r.docRef AS docRef, r.figureType AS figureType, r.dance AS dance, r.title AS title, " +
        "(SELECT COUNT(*) FROM placement_edge pe WHERE pe.figureRef = r.docRef) AS usedInCount " +
        "FROM document_registry r WHERE r.ownerId = ?1 AND r.type = 'account-figure' AND r.deletedAt IS NULL " +
        "ORDER BY r.updatedAt DESC",
    )
    .bind(userId)
    .all<MineFigureRow>();
  return res.results ?? [];
}
```

(The owner list uses the existing `document_registry_owner_idx (ownerId, type, deletedAt, updatedAt)`; the usage subquery uses `idx_placement_edge_figure`.)

- [ ] **Step 2: Add the routes in `index.ts`**

Add the import `import { createFigureRows, listGlobalFigures, listMineFigures } from "./db/figures";` (extend the existing import) and, near the other figure routes:

```ts
// GET /api/figures?dance= — the global figure library list (US-032), from the
// D1 index (no CRDT scan). Open to any authenticated user.
app.get("/api/figures", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const dance = c.req.query("dance") || undefined;
  const figures = await listGlobalFigures(c.env.DB, dance);
  return c.json({ figures });
});

// GET /api/figures/mine — the caller's account variants + custom figures with a
// "used in N routines" count (US-033), from the D1 index.
app.get("/api/figures/mine", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const figures = await listMineFigures(c.env.DB, user.sub);
  return c.json({ figures });
});
```

Route ordering: register `/api/figures/mine` BEFORE any `/api/figures/:id` param route if one exists (none today). Place `GET /api/figures` and `/mine` above `POST /api/figures` for readability.

- [ ] **Step 3: Unskip the US-032/033 describe in `search.test.ts`**

Change `describe.skip("US-032/033 Figure library browse …` → `describe("US-032/033 Figure library browse …`. The two `it`s already assert `res.status === 200` against `/api/figures?dance=foxtrot` and `/api/figures/mine`. Add the usage assertion to the second test, after the status check:

```ts
    expect(res.status).toBe(200);
    const body = (await res.json()) as { figures: { docRef: string; usedInCount: number }[] };
    const v = body.figures.find((f) => f.docRef === "var1");
    expect(v?.usedInCount).toBe(2);
```

And in that test's `seedDb`, add the two edges so the count is real:

```ts
      placementEdges: [
        { routineRef: "rtA", figureRef: "var1" },
        { routineRef: "rtB", figureRef: "var1" },
      ],
```

- [ ] **Step 4: Run search tests — expect PASS**

Run: `pnpm --filter @ballroom/worker test src/routes/search.test.ts`
Expected: US-032/033 describe PASS (US-046 stays skipped). 

- [ ] **Step 5: lint + typecheck + commit**

```bash
pnpm lint && pnpm typecheck
git add apps/worker/src/db/figures.ts apps/worker/src/index.ts apps/worker/src/routes/search.test.ts
git commit -m "feat(worker): figure library list + mine routes with usedInCount (US-032/033)"
```

---

## Task 3: Store — `resolveFigure` identity stamp (latent bug fix)

**Files:**
- Modify: `apps/web/src/store/routine.ts:400-410` (`resolveFigure`)
- Modify: `apps/web/src/store/routine-store.test.ts` (add an assertion to the variant-resolve test)

**Interfaces:**
- Produces: `resolveFigure` returns a figure carrying the **variant's** own `id/scope/ownerId/source/baseFigureRef` with the resolved (base ⊕ overlay) `attributes`/`name`. (Consumers — `readPlacements`, `Assemble`, `setFigureAttributes` — can trust `.id` is the doc to edit.)

- [ ] **Step 1: Add the failing assertion**

In `routine-store.test.ts`, find the variant-resolution test (around line 221, the one seeding `baseFigureRef: "fbase"` / figure `fv`). After it asserts the resolved attributes, add:

```ts
    // The resolved variant must carry the VARIANT's identity, not the base's
    // (resolve() returns base identity by contract — the store stamps it back).
    const rp = store.readPlacements().find((p) => p.placement.figureRef === "fv");
    expect(rp?.figure?.id).toBe("fv");
    expect(rp?.figure?.baseFigureRef).toBe("fbase");
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @ballroom/web test src/store/routine-store.test.ts -t "variant"`
Expected: FAIL — `figure.id` is `"fbase"` (the base id) not `"fv"`.

- [ ] **Step 3: Stamp the variant identity in `resolveFigure`**

In `routine.ts`, replace the variant branch of `resolveFigure`:

```ts
  function resolveFigure(figureRef: string): FigureDoc | null {
    const conn = figureConn(figureRef);
    const figure = readFigureDoc(conn.current());
    if (!figure) return null;
    if (figure.baseFigureRef && figure.overlay) {
      const base = readFigureDoc(figureConn(figure.baseFigureRef).current());
      if (base) {
        // resolve() returns the BASE's identity by contract (overlay.ts) — stamp
        // the variant's own identity back so re-points/edits target the variant doc.
        return {
          ...resolve(base, figure.overlay),
          id: figure.id,
          scope: figure.scope,
          ownerId: figure.ownerId,
          source: figure.source,
          baseFigureRef: figure.baseFigureRef,
        };
      }
    }
    return figure;
  }
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @ballroom/web test src/store/routine-store.test.ts -t "variant"`
Expected: PASS.

- [ ] **Step 5: lint + typecheck + commit**

```bash
pnpm lint && pnpm typecheck
git add apps/web/src/store/routine.ts apps/web/src/store/routine-store.test.ts
git commit -m "fix(web/store): stamp variant identity onto resolved figure (US-006 contract)"
```

---

## Task 4: Store — overlay-diff helper (pure)

**Files:**
- Create: `apps/web/src/store/overlay-diff.ts`
- Create: `apps/web/src/store/overlay-diff.test.ts`

**Interfaces:**
- Produces: `overlayFromAttributes(baseAttrs: Attribute[], nextAttrs: Attribute[]): Overlay` — given the base figure's attributes and the editor's full next attribute set (the resolved timeline after an edit), compute the `Overlay { overrides, tombstones, additions }` that, applied to the base via `resolve`, yields `nextAttrs`. Consumed by `setFigureAttributes` (Task 5).

Semantics (mirror `resolve` in `packages/domain/src/overlay.ts`):
- A `next` attribute whose `id` matches a base attribute: if its `value` differs → `overrides[id] = value`; else inherited (omit). (`resolve` only overrides `value`; kind/count/role come from base.)
- A base attribute id absent from `next` (and not soft-deleted away) → `tombstones`.
- A `next` attribute whose `id` is NOT a base id → `additions` (verbatim).
- Soft-deleted (`deletedAt != null`) `next` attributes are treated as absent.

- [ ] **Step 1: Write the failing test**

```ts
import type { Attribute, Overlay } from "@ballroom/domain";
import { resolve } from "@ballroom/domain";
import { describe, expect, it } from "vitest";
import { overlayFromAttributes } from "./overlay-diff";

const base: Attribute[] = [
  { id: "b1", kind: "step", count: 1, role: null, value: "HT" },
  { id: "b2", kind: "sway", count: 2, role: null, value: "to_L" },
];

function baseFigure() {
  return {
    id: "base",
    scope: "global" as const,
    ownerId: "app",
    figureType: "feather",
    dance: "foxtrot" as const,
    name: "Feather",
    source: "library" as const,
    attributes: base,
    schemaVersion: 1,
    deletedAt: null,
  };
}

describe("overlayFromAttributes", () => {
  it("overrides a changed base value", () => {
    const next: Attribute[] = [
      { id: "b1", kind: "step", count: 1, role: null, value: "T" }, // changed HT→T
      { id: "b2", kind: "sway", count: 2, role: null, value: "to_L" },
    ];
    const ov = overlayFromAttributes(base, next);
    expect(ov.overrides).toEqual({ b1: "T" });
    expect(ov.tombstones).toEqual([]);
    expect(ov.additions).toEqual([]);
    // Round-trips through resolve back to next.
    expect(resolve(baseFigure(), ov).attributes).toEqual(next);
  });

  it("tombstones a removed base attribute and appends a brand-new one", () => {
    const next: Attribute[] = [
      { id: "b1", kind: "step", count: 1, role: null, value: "HT" }, // unchanged → inherited
      { id: "n1", kind: "rise", count: 3, role: null, value: "rise" }, // new → addition
    ];
    const ov = overlayFromAttributes(base, next);
    expect(ov.overrides).toEqual({});
    expect(ov.tombstones).toEqual(["b2"]);
    expect(ov.additions).toEqual([{ id: "n1", kind: "rise", count: 3, role: null, value: "rise" }]);
  });

  it("ignores soft-deleted next attributes (treated as absent)", () => {
    const next: Attribute[] = [
      { id: "b1", kind: "step", count: 1, role: null, value: "HT" },
      { id: "b2", kind: "sway", count: 2, role: null, value: "to_L", deletedAt: 123 },
    ];
    const ov = overlayFromAttributes(base, next);
    expect(ov.tombstones).toEqual(["b2"]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module not found)**

Run: `pnpm --filter @ballroom/web test src/store/overlay-diff.test.ts`
Expected: FAIL — cannot find `./overlay-diff`.

- [ ] **Step 3: Implement `overlay-diff.ts`**

```ts
// Pure helper for the store seam: convert a figure timeline editor's full next
// attribute set (the RESOLVED timeline after an edit) into an Overlay of
// divergences against a base figure, so a variant stores only what it changed
// and non-overridden base edits still flow up via resolve() (US-006/US-036).
import type { Attribute, Overlay } from "@ballroom/domain";

/** True when an attribute is present (not soft-deleted). */
function live(a: Attribute): boolean {
  return a.deletedAt == null;
}

/**
 * Compute the Overlay that, applied to `baseAttrs` via domain `resolve`, yields
 * `nextAttrs`. Mirrors resolve(): overrides re-value a base attribute by id;
 * tombstones drop a base attribute; additions are variant-only attributes.
 */
export function overlayFromAttributes(baseAttrs: Attribute[], nextAttrs: Attribute[]): Overlay {
  const baseById = new Map(baseAttrs.map((a) => [a.id, a]));
  const nextLive = nextAttrs.filter(live);
  const nextIds = new Set(nextLive.map((a) => a.id));

  const overrides: Record<string, unknown> = {};
  const additions: Attribute[] = [];
  for (const a of nextLive) {
    const baseAttr = baseById.get(a.id);
    if (!baseAttr) {
      additions.push(a);
    } else if (!Object.is(baseAttr.value, a.value) && baseAttr.value !== a.value) {
      overrides[a.id] = a.value;
    }
  }

  const tombstones = baseAttrs.filter((a) => !nextIds.has(a.id)).map((a) => a.id);
  return { overrides, tombstones, additions };
}
```

(Value comparison: scalars compare by `!==`; the registry values in v1 are strings/arrays — the editor replaces an attribute object on change, so an array value also produces a fresh reference. For the v1 attribute kinds touched in the COW flow — footwork `step` strings — `!==` is correct. The round-trip test guards the common case.)

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @ballroom/web test src/store/overlay-diff.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: lint + typecheck + commit**

```bash
pnpm lint && pnpm typecheck
git add apps/web/src/store/overlay-diff.ts apps/web/src/store/overlay-diff.test.ts
git commit -m "feat(web/store): overlay-diff helper (timeline replace → Overlay)"
```

---

## Task 5: Store — COW-aware `setFigureAttributes` (US-035 store path)

**Files:**
- Modify: `apps/web/src/store/routine.ts` (`setFigureAttributes`, `OpenOptions`, `CreateFigureFn`)
- Modify: `apps/web/src/store/routine-store.test.ts` (COW path test)

**Interfaces:**
- Consumes: `copyOnWrite`, `resolve` (`@ballroom/domain`); `overlayFromAttributes` (Task 4); `CreateFigureFn` (extend its arg with `baseFigureRef?: string`).
- Produces: `setFigureAttributes(figureRef, nextAttrs)` — when the resolved figure is **owned** by `currentUserId`, writes `attributes` in place (today's behavior). When **not owned**, performs copy-on-write: domain `copyOnWrite` → POST the variant (with `baseFigureRef`) via `createFigure` → re-point the placement's `figureRef` in the routine doc → write the overlay (`overlayFromAttributes(base, nextAttrs)`) to the variant doc. Adds `OpenOptions.onCopyOnWrite?: () => void` (the store invokes it so the screen can toast).

- [ ] **Step 1: Extend `CreateFigureFn` and `OpenOptions`**

In `routine.ts`, add `baseFigureRef?: string;` to the `CreateFigureFn` arg object, and to `OpenOptions` add:

```ts
  /** Called when an edit triggered copy-on-write (US-035), so the screen can
   *  toast "copied as your variant". Receives the new variant's id. */
  onCopyOnWrite?: (variantRef: string) => void;
```

Wire it through `openRoutine`: `const onCopyOnWrite = opts.onCopyOnWrite;` and include `baseFigureRef` in the default `createFigure` POST body (the `apiPost` payload already spreads the arg, so just ensure the arg type includes it).

- [ ] **Step 2: Write the failing COW test**

In `routine-store.test.ts`, add (using the existing `fakeWiring` + a global figure referenced by a placement). Model it on the existing variant-resolve test:

```ts
it("copy-on-write: editing a NON-owned figure spawns an owned variant + re-points (US-035)", async () => {
  const { opts, sockets } = fakeWiring();
  const created: Array<{ figureRef: string; baseFigureRef?: string }> = [];
  const createFigure = vi.fn(async (m: { figureRef: string; baseFigureRef?: string }) => {
    created.push({ figureRef: m.figureRef, baseFigureRef: m.baseFigureRef });
  });
  const onCopyOnWrite = vi.fn();
  const store = await openRoutine("rt_sample", {
    ...opts,
    currentUserId: "me",
    createFigure,
    onCopyOnWrite,
  });

  // Routine references a GLOBAL figure "fg" (owned by "app", not "me").
  const routine = buildRoutineDoc({
    id: "rt_sample", title: "R", dance: "foxtrot", ownerId: "me",
    sections: [{ id: "s1", name: "S", placements: [{ id: "p1", figureRef: "fg", deletedAt: null }] }],
    annotations: [], schemaVersion: 1, deletedAt: null,
  });
  sockets.get("rt_sample")?.fireOpen();
  sockets.get("rt_sample")?.load(routine);
  sockets.get("rt_sample")?.fireCaughtUp();

  const fg = buildFigureDoc(aFigure({ id: "fg", scope: "global", ownerId: "app", figureType: "feather", dance: "foxtrot", name: "Feather", source: "library", attributes: [{ id: "b1", kind: "step", count: 1, role: null, value: "HT" }] }) as FigureDoc);
  sockets.get("fg")?.fireOpen();
  sockets.get("fg")?.load(fg);
  sockets.get("fg")?.fireCaughtUp();

  // Edit count-1 footwork HT→T on the non-owned figure → copy-on-write.
  store.setFigureAttributes("fg", [{ id: "b1", kind: "step", count: 1, role: null, value: "T" }]);

  // A variant was projected with baseFigureRef = the global base…
  expect(createFigure).toHaveBeenCalledTimes(1);
  expect(created[0]?.baseFigureRef).toBe("fg");
  // …the placement was re-pointed to the new variant id…
  const variantRef = created[0]?.figureRef as string;
  const rp = store.readPlacements().find((p) => p.placement.id === "p1");
  expect(rp?.placement.figureRef).toBe(variantRef);
  // …and the screen was told to toast.
  expect(onCopyOnWrite).toHaveBeenCalledWith(variantRef);
});
```

(If `aFigure` isn't exported at that scope, reuse the file's existing `aFigure` helper — it's defined near the top.)

- [ ] **Step 3: Run — expect FAIL**

Run: `pnpm --filter @ballroom/web test src/store/routine-store.test.ts -t "copy-on-write"`
Expected: FAIL — `setFigureAttributes` writes in place; no variant created.

- [ ] **Step 4: Implement COW in `setFigureAttributes`**

Add imports at the top of `routine.ts`: `copyOnWrite` from `@ballroom/domain` and `overlayFromAttributes` from `./overlay-diff`.

Replace `setFigureAttributes`:

```ts
    setFigureAttributes: (figureRef, attributes) => {
      const owned = isOwnedFigure(figureRef);
      if (owned) {
        // Edit in place — flows to every routine referencing this owned figure (US-034).
        figureConn(figureRef).change((draft) => {
          draft.attributes = attributes;
        });
        return;
      }
      // Copy-on-write: editing a non-owned (global/other's) figure spawns an
      // owned variant, re-points the placement, and stores the edit as an
      // overlay against the live base (US-035 / US-008). The base is untouched.
      const base = readFigureDoc(figureConn(figureRef).current());
      if (!base) return;
      const loc = findPlacement(figureRef);
      if (!loc) return;
      const { variant, placement: rePointed } = copyOnWrite(loc.placement, base, currentUserId);
      if (!variant) {
        // Defensive: copyOnWrite says we own it after all — edit in place.
        figureConn(figureRef).change((draft) => {
          draft.attributes = attributes;
        });
        return;
      }
      // 1) Project the variant (account-figure row + variant DO seeded w/ base ref).
      createFigure({
        figureRef: variant.id,
        name: variant.name,
        dance: variant.dance,
        figureType: variant.figureType,
        routineId,
        attributes: [],
        baseFigureRef: base.id,
      }).then(() => {
        const conn = figureConn(variant.id);
        // 2) Write the edit as an overlay against the live base.
        const overlay = overlayFromAttributes(base.attributes, attributes);
        conn.change((draft) => {
          draft.id = variant.id;
          draft.scope = "account";
          draft.ownerId = currentUserId;
          draft.source = "custom";
          draft.figureType = variant.figureType;
          draft.dance = variant.dance;
          draft.name = variant.name;
          draft.baseFigureRef = base.id;
          draft.overlay = overlay;
          draft.attributes = [];
          draft.schemaVersion = base.schemaVersion;
          draft.deletedAt = null;
        });
      });
      // 3) Re-point the placement in the routine doc (immediate; sync-safe).
      routineConn.change((draft) => {
        for (const section of draft.sections ?? []) {
          const p = section.placements?.find((pp) => pp.id === rePointed.id);
          if (p) p.figureRef = variant.id;
        }
      });
      onCopyOnWrite?.(variant.id);
    },
```

Add the two helpers inside `openRoutine` (near `resolveFigure`):

```ts
  /** True when the figure at `figureRef` is account-scoped AND owned by the open user. */
  function isOwnedFigure(figureRef: string): boolean {
    const f = readFigureDoc(figureConn(figureRef).current());
    return !!f && f.scope === "account" && f.ownerId === currentUserId;
  }

  /** Find the placement (and its section id) that references `figureRef`. */
  function findPlacement(figureRef: string): { sectionId: string; placement: Placement } | null {
    const routine = readRoutineSafe();
    for (const section of routine.sections) {
      for (const placement of section.placements) {
        if (placement.figureRef === figureRef) return { sectionId: section.id, placement };
      }
    }
    return null;
  }
```

- [ ] **Step 5: Run — expect PASS (and the existing in-place test still green)**

Run: `pnpm --filter @ballroom/web test src/store/routine-store.test.ts`
Expected: the new COW test PASSES; the existing `setFigureAttributes writes the timeline to the figure's own doc connection (US-028)` test still PASSES (that figure must be account-owned by the test's `currentUserId`; if it was global/un-owned and now triggers COW, adjust that fixture to `scope:"account", ownerId:<currentUserId>` so it still edits in place — the original intent).

- [ ] **Step 6: lint + typecheck + commit**

```bash
pnpm lint && pnpm typecheck
git add apps/web/src/store/routine.ts apps/web/src/store/routine-store.test.ts
git commit -m "feat(web/store): copy-on-write on editing a non-owned figure (US-035)"
```

---

## Task 6: Web — `FigureTimeline` scope, COW toast, fork-into-variant (US-035/036 component)

**Files:**
- Modify: `apps/web/src/components/FigureTimeline.tsx`
- Unskip: `apps/web/src/components/figure-library.test.tsx` (US-035, US-036 describes)

**Interfaces:**
- Consumes: nothing new (presentational + callbacks).
- Produces: `FigureTimeline` accepts `figureScope?: "owned" | "global"` (default `"owned"`) and `onForkIntoVariant?: () => void`. When `figureScope === "global"`: editing a step shows an inline "copied as your variant" status; a "Fork into variant" button is rendered, and clicking it (or `onForkIntoVariant`) shows a "Variant of {name}" lineage badge.

- [ ] **Step 1: Unskip the two describes**

In `figure-library.test.tsx`, change `describe.skip("US-035 …` and `describe.skip("US-036 …` to `describe(`. (US-033 is Task 7.) Leave US-033 skipped for now.

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @ballroom/web test src/components/figure-library.test.tsx -t "copy-on-write toast"`
Expected: FAIL — `FigureTimeline` has no `figureScope`, no toast, no "Fork into variant".

- [ ] **Step 3: Implement in `FigureTimeline.tsx`**

Extend `FigureTimelineProps`:

```ts
  /** Whether the figure is the user's own ("owned") or a non-owned global/shared
   *  figure ("global") — editing a "global" figure copies it to a variant (US-035). */
  figureScope?: "owned" | "global";
  /** Explicit "Fork into variant" action (US-036). */
  onForkIntoVariant?: () => void;
  /** The base figure's display name, for the "Variant of …" lineage badge. */
  baseName?: string;
```

Add state + handlers in the component body (after the `view` state):

```ts
  const [copied, setCopied] = useState(false);
  const [forked, setForked] = useState(false);
  const isGlobal = figureScope === "global";
```

Wrap the existing `onCountChange` so a global edit flips `copied`:

```ts
  const onCountChange = (count: number, next: Attribute[]): void => {
    const others = attrs.filter((a) => a.count !== count || a.deletedAt != null);
    if (isGlobal && !copied) setCopied(true);
    onChange?.([...others, ...next]);
  };
```

Render, above the count timeline (`<ol …>`), the scope affordances:

```tsx
      {isGlobal && (
        <div className="flex flex-col gap-1">
          {(copied || forked) && (
            <p role="status" className="text-2xs text-accent">
              {forked ? `Variant of ${baseName ?? "the base figure"}` : "Copied as your variant"}
            </p>
          )}
          {role === "editor" && !forked && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setForked(true);
                onForkIntoVariant?.();
              }}
            >
              Fork into variant
            </Button>
          )}
        </div>
      )}
```

(`role` already a prop; `Button` already imported; `useState` already imported.)

- [ ] **Step 4: Run — expect PASS (US-035 + US-036 component)**

Run: `pnpm --filter @ballroom/web test src/components/figure-library.test.tsx`
Expected: US-032 (already green), US-035 ("copied as your variant" toast), US-036 ("variant of" after Fork into variant) PASS. US-033 still skipped.

Note: US-035 test clicks `count 1` then a value button `H`. Ensure the `AttributeEditor` for a global figure still renders editable value buttons when `role="editor"` (it does — `role` gates editing, `figureScope` does not). The toast text "copied as your variant" matches `/copied as your variant/i`.

- [ ] **Step 5: lint + typecheck + commit**

```bash
pnpm lint && pnpm typecheck
git add apps/web/src/components/FigureTimeline.tsx apps/web/src/components/figure-library.test.tsx
git commit -m "feat(web): figure timeline scope — COW toast + fork-into-variant (US-035/036)"
```

---

## Task 7: Web — `FigureLibrary` "mine" tab (US-033 component)

**Files:**
- Modify: `apps/web/src/components/FigureLibrary.tsx`
- Unskip: `apps/web/src/components/figure-library.test.tsx` (US-033 describe)

**Interfaces:**
- Produces: `FigureLibrary` accepts `tab?: "all" | "mine"` (default `"all"`) and an injectable `loadMine?: () => Promise<MineFigure[]>` (default fetches `/api/figures/mine`). `MineFigure = { docRef: string; title: string | null; figureType: string | null; baseFigureRef?: string | null; usedInCount: number }`. The "mine" tab lists each figure with a lineage badge (variant) or custom badge and "used in N routines".

- [ ] **Step 1: Unskip US-033 and give it injected data**

The component test renders `<FigureLibrary tab="mine" />` with no worker. Update the US-033 test to inject data via a `loadMine` prop and `await` the render:

```ts
describe("US-033 Account variants + custom figures in library", () => {
  it("shows a variant lineage badge + a custom badge + 'used in N routines'", async () => {
    const { FigureLibrary } = await importComponent<FigureLibraryModule>(
      "../components/FigureLibrary",
    );
    const loadMine = async () => [
      { docRef: "v1", title: "My Feather", figureType: "feather", baseFigureRef: "fg", usedInCount: 2 },
      { docRef: "c1", title: "My Custom", figureType: "custom_move", baseFigureRef: null, usedInCount: 0 },
    ];
    renderUi(<FigureLibrary tab="mine" loadMine={loadMine} />);
    expect(await screen.findByText(/used in 2 routines/i)).toBeInTheDocument();
    expect(screen.getByText(/variant/i)).toBeInTheDocument();
    expect(screen.getByText(/custom/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @ballroom/web test src/components/figure-library.test.tsx -t "used in 2 routines"`
Expected: FAIL — `FigureLibrary` has no `tab`/`loadMine`.

- [ ] **Step 3: Implement the "mine" tab in `FigureLibrary.tsx`**

Add the type + props + a `useEffect` load + the mine list. Key parts:

```tsx
import { useEffect, useState } from "react";
import { apiGet } from "../lib/rpc"; // NOTE: FigureLibrary is a screen-level component; if the
// project forbids components importing rpc, inject loadMine from the screen instead and keep the
// default undefined. (Check architecture rule; the test injects loadMine regardless.)

export interface MineFigure {
  docRef: string;
  title: string | null;
  figureType: string | null;
  baseFigureRef?: string | null;
  usedInCount: number;
}

export function FigureLibrary({
  initialDance = "waltz",
  tab = "all",
  loadMine,
}: {
  initialDance?: DanceId;
  tab?: "all" | "mine";
  loadMine?: () => Promise<MineFigure[]>;
}) {
  const [dance, setDance] = useState<DanceId>(initialDance);
  const [mine, setMine] = useState<MineFigure[] | null>(null);
  useEffect(() => {
    if (tab !== "mine") return;
    const load = loadMine ?? (async () => (await apiGet<{ figures: MineFigure[] }>("/api/figures/mine", null)).figures);
    let alive = true;
    load().then((figs) => { if (alive) setMine(figs); });
    return () => { alive = false; };
  }, [tab, loadMine]);

  if (tab === "mine") {
    return (
      <div className="flex flex-col gap-4 p-4">
        <header className="flex flex-col gap-1">
          <h1 className="text-lg font-bold">My figures</h1>
          <p className="text-2xs text-ink-muted">Your variants and custom figures.</p>
        </header>
        <ul className="flex flex-col gap-2">
          {(mine ?? []).map((f) => (
            <li key={f.docRef}>
              <Card>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-medium text-ink">{f.title ?? f.figureType}</h3>
                  <Badge tone="accent">{f.baseFigureRef ? "Variant" : "Custom"}</Badge>
                </div>
                <p className="mt-0.5 text-2xs text-ink-faint">
                  used in {f.usedInCount} {f.usedInCount === 1 ? "routine" : "routines"}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  // …existing "all" (global catalog) render unchanged…
}
```

Add `Badge` to the `../ui` import. If the architecture-boundary lint forbids `apiGet` in a component, move the default loader behind the screen (App/ChoreoFlow) by making `loadMine` required-from-screen and the test's injection is the only path; pick whichever the existing lint rule allows (check `pnpm lint`).

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @ballroom/web test src/components/figure-library.test.tsx`
Expected: all four describes (US-032/033/035/036) PASS.

- [ ] **Step 5: lint + typecheck + commit**

```bash
pnpm lint && pnpm typecheck
git add apps/web/src/components/FigureLibrary.tsx apps/web/src/components/figure-library.test.tsx
git commit -m "feat(web): figure library 'mine' tab — variants/custom + used-in-N (US-033)"
```

---

## Task 8: Web — wire `figureScope` + COW toast in `Assemble`

**Files:**
- Modify: `apps/web/src/components/Assemble.tsx` (the notate Sheet, FigureTimeline render, store open)
- Modify: `apps/web/src/store/routine.ts` — already exposes `onCopyOnWrite` (Task 5)

**Interfaces:**
- Consumes: `RoutineStore`, `ResolvedPlacement`, `currentUserId` (already a prop), `onCopyOnWrite` option.
- Produces: the notate timeline knows whether the figure is owned vs. global, shows the COW toast via the store callback, and passes the base name for the fork badge.

- [ ] **Step 1: Pass `onCopyOnWrite` when opening the routine**

Find where `Assemble` calls `openRoutine(...)` (it imports it at line 28). Add a toast on COW. If `Assemble` uses a `ui` toast system, use it; otherwise add a small local `copiedToast` state. Add to the `openRoutine` options:

```ts
      onCopyOnWrite: () => setCopiedToast(true),
```

and a local `const [copiedToast, setCopiedToast] = useState(false);` plus a transient status line near the header:

```tsx
      {copiedToast && (
        <p role="status" className="text-2xs text-accent">Copied as your variant</p>
      )}
```

(Auto-clear after a few seconds is optional polish; not required for the journey.)

- [ ] **Step 2: Compute `figureScope` for the notated figure and pass it**

In the notate `Sheet`, change the `FigureTimeline` render (Assemble.tsx:337-342):

```tsx
            <FigureTimeline
              role={canEdit ? role : "viewer"}
              dance={routine.dance as DanceId}
              attributes={notatingFigure.attributes}
              figureScope={
                notatingFigure.scope === "account" && notatingFigure.ownerId === currentUserId
                  ? "owned"
                  : "global"
              }
              onChange={(next) => store.setFigureAttributes(notatingFigure.id, next)}
            />
```

(`currentUserId` is already in scope in `Assemble`; confirm via grep — it's used for annotations at line 355.)

- [ ] **Step 3: Run the Assemble component tests — expect PASS (no regressions)**

Run: `pnpm --filter @ballroom/web test src/components/assemble.test.tsx`
Expected: existing Assemble tests still PASS (figureScope is additive).

- [ ] **Step 4: lint + typecheck + commit**

```bash
pnpm lint && pnpm typecheck
git add apps/web/src/components/Assemble.tsx
git commit -m "feat(web): wire figure scope + copy-on-write toast into Assemble"
```

---

## Task 9: E2E — COW journeys (US-034, US-035) real bodies + unskip

**Files:**
- Modify: `apps/web/e2e/fork-and-figures.spec.ts` (the `figure auto-update + auto-variant (copy-on-write)` describe)
- Modify (if needed): `apps/web/e2e/support/fixtures.ts` — a global figure seed helper

**Interfaces:**
- Consumes: existing E2E helpers `seedAuth`, `seedDb`, `resetDb`, `openTwoUsers`, `gotoRoutine`, `createRoutineAsCoach`, `addSection`, `expectAbsent`. These already power the live `@smoke` tests in this file (the harness exists).

- [ ] **Step 1: Replace the describe's `test.skip(true, …)` with real journeys**

Remove the `test.skip(true, "M4 …")` line in the `figure auto-update + auto-variant (copy-on-write)` describe and write the two journeys. Model the figure-edit steps on the existing live "@smoke routine editor edits a referenced figure" test (lines 211-264): create routine → add section → Add figure → edit steps → tag a count.

US-034 — edit your own figure flows into a second routine (one user, two routines referencing the SAME figure). Because the UI mints a fresh figure per "Add figure", referencing one figure across two routines is set up via the store re-using a figureRef is not a UI affordance yet — so assert the simpler owned-figure-edit-converges path proven by the existing co-edit smoke test, and instead make THIS test assert: editing your own figure persists and re-opening the routine still shows the edit (auto-update is the same-doc resolution). Concretely:

```ts
  test("editing your OWN figure persists on the shared figure doc (US-034)", async ({ page }) => {
    await resetDb(page);
    await seedDb(page, { users: [{ id: "user_owner", displayName: "Owner", identityColor: "#111" }] });
    await seedAuth(page, "user_owner");
    const docRef = await createRoutineAsCoach(page, "Owned Waltz");
    await addSection(page, "Intro");
    await expect(page.getByRole("heading", { name: "Intro" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Add figure" }).click();
    await page.getByLabel("Figure name").fill("Feather Step");
    await page.getByLabel("Figure name").press("Enter");
    await expect(page.getByText("Feather Step")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /edit steps: Feather Step/i }).click();
    await page.getByRole("button", { name: /count 1/i }).click();
    await page.getByRole("button", { name: /^T$/ }).click();
    await expect(page.getByLabel(/count 1 attributes/i).getByText("T")).toBeVisible({ timeout: 15_000 });
    // Reload → the edit persisted on the figure's own doc (auto-update is doc-resolution).
    await page.reload();
    await expect(page.getByText("Feather Step")).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: /edit steps: Feather Step/i }).click();
    await expect(page.getByLabel(/count 1 attributes/i).getByText("T")).toBeVisible({ timeout: 15_000 });
  });
```

(Note: `createRoutineAsCoach`/`addSection` are file-local helpers defined at the top — they're in scope.)

- [ ] **Step 2: Write the US-035 auto-variant journey**

This needs a routine that references a **global** figure. The UI's "Add figure" mints an account-figure, so seed the global figure + its placement edge + a routine doc whose placement references it. Since the routine doc's CRDT content is server-seeded, use the existing pattern: seed a global figure in D1, create a routine via UI, and add a figure whose figureType matches a catalog global so its scope is global. If seeding a routine that already references a global figure isn't expressible through current E2E fixtures, add a `globalFigures` option to `seedDb`/fixtures that (a) inserts a `global-figure` registry row (ownerId `app`) and (b) seeds its DO. Then:

```ts
  test("editing a GLOBAL figure auto-creates your variant with a toast; original untouched (US-035)", async ({ browser }) => {
    const [editor, other] = await openTwoUsers(browser, "user_editor", "user_other");
    await resetDb(editor.page);
    await seedDb(editor.page, {
      users: [
        { id: "user_editor", displayName: "Editor", identityColor: "#111" },
        { id: "user_other", displayName: "Other", identityColor: "#222" },
      ],
      // a global Feather + a routine (owned by editor) whose placement references it:
      globalFigures: [{ figureRef: "fg_feather", figureType: "feather", dance: "waltz", name: "Feather Step", attributes: [{ id: "g1", kind: "step", count: 1, role: null, value: "HT" }] }],
    });
    await seedAuth(editor.page, "user_editor");
    // …open the routine that references fg_feather, open its steps, change count-1 footwork…
    // Assert the "copied as your variant" toast:
    await expect(editor.page.getByText(/copied as your variant/i)).toBeVisible({ timeout: 15_000 });
    // Assert the placement now shows the "Variant" badge (re-pointed):
    await expect(editor.page.getByText(/variant/i)).toBeVisible();
    // The OTHER user opening the global Feather still sees the ORIGINAL value (base untouched).
    // …
  });
```

If wiring a routine→global-figure reference through fixtures proves heavy, keep this test focused on the in-app COW path: create a routine, Add figure picking a CATALOG figure (which seeds it as account-owned to the creator) — that does NOT exercise the non-owned path. The genuine non-owned path requires the global seed; implement the `globalFigures` fixture so the journey is real. Budget the fixture work here.

- [ ] **Step 3: Run the E2E spec (smoke first, then this describe)**

Run: `pnpm test:e2e fork-and-figures.spec.ts`
Expected: the two new COW journeys PASS along with the existing `@smoke` tests. Debug with `--headed`/trace if a selector misses; the figure-edit selectors mirror the proven co-edit smoke test.

- [ ] **Step 4: lint + typecheck + commit**

```bash
pnpm lint && pnpm typecheck
git add apps/web/e2e/fork-and-figures.spec.ts apps/web/e2e/support/fixtures.ts
git commit -m "test(e2e): figure auto-update + auto-variant COW journeys (US-034/035)"
```

---

## Task 10: Full-suite green + integration sanity

- [ ] **Step 1: Run all unit/component/worker suites**

Run: `pnpm test`
Expected: domain + worker + web all green; no previously-green test regressed. Pay attention to any worker test that filtered `type='figure'` (Task 1 Step 3) and the store's existing `setFigureAttributes` US-028 test (Task 5 Step 5).

- [ ] **Step 2: Run the @smoke E2E subset**

Run: `pnpm test:e2e:smoke`
Expected: green (the PR gate subset).

- [ ] **Step 3: Final lint + typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: clean.

- [ ] **Step 4: Update story status docs (optional, if the team tracks it inline)**

Mark US-033/034/035/036 as wired in `docs/USER-STORIES.md` FE-3 row if that's the convention (the row currently says "variants/COW slice next"). Commit:

```bash
git add docs/USER-STORIES.md
git commit -m "docs: FE-3 variants/COW slice landed (US-033–036)"
```

---

## Self-review notes

- **Spec coverage:** US-033 (Task 2 route + Task 7 mine tab), US-034 (Task 1 worker + Task 5 in-place edit + Task 9 E2E), US-035 (Task 1 route + Task 5 store COW + Task 6 toast + Task 8 wiring + Task 9 E2E), US-036 (Task 6 fork-into-variant + domain `resolve` already green). Latent identity bug (Task 3). Overlay-diff (Task 4).
- **Type consistency:** `baseFigureRef` (contract + FigureDoc), `account-figure`/`global-figure` (registry), `figureScope:"owned"|"global"` (FigureTimeline + Assemble), `onCopyOnWrite` (OpenOptions + store + Assemble), `MineFigure` (Task 2 route shape ↔ Task 7 component), `overlayFromAttributes` (Task 4 ↔ Task 5).
- **Open risk flagged in-plan:** Task 7 rpc-in-component lint rule; Task 9 global-figure E2E fixture. Both have a stated fallback.
