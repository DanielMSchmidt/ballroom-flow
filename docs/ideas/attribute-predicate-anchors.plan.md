# Attribute-Predicate Annotation Anchors — Execution Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Load `ballroom-flow-change-control` before Task 1 and `ballroom-flow-validation-and-qa` before writing any test. The spec is [`attribute-predicate-anchors.md`](attribute-predicate-anchors.md) (its Design details are final); this plan is its dispatch brief. Both files are DELETED in Task 9.

**Goal:** A fourth annotation anchor type, `attributePredicate { kind, value, role?, scope }`, that surfaces one note on **every step whose notation matches an attribute condition** ("soften every left-side sway", "every step with *no* sway logged"), dynamically re-evaluated on read, with the family-note ownership/visibility model (author-owned account-doc note + a new co-membership-gated D1 index) and the v4 § 3.6 attribute picker flow grafted onto the shipped choreo-first link picker.

**Architecture:** The `Anchor` union in `packages/domain` gains the variant (compile-pinned into `zAnchor`); a pure `matchPredicate(anchor, resolvedFigure): number[]` matches by meaning via `normalizeValue` read-aliases over the post-variant `resolveFigure` output. The author's account doc owns the note (`addPredicateNote` mutator + `addPredicateNote` AccountOp); the account DO's existing alarm (`projectAccountToD1`) additionally projects rows to a new `attribute_predicate_note_index` D1 table (migration 0019) mirroring `figure_type_note_index`; a new `GET /api/routines/:id/predicate-notes` route mirrors the family-note read with the same co-membership gate. The web store merges own live notes (self-read, offline-capable) with co-members' REST rows; the reading view runs `matchPredicate` over the already-materialized resolved timelines and folds matches into the same margin cells / thread panel as family notes, with `reconcile`-style referential stability. Ship gate: `apps/web/e2e/attribute-predicate-anchors.spec.ts`.

**Tech Stack:** TypeScript (strict), Vitest (+ fast-check, already a domain devDep), pnpm monorepo, Hono (worker), Cloudflare Durable Objects + D1, Automerge, React, Playwright.

## Global Constraints

- **TDD**: write the failing test first, watch it fail, then implement. **One commit per task**; commit and push as you go. Branch `feat/attribute-predicate-anchors` off `main`; PR into `main`; never commit to `main` directly; never `--no-verify`.
- **HARD REVIEW GATE**: Tasks 3–4 add a **cross-account read gate** (worker/permission-touching). Permissions are enforced at the DO/REST boundary only — never by post-hoc CRDT cell rejection. The PR body must call this out; the non-member-sees-nothing tests are non-negotiable.
- **No `any`, no type assertions** (`lint-plugins/no-type-assertion.grit` errors on every `as`/`<T>`; `as const` allowed). Make types honest at the source.
- **Soft-delete only** (`deletedAt` tombstones); **IDs are client-generated ULIDs** (`newId()`); the projection reuses the annotation's ULID as `noteId` so identities survive.
- **D1 is a pure index**: the new table is an alarm-written projection of the account doc — non-destructive, idempotent, tombstone-aware, DO is the single writer. **Every new D1 query gets an `expectIndexedQuery` test** (EXPLAIN, no SCAN).
- **Components never touch Automerge or RPC** — only `apps/web/src/store/` and `apps/web/src/ui`. (Pure domain functions like `matchPredicate` may be imported by components, same as `matchesFigureType` today.)
- **Referential stability** per `docs/system/sync-and-offline.md` § Flicker & referential stability: this is the first content-dependent read path — unchanged match sets must keep object identity (memoize like `readOwnFamilyNotes` / `useStableFamilyNotesByFigure`).
- **Worker/DO tests**: `isolatedStorage: false`, so every test uses a unique DO id (`test-support/do-id.ts`); D1 is shared across the run — unique user ids per test too.
- **Never invent domain data**; registry values come from the merged registry only.
- Package filters: domain = `@weavesteps/domain`, worker = `worker`, web = `web`. Gates: `pnpm -w lint && pnpm -w typecheck` before every commit (lefthook also enforces on staged files).

### Verified idea-vs-code deltas this plan resolves (read before Task 1)

1. **`zAnchor` is NOT lenient** — it is a `z.discriminatedUnion` pinned by `z.ZodType<Anchor>`, and `parseAnchors` returns `null` for the **whole array** if any element is unknown. The idea's "lenient readers ignore unknown anchor types" is true of the actual **readers** (account-doc reads go through `A.toJS` + `readAccount` with no zod; every consumer filters by `anchor.type === "figureType"` and skips the rest — verified in `toOwnFamilyNote`, `projectAccountToD1`, `matchesFigureType`), **not** of the schema. The `z.ZodType<Anchor>` pin means the union change won't compile until `zAnchor` gains the member — Task 1 changes both together, and adds a regression test that the old three-variant corpus keeps parsing. The one runtime `parseAnchors` consumer (`doc-do.ts:671`, the **routine**-annotation DocOp path) never sees predicate anchors from this plan's write paths (predicate notes are account-doc data), but after Task 1 it accepts them anyway.
2. **The "custom badge" comparison does not itself normalize.** `attrKey` (`library.ts:148`) / `attrMeaning` (`fork.ts:106`) compare raw `JSON.stringify(a.value)`. The registry read-alias normalization is `normalizeValue(kind, value)` (`vocabulary.ts:458`), applied on the read path by `withNormalizedValue` in `schemas.ts`. `matchPredicate` therefore calls `normalizeValue` on **both** sides of the comparison — that is the "matched by meaning" the idea specifies.
3. **`scope: "routine"` needs a routine identity.** The idea's anchor shape has no field naming *which* choreo; the plan adds `routineRef?: string`, required iff `scope === "routine"` (enforced in `zAnchor`'s `superRefine`, exactly the WEP-0004 timed-anchor precedent).
4. **The shipped picker has no disabled "An attribute · coming later" row** — that affordance exists only in the design bundle (v4 § 3.4/3.6). The shipped `JournalLinkPicker` is choreo-first (choreo → figure → place → scope). Task 6 "graduates" the design affordance by **adding** a target step + the attribute path; there is no shipped disabled row to flip.
5. **Doc section names**: the real headings are `docs/system/architecture.md` § "D1 — the index & projections" (the idea says "§ Annotations & projections") and `docs/concepts/annotations.md` § "Anchors — what a note points at". Task 9 targets the real headings.

## Exact signatures this plan builds on (verbatim from the codebase)

**The anchor union — `packages/domain/src/doc-types.ts:124`** (Task 1 appends a fourth member):

```ts
export type Anchor =
  | { type: "point"; figureRef: string; count: number; role?: Role }
  | { type: "figure"; figureRef: string }
  | {
      type: "figureType";
      figureType: FigureType;
      danceScope: DanceId | "all";
      /** WEP-0004 (docs/concepts/annotations.md § Anchors): pin the note to one
       *  count of every matching figure. Only
       *  valid with a CONCRETE danceScope — counts don't align across dances
       *  (zAnchor enforces this; absent = the whole figure, the v1 shape). */
      count?: number;
      /** WEP-0004 (docs/concepts/annotations.md § Anchors): narrow a timed note to one side (absent/null = both). */
      role?: Role;
    };
```

