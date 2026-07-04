# Default Golden Waltz Basic Starter Routine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a new user's first onboarding, seed them an editable "Golden Waltz Basic" routine (6 waltz figures with their library step timelines) so they land on a populated app.

**Architecture:** A pure domain builder (`buildGoldenWaltzBasic`) materializes a `RoutineDoc` + 6 `FigureDoc`s from `LIBRARY_FIGURES`; a worker helper (`seedStarterRoutine`) projects + server-seeds them with the existing routine/figure primitives; the `POST /api/onboarding` route calls it once, on genuine first onboarding, best-effort.

**Tech Stack:** TypeScript (strict), Vitest, pnpm monorepo, Hono + Drizzle (worker), Cloudflare Durable Objects, Automerge.

## Global Constraints

- TDD: write the failing test first, watch it fail, then implement. One commit per task.
- The domain builder is PURE — no `Date.now()` / `Math.random()`; id minting is injected via a `mintId: () => string` parameter. Figure step data is COPIED from `LIBRARY_FIGURES`, never invented.
- Figures are separate DO docs referenced by `figureRef`; a routine's placement carries a `figureRef`. Figures must be created + seeded BEFORE the routine.
- The starter counts as the user's first owned routine (no quota special-casing); onboarding runs no quota gate.
- Seed at most once per user — gate on the genuine first `users`-row insert (re-onboarding must NOT re-seed). Seeding is best-effort: a failure is logged and swallowed so onboarding still returns 200.
- Worktree workflow: run gates EXPLICITLY (`pnpm -w lint`, `pnpm -w typecheck`, and the package-scoped test). The lefthook pre-commit hook runs biome + typecheck here. Never `--no-verify`; never pipe `git commit` through grep.
- Package filters: domain = `@ballroom/domain`, worker = `worker`.

## Exact signatures this plan builds on (verbatim from the codebase)

- `newId(): string` — from `@ballroom/domain` (ULID; the worker passes this as `mintId`).
- `RoutineDoc` / `FigureDoc` / `Section` / `Placement` / `Attribute` — `packages/domain/src/doc-types.ts`.
- `LIBRARY_FIGURES: readonly LibraryFigure[]` — `@ballroom/domain`; `LibraryFigure = { dance, figureType, name, timing?, notes?, attributes? }`.
- `createOwnedRoutine(db: D1Database, r: { docRef; ownerId; title; dance; forkedFromRef? }): Promise<void>` — `apps/worker/src/db/routines.ts`.
- `createFigureRows(db: D1Database, f: { figureRef; ownerId; name; dance; figureType }): Promise<void>` — `apps/worker/src/db/figures.ts`.
- `linkPlacement(db: D1Database, routineRef: string, figureRef: string): Promise<void>` — `apps/worker/src/db/placement-edge.ts`.
- `env.DOC_DO.get(env.DOC_DO.idFromName(id)).seedDoc(content: Record<string, unknown>): Promise<void>` — no-clobber server seed (`apps/worker/src/doc-do.ts:177`).

---

### Task 1: Domain builder `buildGoldenWaltzBasic`

**Files:**
- Create: `packages/domain/src/starter-routine.ts`
- Create: `packages/domain/src/starter-routine.test.ts`
- Modify: `packages/domain/src/index.ts` (export)

**Interfaces:**
- Consumes: `LIBRARY_FIGURES` from `./library`; `RoutineDoc`, `FigureDoc` from `./doc-types`; `DanceId` from `./dances`.
- Produces: `buildGoldenWaltzBasic(ownerId: string, mintId: () => string): { routine: RoutineDoc; figures: FigureDoc[]; missing: string[] }` — `missing` lists any figureTypes not found in the library (never invents data).

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/starter-routine.test.ts
import { describe, expect, it } from "vitest";
import { LIBRARY_FIGURES } from "./library";
import { buildGoldenWaltzBasic } from "./starter-routine";

const seq = () => {
  let n = 0;
  return () => `id_${++n}`;
};

