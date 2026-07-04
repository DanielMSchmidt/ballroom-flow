# FE-7 — Custom kinds / Lanes / Search / Start-from-template — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship US-043–046 (custom attribute kinds, Lanes, search, sample/start-from-template) as one E2E-verified M7 feature.

**Architecture:** Custom kinds are stored on the account doc (source of truth) and embedded into routine docs that use them; the editor/lanes render off `mergeRegistry`. Search is a prefix query over the D1 `document_registry` scoped to the caller's reachable docs (indexed → no SCAN). The sample routine is an app-owned, read-only seed; start-from-template (and the onboarding gift) fork it via the existing quota-checked fork endpoint.

**Tech Stack:** TypeScript (strict, no `any`), pnpm workspaces, React + Vite + Testing Library + vitest, Cloudflare Workers + Hono + Durable Objects + D1 (Drizzle + raw SQL migrations), Automerge CRDT, Playwright (`@smoke` subset on PR).

**Spec:** `docs/superpowers/specs/2026-06-27-fe7-custom-kinds-lanes-search-template-design.md`

## Global Constraints

- TDD: RED → GREEN → REFACTOR. Write the failing test first; never write product code before a failing test.
- TS strict, **no `any`** (Biome `noExplicitAny` is an error). Run `pnpm lint && pnpm typecheck` before every commit.
- Dependency direction: `contract → domain`; `web → contract, domain`; `worker → contract, domain`. Never import `web`/`worker` from `domain`/`contract`.
- Skipped/scaffold tests must never top-level-import a not-yet-built product export — use the existing `importComponent(...)` / dynamic `await import(...)` pattern.
- IDs are client-minted ULIDs (`newId()` from `@weavesteps/domain`). **Soft-delete only** (`deletedAt`), never hard removal.
- DO tests: `isolatedStorage: false`; every test uses a unique DO id (`do-id.ts` helper).
- Builtin attribute-kind slugs are reserved — a custom kind colliding with a builtin is ignored (`mergeRegistry` already enforces this).
- Worktree workflow: run gates explicitly (`pnpm lint && pnpm typecheck && pnpm test`, then `pnpm test:e2e:smoke`); push with an explicit refspec; never `--no-verify`. Branch base is `development`.
- `@smoke` E2E runs chromium-desktop only on PR (mobile is nightly). E2E disables animations via the `.bf-e2e` class; the test reset must clear seeded tables.
- Run a single workspace's tests with a filter, e.g. `pnpm --filter @weavesteps/domain test`, `pnpm --filter @weavesteps/web test`, `pnpm --filter @weavesteps/worker test`.

---

## File structure

**Domain (`packages/domain/src`)**
- Modify `doc-types.ts` — add `customKinds?: RegistryKind[]` to `AccountDoc` + `RoutineDoc`.
- Modify `schemas.ts` — `zRegistryKind` + add `customKinds` to account/routine Zod schemas.
- Modify `doc-account.ts`, `doc-routine.ts` — read/round-trip `customKinds`.
- Modify `__fixtures__/factories.ts` — default `customKinds: []`.
- Modify `vocabulary.ts` — export `slugifyKind`, `isReservedKind`.
- Modify `index.ts` — re-export the new symbols.

**Contract (`packages/contract/src`)**
- Modify `index.ts` — `zRegistryKind`, `zSearchResult`/`zSearchResults`, `zTemplateList` (reuse `zRoutineListItem`).

**Worker (`apps/worker`)**
- Create `migrations/0007_search_index.sql`.
- Modify `src/index.ts` — `GET /api/search`, `GET /api/templates`, fork-allows-app-template, onboarding converged.
- Create `src/sample.ts` — `seedSampleRoutine(env)` (sibling of `starter.ts`).
- Modify `src/db/routines.ts` — `searchReachable(...)` query + (if needed) `listTemplates(...)`.
- Modify `src/starter.ts` — converge onto the template fork.

**Web (`apps/web/src`)**
- Create `components/AddKindSheet.tsx`, `components/Lanes.tsx`.
- Modify `components/AttributeEditor.tsx` — accept `customKinds`.
- Modify `components/FigureTimeline.tsx` — use the shared role filter.
- Create `components/role-view.ts` — `filterByRoleView` shared helper.
- Modify `components/ChoreoList.tsx` — sample + start-from-template empty state + header search.
- Modify `store/routine.ts` (+ account-doc connection) — `createCustomKind`, merged registry.
- Create/modify `store/search.ts`, `store/templates.ts` — search + template fetch/fork wiring.

**E2E (`apps/web/e2e`)**
- Modify `authoring.spec.ts`; create `template.spec.ts`, `search.spec.ts`.

---

## Phase 1 — Domain + Contract

### Task 1: `customKinds` on the doc schemas

**Files:**
- Modify: `packages/domain/src/doc-types.ts:114-134`
- Modify: `packages/domain/src/schemas.ts`
- Modify: `packages/domain/src/doc-account.ts`, `packages/domain/src/doc-routine.ts`
- Modify: `packages/domain/src/__fixtures__/factories.ts:156-165`
- Test: `packages/domain/src/doc-schemas.test.ts` (or `doc-routine.test.ts`)

**Interfaces:**
- Consumes: existing `RegistryKind` (`vocabulary.ts`), `readRoutine`/`readAccount` helpers.
- Produces: `AccountDoc.customKinds?: RegistryKind[]`, `RoutineDoc.customKinds?: RegistryKind[]`; both read back via the existing `read*` functions and default to `[]`.

- [ ] **Step 1: Write the failing test**

In `packages/domain/src/doc-routine.test.ts` add (use the existing import style in that file — `importDomain()`/`makeRoutineDoc`):

```ts
describe("US-043 customKinds on the routine doc", () => {
  it("round-trips embedded custom kinds and defaults to []", async () => {
    const { readRoutine } = await importDomain();
    const energy = {
      kind: "energy", label: "Energy", color: "#c0563f",
      cardinality: "single" as const, valueType: "enum", values: ["low", "high"], builtin: false,
    };
    const withKind = makeRoutineDoc({ customKinds: [energy] });
    expect(readRoutine(withKind).customKinds).toEqual([energy]);
    const without = makeRoutineDoc({});
    expect(readRoutine(without).customKinds ?? []).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @weavesteps/domain test -- doc-routine`
Expected: FAIL — `customKinds` missing from the type / not read back.

- [ ] **Step 3: Implement**