**The runtime validator — `packages/domain/src/schemas.ts:36`** (note the `z.ZodType<Anchor>` pin and the `superRefine` precedent Task 1 extends):

```ts
export function parseAnchors(input: unknown): Anchor[] | null {
  const result = z.array(zAnchor).safeParse(input);
  return result.success ? result.data : null;
}

export const zAnchor: z.ZodType<Anchor> = z
  .discriminatedUnion("type", [
    /* point, figure, figureType — three members today */
  ])
  .superRefine((anchor, ctx) => {
    if (
      anchor.type === "figureType" &&
      anchor.danceScope === "all" &&
      (anchor.count != null || anchor.role != null)
    ) {
      ctx.addIssue({ code: "custom", message: "a timed figureType anchor cannot span all dances" });
    }
  });
```

**Attribute + alias normalization** — `packages/domain/src/doc-types.ts:29` and `vocabulary.ts:458`:

```ts
export type Attribute = {
  id: string;
  kind: string;
  /** Float count relative to figure start; fraction → e/&/a (US-004). */
  count: number;
  role?: Role;
  value: unknown;
  deletedAt?: number | null;
};

export function normalizeValue(kind: string, value: string): string {
  return VALUE_ALIASES[kind]?.[value] ?? value;
}
```

**The badge's meaning key (raw, un-normalized — see delta #2)** — `packages/domain/src/library.ts:148` (twin `attrMeaning` at `fork.ts:106`):

```ts
const attrKey = (a: Attribute): string =>
  `${a.kind}|${a.count}|${a.role ?? ""}|${JSON.stringify(a.value)}`;
```

**Resolved-timeline inputs** — `packages/domain/src/fork.ts:134` and `figure-grid.ts:92` (matching runs over `resolveFigure` OUTPUT — post-variant, what the dancer actually sees):

```ts
export function resolveFigure(
  base: Pick<FigureDoc, "attributes" | "counts" | "bars">,
  variant: FigureDoc,
): FigureDoc

export function resolveFigureCounts(figure: {
  counts?: number;
  bars?: number;
  attributes: Attribute[];
  dance: DanceId;
}): number
```

**Registry** — `packages/domain/src/vocabulary.ts` (`RegistryKind { kind, label, color, cardinality, valueType, values?, freeText?, ... }`):

```ts
export function mergeRegistry(
  base: StandardRegistry,
  custom: RegistryKind[],
): StandardRegistry & Record<string, RegistryKind>

export function kindAppliesToDance(kind: string, dance: DanceId | undefined): boolean
```