describe("buildGoldenWaltzBasic", () => {
  it("builds one waltz routine with a single Basic section of 6 placements", () => {
    const { routine, missing } = buildGoldenWaltzBasic("u_1", seq());
    expect(missing).toEqual([]);
    expect(routine.title).toBe("Golden Waltz Basic");
    expect(routine.dance).toBe("waltz");
    expect(routine.ownerId).toBe("u_1");
    expect(routine.sections).toHaveLength(1);
    expect(routine.sections[0].name).toBe("Basic");
    expect(routine.sections[0].placements).toHaveLength(6);
    expect(routine.annotations).toEqual([]);
    expect(routine.schemaVersion).toBe(1);
  });

  it("creates 6 owned waltz figures in the listed order, each with library attributes", () => {
    const { routine, figures } = buildGoldenWaltzBasic("u_1", seq());
    const order = [
      "closed-change-on-rf",
      "natural-turn",
      "closed-change-on-lf",
      "reverse-turn",
      "whisk",
      "chasse-from-pp",
    ];
    expect(figures.map((f) => f.figureType)).toEqual(order);
    for (const f of figures) {
      expect(f.dance).toBe("waltz");
      expect(f.ownerId).toBe("u_1");
      expect(f.scope).toBe("account");
      expect(f.source).toBe("custom");
      // attributes copied verbatim from the library entry
      const lib = LIBRARY_FIGURES.find((l) => l.dance === "waltz" && l.figureType === f.figureType);
      expect(f.attributes).toEqual(lib?.attributes ?? []);
      expect(f.attributes.length).toBeGreaterThan(0);
      // the library's own (canonical) name is used, not a hardcoded one
      expect(f.name).toBe(lib?.name);
    }
  });

  it("links each placement to its figure by figureRef, with all ids distinct", () => {
    const { routine, figures } = buildGoldenWaltzBasic("u_1", seq());
    const placementRefs = routine.sections[0].placements.map((p) => p.figureRef);
    expect(placementRefs).toEqual(figures.map((f) => f.id));
    const allIds = [
      routine.id,
      routine.sections[0].id,
      ...routine.sections[0].placements.map((p) => p.id),
      ...figures.map((f) => f.id),
    ];
    expect(new Set(allIds).size).toBe(allIds.length); // no collisions
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @ballroom/domain exec vitest run starter-routine`
Expected: FAIL — "Cannot find module './starter-routine'".

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/domain/src/starter-routine.ts
// US-055 — the default "Golden Waltz Basic" starter routine seeded for every new
// user on first onboarding. A PURE builder: it materializes a fresh, owned,
// editable RoutineDoc + its referenced FigureDocs, copying each figure's step
// timeline verbatim from the shipped library catalog (LIBRARY_FIGURES) so the
// starter matches what a user would get by picking the same figures themselves.
// Id minting is injected so this stays deterministic and side-effect-free; the
// worker passes `newId`. Figures are separate docs (figureRef) — created and
// seeded before the routine by the caller.
import type { DanceId } from "./dances";
import type { Attribute, FigureDoc, RoutineDoc } from "./doc-types";
import { LIBRARY_FIGURES } from "./library";

/** The starter's figures, in choreography order, by their canonical figureType. */
const GOLDEN_WALTZ_BASIC: readonly string[] = [
  "closed-change-on-rf",
  "natural-turn",
  "closed-change-on-lf",
  "reverse-turn",
  "whisk",
  "chasse-from-pp",
];

const WALTZ: DanceId = "waltz";

/**
 * Build the "Golden Waltz Basic" starter: one waltz routine (a single "Basic"
 * section) plus the FigureDocs its placements reference. Each figure is an owned
 * account-scoped doc carrying the library figure's canonical name + step
 * attributes. `missing` reports any figureType absent from the library (so the
 * caller can log it) — such a figure is skipped, never fabricated.
 */
export function buildGoldenWaltzBasic(
  ownerId: string,
  mintId: () => string,
): { routine: RoutineDoc; figures: FigureDoc[]; missing: string[] } {
  const figures: FigureDoc[] = [];
  const missing: string[] = [];

  for (const figureType of GOLDEN_WALTZ_BASIC) {
    const lib = LIBRARY_FIGURES.find((l) => l.dance === WALTZ && l.figureType === figureType);
    if (!lib) {
      missing.push(figureType);
      continue;
    }
    figures.push({
      id: mintId(),
      scope: "account",
      ownerId,
      figureType,
      dance: WALTZ,
      name: lib.name,
      source: "custom",
      attributes: (lib.attributes ?? []) as Attribute[],
      schemaVersion: 1,
      deletedAt: null,
    });
  }

  const routine: RoutineDoc = {
    id: mintId(),
    title: "Golden Waltz Basic",
    dance: WALTZ,
    ownerId,
    sections: [
      {
        id: mintId(),
        name: "Basic",
        placements: figures.map((f) => ({ id: mintId(), figureRef: f.id, deletedAt: null })),
        deletedAt: null,
      },
    ],
    annotations: [],
    schemaVersion: 1,
    deletedAt: null,
  };

  return { routine, figures, missing };
}
```

- [ ] **Step 4: Export from the domain barrel**

In `packages/domain/src/index.ts`, add (alphabetical with neighbors):

```ts
export { buildGoldenWaltzBasic } from "./starter-routine";
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @ballroom/domain exec vitest run starter-routine` then `pnpm -w typecheck`
Expected: 3 tests PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/domain/src/starter-routine.ts packages/domain/src/starter-routine.test.ts packages/domain/src/index.ts
git commit -m "feat(domain): build the Golden Waltz Basic starter routine from the library"
```

---

### Task 2: Worker `seedStarterRoutine`

**Files:**
- Create: `apps/worker/src/starter.ts`
- Create: `apps/worker/src/starter.test.ts`

**Interfaces:**
- Consumes: `buildGoldenWaltzBasic`, `newId` from `@ballroom/domain`; `createOwnedRoutine` (`./db/routines`); `createFigureRows` (`./db/figures`); `linkPlacement` (`./db/placement-edge`); `Env` (`./index`).
- Produces: `seedStarterRoutine(env: Env, userId: string): Promise<string>` — seeds the starter, returns the new routine's id.

- [ ] **Step 1: Write the failing test**

```ts
// apps/worker/src/starter.test.ts
// Verifies the starter seeder projects the routine + its 6 figures and seeds the
// routine DO with content. Uses the workerd test harness like figures.test.ts.
import * as A from "@automerge/automerge";
import { env, runInDurableObject } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { seedStarterRoutine } from "./starter";
import { applyMigrations } from "./test-support/seed";

describe("seedStarterRoutine", () => {
  beforeEach(async () => {
    await applyMigrations();
  });

  it("projects the routine + 6 figures and seeds the routine DO content", async () => {
    const routineId = await seedStarterRoutine(env, "u_starter");

    // The routine is an owned registry row (counts as the user's routine).
    const routineRow = await env.DB.prepare(
      "SELECT type, ownerId, title, dance FROM document_registry WHERE docRef = ?",
    )
      .bind(routineId)
      .first<{ type: string; ownerId: string; title: string; dance: string }>();
    expect(routineRow).toMatchObject({
      type: "routine",
      ownerId: "u_starter",
      title: "Golden Waltz Basic",
      dance: "waltz",
    });

    // 6 figure rows projected + 6 placement edges linked.
    const figureCount = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM document_registry WHERE type = 'figure' AND ownerId = ?",
    )
      .bind("u_starter")
      .first<{ n: number }>();
    expect(figureCount?.n).toBe(6);
    const edgeCount = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM placement_edge WHERE routineRef = ?",
    )
      .bind(routineId)
      .first<{ n: number }>();
    expect(edgeCount?.n).toBe(6);

    // The routine DO is seeded with the section + 6 placements.
    const stub = env.DOC_DO.get(env.DOC_DO.idFromName(routineId));
    const placements = await runInDurableObject(
      stub as unknown as DurableObjectStub<import("./doc-do").DocDO>,
      async (instance) => {
        const doState = (instance as unknown as { ctx: DurableObjectState }).ctx;
        const rows = doState.storage.sql
          .exec("SELECT data FROM changes ORDER BY seq")
          .toArray() as Array<{ data: ArrayBuffer }>;
        if (rows.length === 0) return -1;
        let doc = A.init<Record<string, unknown>>();
        const changes = rows.map((r) => new Uint8Array(r.data) as A.Change);
        [doc] = A.applyChanges(doc, changes);
        const plain = A.toJS(doc) as { sections?: Array<{ placements?: unknown[] }> };
        return plain.sections?.[0]?.placements?.length ?? -1;
      },
    );
    expect(placements).toBe(6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter worker exec vitest run starter`
Expected: FAIL — "Cannot find module './starter'".

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/worker/src/starter.ts
// US-055 — seed the default "Golden Waltz Basic" starter routine for a user.
// Materializes the routine + its figures via the pure domain builder, then
// projects + server-seeds them with the same primitives the /api/figures and
// /api/routines routes use. Figures are projected + DO-seeded FIRST (so the
// routine's references + cascade edges resolve), then the routine. `seedDoc` is
// no-clobber, so a re-run on the same ids is safe.
import { buildGoldenWaltzBasic, newId } from "@ballroom/domain";
import { createFigureRows } from "./db/figures";
import { linkPlacement } from "./db/placement-edge";
import { createOwnedRoutine } from "./db/routines";
import type { Env } from "./index";

/** Seed the starter routine for `userId`; returns the new routine's id. */
export async function seedStarterRoutine(env: Env, userId: string): Promise<string> {
  const { routine, figures } = buildGoldenWaltzBasic(userId, newId);

  for (const figure of figures) {
    await createFigureRows(env.DB, {
      figureRef: figure.id,
      ownerId: userId,
      name: figure.name,
      dance: figure.dance,
      figureType: figure.figureType,
    });
    await env.DOC_DO.get(env.DOC_DO.idFromName(figure.id)).seedDoc(
      figure as unknown as Record<string, unknown>,
    );
    await linkPlacement(env.DB, routine.id, figure.id);
  }

  await createOwnedRoutine(env.DB, {
    docRef: routine.id,
    ownerId: userId,
    title: routine.title,
    dance: routine.dance,
  });
  await env.DOC_DO.get(env.DOC_DO.idFromName(routine.id)).seedDoc(
    routine as unknown as Record<string, unknown>,
  );

  return routine.id;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter worker exec vitest run starter` then `pnpm -w typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/starter.ts apps/worker/src/starter.test.ts
git commit -m "feat(worker): seed the Golden Waltz Basic starter routine + its figures"
```

---

### Task 3: Trigger the starter on first onboarding

**Files:**
- Modify: `apps/worker/src/index.ts` (the `POST /api/onboarding` handler)
- Modify: `apps/worker/src/routes/me-profile.test.ts` (add starter-on-onboarding tests)

**Interfaces:**
- Consumes: `seedStarterRoutine` from `./starter`.
- Produces: onboarding seeds the starter exactly once, on the genuine first onboarding, best-effort.

- [ ] **Step 1: Write the failing test**

Add to `apps/worker/src/routes/me-profile.test.ts` (mirror the file's existing `authedContext` + `seedDb` + `SELF.fetch` pattern; import `seedDb` if not already imported):

```ts
it("seeds the Golden Waltz Basic starter on a user's FIRST onboarding", async () => {
  const ctx = await authedContext({ keypair: kp, userId: "u_new", docRef: "n/a", role: null });
  const res = await SELF.fetch("https://x/api/onboarding", {
    method: "POST",
    headers: { ...ctx.authHeaders(), "content-type": "application/json" },
    body: JSON.stringify({ displayName: "New", identityColor: "#abc" }),
  });
  expect(res.status).toBe(200);

  // The user now owns exactly one routine: the starter.
  const list = await SELF.fetch("https://x/api/routines", { headers: ctx.authHeaders() });
  const body = (await list.json()) as { routines: Array<{ title: string; dance: string }> };
  const owned = body.routines.filter((r) => r.title === "Golden Waltz Basic" && r.dance === "waltz");
  expect(owned).toHaveLength(1);
});

it("does NOT re-seed the starter on a repeat onboarding", async () => {
  const ctx = await authedContext({ keypair: kp, userId: "u_twice", docRef: "n/a", role: null });
  const post = () =>
    SELF.fetch("https://x/api/onboarding", {
      method: "POST",
      headers: { ...ctx.authHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Twice", identityColor: "#abc" }),
    });
  await post();
  await post(); // re-onboard / profile edit

  const list = await SELF.fetch("https://x/api/routines", { headers: ctx.authHeaders() });
  const body = (await list.json()) as { routines: Array<{ title: string }> };
  const starters = body.routines.filter((r) => r.title === "Golden Waltz Basic");
  expect(starters).toHaveLength(1); // seeded once, not twice
});
```

> Note for the implementer: confirm the shape of `GET /api/routines`' JSON (the key holding the list and each row's title field) by reading the existing `quota.test.ts` assertions, and adjust the destructuring above to match the real response shape before running.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter worker exec vitest run me-profile`
Expected: FAIL — no "Golden Waltz Basic" routine after onboarding.

- [ ] **Step 3: Wire the trigger into the onboarding route**

In `apps/worker/src/index.ts`, add the import near the other local imports:

```ts
import { seedStarterRoutine } from "./starter";
```

Replace the upsert + return block of the `POST /api/onboarding` handler with a first-run-detecting version:

```ts
  const db = drizzle(c.env.DB);
  // Detect a genuine first onboarding (no prior users row) so the starter routine
  // is seeded at most once — a re-onboard / profile edit hits the update path.
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.id, user.sub)).get();
  const firstRun = !existing;

  await db
    .insert(users)
    .values({ id: user.sub, displayName, identityColor, plan: "free", createdAt: Date.now() })
    .onConflictDoUpdate({ target: users.id, set: { displayName, identityColor } });

  if (firstRun) {
    // Best-effort: a new user gets a default "Golden Waltz Basic" routine (US-055).
    // Never fail onboarding if the gift can't be seeded — the account must succeed.
    try {
      await seedStarterRoutine(c.env, user.sub);
    } catch (err) {
      console.error("starter routine seed failed", { userId: user.sub, err });
    }
  }

  return c.json({ sub: user.sub, displayName, identityColor, plan: "free" });
```

(`eq` and `users` are already imported in `index.ts`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter worker exec vitest run me-profile` then the full worker suite once: `pnpm --filter worker exec vitest run`
Expected: the two new tests PASS; no regression in the existing onboarding/quota tests.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/index.ts apps/worker/src/routes/me-profile.test.ts
git commit -m "feat(worker): seed the starter routine on a user's first onboarding (US-055)"
```

---

### Task 4: Full gates + push + PR

**Files:** none (verification only).

- [ ] **Step 1: Run the full gates**

Run: `pnpm -w lint && pnpm -w typecheck && pnpm -w test`
Expected: all green (domain starter-routine tests, worker starter + onboarding tests included).

- [ ] **Step 2: Push the branch**

```bash
git push -u origin story/default-starter-routine:story/default-starter-routine
```

- [ ] **Step 3: Open the PR** (target `development`)

```bash
gh pr create --base development --head story/default-starter-routine \
  --title "feat: seed a default Golden Waltz Basic routine for new users (US-055)" \
  --body "$(cat <<'BODY'
On a new user's first onboarding, seeds an editable **Golden Waltz Basic** routine (6 waltz figures — Closed Change RF, Natural Turn, Closed Change LF, Reverse Turn, Whisk, Chassé from PP — each carrying its WDSF step timeline from the library), so they land on a populated app instead of an empty one.

- `buildGoldenWaltzBasic` (packages/domain) — pure builder, materializes the routine + figures from `LIBRARY_FIGURES`.
- `seedStarterRoutine` (apps/worker) — projects + server-seeds them via the existing routine/figure primitives.
- `POST /api/onboarding` — seeds once, on genuine first onboarding, best-effort (never fails onboarding).

Counts as the user's first owned routine (1 of 3). Implements US-055.

Design: docs/superpowers/specs/2026-06-27-default-starter-routine-design.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

---

## Self-Review

**Spec coverage:**
- "6-figure Golden Waltz Basic, in order, with library step data" → Task 1 (builder + tests). ✓
- "materialize-direct, owned account figures, source custom" → Task 1. ✓
- "worker seeds via existing primitives, figures before routine" → Task 2. ✓
- "trigger on first onboarding only, best-effort, counts as first routine" → Task 3. ✓
- Tests: domain builder, worker seeder, onboarding-once + no-duplicate → Tasks 1–3. ✓

**Placeholder scan:** No TBD/TODO; every code step shows real code. The two implementer notes (confirm `GET /api/routines` response shape; mirror existing test harness) point at concrete existing files rather than reproducing suite-private helpers — intentional. ✓

**Type consistency:** `buildGoldenWaltzBasic(ownerId, mintId) → { routine, figures, missing }` is defined in Task 1 and consumed in Task 2; `seedStarterRoutine(env, userId) → Promise<string>` defined in Task 2, consumed in Task 3. `createOwnedRoutine`/`createFigureRows`/`linkPlacement`/`seedDoc` signatures match the verbatim block above. FigureDoc/RoutineDoc fields match `doc-types.ts`. ✓
