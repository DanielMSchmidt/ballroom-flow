# FE-6 Annotations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the full annotations epic (US-039/040/041/042): anchored notes + reply threads, lessons/practice filters, figure-family notes across a user's routines, and co-member visibility of those family notes.

**Architecture:** Routine-scoped annotations live in the routine Automerge doc (sync + membership for free). A typed change envelope (#117) lets the DO permit a commenter's annotation while refusing a structural edit. Figure-family notes live in a per-user **account** Automerge doc hosted by the same `DocDO`; its alarm projects a content-free `figure_type_note_index` row to D1, and a membership-gated worker route does scoped cross-account reads to surface co-members' family notes.

**Tech Stack:** TypeScript strict · React 19 · `@automerge/automerge` · Hono on Cloudflare Workers · Durable Objects + D1 (Drizzle + raw SQL migrations) · Vitest (`@cloudflare/vitest-pool-workers` for worker, jsdom for components) · Playwright · Biome · pnpm workspaces.

## Global Constraints

- TypeScript strict; **no `any`** without written justification (`noExplicitAny: error`).
- Soft-delete only: deletable entities flip a `deletedAt` tombstone, never a hard removal — concurrent edits must still merge.
- All content lives in Automerge docs; **D1 is a pure index** (no CRDT content in D1).
- All ids are client-generated ULIDs (`newId()` from `@ballroom/domain`).
- Components never import `@automerge/automerge` or the RPC client directly — they go through `store/` (enforced by `routine-store.test.ts`).
- Technique/family matching is identity-based and pure (`matchesFigureType`); the co-membership gate is the worker's concern, never the domain's.
- Index every D1 query; an `EXPLAIN QUERY PLAN` assertion must show **no SCAN** for the family-note lookup.
- Run gates explicitly in the worktree (lefthook no-ops here): `pnpm -r typecheck`, `pnpm biome check .`, `pnpm -r test`. Never `--no-verify`.
- Commit messages end with the `Co-Authored-By: Claude Opus 4.8 (1M context)` trailer.

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `packages/domain/src/doc-routine.ts` | + `addAnnotation/addReply/softDeleteAnnotation/softDeleteReply` mutators | 1 |
| `packages/domain/src/doc-account.ts` (new) | account-doc build/read + family-note mutators + `resolveFamilyNotesFor(figures, annotations)` | 2 |
| `packages/domain/src/index.ts` | re-export the new domain surface | 1,2 |
| `apps/web/src/store/doc-connection.ts` | typed change envelope: tag frames `annotation`\|`structural` | 4 |
| `apps/worker/src/doc-do.ts` | envelope-aware write-role gate; account-doc projection; `getFamilyNote` | 4,6 |
| `apps/web/src/store/routine.ts` | annotation reads + mutations on the seam | 3 |
| `apps/web/src/store/family-notes.ts` (new) | `loadFamilyNotes(routineId, token)` over the worker route | 8 |
| `apps/web/src/components/AnnotationPanel.tsx` (new) | compose/thread/reply/filter UI | 5 |
| `apps/web/src/components/AnchorPicker.tsx` (new) | step/figure/family anchor + dance-scope toggle | 5 |
| `apps/web/src/components/FigureTimeline.tsx` | mount `AnnotationPanel` per point/figure | 8 |
| `apps/worker/migrations/0005_figure_type_note_index.sql` (new) | the index table + indexes | 6 |
| `apps/worker/src/db/schema.ts` | Drizzle mirror of the new table | 6 |
| `apps/worker/src/db/family-notes.ts` (new) | index query (members × families × danceScope) | 7 |
| `apps/worker/src/index.ts` | `GET /api/routines/:id/family-notes` | 7 |
| `apps/web/e2e/annotations.spec.ts` (new) | core journey | 9 |
| `apps/web/e2e/fork-and-figures.spec.ts` | + family-note cross-dance + co-member/non-member | 9 |

---

## Task 1: Domain — routine annotation mutators

**Files:**
- Modify: `packages/domain/src/doc-routine.ts`
- Modify: `packages/domain/src/index.ts` (re-export)
- Test: `packages/domain/src/doc-routine.test.ts`

**Interfaces:**
- Consumes: `mutate`, `newId`, `Annotation`, `Anchor`, `AnnotationKind`, `Reply`, `RoutineDoc` (existing).
- Produces:
  - `addAnnotation(doc, input: { authorId: string; kind: AnnotationKind; text: string; anchors: Anchor[]; tags?: string[] }): A.Doc<RoutineDoc>`
  - `addReply(doc, annotationId: string, input: { authorId: string; text: string }): A.Doc<RoutineDoc>`
  - `softDeleteAnnotation(doc, annotationId: string): A.Doc<RoutineDoc>`
  - `softDeleteReply(doc, annotationId: string, replyId: string): A.Doc<RoutineDoc>`

- [ ] **Step 1: Write the failing test**

```ts
// doc-routine.test.ts (add to the existing file)
import { describe, expect, it } from "vitest";
import { addAnnotation, addReply, buildRoutineDoc, readRoutine, softDeleteAnnotation, softDeleteReply } from "./doc-routine";
import type { RoutineDoc } from "./doc-types";

const base = (): RoutineDoc => ({
  id: "r1", title: "T", dance: "waltz", ownerId: "u1",
  sections: [], annotations: [], schemaVersion: 1, deletedAt: null,
});

describe("routine annotation mutators", () => {
  it("adds a kinded annotation anchored to a point", () => {
    let doc = buildRoutineDoc(base());
    doc = addAnnotation(doc, {
      authorId: "u1", kind: "lesson", text: "rise earlier",
      anchors: [{ type: "point", figureRef: "f1", count: 2, role: "leader" }],
    });
    const r = readRoutine(doc);
    expect(r.annotations).toHaveLength(1);
    expect(r.annotations[0]).toMatchObject({ kind: "lesson", text: "rise earlier", replies: [] });
    expect(r.annotations[0].anchors[0]).toMatchObject({ type: "point", figureRef: "f1", count: 2 });
  });

  it("threads ordered replies", () => {
    let doc = buildRoutineDoc(base());
    doc = addAnnotation(doc, { authorId: "u1", kind: "note", text: "n", anchors: [{ type: "figure", figureRef: "f1" }] });
    const id = readRoutine(doc).annotations[0].id;
    doc = addReply(doc, id, { authorId: "u2", text: "first" });
    doc = addReply(doc, id, { authorId: "u1", text: "second" });
    expect(readRoutine(doc).annotations[0].replies.map((x) => x.text)).toEqual(["first", "second"]);
  });

  it("soft-deletes an annotation and a reply (tombstone, merges)", () => {
    let doc = buildRoutineDoc(base());
    doc = addAnnotation(doc, { authorId: "u1", kind: "note", text: "n", anchors: [{ type: "figure", figureRef: "f1" }] });
    const id = readRoutine(doc).annotations[0].id;
    doc = addReply(doc, id, { authorId: "u1", text: "r" });
    const replyId = readRoutine(doc).annotations[0].replies[0].id;
    doc = softDeleteReply(doc, id, replyId);
    expect(readRoutine(doc).annotations[0].replies).toHaveLength(0);
    doc = softDeleteAnnotation(doc, id);
    expect(readRoutine(doc).annotations).toHaveLength(0);
    expect(readRoutine(doc, { includeDeleted: true }).annotations[0].deletedAt).toBeTypeOf("number");
  });
});
```

- [ ] **Step 2: Run → FAIL.** `pnpm --filter @ballroom/domain test doc-routine` — expect "addAnnotation is not a function".

- [ ] **Step 3: Implement** in `doc-routine.ts`:

```ts
export function addAnnotation(
  doc: A.Doc<RoutineDoc>,
  input: { authorId: string; kind: AnnotationKind; text: string; anchors: Anchor[]; tags?: string[] },
): A.Doc<RoutineDoc> {
  return mutate(doc, (draft) => {
    draft.annotations.push({
      id: newId(), authorId: input.authorId, kind: input.kind, text: input.text,
      tags: input.tags ?? [], anchors: input.anchors, replies: [],
      createdAt: Date.now(), deletedAt: null,
    });
  });
}

export function addReply(
  doc: A.Doc<RoutineDoc>, annotationId: string, input: { authorId: string; text: string },
): A.Doc<RoutineDoc> {
  return mutate(doc, (draft) => {
    const a = draft.annotations.find((x) => x.id === annotationId);
    if (a) a.replies.push({ id: newId(), authorId: input.authorId, text: input.text, createdAt: Date.now(), deletedAt: null });
  });
}

export function softDeleteAnnotation(doc: A.Doc<RoutineDoc>, annotationId: string): A.Doc<RoutineDoc> {
  return mutate(doc, (draft) => {
    const a = draft.annotations.find((x) => x.id === annotationId);
    if (a) a.deletedAt = Date.now();
  });
}

export function softDeleteReply(doc: A.Doc<RoutineDoc>, annotationId: string, replyId: string): A.Doc<RoutineDoc> {
  return mutate(doc, (draft) => {
    const r = draft.annotations.find((x) => x.id === annotationId)?.replies.find((x) => x.id === replyId);
    if (r) r.deletedAt = Date.now();
  });
}
```

Add imports `AnnotationKind, Anchor` to the existing type import. **Note:** `readRoutine` already drops tombstoned annotations but NOT tombstoned replies — extend its annotation map to `replies: filterDeleted(a.replies, opts)`.

- [ ] **Step 4: Run → PASS.** `pnpm --filter @ballroom/domain test doc-routine`
- [ ] **Step 5: Re-export** in `index.ts` (add the four names to the `doc-routine` export line). Run `pnpm -r typecheck`.
- [ ] **Step 6: Commit** — `git commit -am "feat(domain): routine annotation mutators (US-039)"`

---

## Task 2: Domain — account doc + family-note resolution

**Files:**
- Create: `packages/domain/src/doc-account.ts`, `packages/domain/src/doc-account.test.ts`
- Modify: `packages/domain/src/doc-types.ts` (add `AccountDoc`), `index.ts`

**Interfaces:**
- Consumes: `matchesFigureType`, `Annotation`, `Anchor`, `FigureDoc`, `mutate`, `materialize`, `filterDeleted`, `newId`.
- Produces:
  - `interface AccountDoc { id: string; ownerId: string; annotations: Annotation[]; schemaVersion: number }`
  - `buildAccountDoc(account: AccountDoc): A.Doc<AccountDoc>`
  - `readAccount(doc, opts?): AccountDoc`
  - `addFamilyNote(doc, input: { authorId; kind; text; figureType: string; danceScope: DanceId | "all"; tags? }): A.Doc<AccountDoc>`
  - `addAccountReply` / `softDeleteAccountAnnotation` (mirror Task 1)
  - `resolveFamilyNotesFor(figures: FigureDoc[], annotations: Annotation[]): Map<string, Annotation[]>` — figureRef → matching family notes (uses `matchesFigureType`).

- [ ] **Step 1: Write the failing test** (`doc-account.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { addFamilyNote, buildAccountDoc, readAccount, resolveFamilyNotesFor } from "./doc-account";
import type { AccountDoc, FigureDoc } from "./doc-types";

const acct = (): AccountDoc => ({ id: "acct:u1", ownerId: "u1", annotations: [], schemaVersion: 1 });
const fig = (id: string, figureType: string, dance: FigureDoc["dance"]): FigureDoc => ({
  id, scope: "account", ownerId: "u1", figureType, dance, name: figureType, source: "custom",
  attributes: [], schemaVersion: 1, deletedAt: null,
});

it("adds an all-dances family note that matches the family in any dance", () => {
  let doc = buildAccountDoc(acct());
  doc = addFamilyNote(doc, { authorId: "u1", kind: "lesson", text: "head left", figureType: "feather", danceScope: "all" });
  const notes = readAccount(doc).annotations;
  const map = resolveFamilyNotesFor([fig("a", "feather", "foxtrot"), fig("b", "feather", "waltz"), fig("c", "spin_turn", "waltz")], notes);
  expect(map.get("a")?.[0].text).toBe("head left"); // foxtrot feather
  expect(map.get("b")?.[0].text).toBe("head left"); // waltz feather
  expect(map.get("c")).toBeUndefined();              // different family
});

it("a this-dance note matches only that dance", () => {
  let doc = buildAccountDoc(acct());
  doc = addFamilyNote(doc, { authorId: "u1", kind: "note", text: "x", figureType: "feather", danceScope: "foxtrot" });
  const map = resolveFamilyNotesFor([fig("a", "feather", "foxtrot"), fig("b", "feather", "waltz")], readAccount(doc).annotations);
  expect(map.has("a")).toBe(true);
  expect(map.has("b")).toBe(false);
});
```

- [ ] **Step 2: Run → FAIL.** `pnpm --filter @ballroom/domain test doc-account`
- [ ] **Step 3: Implement** `doc-account.ts`. `addFamilyNote` pushes an `Annotation` whose single anchor is `{ type: "figureType", figureType, danceScope }`. `resolveFamilyNotesFor` iterates figures × annotations, calling `matchesFigureType(anchor, figure)` for each `figureType` anchor; build the `figureRef → Annotation[]` map. Add `AccountDoc` to `doc-types.ts`.
- [ ] **Step 4: Run → PASS.** Re-export in `index.ts`; `pnpm -r typecheck`.
- [ ] **Step 5: Commit** — `git commit -am "feat(domain): account doc + family-note resolution (US-040)"`

---

## Task 3: Store seam — routine annotation reads + mutations

**Files:**
- Modify: `apps/web/src/store/routine.ts`
- Test: `apps/web/src/store/routine-store.test.ts`

**Interfaces:**
- Consumes Task 1 mutators; the existing `routineConn.change/commit`.
- Produces on `RoutineStore`:
  - `readAnnotations(): Annotation[]`
  - `createAnnotation(input: { kind: AnnotationKind; text: string; anchors: Anchor[]; tags?: string[] }): void`
  - `addReply(annotationId: string, text: string): void`
  - `deleteAnnotation(annotationId: string): void`
  - `deleteReply(annotationId: string, replyId: string): void`
- The store knows the current user id via a new `OpenOptions.currentUserId?: string` (default `""`); mutators stamp `authorId`.

- [ ] **Step 1: Write the failing test** in `routine-store.test.ts` (the suite already builds a store over a fake socket — mirror an existing `addSection` test): open a store, `createAnnotation({ kind: "lesson", text: "rise", anchors: [{ type: "figure", figureRef: "f1" }] })`, assert `readAnnotations()` returns it; `addReply` then `deleteReply`; assert author stamped from `currentUserId`.

- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** the five methods on the `store` object, each via `routineConn.commit(addAnnotation(routineConn.current(), {...}))` etc., stamping `authorId: currentUserId`. Add `readAnnotations: () => readRoutineSafe().annotations`. Thread `currentUserId` from `opts`.
- [ ] **Step 4: Run → PASS.** `pnpm --filter web test routine-store`
- [ ] **Step 5: Commit** — `git commit -am "feat(web): annotation reads + mutations on the store seam (US-039)"`

---

## Task 4: Typed change envelope (#117) — commenter may annotate, not edit

**Files:**
- Modify: `apps/web/src/store/doc-connection.ts` (tag outgoing frames), `apps/worker/src/doc-do.ts` (gate by tag + role)
- Test: `apps/worker/src/doc-do.test.ts`

**Interfaces:**
- Each synced change frame carries an envelope `{ intent: "annotation" | "structural", change: Uint8Array }` (JSON-with-base64 or a length-prefixed binary frame — match the existing `webSocketMessage` framing in `doc-do.ts`).
- Gate: `editor`/owner → both intents apply; `commenter` → only `intent:"annotation"`; `viewer` → none.
- The store tags annotation mutations (Task 3) with `intent:"annotation"`; all others `"structural"`.

- [ ] **Step 1: Write the failing tests** in `doc-do.test.ts`: (a) a commenter's `annotation`-intent frame **applies** (annotation appears in the snapshot); (b) a commenter's `structural`-intent frame is **dropped** (no section added); (c) a viewer's annotation frame is dropped; (d) an editor's structural frame still applies (regression).
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement.** In `DocConnection`, give `commit/change` an optional `intent` (default `"structural"`); annotation calls pass `"annotation"`. Wrap the frame in the envelope. In `doc-do.ts` `webSocketMessage`/`ingestChange`, parse the envelope and replace the current "canEdit only" drop (lines ~329-341) with: apply if `canEdit(role)` OR (`role==="commenter"` AND `intent==="annotation"`). Remove the stale "commenter is read-only for now" comment.
- [ ] **Step 4: Run → PASS.** `pnpm --filter worker test doc-do`
- [ ] **Step 5: Commit** — `git commit -am "feat: typed change envelope — commenter annotations vs structural edits (#117/US-039)"`

---

## Task 5: UI — AnnotationPanel + AnchorPicker (unskip the waiting tests)

**Files:**
- Create: `apps/web/src/components/AnnotationPanel.tsx`, `apps/web/src/components/AnchorPicker.tsx`
- Modify (unskip): `apps/web/src/components/annotations.test.tsx`

**Interfaces (props the waiting tests require — do not rename):**
- `AnnotationPanel` props: `role: "viewer"|"commenter"|"editor"`, `currentUserId?: string`, `annotations?: Annotation[]`, `onCreate?`, `onReply?`, `onDeleteReply?`. Renders: a kind selector + textbox (accessible name matching `/note|comment/i`) + an add/post button **only when `role !== "viewer"`**; a replies `list` with accessible name `/replies|thread/i`; a delete control on a reply **only when `reply.authorId === currentUserId`**; filter buttons `all/lessons/practice` with `aria-pressed` + a by-figure filter.
- `AnchorPicker` props: `figureType: string`, `dance: DanceId`, `onPick?`. Renders three buttons matching `/this step/i`, `/this figure( here)?/i`, `/this figure family/i`; choosing family reveals radios `/this dance/i` and `/all dances/i`.

- [ ] **Step 1: Unskip** the four `describe.skip` blocks → `describe` in `annotations.test.tsx`. Run → FAIL (components missing).
- [ ] **Step 2: Implement** both components to satisfy the exact roles/names above. Keep them presentational (props in, callbacks out) — no store import. Filters are client-side over `annotations` (US-042). Match existing component style (see `Share.tsx`, `AttributeEditor.tsx`).
- [ ] **Step 3: Run → PASS.** `pnpm --filter web test annotations`
- [ ] **Step 4: a11y** — touch targets ≥44px, color never sole signal (kind also shown as text). Run the existing axe matcher if the suite includes one.
- [ ] **Step 5: Commit** — `git commit -am "feat(web): AnnotationPanel + AnchorPicker (US-039/040/042)"`

---

## Task 6: Account-doc hosting + D1 index + alarm projection

**Files:**
- Create: `apps/worker/migrations/0005_figure_type_note_index.sql`
- Modify: `apps/worker/src/db/schema.ts`, `apps/worker/src/doc-do.ts`
- Test: `apps/worker/src/doc-do.test.ts`

**Interfaces:**
- Account docs are addressed by DO name `account:<userId>`; only `<userId>` is a member (editor), seeded on first onboarding/use.
- `DocDO.getFamilyNote(noteId: string): Promise<Annotation | null>` — reads one annotation from this account doc.
- The alarm's `projectToD1`, when the doc `type === "account"`, upserts a row per non-deleted `figureType` annotation into `figure_type_note_index`.

- [ ] **Step 1: Migration** `0005_figure_type_note_index.sql`:

```sql
CREATE TABLE IF NOT EXISTS figure_type_note_index (
  noteId     TEXT PRIMARY KEY,
  authorId   TEXT NOT NULL,
  figureType TEXT NOT NULL,
  danceScope TEXT NOT NULL,  -- a DanceId or 'all'
  updatedAt  INTEGER NOT NULL,
  deletedAt  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ftni_family ON figure_type_note_index (figureType, danceScope);
CREATE INDEX IF NOT EXISTS idx_ftni_author ON figure_type_note_index (authorId);
```

- [ ] **Step 2: Drizzle mirror** in `schema.ts` (`figureTypeNoteIndex` table). `pnpm -r typecheck`.
- [ ] **Step 3: Write failing tests** in `doc-do.test.ts`: seed an account doc with one all-dances `feather` family note, run `runAlarmForTest()`, assert a row exists in `figure_type_note_index` with `figureType="feather", danceScope="all"`; soft-delete the note, re-run alarm, assert the row's `deletedAt` is set. `getFamilyNote(id)` returns the annotation.
- [ ] **Step 4: Implement** the account branch in `projectToD1` + `getFamilyNote`. Account docs reuse the existing snapshot/replay machinery.
- [ ] **Step 5: Run → PASS.** `pnpm --filter worker test doc-do`
- [ ] **Step 6: Commit** — `git commit -am "feat(worker): account-doc hosting + figure_type_note_index projection (US-041)"`

---

## Task 7: Worker route — membership-gated cross-account family notes

**Files:**
- Create: `apps/worker/src/db/family-notes.ts`, `apps/worker/src/figuretype-visibility.test.ts`
- Modify: `apps/worker/src/index.ts`

**Interfaces:**
- `familyNoteIndexFor(db, { authorIds: string[]; figureTypes: string[]; dance: DanceId }): Promise<{ noteId; authorId }[]>` — WHERE `authorId IN (...)` AND `figureType IN (...)` AND `danceScope IN (dance,'all')` AND `deletedAt IS NULL`.
- Route `GET /api/routines/:id/family-notes` → `{ notes: Annotation[] }`.

- [ ] **Step 1: Write failing tests** (`figuretype-visibility.test.ts`, vitest-pool-workers):
  - `surfaces a co-member's family note on a shared routine's matching figure` — user A (editor) writes an all-dances `feather` note in A's account doc; B is a member of a routine R containing a feather; `GET /api/routines/R/family-notes` as B returns A's note.
  - `shows a NON-member NONE of those family notes (gate holds)` — a non-member of R gets 403/empty.
  - `uses an INDEX for the FigureTypeNoteIndex lookup (EXPLAIN, no SCAN)` — run `EXPLAIN QUERY PLAN` for the `familyNoteIndexFor` query; assert the plan string contains `USING INDEX` and not `SCAN`.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** the route: authorize caller ∈ `listMembers(R)` (else 403); resolve R's figure families from referenced figures; `familyNoteIndexFor(...)`; for each match `env.DOC_DO.get(idFromName("account:"+authorId)).getFamilyNote(noteId)`; return non-null notes. Implement `familyNoteIndexFor`.
- [ ] **Step 4: Run → PASS.** `pnpm --filter worker test figuretype-visibility`
- [ ] **Step 5: Commit** — `git commit -am "feat(worker): membership-gated cross-account family notes (US-041)"`

---

## Task 8: Wire annotations into the timeline + family-note merge

**Files:**
- Create: `apps/web/src/store/family-notes.ts`
- Modify: `apps/web/src/components/FigureTimeline.tsx`
- Test: a component/integration test alongside the timeline.

**Interfaces:**
- `loadFamilyNotes(routineId, token, baseUrl?): Promise<Annotation[]>` — GET the route via `apiGet`.
- `FigureTimeline` mounts `AnnotationPanel` for the selected point/figure, fed `readAnnotations()` ⊕ family notes; `AnchorPicker` drives `createAnnotation` (point/figure → routine store) or a family note (→ account doc, exposed via the store as `createFamilyNote`).

- [ ] **Step 1: Write the failing test** — render `FigureTimeline` with a stub store exposing annotations; assert the panel shows a note on the selected step and a viewer sees no compose box.
- [ ] **Step 2: Run → FAIL.**
- [ ] **Step 3: Implement** the wiring + `loadFamilyNotes`. Family notes render read-only-merged on matching figures (US-040/041 surfacing).
- [ ] **Step 4: Run → PASS.** `pnpm --filter web test FigureTimeline`
- [ ] **Step 5: Commit** — `git commit -am "feat(web): annotations in the figure timeline + family-note merge (US-039/040/041)"`

---

## Task 9: E2E journeys (the ship gate)

**Files:**
- Create: `apps/web/e2e/annotations.spec.ts`
- Modify: `apps/web/e2e/fork-and-figures.spec.ts`

**Interfaces:** follow the existing harness (`e2e/serve.sh`, `e2e/support`, seeded auth + two browser contexts as in `convergence.spec.ts`/`fork-and-figures.spec.ts`).

- [ ] **Step 1: `annotations.spec.ts`** (`@smoke`): sign in → open a routine → open a figure timeline → add a `lesson` on a step → assert it renders → reply → assert thread → switch the filter to `lessons` → assert only lessons show.
- [ ] **Step 2: Extend `fork-and-figures.spec.ts`:**
  - `an all-dances family note surfaces on a Feather in BOTH a Waltz and a Foxtrot routine` (single user, two routines).
  - `a co-member sees a coach's family note on a shared routine; a non-member sees none` (two seeded users; the second user is/ isn't a member).
- [ ] **Step 3: Run** the new specs locally: `apps/web/e2e/serve.sh` per the harness, then `pnpm --filter web exec playwright test annotations fork-and-figures`. Expect PASS.
- [ ] **Step 4: Commit** — `git commit -am "test(e2e): annotations journeys + cross-account family-note gate (FE-6)"`

---

## Self-Review

- **Spec coverage:** US-039 → Tasks 1,3,4,5,8,9. US-040 → Tasks 2,5,8,9. US-041 → Tasks 6,7,8,9. US-042 → Task 5 (filters) + Task 9. Permission AC-4 → Task 4. EXPLAIN NFR → Task 7. All four waiting `annotations.test.tsx` tests → Task 5; `figuretype-visibility.test.ts` → Task 7.
- **Placeholder scan:** all code steps carry concrete code or exact test names/commands; no TODO/TBD.
- **Type consistency:** `addAnnotation/addReply/softDeleteAnnotation/softDeleteReply` (Task 1) reused verbatim in Task 3; `resolveFamilyNotesFor` (Task 2) consumed in Task 8; `getFamilyNote` (Task 6) consumed in Task 7; `familyNoteIndexFor` defined+used in Task 7; envelope `intent` (Task 4) produced by Task 3 mutations.
- **Open risk:** the envelope framing (Task 4) must match `doc-do.ts`'s existing binary `webSocketMessage` format — the implementer reads that function first; if frames are raw binary today, the envelope becomes a 1-byte intent prefix rather than JSON.