In `doc-types.ts`, add to both interfaces (import `RegistryKind` from `./vocabulary` at the top — note `vocabulary.ts` imports from `./dances`, and `doc-types.ts` is allowed to import `vocabulary`; verify no import cycle, otherwise inline the `RegistryKind` type into `doc-types.ts` and have `vocabulary.ts` import it from there):

```ts
export interface AccountDoc {
  id: string;
  ownerId: string;
  annotations: Annotation[];
  customKinds?: RegistryKind[];
  schemaVersion: number;
  deletedAt?: number | null;
}
export interface RoutineDoc {
  id: string;
  title: string;
  dance: DanceId;
  ownerId: string;
  forkedFromRef?: string | null;
  templateOf?: string | null;
  sections: Section[];
  annotations: Annotation[];
  customKinds?: RegistryKind[];
  schemaVersion: number;
  deletedAt?: number | null;
}
```

In `doc-routine.ts` `readRoutine` (and `doc-account.ts` `readAccount`), include `customKinds` in the returned POJO: `customKinds: plain.customKinds ?? []`.

In `factories.ts` `makeRoutineDoc` (and `makeAccountDoc` if present), add `customKinds: overrides.customKinds ?? []`.

In `schemas.ts`, add `customKinds: z.array(zRegistryKind).optional()` to the account + routine schemas (define `zRegistryKind` here or import from `vocabulary`; see Task 2 for the canonical shape — keep ONE definition, re-export it).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @weavesteps/domain test -- doc-routine`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src
git commit -m "feat(domain): customKinds on account + routine docs (US-043)"
```

---

### Task 2: `slugifyKind` + `isReservedKind` helpers

**Files:**
- Modify: `packages/domain/src/vocabulary.ts:128-169`
- Modify: `packages/domain/src/index.ts` (re-export)
- Test: `packages/domain/src/vocabulary.test.ts`

**Interfaces:**
- Produces:
  - `slugifyKind(label: string): string` — lowercases, trims, replaces non-alphanumerics with `_`, collapses repeats, strips leading/trailing `_`.
  - `isReservedKind(slug: string): boolean` — true when `slug` is a builtin key of `ATTRIBUTE_REGISTRY`.

- [ ] **Step 1: Write the failing test**

In `vocabulary.test.ts`:

```ts
describe("US-043 custom kind slug helpers", () => {
  it("slugifies a label to a safe kind id", async () => {
    const { slugifyKind } = await import("./vocabulary");
    expect(slugifyKind("Energy Level!")).toBe("energy_level");
    expect(slugifyKind("  Foot  Pressure ")).toBe("foot_pressure");
  });
  it("flags builtin slugs as reserved", async () => {
    const { isReservedKind } = await import("./vocabulary");
    expect(isReservedKind("step")).toBe(true);
    expect(isReservedKind("rise")).toBe(true);
    expect(isReservedKind("energy")).toBe(false);
  });
  it("mergeRegistry ignores a custom kind colliding with a builtin", async () => {
    const { mergeRegistry, ATTRIBUTE_REGISTRY } = await import("./vocabulary");
    const merged = mergeRegistry(ATTRIBUTE_REGISTRY, [
      { kind: "rise", label: "Hacked", color: "#000", cardinality: "single", valueType: "enum", values: [], builtin: false },
    ]);
    expect(merged.rise.label).toBe("Rise & Fall"); // builtin wins
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @weavesteps/domain test -- vocabulary`
Expected: FAIL — `slugifyKind`/`isReservedKind` not exported.

- [ ] **Step 3: Implement** (append to `vocabulary.ts`)

```ts
/** Lowercase, collapse non-alphanumerics to `_`, trim `_` — a safe kind slug. */
export function slugifyKind(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** True when `slug` collides with a builtin kind (reserved — builtins win). */
export function isReservedKind(slug: string): boolean {
  return ATTRIBUTE_REGISTRY[slug]?.builtin === true;
}
```

Re-export both from `index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @weavesteps/domain test -- vocabulary`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src
git commit -m "feat(domain): slugifyKind + isReservedKind for custom kinds (US-043)"
```

---

### Task 3: Contract schemas (registry kind, search, templates)

**Files:**
- Modify: `packages/contract/src/index.ts`
- Test: `packages/contract/src/index.test.ts`

**Interfaces:**
- Produces:
  - `zRegistryKind` / `RegistryKindDto` — `{ kind, label, color, cardinality: "single"|"multi", valueType: string, values?: string[], freeText?: boolean, appliesToDances?: DanceId[], builtin: boolean }`.
  - `zSearchResult` — `{ docRef, type: "routine"|"global-figure"|"account-figure", title, dance: DanceId|null }`; `zSearchResults = { results: zSearchResult[] }`.
  - `zTemplateList` — `{ templates: zRoutineListItem[] }`.

- [ ] **Step 1: Write the failing test**

In `index.test.ts`:

```ts
import { zRegistryKind, zSearchResults, zTemplateList } from "./index";

