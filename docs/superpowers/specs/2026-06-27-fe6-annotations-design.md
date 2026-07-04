# FE-6 Annotations — Design

**Date:** 2026-06-27 · **Feature epic:** FE-6 · **Stories:** US-039, US-040, US-041, US-042
**Status:** Approved (design); spec for the implementation plan.
**Ship gate:** the `annotations.spec` Playwright journey green on PR, plus the extended
`fork-and-figures.spec` multi-user family-note journey; `@smoke` subset on PR.

## Goal

Turn Ballroom Flow from a live co-editor into the collaborative *teaching* tool it was
designed to be: partners and coaches annotate points and figures, thread replies, keep a
shared lessons/practice journal, and — the headline — write a **figure-family note once**
that surfaces on every matching figure across their routines, visible to co-members.

## What already exists (do not rebuild)

- **Domain types** (`packages/domain/src/doc-types.ts`): `Annotation`, `Reply`,
  `Anchor = point | figure | figureType`, `AnnotationKind = note|lesson|practice`,
  and `RoutineDoc.annotations`.
- **`matchesFigureType(anchor, figure)`** (`figuretype.ts`) — all-dances vs this-dance
  resolution + variant inheritance (US-011), with `figuretype-notes.test.ts`.
- **`readRoutine`** already drops tombstoned annotations.
- **One `DocDO`** hosts any Automerge doc (addressed by name), persists changes to its
  SQLite, and on its **alarm** projects a thin row to D1 `document_registry`. The
  **permission boundary lives at the DO connection** (Clerk JWT + `resolveEffectiveRole`).
- **Pre-authored skipped tests**: `apps/web/src/components/annotations.test.tsx`
  (US-039/040/042) and `figuretype-notes.test.ts`.

## Architectural decision: figure-family notes live in a per-user **account doc**

`figureType` notes are account-scoped (US-040). We model the account doc as **another
Automerge doc hosted by the existing `DocDO`** (`type:"account"`, DO name `account:<userId>`,
owner = sole editor; no other user ever connects to it). Its alarm projects rows to a new
D1 index. Chosen over plain-D1 storage because it reuses the entire DO lifecycle
(persistence, alarm, permission) with zero new infra and upholds the codebase invariant
"all content lives in docs; D1 is a pure index."

## Components & data flow

### US-039 — Anchored notes + reply threads (routine doc)

- **Domain** (`doc-routine.ts`): add `addAnnotation`, `addReply`, `softDeleteAnnotation`,
  `softDeleteReply` — pure Automerge mutators mirroring `addSection`/`softDeleteSection`.
  Soft-delete is always a tombstone flip (never a hard delete), so concurrent edits merge.
- **Store seam** (`apps/web/src/store/routine.ts`): expose a reactive `annotations` read and
  `createAnnotation / addReply / deleteAnnotation / deleteReply` mutations routed through
  the existing doc-change pipeline. Because annotations live **in the routine doc**, they
  sync to every member over the existing WS/DO path — **AC-3 (visible to all members) holds
  by construction**, no new route.
- **Permission** (DO write-role gate): annotation ops are classified **commenter+**
  (commenter and editor may write; viewer is read-only), distinct from structure edits
  which stay editor-only. Enforced at the DO (defence in depth) and reflected in the UI.
- **UI**: `<AnnotationPanel>` (kind selector note/lesson/practice, compose box gated by
  role, ordered reply thread, **author-only** reply delete) wired into `FigureTimeline` for
  point (`{figureRef,count,role?}`) and figure (`{figureRef}`) anchors.

### US-042 — Filters

Client-side `all / lessons / practice / by figure` over the **one** loaded annotation set,
shared between the timeline panel and a routine-level journal view. No content search in v1.

### US-040 — figureType family notes (account doc)

- **UI** `<AnchorPicker>`: `this step` / `this figure here` / `this figure family`, the
  family option exposing a `this dance | all dances` toggle.
- Family notes are written to the **account doc**. On read, `matchesFigureType()` surfaces
  the user's own family notes onto any matching figure in any of their routines (all-dances
  → Waltz *and* Foxtrot Feather; this-dance → only that dance; variants inherit the family).

### US-041 — Co-member visibility of family notes (option 2)

- **D1** migration `0005_figure_type_note_index.sql`: table `figure_type_note_index
  (noteId PK, authorId, figureType, danceScope, updatedAt, deletedAt)` with an index on
  `(figureType, danceScope)` (and `authorId`). Projected from the **account-doc alarm**
  (extends `projectToD1` for `type:"account"`) — keyed by author + family identity, holding
  **no note content**.
- **Worker** `GET /api/routines/:id/family-notes`:
  1. Authorize the caller is a member of routine R (existing membership check). A
     non-member is rejected here → sees **none** (AC-3/4 gate).
  2. Resolve R's figure families (from R's referenced figures).
  3. Query the index for `authorId ∈ members(R)` ∧ `danceScope ∈ {R.dance, 'all'}` ∧
     `figureType ∈ families(R)`.
  4. For each match, a **scoped cross-account read of just that note** from the author's
     account DO (new `DocDO.getFamilyNote(noteId)` returning one annotation) — never a
     wholesale browse of another user's account doc.
  5. Return the notes. EXPLAIN QUERY PLAN over step 3 shows index use (no SCAN).
- **Store**: `useFamilyNotes(routineId)` merges co-member family notes into the timeline's
  annotation set alongside the user's own.

## Testing strategy (ship gate)

| Layer | Coverage |
|---|---|
| Domain (unit/property) | annotation mutator round-trips + tombstone merge in `doc-routine`; extend `figuretype-notes.test.ts` (all-dances/this-dance/variant). |
| Component | unskip the 4 `annotations.test.tsx` tests (US-039 create/thread/viewer-gate, US-040 anchor picker, US-042 filters) by building `AnnotationPanel` + `AnchorPicker`. |
| Worker (integration) | new `figuretype-visibility.test.ts`: co-member surfaces; **non-member sees none** (gate); EXPLAIN no SCAN. Annotation write-permission (commenter yes / viewer no) in `doc-do.test`. |
| E2E (`@smoke`) | new `annotations.spec.ts` (note → reply → filter); extend `fork-and-figures.spec.ts` (all-dances Feather across a Waltz AND a Foxtrot routine; co-member sees a coach's family note, non-member sees none). |

**Manual Chrome verification (by the implementer):** run worker + web locally with seeded
auth; drive the single-user journey live — add a lesson on a step → reply → filter → write
an all-dances family note → see it surface on a matching figure in a second routine. The
**two-account US-041 gate** is verified by the multi-user `fork-and-figures.spec` (it needs
two real accounts); this split is stated explicitly, not glossed.

## Out of scope (v1)

Content search within annotations; predicate/attribute-value anchors (only point / figure /
figureType); media attachments; notifications; ownership transfer of family notes.