**Account-doc mutator precedent** — `packages/domain/src/doc-account.ts:171` (Task 1's `addPredicateNote` mirrors this):

```ts
export function addFamilyNote(
  doc: A.Doc<AccountDoc>,
  input: {
    authorId: string;
    kind: AnnotationKind;
    text: string;
    figureType: string;
    danceScope: DanceId | "all";
    tags?: string[];
    count?: number;
    role?: Role;
  },
): A.Doc<AccountDoc>
```

**The identity-match precedent the matcher generalizes** — `packages/domain/src/figuretype.ts:30`:

```ts
export function matchesFigureType(anchor: Anchor, figure: FigureDoc): boolean {
  if (anchor.type !== "figureType") return false;
  if (anchor.figureType !== figure.figureType) return false;
  return anchor.danceScope === "all" || anchor.danceScope === figure.dance;
}
```

**The family-note index module the new index mirrors EXACTLY** — `apps/worker/src/db/family-notes.ts`:

```ts
export async function familyNotesForMembers(
  db: D1Database,
  authorIds: string[],
  dance: string,
): Promise<FamilyNoteRow[]> {
  if (authorIds.length === 0) return [];
  const placeholders = authorIds.map(() => "?").join(",");
  const sql =
    `SELECT noteId, accountDocRef, authorId, figureType, danceScope, kind, text, count, role, updatedAt FROM figure_type_note_index ` +
    `WHERE deletedAt IS NULL AND (danceScope = ? OR danceScope = 'all') ` +
    `AND authorId IN (${placeholders})`;
  const res = await db
    .prepare(sql)
    .bind(dance, ...authorIds)
    .all<FamilyNoteRow>();
  return res.results ?? [];
}

export async function projectFamilyNotes(
  db: D1Database,
  notes: FamilyNoteProjection[],
): Promise<void> {
  if (notes.length === 0) return;
  const now = Date.now();
  const stmts = notes.map((n) =>
    db
      .prepare(
        `INSERT INTO figure_type_note_index (noteId, accountDocRef, authorId, figureType, danceScope, kind, text, count, role, updatedAt, deletedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(noteId) DO UPDATE SET
           accountDocRef = excluded.accountDocRef, authorId = excluded.authorId,
           figureType = excluded.figureType, danceScope = excluded.danceScope,
           kind = excluded.kind, text = excluded.text, count = excluded.count,
           role = excluded.role, updatedAt = excluded.updatedAt, deletedAt = excluded.deletedAt`,
      )
      .bind(n.noteId, `account:${n.authorId}`, n.authorId, n.figureType, n.danceScope, n.kind, n.text, n.count, n.role, now, n.deletedAt),
  );
  await db.batch(stmts);
}
```

with `FamilyNoteProjection = { noteId; authorId; figureType; danceScope; kind; text; count: number | null; role: string | null; deletedAt: number | null }` and `FamilyNoteRow` adding `accountDocRef` + `updatedAt: number`.

**The account-DO alarm projection call site** — `apps/worker/src/doc-do.ts` (Task 3 appends a second collection loop here; the alarm at `doc-do.ts:1134` already calls `projectAccountToD1()` best-effort at line 1164):

```ts
  private async projectAccountToD1(): Promise<void> {
    /* … doc_meta type gate, loadPersistedAccount … */
    const account = readAccount(doc, { includeDeleted: true });
    const userId = account.ownerId;
    await projectLibraryEntries(this.env.DB, userId, account.libraryFigureRefs ?? []);
    // Family notes — one row per figureType annotation, tombstones carried.
    const notes: FamilyNoteProjection[] = [];
    for (const a of account.annotations) {
      const anchor = a.anchors.find((an) => an.type === "figureType");
      if (anchor?.type !== "figureType") continue;
      notes.push({
        noteId: a.id, authorId: userId, figureType: anchor.figureType,
        danceScope: anchor.danceScope, kind: a.kind, text: a.text,
        count: anchor.count ?? null, role: anchor.role ?? null,
        deletedAt: a.deletedAt ?? null,
      });
    }
    await projectFamilyNotes(this.env.DB, notes);
  }
```

**The account-op RPC surface** — `apps/worker/src/doc-do.ts:96` (`AccountOp` union: `addFamilyNote` / `addAccountReply` / `deleteFamilyNote` / `addLibraryRef` / `removeLibraryRef`) applied by `applyAccountOp` via `async applyAccountEdit(op: AccountOp): Promise<{ id: string | null; changed: boolean }>` (`doc-do.ts:562`); `export function accountDocRef(userId: string): string` and `export async function ensureAccountDoc(env: Env, userId: string): Promise<void>` (`ensure-account-doc.ts:25,37`); `async runAlarmForTest(): Promise<void>` (`doc-do.ts:1292`).

**The gated read route the new route clones** — `apps/worker/src/index.ts:649` (`GET /api/routines/:id/family-notes`): `authenticate(c)` → 401; `resolveEffectiveRole(c.env.DB, routineRef, user.sub)` → null ⇒ 403 **before any note is read**; registry lookup for `dance`/`ownerId`; author set = `listMembers(...)` ∪ owner (the #168 owner-elevation fix); then `familyNotesForMembers(c.env.DB, authorIds, dance)` and rows are shaped as Annotation-like notes with a `figureType` anchor.

**The migration convention** — plain SQL files `apps/worker/migrations/00NN_name.sql` (latest: `0018_timed_family_notes.sql`; next is **0019**), picked up by `applyMigrations()` (`apps/worker/src/test-support/seed.ts`) in tests and applied to envs per the `ballroom-flow-run-and-operate` skill (wrangler D1 migrations). `figure_type_note_index` (migration 0005) has PK `noteId` plus `idx_ftni_family (figureType, danceScope)` and `idx_ftni_author (authorId, deletedAt)`.

**Worker test helpers** — `test-support/explain.ts` (`expectIndexedQuery(db, sql, params, opts?)` — asserts EXPLAIN QUERY PLAN has no SCAN), `test-support/do-id.ts` (`uniqueDocName(prefix = "doc"): string`, `uniqueDocStub(namespace, prefix)`), `test-support/seed.ts` (`applyMigrations`, `seedDb`), `test-support/authed-context.ts` + `test-support/jwt.ts` (`authedContext`, `generateTestKeypair`). Model test file for the whole worker slice: `apps/worker/src/figuretype-visibility.test.ts` (incl. its `runAccountAlarm(userId)` helper: `env.DOC_DO.get(env.DOC_DO.idFromName(`account:${userId}`)).runAlarmForTest()`).

**The web store seam being mirrored** — `apps/web/src/store/family-notes.ts` (`interface FamilyNote { id; authorId; kind; text; figureType; danceScope; count?; role?; anchors: Anchor[]; createdAt? }`, `loadFamilyNotes(routineId: string, token: string | null, baseUrl = ""): Promise<FamilyNote[]>` via `apiGet`); `apps/web/src/store/account.ts` (`interface OwnFamilyNote`, `AccountStore.readOwnFamilyNotes(): OwnFamilyNote[]` with the `ownNotesCache` memo keyed on the reconcile-stable `annotations` array, `createFamilyNote(input): void` = `conn.commit(addFamilyNote(conn.current(), { authorId: currentUserId, ...input }))`, `deleteFamilyNote(noteId)` = `conn.commit(softDeleteAccountAnnotation(...))`); `apps/web/src/store/use-account.ts` (`useAccount()`, `useOwnFamilyNotes(store)` via `useSyncExternalStore`, the `IDLE_STORE` + stable-empty pattern); `apps/web/src/store/journal.ts:250` (`mergeLiveFamilyNotes(entries, liveNotes, currentUserId)` — the read-your-writes merge, REST row wins on dedupe); `apps/web/src/store/routine.ts:96` (`interface ResolvedPlacement { placement; figure: FigureDoc | null; status; fromLiveDoc? }` — **`figure` is already the resolved figure**); `apps/web/src/components/RoutineReadingView.tsx:371` (`useStableFamilyNotesByFigure(familyNotes, figures): Map<string, FamilyNote[]>` with the `prevRef` reuse pattern and the `MarginNote`/`familyMarginNote` fold); `apps/web/src/components/Assemble.tsx:470–519` (co-member REST load + own-live merge deduped by id, passed as `familyNotes` to the reading view and the thread panel).

**E2E harness** — `apps/web/e2e/support/`: `seedAuth(page, userId)`, `resetDb(page)`, `seedDb(page, fixture)` (`auth.ts`/`fixtures.ts`), `openUser(browser, userId)` / `openTwoUsers(...)` (`two-users.ts`; two isolated contexts, no sleeps — web-first assertions only). Smoke convention: `test.describe("@smoke …", …)` with a header comment naming docs + intent (see `journal.spec.ts`).

**Design source** — `docs/design/project/Ballroom Wireframes v4.dc.html` § "3.6 · Link picker — ATTRIBUTE": family chips (Body position, Rise & fall, Footwork, Sway, Turn) → VALUE list including the explicit **None** row → role → scope; the § 3.4 "coming later · v1.1" affordance graduates by this plan.

---

### Task 1: Domain — the `attributePredicate` anchor variant (+ schema + account mutator)

**Files:**
- Modify: `packages/domain/src/doc-types.ts` (the `Anchor` union)
- Modify: `packages/domain/src/schemas.ts` (`zAnchor` member + `superRefine`)
- Modify: `packages/domain/src/doc-account.ts` (`addPredicateNote`)
- Modify: `packages/domain/src/index.ts` (export)
- Create: `packages/domain/src/predicate-anchor.test.ts`

**Interfaces produced:**

```ts
// Appended to the Anchor union (doc-types.ts):
| {
    type: "attributePredicate";
    /** A kind from the MERGED registry (builtin or custom). */
    kind: string;
    /** A value of that kind, matched BY MEANING via normalizeValue read-aliases,
     *  or the absence sentinel PREDICATE_NONE ("no value of `kind` logged"). */
    value: string;
    /** Narrow to one side; absent = either/both. */
    role?: Role;
    /** "all" = every dance · a DanceId = that dance's choreos · "routine" = one choreo. */
    scope: DanceId | "all" | "routine";
    /** The confined choreo — REQUIRED iff scope === "routine" (zAnchor enforces; delta #3). */
    routineRef?: string;
  }

// doc-account.ts, mirroring addFamilyNote:
export function addPredicateNote(
  doc: A.Doc<AccountDoc>,
  input: {
    authorId: string;
    kind: AnnotationKind;
    text: string;
    attrKind: string;
    attrValue: string;
    attrRole?: Role;
    scope: DanceId | "all" | "routine";
    routineRef?: string;
    tags?: string[];
  },
): A.Doc<AccountDoc>  // pushes an Annotation with one attributePredicate anchor (newId() ULID)
```

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/predicate-anchor.test.ts
// attribute-predicate-anchors — the fourth Anchor variant (docs/ideas/attribute-predicate-anchors.md
// § Design details). zAnchor is a discriminatedUnion pinned by z.ZodType<Anchor>, so the union
// and the schema move in ONE commit; readers stay lenient by structure (they filter on
// anchor.type), which this file also pins for the existing corpus.
import { describe, expect, it } from "vitest";
import { readAccount } from "./doc-account";
import { addPredicateNote, buildAccountDoc } from "./doc-account";
import { CURRENT_SCHEMA_VERSION } from "./migrations";
import { parseAnchors } from "./schemas";

const predicate = {
  type: "attributePredicate",
  kind: "sway",
  value: "left",
  role: "leader",
  scope: "waltz",
} as const;

describe("attributePredicate anchor: schema", () => {
  it("round-trips an attributePredicate anchor through parseAnchors", () => {
    expect(parseAnchors([predicate])).toEqual([predicate]);
    expect(parseAnchors([{ type: "attributePredicate", kind: "sway", value: "none", scope: "all" }]))
      .toEqual([{ type: "attributePredicate", kind: "sway", value: "none", scope: "all" }]);
  });

  it("keeps the whole v1 corpus parsing unchanged (leniency regression)", () => {
    const corpus = [
      { type: "point", figureRef: "f1", count: 2 },
      { type: "figure", figureRef: "f1" },
      { type: "figureType", figureType: "whisk", danceScope: "waltz", count: 3, role: "leader" },
    ] as const;
    expect(parseAnchors([...corpus])).toEqual([...corpus]);
  });

  it("requires routineRef exactly when scope is 'routine'", () => {
    expect(
      parseAnchors([{ type: "attributePredicate", kind: "sway", value: "left", scope: "routine" }]),
    ).toBeNull(); // routine scope without a routineRef is unresolvable
    expect(
      parseAnchors([
        { type: "attributePredicate", kind: "sway", value: "left", scope: "routine", routineRef: "r1" },
      ]),
    ).not.toBeNull();
    expect(
      parseAnchors([
        { type: "attributePredicate", kind: "sway", value: "left", scope: "waltz", routineRef: "r1" },
      ]),
    ).toBeNull(); // a stray routineRef on a dance/all scope is rejected — anchors stay canonical
  });
});

describe("addPredicateNote", () => {
  it("pushes an annotation carrying ONE attributePredicate anchor, ULID id, no tombstone", () => {
    const doc = buildAccountDoc({
      id: "acct", ownerId: "u1", annotations: [],
      libraryFigureRefs: [], schemaVersion: CURRENT_SCHEMA_VERSION, deletedAt: null,
    });
    const after = addPredicateNote(doc, {
      authorId: "u1", kind: "note", text: "soften it",
      attrKind: "sway", attrValue: "left", attrRole: "leader", scope: "waltz",
    });
    const [a] = readAccount(after).annotations;
    expect(a?.anchors).toEqual([
      { type: "attributePredicate", kind: "sway", value: "left", role: "leader", scope: "waltz" },
    ]);
    expect(a?.authorId).toBe("u1");
    expect(a?.deletedAt ?? null).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @weavesteps/domain exec vitest run predicate-anchor`
Expected: FAIL — `addPredicateNote` not exported; `parseAnchors([predicate])` returns `null` (discriminatedUnion rejects the unknown type).

- [ ] **Step 3: Implement**

  - `doc-types.ts`: append the variant above to `Anchor` (with the doc comments). `pnpm -w typecheck` now FAILS in `schemas.ts` — the `z.ZodType<Anchor>` pin doing its job.
  - `schemas.ts`: add to the `discriminatedUnion` (mirror the `figureType` member's style):

    ```ts
    z.object({
      type: z.literal("attributePredicate"),
      kind: z.string(),
      value: z.string(),
      role: z.enum(["leader", "follower"]).nullish(),
      scope: z.union([z.custom<DanceId>(isDanceId), z.literal("all"), z.literal("routine")]),
      routineRef: z.string().optional(),
    }),
    ```

    and extend the existing `superRefine`: `anchor.type === "attributePredicate"` ⇒ issue when `(anchor.scope === "routine") !== (anchor.routineRef != null)` (message: `"a routine-scoped predicate anchor requires exactly its routineRef"`).
  - `doc-account.ts`: `addPredicateNote` mirroring `addFamilyNote` verbatim (conditional spreads for `role`/`routineRef`, `tags: input.tags ?? []`, `replies: []`, `createdAt: Date.now()` — copy `addFamilyNote`'s body shape exactly).
  - `index.ts`: export `addPredicateNote` alongside `addFamilyNote`.

- [ ] **Step 4: Verify green**

Run: `pnpm --filter @weavesteps/domain exec vitest run predicate-anchor && pnpm --filter @weavesteps/domain exec vitest run anchor-schema && pnpm -w typecheck && pnpm -w lint`
Expected: new tests PASS, the WEP-0004 anchor-schema suite untouched, typecheck/lint clean.

- [ ] **Step 5: Commit**

```bash
git checkout -b feat/attribute-predicate-anchors
git add packages/domain/src/doc-types.ts packages/domain/src/schemas.ts packages/domain/src/doc-account.ts packages/domain/src/index.ts packages/domain/src/predicate-anchor.test.ts
git commit -m "feat(domain): attributePredicate anchor variant + schema + addPredicateNote"
git push -u origin feat/attribute-predicate-anchors
```

---

### Task 2: Domain — pure `matchPredicate` over resolved timelines

**Files:**
- Create: `packages/domain/src/predicate.ts`
- Create: `packages/domain/src/predicate.test.ts`
- Modify: `packages/domain/src/index.ts` (export)

**Interfaces produced:**

```ts
// packages/domain/src/predicate.ts
export const PREDICATE_NONE = "none";

/**
 * The counts of `figure` an attributePredicate anchor matches — sorted, deduped.
 * PURE; operates on a RESOLVED figure snapshot (post-variant resolveFigure output).
 * Returns [] for non-attributePredicate anchors and out-of-scope dances.
 * routineRef confinement (scope "routine") is the CALLER's gate — a bare figure
 * doesn't know its routine.
 */
export function matchPredicate(
  anchor: Anchor,
  figure: Pick<FigureDoc, "dance" | "attributes" | "counts" | "bars">,
): number[]
```

Semantics (from the idea's Design details, delta #2 applied):
- **Scope gate**: `"all"` always passes; a `DanceId` requires `figure.dance` equality; `"routine"` passes here (caller confines by `routineRef`).
- **Applicable attribute**: live (`deletedAt == null`), `a.kind === anchor.kind`, and role-compatible — `anchor.role == null || a.role == null || a.role === anchor.role` (a both-sides value applies to either role lens).
- **Value match** (`value !== PREDICATE_NONE`): matched counts are the `a.count` values of applicable attributes where `typeof a.value === "string" && normalizeValue(anchor.kind, a.value) === normalizeValue(anchor.kind, anchor.value)`. Unknown persisted values pass through `normalizeValue` unchanged and match nothing known (a non-string `value` never matches).
- **Absence sentinel** (`value === PREDICATE_NONE`): matched counts are the whole beats `1..resolveFigureCounts(figure)` carrying **no** applicable live attribute — an attribute at count `c` claims beat `Math.floor(c)` (the `beatOf` convention, `fork.ts:111`). Role-scoped absence falls out of the applicability rule: with `anchor.role: "follower"`, a leader-only value does not block the beat.

- [ ] **Step 1: Write the failing test** — `packages/domain/src/predicate.test.ts` with a header comment citing the idea's Test plan. Cases (use plain `FigureDoc` literals + `resolveFigure` from `./fork` for the variant case; helper `attr(kind, count, value, role?)` minting ids locally):
  - value match returns exactly the carrying counts, sorted (incl. a sub-beat count like `2.5`);
  - **alias normalization**: a persisted `direction: "diag_forward"` matches an anchor `value: "diagonal_forward"` and vice versa (`VALUE_ALIASES`, `vocabulary.ts:445`);
  - **`none` sentinel**: figure with `counts: 3` and sway only on count 1 → `[2, 3]`; **role-scoped absence**: leader-only sway on count 2, anchor `{ value: "none", role: "follower" }` → count 2 IS in the match set;
  - **role filter**: anchor `role: "leader"` matches leader and both-sides values, never follower-only;
  - **unknown-value pass-through**: persisted `"future_sway"` never matches anchor `"left"`; anchor `"future_sway"` matches a persisted `"future_sway"` (pass-through equality); a non-string persisted value matches nothing;
  - **dance scope**: DanceId scope mismatches → `[]`; `"all"` matches; non-predicate anchors → `[]`;
  - **tombstones**: a `deletedAt` attribute neither matches a value nor blocks `none`;
  - **dynamic re-resolution**: retag (replace the sway attribute with a tombstone + new value on another count), call again → the match set moved;
  - **variant resolution**: matching over `resolveFigure(base, variant)` sees the variant's owned-beat retag, not the base value;
  - **property (fast-check, already a domain devDep)**: for arbitrary attribute sets and anchors, the match set is sorted, duplicate-free, and ⊆ (attribute counts ∪ `1..resolveFigureCounts(figure)`) — the idea's "match set ⊆ resolved counts".

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @weavesteps/domain exec vitest run "src/predicate.test"` → FAIL: cannot find module `./predicate`.

- [ ] **Step 3: Implement** `predicate.ts` per the semantics block (import `normalizeValue` from `./vocabulary`, `resolveFigureCounts` from `./figure-grid`; no `Date.now()`, no I/O). Export `matchPredicate`, `PREDICATE_NONE` from `index.ts`.

- [ ] **Step 4: Verify green** — same vitest run + `pnpm -w typecheck && pnpm -w lint`; then the full domain suite once: `pnpm --filter @weavesteps/domain test`. Coverage note: domain threshold is ≥90 lines — a pure module with this test list clears it.

- [ ] **Step 5: Commit** — `feat(domain): matchPredicate — attribute-predicate matching over resolved timelines`.

---

### Task 3: Worker — migration 0019 + alarm projection from the account DO

**Files:**
- Create: `apps/worker/migrations/0019_attribute_predicate_note_index.sql`
- Create: `apps/worker/src/db/predicate-notes.ts`
- Modify: `apps/worker/src/doc-do.ts` (`AccountOp` + `applyAccountOp` + `projectAccountToD1`)
- Create: `apps/worker/src/predicate-projection.test.ts`

**Migration (mirrors 0005 + 0018's style — comment header citing the idea, then):**

```sql
CREATE TABLE IF NOT EXISTS attribute_predicate_note_index (
  noteId        TEXT PRIMARY KEY,        -- the Annotation id (reused ULID)
  accountDocRef TEXT NOT NULL,           -- account:<userId>
  authorId      TEXT NOT NULL,
  attrKind      TEXT NOT NULL,           -- merged-registry kind (builtin or custom)
  attrValue     TEXT NOT NULL,           -- registry value, or 'none' (absence sentinel)
  attrRole      TEXT,                    -- 'leader' | 'follower' | NULL = both
  scope         TEXT NOT NULL,           -- DanceId | 'all' | 'routine' ('routine' rows are
                                         -- projected for upsert-consistency but NEVER served
                                         -- cross-account: the read filters scope = dance|'all')
  kind          TEXT NOT NULL DEFAULT 'note',
  text          TEXT NOT NULL DEFAULT '',
  updatedAt     INTEGER NOT NULL,
  deletedAt     INTEGER                  -- soft-delete tombstone
);
CREATE INDEX IF NOT EXISTS idx_apni_predicate ON attribute_predicate_note_index (attrKind, attrValue, scope);
CREATE INDEX IF NOT EXISTS idx_apni_author ON attribute_predicate_note_index (authorId, deletedAt);
```

**Interfaces produced (`db/predicate-notes.ts`, mirroring `db/family-notes.ts` name-for-name):** `PredicateNoteRow { noteId; accountDocRef; authorId; attrKind; attrValue; attrRole: string | null; scope; kind; text; updatedAt }`, `PredicateNoteProjection { noteId; authorId; attrKind; attrValue; attrRole: string | null; scope; kind; text; deletedAt: number | null }`, `projectPredicateNotes(db, notes): Promise<void>` (stable-key upsert on `noteId`, `db.batch`, tombstones carried — copy `projectFamilyNotes` verbatim with the new columns), and Task 4's `predicateNotesForMembers`. **`doc-do.ts`**: `AccountOp` gains `{ op: "addPredicateNote"; authorId; kind: AnnotationKind; text: string; attrKind: string; attrValue: string; attrRole?: Role; scope: DanceId | "all" | "routine"; routineRef?: string; tags?: string[] }` → `applyAccountOp` dispatches to `addPredicateNote`; `projectAccountToD1` gains a second loop (`a.anchors.find((an) => an.type === "attributePredicate")`) building `PredicateNoteProjection[]` → `projectPredicateNotes` — same non-destructive/idempotent/tombstone-carrying shape as the family loop above it. **All** predicate annotations project (including `scope: "routine"`, stored as the literal `'routine'` — keeps the upsert authoritative if a note's scope ever changes; the read query excludes them structurally).

- [ ] **Step 1: Write the failing test** — `predicate-projection.test.ts`, modeled on `figuretype-visibility.test.ts`'s account-alarm section and `ensure-account-doc.test.ts`'s stub helper. Per-test-unique user ids (`uniqueDocName("u_pred")` — D1 + DO storage are shared, `isolatedStorage: false`):
  1. `applyMigrations()` in `beforeAll`; seed the user row (`seedDb`), `ensureAccountDoc(env, userId)`;
  2. `applyAccountEdit({ op: "addPredicateNote", authorId: userId, kind: "note", text: "soften", attrKind: "sway", attrValue: "left", attrRole: "leader", scope: "waltz" })` → returns the minted id; `runAlarmForTest()`; assert the `attribute_predicate_note_index` row (all columns, `deletedAt` NULL);
  3. **idempotent + non-destructive**: run the alarm again → still exactly one row, same `noteId`;
  4. **tombstone-aware**: `applyAccountEdit({ op: "deleteFamilyNote", annotationId: id })` (the existing op soft-deletes ANY account annotation via `softDeleteAccountAnnotation`) → alarm → the row carries `deletedAt`, never disappears;
  5. a `scope: "routine"` note (with `routineRef`) projects with `scope = 'routine'`.

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter worker exec vitest run predicate-projection` → FAIL (no table / unknown op).

- [ ] **Step 3: Implement** migration + module + the two `doc-do.ts` edits. No new alarm scheduling — `applyAccountEdit` already calls `maybeScheduleProjection()` and the alarm already calls `projectAccountToD1()` best-effort.

- [ ] **Step 4: Verify green** — the file's run + the full worker suite once (`pnpm --filter worker test`) + `pnpm -w typecheck && pnpm -w lint`. Worker coverage threshold ≥88 lines.

- [ ] **Step 5: Commit** — `feat(worker): attribute_predicate_note_index (migration 0019) + account-DO alarm projection`. **Reminder:** production/staging need `wrangler d1 migrations apply` on deploy (run-and-operate skill) — note it in the PR body.

---

### Task 4: Worker — the gated read route (HARD REVIEW GATE)

**Files:**
- Modify: `apps/worker/src/db/predicate-notes.ts` (`predicateNotesForMembers`)
- Modify: `apps/worker/src/index.ts` (`GET /api/routines/:id/predicate-notes`)
- Create: `apps/worker/src/predicate-visibility.test.ts`

**Interfaces produced:**

```ts
// db/predicate-notes.ts — the exact familyNotesForMembers shape:
export async function predicateNotesForMembers(
  db: D1Database,
  authorIds: string[],
  dance: string,
): Promise<PredicateNoteRow[]>
// SQL: SELECT noteId, accountDocRef, authorId, attrKind, attrValue, attrRole, scope, kind, text, updatedAt
//      FROM attribute_predicate_note_index
//      WHERE deletedAt IS NULL AND (scope = ? OR scope = 'all') AND authorId IN (…)
// []-fast-path on empty authorIds; 'routine' rows are excluded structurally by the scope filter.
```

Route: clone the family-notes route body (`index.ts:649–` quoted above) — `authenticate` → 401; **`resolveEffectiveRole` null → 403 before any read**; registry `dance`/`ownerId`; authorIds = members ∪ owner (keep the #168 owner-elevation comment); `predicateNotesForMembers`; respond `{ notes }` where each note is `{ id, authorId, kind, text, createdAt: updatedAt, anchors: [{ type: "attributePredicate", kind: attrKind, value: attrValue, scope, …(attrRole ? { role } : {}) }] }` — the same Annotation-like shaping as family notes so the client matcher consumes `Anchor`s. (`scope` from D1 is a string; narrow it with `isDanceId(scope) || scope === "all"` before building the anchor and skip malformed rows — no casts.)

- [ ] **Step 1: Write the failing test** — `predicate-visibility.test.ts`, cloning `figuretype-visibility.test.ts`'s scenario (coach/student/stranger, one shared routine, seeded via `seedDb` + the Task 3 write path + `runAlarmForTest`, seeded ONCE per file like the model). Assertions:
  - the **co-member** (student, commenter) GETs 200 with the coach's dance-scoped note (full content + anchor shape);
  - the **author** sees their own note on their own routine (owner-elevation arm);
  - a **non-member** (stranger) gets **403 with zero rows read**;
  - an `'all'`-scoped note surfaces on the dance routine; a mismatched-dance note does not; a `'routine'`-scoped note **never** comes back from this route;
  - unauthenticated → 401;
  - **`expectIndexedQuery`** on the EXACT runtime SQL of `predicateNotesForMembers` (mirror the model's comment: the test must mirror the query the code runs, or it proves an index for a path never taken) — no SCAN (uses `idx_apni_author`).

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter worker exec vitest run predicate-visibility` → FAIL (404 route).

- [ ] **Step 3: Implement** the query + route.

- [ ] **Step 4: Verify green** — file run, full worker suite, `pnpm -w typecheck && pnpm -w lint`.

- [ ] **Step 5: Commit** — `feat(worker): co-membership-gated predicate-note read (GET /api/routines/:id/predicate-notes)`.

---

### Task 5: Web store — the predicate-note seam + materializer

**Files:**
- Create: `apps/web/src/store/predicate-notes.ts`
- Modify: `apps/web/src/store/account.ts` (`OwnPredicateNote`, `readOwnPredicateNotes`, `createPredicateNote`; `IDLE_STORE` counterpart in `use-account.ts`)
- Modify: `apps/web/src/store/use-account.ts` (`useOwnPredicateNotes`)
- Create: `apps/web/src/store/predicate-notes.test.ts`; extend `apps/web/src/store/account.test.ts` and `apps/web/src/store/use-account.test.tsx`

**Interfaces produced:**

```ts
// store/predicate-notes.ts — mirrors store/family-notes.ts:
export interface PredicateNote {
  id: string; authorId: string; kind: AnnotationKind; text: string;
  attrKind: string; attrValue: string; role?: "leader" | "follower";
  scope: string; anchors: Anchor[]; createdAt?: number;
}
export async function loadPredicateNotes(
  routineId: string, token: string | null, baseUrl = "",
): Promise<PredicateNote[]>  // apiGet `${baseUrl}/api/routines/${routineId}/predicate-notes`

/** Own ∪ co-member merge, deduped by id, REST row wins (the mergeLiveFamilyNotes rule —
 *  own live notes filtered to those applying to `routineId`+`dance`: scope 'all', the
 *  routine's dance, or scope 'routine' with this routineRef). PURE. */
export function mergePredicateNotes(
  coMember: PredicateNote[], own: OwnPredicateNote[],
  currentUserId: string | undefined, routineId: string, dance: string,
): PredicateNote[]

// store/account.ts — mirrors OwnFamilyNote/readOwnFamilyNotes exactly:
export interface OwnPredicateNote {
  id: string; kind: AnnotationKind; text: string;
  attrKind: string; attrValue: string; role?: Role;
  scope: DanceId | "all" | "routine"; routineRef?: string; createdAt: number;
}
// AccountStore gains:
readOwnPredicateNotes(): OwnPredicateNote[];   // memoized against the reconcile-stable annotations array
createPredicateNote(input: { attrKind: string; attrValue: string; role?: Role;
  scope: DanceId | "all" | "routine"; routineRef?: string;
  kind: AnnotationKind; text: string }): void; // conn.commit(addPredicateNote(conn.current(), { authorId: currentUserId, … }))
// deletion REUSES deleteFamilyNote(noteId) — softDeleteAccountAnnotation tombstones ANY account annotation.
```

- [ ] **Step 1: Write the failing tests** (mirror the existing store test files' harness — injected fake connections, no real sockets):
  - `readOwnPredicateNotes` flattens an `attributePredicate` annotation (and returns **the same array identity** across reads when the annotations subtree is unchanged — the `ownNotesCache` referential-stability contract; a family-note annotation does not leak in, and vice versa for `readOwnFamilyNotes`);
  - `createPredicateNote` lands the annotation in the account doc (read back via `readOwnPredicateNotes`), offline-capable (works before a socket, like `createFamilyNote`);
  - `mergePredicateNotes` dedupes by id with the REST row winning; filters own notes by scope applicability (dance / `'all'` / matching `routineRef`; a `'routine'` note for ANOTHER routine stays out); stable result for empty inputs;
  - `useOwnPredicateNotes` returns the stable empty list on the idle store (extend `use-account.test.tsx`);
  - `loadPredicateNotes` hits the route path with the token (mirror `family-notes` loader coverage).

- [ ] **Step 2: Run to verify failure** — `pnpm --filter web exec vitest run predicate-notes` (+ the extended files) → FAIL.

- [ ] **Step 3: Implement** — copy the family-note patterns quoted in "Exact signatures"; add the `IDLE_STORE` no-op members and a module-level stable `EMPTY` result.

- [ ] **Step 4: Verify green** — file runs + full web store suite + `pnpm -w typecheck && pnpm -w lint`.

- [ ] **Step 5: Commit** — `feat(web/store): predicate-note seam — own live + co-member REST, merged`.

---

### Task 6: Web — the attribute path in the link picker (v4 § 3.6)

**Files:**
- Modify: `apps/web/src/components/JournalLinkPicker.tsx`
- Modify: `apps/web/src/components/JournalEntryEditor.tsx` + `apps/web/src/components/Journal.tsx` (save path wiring)
- Modify: `apps/web/src/i18n/messages/journal.ts` (new strings)
- Create: `apps/web/src/components/predicate-picker.test.tsx`; extend `apps/web/src/components/a11y.test.tsx`

**Design:** `docs/design/project/Ballroom Wireframes v4.dc.html` § "3.6 · Link picker — ATTRIBUTE" — recreate pixel-for-pixel per CLAUDE.md; the § 3.4 "coming later · v1.1" affordance graduates by existing (delta #4: there is no shipped disabled row — the shipped picker gains a **target** step). Flow grafted onto the shipped choreo-first picker: choreo → **target** ("A figure from this choreo" › the existing figure/place path · "An attribute" › the new path) → **family** (one row per merged-registry kind, `mergeRegistry(ATTRIBUTE_REGISTRY, customKinds)`, gated by `kindAppliesToDance(kind, routine.dance)` — Tango omits `rise`) → **value** (the kind's `values` chips + free-text input for `freeText` kinds + the explicit **"No value logged"** row = `PREDICATE_NONE`) → **role** (`SegmentedToggle` Both/Leader/Follower, reuse `RoleLens`) → **scope** (*this choreo only* · *all my 〈dance〉 choreos* · *every dance*; same `danceScopeAvailable` gating as today). `JournalLinkPickerProps` gains `customKinds?: RegistryKind[]` (passed from the store-backed caller, like the registry reaches other surfaces). `JournalLink` gains:

```ts
| { home: "accountPredicate"; attrKind: string; attrValue: string;
    role?: "leader" | "follower"; scope: DanceId | "all" | "routine";
    routineRef?: string; anchor: Anchor; label: string }
```

with `anchor = { type: "attributePredicate", kind, value, …(role), scope, …(scope === "routine" ? { routineRef: routine.docRef } : {}) }` and chip label in the design's voice: *"↳ all left sways · every dance"* / *"↳ no sway logged · Waltz"*. Save path: the entry editor routes `home: "accountPredicate"` to `account.store.createPredicateNote(...)` (the store seam — offline-capable; **no** REST write route exists or is needed).

- [ ] **Step 1: Failing component tests** — `predicate-picker.test.tsx`: walking choreo → An attribute → Sway → Left → Leader → every dance calls `onPick` with the exact `JournalLink` + anchor above; the "No value logged" row yields `attrValue: "none"`; a custom kind from `customKinds` appears in the family list; `rise` is absent for a Tango choreo; back-navigation returns through the steps; the figure path is untouched (regression). Extend `a11y.test.tsx`: axe on each new picker step (the existing per-surface pattern).
- [ ] **Step 2: Verify failure** — `pnpm --filter web exec vitest run predicate-picker` → FAIL.
- [ ] **Step 3: Implement** picker steps + editor/Journal save wiring + i18n strings (both locales the messages files carry).
- [ ] **Step 4: Verify green** — file + `a11y` + full web component suite; `pnpm -w typecheck && pnpm -w lint`.
- [ ] **Step 5: Commit** — `feat(web): attribute-predicate path in the link picker (v4 § 3.6)`.

---

### Task 7: Web — surface predicate notes on matching steps

**Files:**
- Modify: `apps/web/src/components/RoutineReadingView.tsx` (prop + `useStablePredicateNotesByFigure` + margin fold)
- Modify: `apps/web/src/components/Assemble.tsx` (load + merge + pass-through; thread panel set)
- Extend: `apps/web/src/components/reading-view.test.tsx` (or a sibling `predicate-surfacing.test.tsx`)

**Design:** `RoutineReadingView` gains `predicateNotes?: PredicateNote[]`. A hook mirroring `useStableFamilyNotesByFigure` (quoted above) computes `Map<figureId, Array<{ note: PredicateNote; counts: number[] }>>` by running **`matchPredicate(anchor, rp.figure)`** over each `ResolvedPlacement`'s already-resolved `figure` (pure domain import — allowed, same as `matchesFigureType` today), confining `scope: "routine"` anchors to `anchor.routineRef === routine.id`. **Referential stability**: `prevRef` reuse — a figure whose matched (note-ids × counts) set is unchanged keeps its previous array identity, so an unrelated doc change re-renders nothing (§ Flicker & referential stability; this is the first content-dependent read path — the test below pins it). Matched notes fold into the **same** `MarginNote` merged newest-first set as family notes (adapter like `familyMarginNote`; a predicate note lands on each matched **count row**'s cell — the WEP-0004 timed-note cell machinery — with the figure-header cell as the soft fallback when the count row isn't rendered). `Assemble.tsx`: mirror its family-note block — `loadPredicateNotes` (best-effort, reload after authoring) + `useOwnPredicateNotes` + `mergePredicateNotes`, passed to the reading view and folded into the same thread-panel note set the margin opens (`onOpenThread` / the `FamilyNotes` panel list at `Assemble.tsx:1272`).

- [ ] **Step 1: Failing tests** — with an injected store snapshot (the reading-view test harness): a `sway/left/waltz` note surfaces in the margin cell of every count carrying a left sway across two placements and NOT on non-matching counts; a `none` note surfaces on value-free counts; changing an unrelated annotation keeps the per-figure array identities (referential stability — assert `Map` value identity across renders); a `routine`-scoped note only surfaces on its own routine; merged cell set stays newest-first with family notes interleaved.
- [ ] **Step 2: Verify failure**, **Step 3: Implement**, **Step 4: Verify green** (file + full web suite + lint/typecheck).
- [ ] **Step 5: Commit** — `feat(web): predicate notes surface on matching steps (margin + thread panel)`.

---

### Task 8: Ship gate — `apps/web/e2e/attribute-predicate-anchors.spec.ts`

**Files:** Create `apps/web/e2e/attribute-predicate-anchors.spec.ts`.

Header comment citing the idea's ship gate + the docs; `test.describe("@smoke attribute-predicate anchors", …)` (this journey is the feature's PR gate). Harness: `resetDb`/`seedDb`/`seedAuth` + `openTwoUsers` (no sleeps — web-first assertions only, per `two-users.ts`). Three journeys, verbatim from the idea:

1. **Surfaces across choreos**: author builds two Waltz choreos each containing a figure with a left sway (seed via the UI or `seedDb` fixtures like `journal.spec.ts` builds its routine); Journal → new entry → link picker → An attribute → Sway → Left → *all my Waltz choreos*; the note surfaces on every left-sway step in **both** choreos' reading views.
2. **Dynamic re-resolution, no reload**: in the figure editor, retag the sway away → the margin note drops from that step; add a left sway to a different count → the note surfaces there — both **without** a page reload (the live-doc re-render path).
3. **Co-member sees, non-member blocked**: share one choreo with user B (`openTwoUsers`); B sees the note on its matching steps; user C (signed in, non-member) sees nothing in the UI **and** a direct `GET /api/routines/:id/predicate-notes` (via `page.request` with C's auth) returns 403.

- [ ] **Step 1: Write the spec (failing only until Tasks 1–7 land — this task runs LAST before docs).**
- [ ] **Step 2: Run it** — `pnpm --filter web exec playwright test attribute-predicate-anchors` (sandbox browser setup: `ballroom-flow-build-and-env` skill; the E2E build serves via `apps/web/e2e/serve.sh` harness as the other specs do). Then the smoke subset once: `pnpm test:e2e:smoke`.
- [ ] **Step 3: Root-cause any flake — never retry/loosen** (repro via `--repeat-each`, diagnostics skill).
- [ ] **Step 4: Commit** — `test(e2e): attribute-predicate anchors ship gate (@smoke)`.

---

### Task 9: Fold the mental-model delta into the docs + delete the idea (+ this plan) + PR

**Files:**
- Modify: `docs/concepts/annotations.md` — § "Anchors — what a note points at" gains the fourth anchor (the first **dynamic**, content-dependent one: match set re-evaluated on read; add/retag semantics; `none` sentinel; matched by meaning via read aliases) and § "The Journal" 's picker description gains the unified target → scope flow with `figureType` as the identity special case.
- Modify: `docs/system/architecture.md` — § "D1 — the index & projections" gains `attribute_predicate_note_index` (migration 0019, alarm-projected, DO single-writer, content-carrying like the family index) and the read path (co-membership gate, client-side `matchPredicate` over resolved timelines); § Non-functional requirements' EXPLAIN roster mentions the new query if the section enumerates them.
- Modify: `docs/TEST-MAP.md` — rows for the new test files (domain `predicate-anchor` / `predicate`, worker `predicate-projection` / `predicate-visibility`, web store + `predicate-picker` + surfacing, e2e `attribute-predicate-anchors.spec.ts`), keyed to this feature, layer-tagged like the existing rows.
- Check `docs/concepts/figures.md` § The custom badge for a cross-reference if it names the comparison the matcher reuses (delta #2 — cite `normalizeValue`, don't overclaim).
- **Delete: `docs/ideas/attribute-predicate-anchors.md` and `docs/ideas/attribute-predicate-anchors.plan.md`** (this file) — shipping an idea folds its delta and deletes it in the same change; remove any index-row for it in `docs/ideas/README.md`.

- [ ] **Step 1: Update both doc layers** (concept + system must read true in the same change — a doc-vs-code divergence is a bug).
- [ ] **Step 2: Full gates** — `pnpm -w lint && pnpm -w typecheck && pnpm -w test && pnpm test:e2e:smoke`.
- [ ] **Step 3: Commit + push** — `docs: fold attribute-predicate anchors into concepts/system; retire the idea`.
- [ ] **Step 4: Open the PR** (base `main`; merging deploys — don't merge red):

```bash
gh pr create --base main --head feat/attribute-predicate-anchors \
  --title "feat: attribute-predicate annotation anchors (fourth anchor type)" \
  --body "$(cat <<'BODY'
A fourth annotation anchor type — attributePredicate { kind, value, role?, scope } — surfacing one
note on every step whose notation matches an attribute condition, re-evaluated dynamically on read.
Engine (domain matchPredicate over resolveFigure output, normalizeValue read-alias meaning match,
'none' absence sentinel) + index (attribute_predicate_note_index, migration 0019, alarm-projected,
co-membership-gated read mirroring family notes) + picker (v4 § 3.6 attribute flow on the shipped
choreo-first link picker) + margin/thread surfacing. Ship gate:
apps/web/e2e/attribute-predicate-anchors.spec.ts (@smoke).

⚠ HARD REVIEW GATE: adds a cross-account read path (GET /api/routines/:id/predicate-notes) gated on
co-membership at the REST boundary — please review Tasks 3–4's diff with the same scrutiny as the
family-note gate. Non-member 403 + expectIndexedQuery (no SCAN) are covered in
apps/worker/src/predicate-visibility.test.ts.

Ops note: run the D1 migration (0019) on deploy.

Folds the mental-model delta into docs/concepts/annotations.md + docs/system/architecture.md and
deletes docs/ideas/attribute-predicate-anchors.md (+ its plan) per the idea process.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
BODY
)"
```

---

## Self-Review

**Spec coverage (idea § Design details → tasks):** anchor shape + `none` sentinel + meaning-match (T1/T2) ✓ · dynamic re-resolution on read (T2 semantics, T7 live re-render, T8 journey 2) ✓ · index mirroring `figure_type_note_index`, alarm-projected, non-destructive/idempotent/tombstone-aware, DO single-writer (T3) ✓ · accessible-authors co-membership read gate + `expectIndexedQuery` (T4) ✓ · routine-scoped self-read offline via the `mergeLiveFamilyNotes`-style seam (T5) ✓ · v4 § 3.6 picker graft, `figureType` path untouched (T6) ✓ · margin/thread surfacing with referential stability (T7) ✓ · three-journey Playwright ship gate (T8) ✓ · docs fold + idea deletion (T9) ✓.

**No invented signatures:** every quoted symbol in "Exact signatures" was read from the working tree at plan time (file:line cited). New names (`matchPredicate`, `PREDICATE_NONE`, `addPredicateNote`, `PredicateNoteRow/Projection`, `predicateNotesForMembers`, `projectPredicateNotes`, `OwnPredicateNote`, `mergePredicateNotes`, `loadPredicateNotes`, `useOwnPredicateNotes`, `home: "accountPredicate"`) are defined once here and used consistently across tasks.

**Known deviations from the idea doc — all flagged in "Verified deltas":** zAnchor strictness (resolved by the compile-pin + reader-leniency test), the badge comparison not itself normalizing (matcher uses `normalizeValue` directly), `routineRef` added for `scope: "routine"`, no shipped disabled picker row, real doc-section headings, and the idea's column list gains no columns but `scope: 'routine'` rows are projected-yet-never-served (upsert consistency).