it("US-043 validates a custom registry kind", () => {
  const ok = zRegistryKind.safeParse({
    kind: "energy", label: "Energy", color: "#c0563f",
    cardinality: "single", valueType: "enum", values: ["low", "high"], builtin: false,
  });
  expect(ok.success).toBe(true);
});
it("US-046 shapes search results", () => {
  const ok = zSearchResults.safeParse({ results: [{ docRef: "r1", type: "routine", title: "My Foxtrot", dance: "foxtrot" }] });
  expect(ok.success).toBe(true);
});
it("US-045 shapes the template list", () => {
  const ok = zTemplateList.safeParse({ templates: [{ docRef: "t1", title: "Sample", dance: "foxtrot", role: "viewer", updatedAt: 1 }] });
  expect(ok.success).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @weavesteps/contract test`
Expected: FAIL — schemas not exported.

- [ ] **Step 3: Implement** (append to `contract/src/index.ts`)

```ts
/** A merged-registry attribute kind (US-003/US-043), shared shape. */
export const zRegistryKind = z.object({
  kind: z.string().min(1),
  label: z.string().min(1),
  color: z.string().min(1),
  cardinality: z.enum(["single", "multi"]),
  valueType: z.string().min(1),
  values: z.array(z.string()).optional(),
  freeText: z.boolean().optional(),
  appliesToDances: z.array(z.enum(DANCE_IDS)).optional(),
  builtin: z.boolean(),
});
export type RegistryKindDto = z.infer<typeof zRegistryKind>;

/** One search hit (US-046) — projected from D1, no CRDT content. */
export const zSearchResult = z.object({
  docRef: z.string(),
  type: z.enum(["routine", "global-figure", "account-figure"]),
  title: z.string(),
  dance: z.enum(DANCE_IDS).nullable(),
});
export type SearchResult = z.infer<typeof zSearchResult>;
export const zSearchResults = z.object({ results: z.array(zSearchResult) });
export type SearchResults = z.infer<typeof zSearchResults>;

/** Templates list (US-045) — app-owned routines flagged templateOf. */
export const zTemplateList = z.object({ templates: z.array(zRoutineListItem) });
export type TemplateList = z.infer<typeof zTemplateList>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @weavesteps/contract test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/contract/src
git commit -m "feat(contract): registry-kind, search, template schemas (US-043/045/046)"
```

---

## Phase 2 — Worker

### Task 4: Search index + `GET /api/search`

**Files:**
- Create: `apps/worker/migrations/0007_search_index.sql`
- Modify: `apps/worker/src/db/routines.ts` (add `searchReachable`)
- Modify: `apps/worker/src/index.ts` (route)
- Test: `apps/worker/src/routes/search.test.ts` (unskip + rewrite AC-2 to the real scoped prefix query)

**Interfaces:**
- Consumes: `authenticate(c)`, `c.env.DB`, `resolveEffectiveRole`/membership helpers.
- Produces: `GET /api/search?q=&dance=` → `200 { results: SearchResult[] }`; `searchReachable(db, { userId, q, dance? })` returning rows `{ docRef, type, title, dance }`.

**Reachability + indexability:** scope routines to `ownerId = userId` (covered by `document_registry_owner_idx`) and figures to `ownerId IN (userId, 'app')`. The prefix term is `q + '%'`. The new `(title COLLATE NOCASE)` index covers the high-cardinality `ownerId='app'` figure branch so neither branch SCANs.

- [ ] **Step 1: Write the migration**

Create `apps/worker/migrations/0007_search_index.sql`:

```sql
-- US-046 — prefix search index. SQLite uses an index for a prefix LIKE ('q%')
-- only when the column collates the same way the LIKE compares; LIKE is
-- case-insensitive by default, so the index must be COLLATE NOCASE.
CREATE INDEX IF NOT EXISTS document_registry_title_idx
  ON document_registry (title COLLATE NOCASE);
```

- [ ] **Step 2: Write the failing test** — unskip the `US-046` describe in `apps/worker/src/routes/search.test.ts` (remove `.skip`). Rewrite AC-2 to the REAL scoped prefix query:

```ts
it("uses an INDEX for the search query (EXPLAIN, no SCAN)", async () => {
  await expectIndexedQuery(
    env.DB,
    "SELECT docRef, type, title, dance FROM document_registry WHERE ownerId = ?1 AND deletedAt IS NULL AND title LIKE ?2",
    ["u1", "feather%"],
  );
});
```

Keep AC-1 but point it at the real route and assert a result is returned:

```ts
const res = await SELF.fetch("https://x/api/search?q=My", { headers: ctx.authHeaders() });
expect(res.status).toBe(200);
const body = await res.json<{ results: { title: string }[] }>();
expect(body.results.some((r) => r.title === "My Foxtrot")).toBe(true);
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @weavesteps/worker test -- search`
Expected: FAIL — route 404 / migration not applied.

- [ ] **Step 4: Implement `searchReachable`** in `apps/worker/src/db/routines.ts`:

```ts
/** Prefix search over the caller's reachable docs (US-046). Indexed: routines by
 *  owner (owner_idx), figures by owner IN (user,'app') (title_idx COLLATE NOCASE). */
export async function searchReachable(
  db: D1Database,
  { userId, q, dance }: { userId: string; q: string; dance?: string },
): Promise<{ docRef: string; type: string; title: string; dance: string | null }[]> {
  const prefix = `${q}%`;
  const danceClause = dance ? " AND dance = ?3" : "";
  const params = dance ? [userId, prefix, dance] : [userId, prefix];
  // Owned routines + figures the user owns or that are app-owned globals.
  const sql =
    "SELECT docRef, type, title, dance FROM document_registry " +
    "WHERE deletedAt IS NULL AND title LIKE ?2 AND (ownerId = ?1 OR ownerId = 'app')" +
    danceClause +
    " ORDER BY updatedAt DESC LIMIT 50";
  const rows = await db.prepare(sql).bind(...params).all<{ docRef: string; type: string; title: string; dance: string | null }>();
  return rows.results;
}
```

Note: shared-in routines (membership, not ownership) are out of v1 search scope to keep the query single-index; document this in the route comment and the spec's "out of scope" list. (If testers need them, add a UNION over `membership_user_idx` later.)

Wire the route in `index.ts` (near the other `app.get`s):

```ts
// GET /api/search — prefix search over the D1 index (US-046). Scoped to the
// caller's reachable docs (owned routines + owned/app-owned figures). Indexed
// (EXPLAIN no-SCAN gate, ops.test). Annotation/content search is v1.1.
app.get("/api/search", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  const q = (c.req.query("q") ?? "").trim();
  if (!q) return c.json({ results: [] });
  const dance = c.req.query("dance") ?? undefined;
  const rows = await searchReachable(c.env.DB, { userId: user.sub, q, dance });
  const results = rows.map((r) => ({ docRef: r.docRef, type: r.type, title: r.title ?? "", dance: r.dance }));
  return c.json({ results });
});
```

Add `searchReachable` to the imports from `./db/routines` in `index.ts`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @weavesteps/worker test -- search`
Expected: PASS (both AC-1 and AC-2).

- [ ] **Step 6: Run the EXPLAIN ops gate** to confirm no regression:

Run: `pnpm --filter @weavesteps/worker test -- ops`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/migrations apps/worker/src
git commit -m "feat(worker): GET /api/search prefix search + title index (US-046)"
```

---

### Task 5: Sample seed + `GET /api/templates`

**Files:**
- Create: `apps/worker/src/sample.ts`
- Modify: `apps/worker/src/db/routines.ts` (add `listTemplates`)
- Modify: `apps/worker/src/index.ts` (route + seed invocation)
- Test: `apps/worker/src/routes/templates.test.ts` (new)

**Interfaces:**
- Produces:
  - `seedSampleRoutine(env): Promise<string>` — projects `SAMPLE_ROUTINE` + its figures with `ownerId: "app"`, `templateOf` set; idempotent (`seedDoc` no-clobber, `createOwnedRoutine`/`createFigureRows` upsert-safe).
  - `listTemplates(db): Promise<RoutineListItem[]>` — app-owned rows where `templateOf IS NOT NULL`.
  - `GET /api/templates` → `200 { templates: RoutineListItem[] }`.

**Seed invocation:** seed lazily on first `GET /api/templates` AND on first onboarding (idempotent), guarded so it runs at most once per cold start via a module-level `let seeded = false`. (Both mechanisms are acceptable per the spec; the lazy guard avoids a migration hook.)

- [ ] **Step 1: Write the failing test** — `apps/worker/src/routes/templates.test.ts`:

```ts
import { SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { authedContext } from "../test-support/authed-context";
import { generateTestKeypair, type TestKeypair } from "../test-support/jwt";
import { applyMigrations, seedDb } from "../test-support/seed";

let kp: TestKeypair;
beforeAll(async () => { await applyMigrations(); kp = await generateTestKeypair(); });

describe("US-045 templates", () => {
  it("lists the app-owned sample template", async () => {
    const ctx = await authedContext({ keypair: kp, userId: "u1", docRef: "n/a", role: null });
    await seedDb({ users: [{ id: "u1", displayName: "U1", identityColor: "#111", plan: "free" }] });
    const res = await SELF.fetch("https://x/api/templates", { headers: ctx.authHeaders() });
    expect(res.status).toBe(200);
    const body = await res.json<{ templates: { title: string }[] }>();
    expect(body.templates.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @weavesteps/worker test -- templates`
Expected: FAIL — route 404.

- [ ] **Step 3: Implement the seed** — `apps/worker/src/sample.ts` (mirror `starter.ts`):

```ts
// apps/worker/src/sample.ts
// US-045 — seed the app-owned READ-ONLY sample routine (a start-from-template
// source). Projects the shared SAMPLE_ROUTINE fixture + its figures with
// ownerId "app"; idempotent (seedDoc is no-clobber). Distinct from the
// onboarding gift (starter.ts), which FORKS this template into an owned copy.
import { SAMPLE_FIGURE_LIBRARY, SAMPLE_ROUTINE } from "@weavesteps/domain/fixtures";
import { createFigureRows } from "./db/figures";
import { linkPlacement } from "./db/placement-edge";
import { createOwnedRoutine } from "./db/routines";
import type { Env } from "./index";

export const APP_OWNER = "app";

export async function seedSampleRoutine(env: Env): Promise<string> {
  const routine = SAMPLE_ROUTINE;
  const figureIds = new Set(
    routine.sections.flatMap((s) => s.placements.map((p) => p.figureRef)),
  );
  for (const id of figureIds) {
    const fig = SAMPLE_FIGURE_LIBRARY[id];
    if (!fig) continue;
    await createFigureRows(env.DB, {
      figureRef: fig.id, ownerId: APP_OWNER, name: fig.name, dance: fig.dance, figureType: fig.figureType,
    });
    await env.DOC_DO.get(env.DOC_DO.idFromName(fig.id)).seedDoc(fig as unknown as Record<string, unknown>);
    await linkPlacement(env.DB, routine.id, fig.id);
  }
  await createOwnedRoutine(env.DB, {
    docRef: routine.id, ownerId: APP_OWNER, title: routine.title, dance: routine.dance, templateOf: routine.id,
  });
  await env.DOC_DO.get(env.DOC_DO.idFromName(routine.id)).seedDoc({
    ...routine, ownerId: APP_OWNER, schemaVersion: 1, deletedAt: null,
  } as unknown as Record<string, unknown>);
  return routine.id;
}
```

Confirm the fixtures subpath export exists. If `@weavesteps/domain/fixtures` is not exported by the domain `package.json`, import the fixture from the existing path used elsewhere (grep `SAMPLE_ROUTINE` imports in the worker tests) or add the subpath export. Also confirm `createOwnedRoutine` accepts `templateOf`; if not, extend it + the `document_registry` insert to set `templateOf` is NOT a column — `templateOf` lives in the DO doc, the registry has no `templateOf` column. **Decision:** the registry has no `templateOf`; instead flag templates by `ownerId = 'app'`. So `listTemplates` filters `ownerId = 'app' AND type = 'routine'`. Update `seedSampleRoutine` to drop the `templateOf` arg to `createOwnedRoutine` (it stays only on the DO doc).

`listTemplates` in `db/routines.ts`:

```ts
/** App-owned sample/template routines (US-045). Indexed by owner_idx (ownerId='app'). */
export async function listTemplates(db: D1Database): Promise<{ docRef: string; title: string; dance: string; updatedAt: number }[]> {
  const rows = await db
    .prepare("SELECT docRef, title, dance, updatedAt FROM document_registry WHERE ownerId = 'app' AND type = 'routine' AND deletedAt IS NULL ORDER BY updatedAt DESC")
    .all<{ docRef: string; title: string; dance: string; updatedAt: number }>();
  return rows.results;
}
```

Route + lazy seed in `index.ts`:

```ts
let sampleSeeded = false;
async function ensureSample(env: Env): Promise<void> {
  if (sampleSeeded) return;
  try { await seedSampleRoutine(env); sampleSeeded = true; } catch (err) { console.error("sample seed failed", err); }
}

app.get("/api/templates", async (c) => {
  const user = await authenticate(c);
  if (!user) return c.json({ error: "unauthenticated" }, 401);
  await ensureSample(c.env);
  const rows = await listTemplates(c.env.DB);
  const templates = rows.map((r) => ({ docRef: r.docRef, title: r.title, dance: r.dance, role: "viewer" as const, updatedAt: r.updatedAt }));
  return c.json({ templates });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @weavesteps/worker test -- templates`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src
git commit -m "feat(worker): app-owned sample seed + GET /api/templates (US-045)"
```

---

### Task 6: Fork an app-owned template + converge the onboarding gift

**Files:**
- Modify: `apps/worker/src/index.ts` (fork route: allow forking an `ownerId='app'` template even without a membership row)
- Modify: `apps/worker/src/starter.ts` (converge: onboarding gift forks the sample)
- Test: `apps/worker/src/routes/templates.test.ts` (fork-a-template case), `apps/worker/src/starter.test.ts`

**Interfaces:**
- Consumes: existing `POST /api/routines/:id/fork`, `seedSampleRoutine`.
- Produces: forking the sample template → a new owned, quota-counted routine; onboarding gifts a fork of the sample (one mechanism).

- [ ] **Step 1: Write the failing test** (append to `templates.test.ts`):

```ts
it("forks the app-owned sample into an owned routine (quota-checked)", async () => {
  const ctx = await authedContext({ keypair: kp, userId: "u2", docRef: "n/a", role: null });
  await seedDb({ users: [{ id: "u2", displayName: "U2", identityColor: "#222", plan: "free" }] });
  const list = await (await SELF.fetch("https://x/api/templates", { headers: ctx.authHeaders() })).json<{ templates: { docRef: string }[] }>();
  const templateRef = list.templates[0].docRef;
  const res = await SELF.fetch(`https://x/api/routines/${templateRef}/fork`, { method: "POST", headers: ctx.authHeaders() });
  expect(res.status).toBe(201);
  const body = await res.json<{ docRef: string; forkedFromRef: string }>();
  expect(body.forkedFromRef).toBe(templateRef);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @weavesteps/worker test -- templates`
Expected: FAIL — fork returns 403 (no membership on the app-owned template).

- [ ] **Step 3: Implement** — in the fork route (`index.ts:171-188`), allow an app-owned template to be forked by any authenticated user. Replace the membership gate:

```ts
const originRef = c.req.param("id");
const role = await resolveEffectiveRole(c.env.DB, originRef, user.sub);
// An app-owned template (US-045) is forkable by anyone; otherwise require membership.
const owner = await getDocOwner(c.env.DB, originRef); // from db/membership.ts
if (!role && owner !== "app") return c.json({ error: "forbidden" }, 403);
```

Use the existing owner lookup (`db/membership.ts` documents `document_registry.ownerId` lookup — confirm the helper name via grep; if absent, add `getDocOwner(db, docRef)` reading `SELECT ownerId FROM document_registry WHERE docRef = ?`). Ensure `ensureSample` has run so the template's DO content exists when `getSnapshot()` is called in the fork (call `await ensureSample(c.env)` at the top of the fork route, cheap after first run).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @weavesteps/worker test -- templates`
Expected: PASS.

- [ ] **Step 5: Converge onboarding** — modify `starter.ts` `seedStarterRoutine` to fork the sample template instead of building its own. Keep the signature `seedStarterRoutine(env, userId): Promise<string>` and the best-effort try/catch in the onboarding route. Replace the body to: ensure the sample is seeded, then run the same snapshot-clone-into-owned-doc logic the fork route uses (extract that into a shared `forkRoutineFor(env, { originRef, userId }): Promise<string>` helper in a new `apps/worker/src/fork.ts`, and call it from BOTH the fork route and `seedStarterRoutine`). The onboarding gift must NOT be quota-gated (it's a gift) — `forkRoutineFor` takes a `skipQuota?: boolean`.

Update `starter.test.ts` expectations: the gifted routine is now a fork of the sample (assert `forkedFromRef === SAMPLE_ROUTINE.id` and the user owns it). If the test asserts the golden-waltz title specifically, update it to the sample's title (or keep golden-waltz as the sample source — see note below).

> **Note on content:** the spec says "the golden-waltz builder content is preserved." If the product wants the onboarding gift to remain the Golden Waltz Basic (not the Foxtrot sample), then seed the golden-waltz routine as a SECOND app-owned template and fork THAT in onboarding, while the US-045 sample stays the Foxtrot one. Pick during execution; default: one sample (Foxtrot) used for both, simplest. Surface the choice in the task PR description.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @weavesteps/worker test -- starter templates`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src
git commit -m "feat(worker): fork app-owned templates; converge onboarding gift onto the template fork (US-045/US-055)"
```

---

## Phase 3 — Store seam

### Task 7: `createCustomKind` + merged-registry exposure

**Files:**
- Modify: `apps/web/src/store/routine.ts` (add `createCustomKind`, `customKinds()` / merged registry; open an account-doc connection)
- Test: `apps/web/src/store/routine-store.test.ts`

**Interfaces:**
- Produces on `RoutineStore`:
  - `createCustomKind(descriptor: RegistryKind): void` — writes to the account doc AND embeds into the open routine doc (de-duped by slug; ignores reserved/builtin slugs).
  - `customKinds(): RegistryKind[]` — the merged set (account ∪ routine), de-duped by slug, excluding builtins.

- [ ] **Step 1: Write the failing test** in `routine-store.test.ts` (follow the file's existing in-memory store harness):

```ts
it("US-043 createCustomKind embeds the kind into the routine doc", async () => {
  const store = await openTestRoutine(/* existing harness helper */);
  store.createCustomKind({ kind: "energy", label: "Energy", color: "#c0563f", cardinality: "single", valueType: "enum", values: ["low","high"], builtin: false });
  expect(store.customKinds().some((k) => k.kind === "energy")).toBe(true);
  expect(store.readRoutine().customKinds?.some((k) => k.kind === "energy")).toBe(true);
});
it("US-043 ignores a custom kind colliding with a builtin", async () => {
  const store = await openTestRoutine();
  store.createCustomKind({ kind: "rise", label: "Hacked", color: "#000", cardinality: "single", valueType: "enum", values: [], builtin: false });
  expect(store.customKinds().some((k) => k.kind === "rise")).toBe(false);
});
```

(Use the test file's actual open helper name — grep `routine-store.test.ts` for how it constructs a store with in-memory Automerge.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @weavesteps/web test -- routine-store`
Expected: FAIL — `createCustomKind` undefined.

- [ ] **Step 3: Implement** — in `store/routine.ts`:
  - Add `createCustomKind` to the `RoutineStore` interface + the returned object.
  - On call: `if (isReservedKind(descriptor.kind)) return;` then `A.change` the routine doc to push the descriptor into `doc.customKinds` (init `[]` if absent), de-duped by slug; and write the same descriptor to the account doc (`A.change` on the account handle — reuse the existing account-doc connection used for annotations; if the routine store doesn't already hold an account handle, thread it through `OpenOptions` like the annotation author id is).
  - `customKinds()` returns `dedupeBySlug([...accountKinds, ...routineKinds]).filter((k) => !isReservedKind(k.kind))`.
  - Import `isReservedKind`, `type RegistryKind` from `@weavesteps/domain`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @weavesteps/web test -- routine-store`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/store
git commit -m "feat(web/store): createCustomKind + merged registry (US-043)"
```

---

### Task 8: Search + template-fork store wiring

**Files:**
- Create: `apps/web/src/store/search.ts`, `apps/web/src/store/templates.ts`
- Test: `apps/web/src/store/search.test.ts` (new)

**Interfaces:**
- Produces:
  - `search(token: string, q: string, dance?: DanceId): Promise<SearchResults>` — `GET /api/search`.
  - `listTemplates(token): Promise<TemplateList>`; `forkTemplate(token, docRef): Promise<{ docRef: string }>` (POST `/api/routines/:id/fork`).

- [ ] **Step 1: Write the failing test** — `store/search.test.ts` (mirror the fetch-mock style of other store tests, e.g. `me.ts`/`routines.ts` tests):

```ts
it("US-046 queries /api/search and returns results", async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({ results: [{ docRef: "r1", type: "routine", title: "My Foxtrot", dance: "foxtrot" }] }), { status: 200 }));
  const { search } = await import("./search");
  const out = await search("tok", "My", undefined, { fetch: fetchMock, baseUrl: "" });
  expect(out.results[0].title).toBe("My Foxtrot");
  expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/api/search?q=My"), expect.anything());
});
```

(Match the existing store modules' injectable-`fetch` convention — check `store/me.ts` for `apiGet`/token signature and reuse it; if they use a global `apiGet(path, token)` without injectable fetch, follow that exact pattern instead and stub via the shared test helper.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @weavesteps/web test -- store/search`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** `store/search.ts` + `store/templates.ts` using the existing `apiGet`/`apiPost` helpers (grep `store/routines.ts` for their import + signature). Encode `q` with `encodeURIComponent`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @weavesteps/web test -- store/search`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/store
git commit -m "feat(web/store): search + template-fork wiring (US-045/US-046)"
```

---

## Phase 4 — Components

### Task 9: Shared role filter + `AttributeEditor` custom kinds

**Files:**
- Create: `apps/web/src/components/role-view.ts`
- Modify: `apps/web/src/components/FigureTimeline.tsx:44` (use the shared helper)
- Modify: `apps/web/src/components/AttributeEditor.tsx:34-48` (accept `customKinds`)
- Test: `apps/web/src/components/custom-kind.test.tsx` (US-043 second test), `attribute-editor.test.tsx` (unchanged still green)

**Interfaces:**
- Produces: `filterByRoleView(attrs: Attribute[], view: "leader"|"follower"): Attribute[]`; `AttributeEditor` prop `customKinds?: RegistryKind[]`.

- [ ] **Step 1: Write the failing test** — unskip `custom-kind.test.tsx` US-043 describe; rewrite the second test's arrange to pass a descriptor (the prop is now typed):

```ts
it("makes the new kind appear in the attribute editor after creation", async () => {
  const { AttributeEditor } = await importComponent<AttributeEditorModule>("../components/AttributeEditor");
  const energy = { kind: "energy", label: "Energy", color: "#c0563f", cardinality: "single", valueType: "enum", values: ["low","high"], builtin: false };
  renderUi(<AttributeEditor count={1} dance="foxtrot" role="editor" customKinds={[energy]} />);
  expect(screen.getByRole("heading", { name: /energy/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @weavesteps/web test -- custom-kind`
Expected: FAIL — `customKinds` ignored; no Energy heading.

- [ ] **Step 3: Implement**
  - `role-view.ts`:
    ```ts
    import type { Attribute } from "@weavesteps/domain";
    /** Visible in a lens when both-role (role=null, always) or the selected role. */
    export const filterByRoleView = (attrs: Attribute[], view: "leader" | "follower"): Attribute[] =>
      attrs.filter((a) => a.role == null || a.role === view);
    ```
  - `FigureTimeline.tsx`: replace the local `visibleInView` usage with `filterByRoleView` (import it; drop the inline helper).
  - `AttributeEditor.tsx`: add `customKinds?: RegistryKind[]` to props; change `kindsFor(dance)` to operate on the merged registry:
    ```ts
    import { ATTRIBUTE_REGISTRY, mergeRegistry, type RegistryKind, ... } from "@weavesteps/domain";
    function kindsFor(dance: DanceId | undefined, customKinds: RegistryKind[]) {
      const reg = mergeRegistry(ATTRIBUTE_REGISTRY, customKinds);
      return Object.values(reg).filter((k) => !k.appliesToDances || dance === undefined || k.appliesToDances.includes(dance));
    }
    ```
    Default `customKinds = []`; pass it from `FigureTimeline` (thread a `customKinds` prop through, defaulting `[]`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @weavesteps/web test -- custom-kind attribute-editor`
Expected: PASS (custom-kind US-043 + the existing US-028/029/030 stay green).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components
git commit -m "feat(web): shared role filter + AttributeEditor custom kinds (US-043)"
```

---

### Task 10: `AddKindSheet`

**Files:**
- Create: `apps/web/src/components/AddKindSheet.tsx`
- Test: `apps/web/src/components/custom-kind.test.tsx` (US-043 first test)

**Interfaces:**
- Produces: `AddKindSheet` props `{ open?: boolean; onClose?: () => void; onCreate?: (kind: RegistryKind) => void }`.

- [ ] **Step 1: Write the failing test** — the first US-043 test asserts the form captures the descriptor and calls `onCreate`. Rewrite to assert the callback:

```ts
it("creates a user-defined kind (label, color, cardinality, valueType, values)", async () => {
  const { AddKindSheet } = await importComponent<AddKindModule>("../components/AddKindSheet");
  const onCreate = vi.fn();
  renderUi(<AddKindSheet open onCreate={onCreate} />);
  await userEvent.type(screen.getByLabelText(/label/i), "Energy");
  await userEvent.type(screen.getByLabelText(/values/i), "low, high");
  await userEvent.click(screen.getByRole("button", { name: /create|save/i }));
  expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ kind: "energy", label: "Energy", values: ["low", "high"], builtin: false }));
});
```

(Add `vi` to the import from `vitest` in that file.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @weavesteps/web test -- custom-kind`
Expected: FAIL — module missing.

- [ ] **Step 3: Implement** `AddKindSheet.tsx` using the `ui` primitives (`Sheet`, `Input`, `Select`, `Button`) and `slugifyKind`/`isReservedKind` from `@weavesteps/domain`:
  - Fields: label (Input), color (Input type color or a token Select), cardinality (Select single/multi), valueType (Select enum/text), values (Input — comma-separated, split+trim+filter).
  - On submit: build `{ kind: slugifyKind(label), label, color, cardinality, valueType, values, builtin: false }`; block if `!label.trim()` or `isReservedKind(slug)` (show an inline error "That name is reserved"); call `onCreate`, then `onClose`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @weavesteps/web test -- custom-kind`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components
git commit -m "feat(web): AddKindSheet for custom attribute kinds (US-043)"
```

---

### Task 11: `Lanes`

**Files:**
- Create: `apps/web/src/components/Lanes.tsx`
- Test: `apps/web/src/components/attribute-editor.test.tsx` (US-044 describe)

**Interfaces:**
- Produces: `Lanes` props `{ kind: string; role: MembershipRole; dance?: DanceId; counts?: number; attributes?: Attribute[]; initialView?: "leader"|"follower"; customKinds?: RegistryKind[]; onChange?: (next: Attribute[]) => void }`.

- [ ] **Step 1: Write the failing test** — unskip the `US-044` describe in `attribute-editor.test.tsx`. Make the first test concrete:

```ts
it("shows a single kind across every count and edits the same attributes as the timeline", async () => {
  const { Lanes } = await importComponent<LanesModule>("../components/Lanes");
  const onChange = vi.fn();
  const sway = (c: number, v: string): Attribute => ({ id: `sway-${c}`, kind: "sway", count: c, value: v, role: null, deletedAt: null });
  renderUi(<Lanes kind="sway" role="editor" counts={3} dance="foxtrot" attributes={[sway(1, "to_L"), sway(3, "to_R")]} onChange={onChange} />);
  expect(screen.getAllByRole("gridcell").length).toBe(3);
  await userEvent.click(screen.getByRole("button", { name: /count 2/i }));
  await userEvent.click(screen.getByRole("button", { name: /^to_R$/i }));
  expect(onChange).toHaveBeenCalled();
});
```

The role-toggle test:

```ts
it("honors the role-view toggle in the lane", async () => {
  const { Lanes } = await importComponent<LanesModule>("../components/Lanes");
  const follower: Attribute = { id: "sway-2-f", kind: "sway", count: 2, value: "to_R", role: "follower", deletedAt: null };
  renderUi(<Lanes kind="sway" role="editor" counts={3} dance="foxtrot" initialView="leader" attributes={[follower]} />);
  expect(screen.getByRole("grid")).toBeInTheDocument();
  expect(screen.queryByText("to_R")).toBeNull(); // hidden in leader view
  await userEvent.click(screen.getByRole("button", { name: /flip role|follower/i }));
  expect(screen.getByText("to_R")).toBeInTheDocument(); // shown in follower view
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @weavesteps/web test -- attribute-editor`
Expected: FAIL — `Lanes` missing.

- [ ] **Step 3: Implement** `Lanes.tsx`:
  - `role="grid"` wrapper; one `role="gridcell"` per count (`counts`, default 8).
  - Resolve the kind descriptor from `mergeRegistry(ATTRIBUTE_REGISTRY, customKinds)[kind]`.
  - Per cell, filter the figure's attributes to this `kind` + this `count`, then `filterByRoleView(..., view)`. Render selected value(s) as chips; an editor taps a cell to open a small inline value picker (reuse `AttributeEditor` scoped to `count` + a single kind, or a minimal chip toggler honoring cardinality — simplest: render the kind's `values` as toggle `Chip`s per cell, calling `onCountKindChange`).
  - A `view` toggle button identical in label to `FigureTimeline` ("Flip role to {flipped}").
  - `onChange` emits the figure's full next attribute set (merge this cell's next values with the untouched rest), mirroring `FigureTimeline.onCountChange`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @weavesteps/web test -- attribute-editor`
Expected: PASS (US-044 + the existing US-028/029/030 stay green).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components
git commit -m "feat(web): Lanes — one kind across all counts (US-044)"
```

---

### Task 12: `ChoreoList` empty state (sample + template) + header search

**Files:**
- Modify: `apps/web/src/components/ChoreoList.tsx`
- Test: `apps/web/src/components/choreo-list.test.tsx` (US-045 describe + a search test)

**Interfaces:**
- Produces new `ChoreoList` props: `sample?: RoutineListItem` (the read-only sample), `templates?: RoutineListItem[]`, `onStartFromTemplate?: (docRef: string) => void`, `onSearch?: (q: string) => void`, `searchResults?: SearchResult[]`.

- [ ] **Step 1: Write the failing test** — unskip the `US-045` describe in `choreo-list.test.tsx`. Make assertions match the implementation:

```ts
it("shows the read-only sample + a template in the empty state", async () => {
  const { ChoreoList } = await importComponent<ChoreoListModule>("../components/ChoreoList");
  const sample = { docRef: "rt_sample", title: "Sample Foxtrot", dance: "foxtrot", role: "viewer", updatedAt: 1 };
  renderUi(<ChoreoList ownedCount={0} plan="free" sample={sample} templates={[sample]} />);
  expect(screen.getByText(/sample/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /start from template/i })).toBeInTheDocument();
});
it("prevents editing the read-only sample", async () => {
  const { ChoreoList } = await importComponent<ChoreoListModule>("../components/ChoreoList");
  const sample = { docRef: "rt_sample", title: "Sample Foxtrot", dance: "foxtrot", role: "viewer", updatedAt: 1 };
  renderUi(<ChoreoList ownedCount={0} plan="free" sample={sample} />);
  expect(screen.getByText(/read-only|sample/i)).toBeInTheDocument();
});
```

Add a search test:

```ts
it("US-046 calls onSearch as the user types in the header", async () => {
  const { ChoreoList } = await importComponent<ChoreoListModule>("../components/ChoreoList");
  const onSearch = vi.fn();
  renderUi(<ChoreoList ownedCount={1} plan="free" onSearch={onSearch} routines={[{ docRef: "r1", title: "My Foxtrot", dance: "foxtrot", role: "owner", updatedAt: 1 }]} />);
  await userEvent.type(screen.getByRole("searchbox", { name: /search/i }), "Fox");
  expect(onSearch).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @weavesteps/web test -- choreo-list`
Expected: FAIL — props/affordances missing.

- [ ] **Step 3: Implement** in `ChoreoList.tsx`:
  - A header search `Input type="search"` (`role="searchbox"`, labelled "Search") that calls `onSearch(e.target.value)`. When `searchResults` is non-empty, render them above the routine cards (tapping a result calls `onOpen`).
  - Empty state (`routines.length === 0`): show the read-only `sample` card (badge "Read-only sample"; tapping opens it via `onOpen` — read-only is enforced server-side) + a "Start from template" button. If `templates` has entries, the button forks the first/selected template via `onStartFromTemplate(docRef)`.
  - Keep the existing New-Choreo + quota-upsell behavior intact.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @weavesteps/web test -- choreo-list`
Expected: PASS.

- [ ] **Step 5: Wire the screen** — in the ChoreoList screen wrapper (grep for where `<ChoreoList` is rendered with store data; likely `App.tsx` or a `ChoreoListScreen`), wire `onSearch` → `store/search.search`, `templates`/`sample` → `store/templates.listTemplates` (the sample is the template whose `docRef === SAMPLE_ROUTINE.id`), `onStartFromTemplate` → `forkTemplate` then navigate to the new `docRef`. Typecheck only (screen wiring is covered by E2E).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src
git commit -m "feat(web): ChoreoList sample/start-from-template + header search (US-045/US-046)"
```

---

## Phase 5 — E2E (`@smoke`)

> The real-worker journey harness is `apps/web/e2e/support` (`serve.sh`, `seedAuth`, `seedDb`, `useAppAuth`, router) per the FE-6/#191 work. Reuse `seedDb` to land deterministic state and `test-seed` reset to clear tables (incl. any seeded sample). Each spec must run under the `@smoke` tag (chromium-desktop on PR).

### Task 13: Custom kind + lane journey (authoring.spec)

**Files:**
- Modify: `apps/web/e2e/authoring.spec.ts`

- [ ] **Step 1: Write the failing test** — add to the `@smoke core authoring journey` describe (or a new `@smoke` describe in the same file): sign in (seeded auth), open a routine + a figure, open "Add kind", create "Energy", assert an "Energy" section appears in the editor, open the lane view for it, assert the lane grid renders, reload, assert "Energy" still present (AC-3 persistence).

```ts
test("@smoke create a custom kind and view it in a lane", async ({ page }) => {
  // ...seeded sign-in + open a routine's figure (reuse the helpers already in this file)...
  await page.getByRole("button", { name: /add kind/i }).click();
  await page.getByLabel(/label/i).fill("Energy");
  await page.getByLabel(/values/i).fill("low, high");
  await page.getByRole("button", { name: /create|save/i }).click();
  await expect(page.getByRole("heading", { name: /energy/i })).toBeVisible();
  await page.getByRole("button", { name: /lanes?/i }).click();
  await expect(page.getByRole("grid")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: /energy/i })).toBeVisible();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:e2e:smoke -- authoring`
Expected: FAIL (UI entry points for Add kind / Lanes not yet surfaced on the screen).

- [ ] **Step 3: Surface the entry points** — add an "Add kind" button (opens `AddKindSheet`, wired to `store.createCustomKind`) and a "Lanes" view toggle (renders `Lanes` for a chosen kind) on the figure/Assemble screen. Wire `customKinds` from `store.customKinds()` into `FigureTimeline`/`AttributeEditor`/`Lanes`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test:e2e:smoke -- authoring`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "test(e2e): custom kind + lane authoring journey (US-043/US-044)"
```

---

### Task 14: Start-from-template journey

**Files:**
- Create: `apps/web/e2e/template.spec.ts`

- [ ] **Step 1: Write the failing test** — `@smoke`: a fresh signed-in user with zero owned routines lands on the empty Choreo list; sees the read-only sample + "Start from template"; clicks it; lands on a NEW owned, editable routine (the header shows an editable affordance, not read-only); the sample itself stays read-only when opened.

```ts
test("@smoke start from template creates an owned editable copy", async ({ page }) => {
  // ...seeded sign-in with no owned routines; ensure the sample is seeded (GET /api/templates triggers it)...
  await expect(page.getByText(/sample/i)).toBeVisible();
  await page.getByRole("button", { name: /start from template/i }).click();
  await expect(page).toHaveURL(/\/routines\//);
  await expect(page.getByRole("button", { name: /new section|add figure/i })).toBeVisible(); // editable
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:e2e:smoke -- template`
Expected: FAIL.

- [ ] **Step 3: Implement** — ensure the ChoreoList screen fetches `/api/templates` on mount and renders the empty-state affordances; the fork navigates to the returned `docRef`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test:e2e:smoke -- template`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "test(e2e): start-from-template journey (US-045)"
```

---

### Task 15: Search journey

**Files:**
- Create: `apps/web/e2e/search.spec.ts`

- [ ] **Step 1: Write the failing test** — `@smoke`: a signed-in user with a seeded routine "My Foxtrot" types "My" into the Choreo header search and sees the routine in the results.

```ts
test("@smoke search finds a routine by title prefix", async ({ page }) => {
  // ...seeded sign-in + a seeded owned routine titled "My Foxtrot"...
  await page.getByRole("searchbox", { name: /search/i }).fill("My");
  await expect(page.getByText("My Foxtrot")).toBeVisible();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test:e2e:smoke -- search`
Expected: FAIL.

- [ ] **Step 3: Implement** — wire the header search to `store/search.search`, render results above the cards (debounce ~200ms).

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test:e2e:smoke -- search`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web
git commit -m "test(e2e): routine search journey (US-046)"
```

---

## Final verification

- [ ] **Full gates:**

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm test:e2e:smoke
```

Expected: all green.

- [ ] **Coverage spot-check** the new domain/worker code is exercised (domain ≥95%, worker ≥90% if thresholds are enabled).

- [ ] **Unskip audit:** confirm `custom-kind.test.tsx`, `attribute-editor.test.tsx` (US-044), `choreo-list.test.tsx` (US-045), `search.test.ts` (US-046) no longer carry `.skip`, and reference the stories in `docs/TEST-MAP.md` if that doc tracks unskips.

- [ ] **Push** the branch with an explicit refspec and open the PR; the PR body lists the US-043–046 journeys and the onboarding-convergence decision (one sample vs. golden-waltz preserved as a second template).

---

## Self-review notes (coverage vs. spec)

- **US-043** — Tasks 1, 2, 3, 7, 9, 10, 13 (schema, helpers, contract, store, editor merge, AddKindSheet, E2E + persistence).
- **US-044** — Tasks 9 (shared filter), 11, 13 (Lanes + E2E).
- **US-045** — Tasks 5, 6, 8, 12, 14 (sample seed, fork-app-template + onboarding convergence, store, ChoreoList empty state, E2E).
- **US-046** — Tasks 4, 8, 12, 15 (search route + index, store, header search, E2E).
- **EXPLAIN gate** — Task 4 tests the real scoped prefix query; Task 4 Step 6 re-runs `ops`.
- **Open execution choices flagged in-task:** (a) import path for `SAMPLE_ROUTINE`/fixtures subpath; (b) one sample vs. preserving golden-waltz as a second template in onboarding; (c) the exact `apiGet`/injectable-fetch convention in the store tests. Each is resolved by grepping the named existing file before writing code.
