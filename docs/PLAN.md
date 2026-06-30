# Ballroom Flow — Master Plan

**Status:** Draft for review — **v4.4 (M0.5 spike run → GO; architecture validated, 2026-06-25)**
**Date:** 2026-06-25

This is the single source of truth for Ballroom Flow. It consolidates the original design/implementation/testing/open-questions docs, then folds in successive owner reviews on PR #9. The latest decision is the foundational one: **full fork/inheritance is in v1** — at both the **choreography** and **figure** level — and to support it correctly the data layer is an **Automerge document graph**, not a single per-routine CRDT. The owner deliberately took on this complexity now to make the storage choice right and avoid a later rewrite.

Three sources are **retained for detail this plan does not reproduce in full** (see [§14](#14-further-detail--sources)):

- **`docs/superpowers/specs/2026-06-24-testing-plan.md`** — verbatim per-screen surface checklist (predates the redesign — see its banner);
- **`docs/design/Ballroom Builder.dc.html`** — the wireframe prototype (product sketch, not requirements);
- **`research/*.md`** — deep-dive research; `extensibility-crdt.md` and `critique-sync.md` remain load-bearing.

**Guiding principle:** *quality and maintainability over feature count.* Fork/inheritance is the one place the owner has chosen *more* upfront complexity, on purpose — everything else stays YAGNI.

> **What's new in v4 (the fork decision and its consequences):** The data model is a **graph of Automerge documents** — reusable **figure documents** (edit once, the change flows into every routine that references it) and **routine documents** (sections + ordered figure *placements* + annotations). A **choreo fork** is an Automerge `clone` that is **frozen at fork time** (independent of its origin — "make it your own"; lineage kept for provenance). A custom/edited figure is **choreo-owned** by default (the choreo's editors edit it in place together). **Editing a figure that lives outside the current choreo** — a global-library figure, or a personal-library figure placed in — **is auto copy-on-write** → it spawns a **frozen, choreo-owned copy** (a snapshot; `baseFigureRef` = provenance only). **Personal-library** figures a user has explicitly saved auto-update across **that user's** routines that reference them (US-034); **choreo forks** and figure **copies** are **frozen** (no pull). The **global library is application-scoped**; choreo-owned copies, personal-library figures, and notes are **account-scoped**. *(Reconciled 2026-06: the earlier live-overlay/"flow-up" variant model is retired in favor of frozen copies — §5.2.)* Figures carry a **cross-dance `figureType`** family identity so a note can target *this Feather* or *every Feather across dances*. The foundation's cost: **Automerge has no Cloudflare-blessed server** (we build a thin sync + SQLite-persistence layer on Durable Objects, one DO per document) and **per-user undo is history-based, not turnkey** (accepted). **The M0.5 spike has since validated this end-to-end** (Automerge-in-DO, SQLite persistence, convergence, permission, multi-doc references, deployable bundle) — see [`docs/spike/SPIKE-FINDINGS.md`](spike/SPIKE-FINDINGS.md). All reflected below.

---

## Table of contents

1. [Overview & Goals](#1-overview--goals)
2. [Domain Model — the document graph](#2-domain-model--the-document-graph)
3. [Controlled Vocabularies — the ATTRIBUTE_REGISTRY](#3-controlled-vocabularies--the-attribute_registry)
4. [Features by Screen](#4-features-by-screen)
5. [Collaboration, Fork, Permissions & Undo](#5-collaboration-fork-permissions--undo)
6. [Architecture](#6-architecture)
7. [Non-Functional Requirements](#7-non-functional-requirements)
8. [Locked Technical Decisions](#8-locked-technical-decisions)
9. [Implementation Roadmap (Milestones)](#9-implementation-roadmap-milestones)
10. [Testing Strategy](#10-testing-strategy)
11. [Out of Scope (v1)](#11-out-of-scope-v1)
12. [Open Questions & Decisions Needed](#12-open-questions--decisions-needed)
13. [Appendix: Media (v1.1)](#13-appendix-media-v11)
14. [Further detail & sources](#14-further-detail--sources)

---

## 1. Overview & Goals

### 1.1 What it is

Ballroom Flow is a **collaborative, mobile-first PWA** for building and annotating ballroom dance choreography ("routines"). A routine is an ordered sequence of **figures**, each described as a **timeline of attributes** placed at a relative count. **Figures are reusable, forkable units:** there's an **application-wide global library** of canonical figures plus your own figures; a routine *references* figures. A custom/edited figure's home is the **choreo** (its editors edit it together); editing a figure that lives **outside** the choreo (the global library, or your personal library) makes a **frozen copy** owned by the choreo, leaving the source untouched. You can **save a figure to your personal library** to reuse it across your routines — refining a personal-library figure then flows into every one of your routines that uses it. Figures also have a **cross-dance identity** — a *Feather* exists in Waltz, Foxtrot, and Quickstep with different steps but one family, so a note can target the whole family (this dance or all dances). Whole **routines fork** too — "make it your own" clones a routine (keeping lineage so changes can merge back). Attribute *kinds* are user-extensible. People **annotate** the routine — corrections, lessons, practice notes — anchored to a point, a figure, or a whole figure family across dances. The whole thing is built on a **CRDT document graph** so collaboration, offline, and forking are first-class rather than retrofitted.

### 1.2 Who uses it

A **flat collaboration model** — everyone is on the same level. **Anyone** creates routines/figures and invites others, granting **view**, **comment**, or **edit** (edit covers structure *and* annotations). A routine can be shared with **n people for reading**. No special "leader/follower/coach" *user* role (§1.5). A small-N collaboration tool, not a social network or studio LMS.

### 1.3 Non-negotiable constraints (owner)

1. **Cloudflare-hosted** end to end.
2. **No self-run auth** — managed IdP with a generous free tier.
3. **Cheap** — on **Workers Paid (~$5/mo base, in place)**; usage stays low at hobby scale; a **pro plan** monetizes (§1.6).
4. **Performant** on mobile.
5. **PWA is the priority** (installable; no native app in v1).
6. **Quality & maintainability over feature count** — YAGNI, except the deliberate fork/document-graph investment.
7. **A solid, detailed testing plan is required** (§10).

### 1.4 Primary user journey (the core loop)

1. Sign in (Clerk).
2. Open the **sample routine**, start from a **template**, **fork** an existing routine to make it your own, or create one for a dance.
3. Add **sections** (named by you) → add **figures** from your library / the catalog / compose custom (editing a catalog or personal-library figure here makes a **frozen choreo-owned copy**).
4. Open a figure and **place attributes on its count timeline** (the hero flow) — footwork, sway, turn, rise, position, or any kind you've added — for a count, optionally per role. Refining a **personal-library** figure flows into every one of your routines that references it; editing a figure that lives **outside the current choreo** (a global-library figure, or a personal-library figure placed in) is **copy-on-write to a frozen, choreo-owned copy**.
5. **Annotate** from the timeline or the journal (one concept).
6. **Undo** your own changes (history-based, per-user).

### 1.5 Role of "leader / follower"
A view dimension, not a user attribute. No stored default role; which role's steps you see is a **per-device preference**, switchable in the timeline. Attributes carry an **optional `role`** for genuine divergences.

### 1.6 Plans & quotas
Free tier + later pro plan. v1 enforces a quota — **free accounts may own at most 3 routines** (owned, not shared-in) — with an upsell. Pro limits + billing provider deferred (Q-PLAN); v1 builds the quota seam.

> **Offline:** v1 is **online-first** (sync requires the document's DO). Automerge is local-first by nature, so offline *editing* (local persistence + sync-on-reconnect) becomes an additive increment rather than a rewrite.

---

## 2. Domain Model — the document graph

The system is a **graph of Automerge documents**, each hosted in its own Durable Object (§6), indexed by **D1**. There are two document types — **figure docs** and **routine docs** — plus the D1 index. The logical shapes:

### 2.1 Conventions
- **Client-generated ULIDs** for every entity id (stable references across documents).
- **Soft-delete / tombstones** (`deletedAt`) — the remove-wins marker the CRDT and the document model both need; never a hard removal.
- **CRDT-native history.** Automerge keeps full, compressed history per document — the basis for undo (inverse changes), fork lineage, and merge. There is **no separate op-log**.

### 2.2 Figure document — global library, choreo-owned copies & personal-library figures *(reusable, forkable)*

**Scopes (Q-FIGLIB):** the **global figure library is application-scoped** — canonical, app-owned definitions everyone references and **nobody edits directly**. Everything else is **account-scoped** (`scope: account`, owned by a user) and comes in two flavors:

- **Choreo-owned (the default home of a custom/edited figure):** referenced by a **single routine** and **editable in place by everyone who can edit that choreo** (§5.1 cascade). Divergence lives here by default — edits stay inside the choreo and never leak to other routines.
- **Personal-library (an explicit promotion):** a figure a user has deliberately **saved to their library** to **reuse across their own routines**. Editing one in place flows to **every one of that user's routines that references it** (US-034) — the deliberate cross-routine behavior.

**Placements are routine-scoped.** Editing a figure that lives **outside the current choreo** — a global-library figure, or one of your personal-library figures you've placed into it — is **copy-on-write to a frozen, choreo-owned copy** (§5.2), so the shared original is never mutated out from under others or other routines.

- `id` (Automerge URL), `scope` (`global` | `account`), `ownerId` (the account, or the app for global), **`figureType`** (stable family id, e.g. `feather`), **`dance`** (the dance this definition is for), `name`, `source` (`library` | `custom`), `entryAlignment`/`exitAlignment` (§3.8), `schemaVersion`, `deletedAt`.
- **Cross-dance figure identity:** a **`figureType`** (e.g. *Feather*) names a *family* of similar figures that exist in **multiple dances with different steps** (Feather in Foxtrot vs Quickstep vs Waltz). Each (`figureType` × `dance`) is its own global FigureDoc with its own attributes, but they **share the `figureType`** so a note can target the whole family across dances (§2.6). `figureType` lives in the global catalog; a copy **inherits** its source's `figureType` + `dance`.
- **Attributes** (the timeline): a set of `{ id, kind, count (float), role?, value }` (§2.5). A figure carries its **own** attributes — there is no live overlay against another document.
- **Provenance (`baseFigureRef`):** a nullable Automerge URL recording **which figure this was copied from**, for lineage display and the "custom" badge (§4.2). It is **provenance only — not resolved live**: a copy is a **frozen snapshot** of its source's attributes at copy time, so later edits to the source never flow into the copy. *(This is the deliberate reversal of the earlier live-overlay/"flow-up" model — see §5.2 and §2.5.1.)*
- A **personal-library** figure edited in place flows to **every routine placement referencing it** (the reusable-figure behavior, US-034). A **choreo-owned** figure is referenced by one routine, so an in-place edit is naturally scoped to that choreo.

### 2.3 Routine document
- `id` (doc id / Automerge URL), metadata mirrored in D1 (title, dance, ownerId, `forkedFromRef` lineage, `templateOf`, `schemaVersion`, timestamps, `deletedAt`).
- **Sections:** ordered list of `{ id, name (free text + optional preset quick-fills), sortKey }`. (No long/short/corner enum; alignment-per-figure is enough — no separate floor concept.) The **`sortKey`** is a **fractional-index** string (§5.3): order is read by sorting on it, so a reorder is a per-field update, not an array splice.
- **Figure placements:** each section owns an ordered list of `{ id, figureRef (Automerge URL of a figure doc), perPlacementAlignment?, sortKey }` — ordered by `sortKey` like sections. The routine doesn't *contain* figures — it **references** them, which is what makes the shared-library + fork model work.
- **Annotations** (§2.6) scoped to this routine.

### 2.4 Fork & copy-on-write (the unifying rule — see §5.2)
- **Choreo fork** = Automerge **`clone`** of the routine doc → new doc id, **frozen at fork time** (independent of its origin — it does **not** pull origin changes); `forkedFromRef` is kept for **provenance only**. Referenced figure docs are copied/diverged on edit per the copy-on-write rule below.
- **Editing a figure that lives outside the current choreo is copy-on-write:** editing a **global-library** figure, or a **personal-library** figure you've placed in, spawns a **frozen, choreo-owned copy** (a new account figure with `baseFigureRef` = the source, recorded for provenance only) owned by the editor's choreo, and the placement re-points to the copy. The source is never touched. A **choreo-owned** figure (the default home of a custom/edited figure) is edited **in place** by anyone who can edit that choreo — no copy, no per-user divergence. So the rule is about **where the figure lives** (global / personal library = outside → copy; choreo-local = inside → edit in place), not about who owns it.

### 2.5 Attribute *(the notation unit)*
`{ id, kind (`direction`|`footwork`|`sway`|`turn`|`rise`|`position`|… user-defined), count (float, relative to figure start), role (`leader`|`follower`|null=both), value (typed by kind), deletedAt }`. A step's two real dimensions are **`direction`** (the step *headline* — forward/back/side/close/…) and **`footwork`** (the *foot part*); **foot (L/R) is never stored — steps alternate feet automatically**. (The original single `step` kind that held footwork tokens was split into `direction` + `footwork` in the 2026-06-28 notation-parity work; legacy `step` attributes retag to `footwork` via the v2 migration.) **Float-count timing** is interpreted modulo the dance's counted phrase (Waltz/Viennese 1–6; rest 1–8); the fraction renders as **`e`=.25, `&`=.5, `a`=.75** (the conventional "1 **e** & **a** 2" count), with `i` for 1/8-note subdivisions (`ia`=.125, `ai`=.375).

### 2.5.1 Attribute invariants *(the rules that must stay true)*

The canonical, checkable rules for attributes. Items marked **⟳** were changed in the 2026-06 attribute reconciliation (frozen choreo-owned copies replacing live overlays — §5.2).

**Shape & identity**
1. An attribute is a **single `kind → value`** pinned to one moment — `{ id, kind, count, role?, value, deletedAt? }` — not a bag of pairs. A *figure* holds 0..n of them.
2. `count` is a **float** relative to figure start; fractions encode off-beat `e`/`&`/`a` timings (§2.5).
3. `role ∈ { leader, follower, null }` where `null` = *both*.
4. **Multiple attributes may share the same `count`** (and role). The only per-count "one value" rule is *within a single kind*, governed by that kind's cardinality (§3).
5. Attributes live on the **figure doc** — never on a placement or routine. (Entry/exit alignment and annotations are separate types, not attributes.)

**Deletion & CRDT-safety**
6. Removal is **always a soft tombstone** (`deletedAt`), never a hard delete — so a concurrent edit on a deleted attribute still merges.
7. Reads **drop tombstoned attributes by default**; an explicit flag retains them.

**Vocabulary (kinds)**
8. Every `kind` resolves against **one merged registry** = builtin kinds + user-defined custom kinds (§3).
9. **Builtin slugs are reserved**: a custom kind colliding with a builtin is ignored — the builtin wins.
10. A kind's **cardinality** is `single` (one value per count) or `multi` (a set per count).
11. **enum** kinds constrain values to their declared set; **freeText** kinds treat values as suggestions and also accept free text (e.g. `footwork`). Closed-enum write-rejection lives in the Zod layer; freeText skips it.
12. Reads are **forward-compatible**: unknown persisted values pass through; known aliases normalize on read (`CBP→CBMP`, `H→heel`, `T→toe`).
13. `appliesToDances` gates a kind to specific dances (rise omits Tango), declared explicitly. The gate is enforced on the **write path** (the Zod strict-write layer rejects an attribute whose kind's `appliesToDances` excludes the figure's dance — `dance_not_applicable`), so a `rise` value can never be persisted onto a Tango figure; the reading/edit views additionally hide the inapplicable kind. The store seam drops such attributes before writing; the DO seed route rejects them 400.

**Copies & provenance** ⟳
14. A figure carries its **own** attributes. There is **no live overlay** against another doc — `resolve(base, overlay)` and base-addition flow-up are **retired**. ⟳
15. A copy-on-write copy is a **frozen snapshot** of its source's attributes at copy time; later edits to the source **never** flow into the copy. ⟳
16. `baseFigureRef` is **provenance only** (lineage + "custom" badge), not a live link. ⟳
17. Copy-on-write **never mutates the source** figure (no disturbance to others or to other routines).
18. **Copy-on-write trigger = the figure lives outside this choreo** (global library, or a personal-library figure placed in). A **choreo-owned** figure is edited **in place**. The trigger is *location*, not ownership or attribute-kind. ⟳

**"Custom" badge (display only)**
19. A placed figure is badged **custom** when its `(dance, figureType, name)` or its live attributes **diverge from the source** it was copied/picked from; an unchanged pick is not badged.
20. The badge compares attributes **by meaning** (`kind | count | role | value`), ignoring `id` and `deletedAt`. It is a content check, independent of whether the figure is technically a copy.

**Permissions / access**
21. Editing attributes requires **`canEdit`** (editor or owner); commenters/viewers cannot.
22. A routine member's role **cascades to referenced figures**: routine *editor* → may edit the figure; *commenter/viewer* → read-only; cascade **never grants delete** on a figure (§5.1).

> **Designer-facing restatement** (same rules, no code): an *attribute* is one piece of technique (footwork, rise, sway, turn…) placed at one moment of a figure, for the leader, the follower, or both; many can sit on the same beat, and beats can be off-beat. Deleting is always reversible-and-safe. There's a standard palette of attribute types plus user-added ones; custom types can't impersonate standard ones; some are pick-from-list, some free-text, some dance-specific. A custom/edited figure's home is the **choreo** and everyone who can edit the choreo edits it together; editing a figure that lives **outside** the choreo (the global library, or your personal library) makes a **frozen copy** owned by the choreo, leaving the original untouched. Saving to your personal library is a separate, deliberate action. A figure shows as **"custom"** when its content has drifted from where it came from. Only editors can change attributes.

### 2.6 Annotation *(unifies Thread/Comment + Journal)*
`{ id, authorId, kind (`note`|`lesson`|`practice`), text, tags[], createdAt, media[] (v1.1), deletedAt }` with **anchors[]** and ordered **Replies** (author-only delete). v1 anchor types:
- `point {figureRef, count, role?}` — a count in a routine figure.
- `figure {figureRef}` — a whole figure instance in a routine.
- **`figureType {figureType, danceScope: <DanceId> | "all"}` *(new — figure-level notes across dances)*** — a note on a whole library figure **family**: this dance only, or **all dances the figure exists in** (e.g. one note on every *Feather*, whether Waltz, Foxtrot, or Quickstep). Applies to global-library figures and to account figures (which inherit `figureType`).

Routine anchors (`point`/`figure`) live in the **routine doc** and are visible to all members of that routine. A **`figureType` annotation is *owned* in your account doc** (account-scoped — it follows the family across all your routines), but per **Q-FIGNOTE-VIS = option 2** it is **visible to co-members of any shared routine where that figure appears** — so a coach's "on every Feather, keep the head left" surfaces for the student on their Feathers (this-dance or all-dances). This needs a small **scoped cross-account read path** (§2.7, §5.1). Predicate **query anchors** ("all rising steps") remain v1.1; `figureType` is *identity-based*, not a predicate, which is why it ships in v1. The deferred **attribute-predicate** anchor — `attributePredicate { kind, value, role?, scope }` — is spec'd precisely in **§11.1** so it can be built later without re-deriving it.

### 2.7 D1 index (not document content)
- **User** `{ id (Clerk sub), displayName, identityColor, plan }`.
- **Membership** `{ id, docRef, userId, role (viewer|commenter|editor) }` — **per document** (a routine doc; an account figure can also be shared).
- **DocumentRegistry** `{ docRef, type (routine | global-figure | account-figure | account), ownerId, doName, figureType?, dance?, title?, forkedFromRef?, bars?, figureCount?, updatedAt, deletedAt? }` — routes each doc to its DO and powers list/search without reading CRDT content. (`account` = the per-user **account doc** that holds `figureType` annotations and the index of the user's account figures.) The **Choreo-card projection** columns (US-025, frames 1.1/1.3) are alarm-written, nullable, and **eventually consistent**:
  - **`bars`** — on a **figure** row, that figure's own bar count = `barsForFigure(its non-deleted attribute counts)` (the **max count across both roles** → the longer role's span; §2.5, §1.4). On a **routine** row, **Σ over its non-deleted placements** of each referenced figure's `bars`, summed by the routine DO **reading this shared index** (never another doc) — so a routine's `bars` may lag a figure edit until the routine re-projects, and a not-yet-projected figure contributes 0.
  - **`figureCount`** — a **routine** row's count of **non-deleted placements** (`0` → the card's "no figures yet"); null on figure/account rows.
  - **`forkedFromTitle`** is **not stored** — it's resolved on the list read by a self-join on `forkedFromRef` → the origin row's `title` (a PK lookup; EXPLAIN no-SCAN).
- **FigureType catalog (reference data, bundle):** the family ids (e.g. `feather`) and which dances each exists in — drives the all-dances annotation scope and library browsing.
- **FigureTypeNoteIndex** `{ accountDocRef, authorId, figureType, danceScope, kind, text }` — lets a routine view discover **co-members'** `figureType` notes matching the figures present (Q-FIGNOTE-VIS option 2) without scanning account docs; reading a note's content is gated by **co-membership of a routine containing that figure**. Its `kind ∈ {note,lesson,practice}`, so a `figureType` **lesson/practice** note is also an account-scoped **Journal** entry (T6).
- **JournalEntry** `{ entryId, routineRef, authorId, kind (lesson|practice), text, anchors (with resolved chip labels), createdAt, deletedAt }` — the **cross-routine projection of routine-scoped lesson/practice annotations**, written by the **routine DO alarm** (mirroring `DocumentRegistry`). The **Journal** read (`GET /api/journal`, T6) UNIONs it with the account-scoped `figureType` lesson/practice rows in **FigureTypeNoteIndex**. Read gate (LOCKED): the routine arm is **co-membership of the routine** (a co-member's entry surfaces, author-coloured); the account arm is the **accessible-authors set** (self + co-members/owners of the user's accessible routines) — symmetric. Soft-delete only.
- **Invite** `{ id, docRef, role, expiresAt, redeemedAt? }`.

### 2.8 Entity-relationship summary

```
D1 index:   User 1──* Membership *──1 DocumentRegistry(routine|global-figure|account-figure|account) · Invite
                                              │ routes to its DO        FigureType catalog (bundle)
Automerge graph (one doc per DO):
  RoutineDoc ──* Section ──* Placement ──(figureRef)──▶ FigureDoc
  RoutineDoc ──* Annotation ──* Reply ;  anchor ──▶ { point | figure }            (routine-scoped)
  FigureDoc  ──* Attribute { kind, count(float), role?, value } ; { figureType, dance, scope }
  FigureDoc(account copy) ──(baseFigureRef: provenance only — frozen snapshot, no pull)──▶ FigureDoc(source)
  RoutineDoc(fork) ──(forkedFromRef: provenance only — frozen, no pull)──▶ RoutineDoc(origin)
  AccountDoc ──* Annotation ; anchor ──▶ figureType{ family, danceScope: dance|all }   (account-scoped, cross-dance)

Scopes:  application = global library (FigureDocs, app-owned) ;  account = choreo-owned copies + personal-library figures + figureType notes ;  routine = placements + routine notes
```

---

## 3. Controlled Vocabularies — the ATTRIBUTE_REGISTRY

Two tiers, merged everywhere (editor, lanes, info-sheet, chips, Zod): **standard kinds** ship in `packages/domain/src/vocabulary.ts` (`{ kind, label, color, cardinality, valueType, values?, appliesToDances?, description?, valueDefs?, roleAware?, required?, builtin:true }`); **user-defined kinds** are created in-app (**creation UI in v1**, D22) and stored in the relevant document. Forward-compatible reads: registry version + value aliases; unknown values pass through on read; aliases normalize (`CBP→CBMP`); unknown-value writes to a known kind rejected, and a write of a kind whose `appliesToDances` excludes the figure's dance is rejected (`dance_not_applicable` — e.g. `rise` on Tango).

`RegistryKind` is **data-driven** for its presentational surfaces (T5): a one-line `description` + per-value `valueDefs` power the **info-sheet** (§4.9, frame 1.13) prose/glossary; `roleAware` (the kind commonly differs by leader/follower) and `required` (a core slot) drive the **Profile attribute-types manager** (frame 1.17) + the **add-kind picker** (frame 1.15) affordances (an "L/F" badge, a "*" required marker). These read straight off the merged registry, so a **custom kind** carrying its own `description`/`valueDefs`/`roleAware` gets the same coverage; one with none falls back to the raw value list. The standard `required` slot is `direction` — it drives the notate EDIT grid's "Step*" column (`FigureTimeline.col.isStep`); the role-mirroring kinds (`direction`/`footwork`/`sway`/`turn`/`bodyActions`) are `roleAware`, while the couple-shared `position`/`rise` are not.

Standard kinds (v1): **`direction`** (the step headline — **closed enum** `forward`/`back`/`side`/`close`/`diag_forward`/`diag_back`/`in_place`) `#2f5d8f`; **`footwork`** (the foot part — **free-text**, suggested `heel`/`heel_ball`/`ball`/`ball_flat`/`flat`/`toe`/`tap`; classic ISTD tokens `HT`/`TH`/`heel_pull` pass through as free-text, and single `H`→`heel` / `T`→`toe` normalize on read) `#a9742c`; **`rise`** (`commence`/`body_rise`/`foot_rise`/`up`/`continue`/`lowering`/`NFR`; **Tango omits** via `appliesToDances`) `#1f8a5b`; **`position`** (single: `closed`/`promenade`/`wing`) + **`bodyActions`** (multi: `CBM`/`CBMP`; "CBP"→CBMP **[confirm] Q-D4**) `#8a5cab`; **`sway`** (`to_L`/`to_R`/`none`) `#c0563f`; **`turn`** (`eighth_L`…`half_R`/`none`) `#5b6b8a`.

**Dance** (v1: Standard travelling only — `waltz`, `viennese_waltz`, `quickstep`, `foxtrot`, `tango`): metadata `timeSignature`, `beatsPerBar` (3 Waltz/Viennese; 4 rest), `phraseBeats` (6 Waltz/Viennese; 8 rest), `travelling:true`. **Alignment (per-figure)** — qualifier (`facing`/`backing`/`pointing`) + direction (`LOD`/`ALOD`/`wall`/`centre`/`DW`/`DC`/`DW_against`/`DC_against`); per-figure is sufficient (no floor concept). Latin/spot → v1.1.

---

## 4. Features by Screen

### 4.0 Cross-cutting
| Capability | v1 decision |
|---|---|
| Auth / onboarding | Clerk hosted sign-in (Google + passkeys); onboarding: displayName, identity color. |
| Account / settings | Edit displayName/color; sign out; **plan/quota status**; **figure library** management. |
| Delete flows | routine/section/placement/figure/attribute/annotation; reply delete = author-only. Confirm dialogs. |
| Reorder | sections, placements (within a section), attributes (by count). |
| Attribute add/edit/remove | place/edit/remove on a figure's count timeline; switch role inline. |
| **Custom attribute kinds** | **v1** — create/edit user-defined kinds. |
| **Fork — choreo** | **v1** — clone a routine ("make it your own"); **frozen** from origin (no pull); lineage kept for provenance. |
| **Fork — figure (copy)** | **v1** — **copy-on-write to a frozen, choreo-owned copy** when editing a figure from outside the choreo (global library / personal library); choreo-owned figures edited in place; **save to personal library** for cross-routine reuse. |
| **Figure library** | **v1** — reusable figures; editing one flows into every routine referencing it. |
| **Undo / redo** | **v1** — per-user, history-based (§5.4). |
| Search | routine + figure list by title/name/dance (D1 index). Annotation/content search deferred. |
| Invite | per-document invite by link (signed token → Membership with chosen role). |
| Media | "coming soon" (v1.1). |
| Sample/template | read-only sample + start-from-template. |
| Ownership/copy | a self-contained owned copy is delivered by **forking** (clone + copy-on-write of a routine with its referenced figures); no separate JSON export/import (§7). |
| Plans/quota | free cap (3 owned routines) + upsell; billing deferred. |

### 4.1 Routine List (Choreo tab) — your routines (D1 index); card: dance-color icon, title, `dance · barLabel · created`. "+" → New Choreo (quota-checked). **Fork** action on a routine. Empty → sample + template. Search.
- **Card data (US-025) is pure D1 projection** — the list path reads NO routine CRDT content. `barLabel` = the routine's projected **`bars`** ("`N bars`"), except a routine with **`figureCount === 0`** renders **"no figures yet"**; a fork also shows a **"⑂ forked from \<forkedFromTitle\>"** lineage line (frame 1.3). The exact rule (LOCKED, supersedes the earlier loose "placements whose first step count == 1"): **`figureCount` = the routine's non-deleted placement count**, and **`bars` = Σ over those placements of `barsForFigure(figure)`** — each figure's bar span (`barsForFigure` = the **max count across both roles**, §1.4/§2.5), summed across placements. All three are eventually consistent (alarm-projected; §2.7).
### 4.2 Figure Library — browse the **application-global library** (canonical figures, grouped by `figureType`, **dance filter chips** incl. an "All" cross-dance view; each card a scope dot + name + dance tag + a "↟ save" affordance, frames 2.1/2.2) and **your personal-library figures** (frames 2.3/2.4: amber cards with **lineage** — "based on \<source\>" when saved/copied, else "your own figure" — a two-state **ScopeBadge** (`library`|`custom`), "used in N routines", an **edit** affordance, a dance filter, and a guided empty-per-dance state "Nothing saved for this dance yet — Save a figure from the library to reuse it"); create/edit; "used in N routines". Editing one of *your personal-library* figures flows into all your referencing routines; editing a **global** one, or a personal-library figure inside a choreo, is **copy-on-write to a frozen choreo-owned copy**. From a figure family you can open the **cross-dance note** surface (annotate this dance or all dances — §4.6).
- **"↟ Save to my library" (promotion):** promotes a global-catalog figure into the caller's personal library as a **FROZEN account-figure copy** (`type='account-figure'`, owner = caller, `baseFigureRef = globalFigureRef(dance, figureType)` provenance only — §5.2). **Auth-gated** (Clerk) and **idempotent on `(owner, baseFigureRef)`**: re-saving the same global figure returns the existing copy (no duplicate), toast "Already in your library" vs "Saved to your library". The server resolves the catalog figure from the bundled reference data and seeds the copy's attributes (never trusts client attributes); a saved figure starts at `usedInCount` 0 (no placement edge until it's added to a routine). Route: `POST /api/figures/save-to-library { dance, figureType, name } → 201/200 { figureRef, baseFigureRef, alreadySaved }`. **In the personal-library list the ScopeBadge reflects lineage** (saved/copied → `library`; from-scratch → `custom`); the live content-divergence flip (§4.3) applies in the Timeline/placement surfaces where attributes are loaded, not in the D1-projected library list.
### 4.3 Assemble — sections (user-named) → placement cards (figure name, **scope badge**, attribute summary, alignment chips). Add/fork figure, add section, reorder/delete placements. Share. Role view toggle. Edit affordances gated by membership role.
- **Scope badge is derived by *divergence*, not just scope** (`figureMatchesLibraryOrigin`): a placed figure that still equals the catalog figure it was added from reads **Library**; a frozen choreo-owned copy whose content has diverged from its source reads **Custom**; a from-scratch figure reads **Custom**. So adding a catalog figure and leaving it alone is **not** "custom" — the badge only flips once you actually change a configured attribute or add a new one (matching the owner's "don't call it custom until I change something" requirement). The badge is a **content-divergence** check (compares attributes by meaning), independent of the copy mechanism (§2.5.1 #19–20).
- **Adding a figure (Add-figure sheet):** tapping a catalog preset — **or typing a name that matches a catalog figure** (resolved against the library *by name*, since a name-slug can't reproduce a hyphenated `figureType`) — seeds the placement with that figure's canonical `figureType` + its per-count timeline (`direction`+`footwork`), so it arrives **pre-filled**. Only a name with no catalog match mints a true custom (empty) figure.
### 4.4 Figure Timeline (hero surface) — a figure as a count timeline: attributes per count as chips; tap to edit; tap a step to flip viewed role. Add/edit/remove attributes; **Lanes** (one kind across all counts). Edit alignment. Editing a figure from outside the choreo makes a **frozen choreo-owned copy** (copy-on-write, toast "copied into this choreo"); **save to personal library** for cross-routine reuse.
### 4.5 Attribute Editor (hero flow) — sections render from the merged ATTRIBUTE_REGISTRY (Tango omits rise; single/multi from the registry); re-tap clears; **"add a kind"** affordance (v1).
### 4.6 Annotation (timeline + journal) — one concept; anchors **point / figure / figureType**; reply thread; filters (all/lessons/practice/by figure). The anchor picker offers, for a figure: "this step", "this figure here", or "this **figure family**" with a **dance scope toggle (this dance | all dances it exists in)**. `figureType` notes surface on every matching figure across your routines. Predicate query anchors → v1.1.

**Journal tab — IMPLEMENTED (T6).** A **cross-doc VIEW** over lesson/practice annotations (NOT a separate store): the routine-scoped ones (routine doc → `JournalEntry`) UNIONed with the account-scoped `figureType` ones (account doc → `FigureTypeNoteIndex`), read via `GET /api/journal`. The list (frames 3.1/3.2) shows author-coloured cards with kind pills, server-resolved link chips, filter pills (all/lessons/practice/by figure), and a designed empty state. The **entry editor** (frame 3.3) has a Lesson/Practice toggle, handwritten text, the link chips, and a **disabled media affordance** (v1.1). The **link picker** (frames 3.4/3.5/3.7) is **full-parity (LOCKED)**: a routine-scoped link ("Specific place" / "This choreo only") opens a **routine chooser** + figure-in-routine chooser → `createAnnotation` on that routine; a `figureType` link ("All <dance>" / "Every dance") → `createFamilyNote`. The **attribute-predicate** link + **media** are visibly disabled → v1.1.
### 4.7 Share — per-document member list + roles; invite by link; remove member (editor/owner); **fork** action. Microcopy explains roles + that edits to a shared figure affect every routine using it (else fork).
### 4.8 Profile — identity; editable name; note-color picker (global); **plan status + owned-routine count**; sign out.
### 4.9 Overlays — Add/fork-figure sheet; New Choreo sheet (quota-checked); Add-kind sheet; Info sheet (registry-derived); Toast (incl. "Undone", quota upsell, and **"copied into this choreo"** on copy-on-write).

---

## 5. Collaboration, Fork, Permissions & Undo

### 5.1 Roles (per document)
| Role | Can do |
|---|---|
| `editor` | Edit structure + annotations of that doc; invite/remove members; undo own actions. |
| `commenter` | Read; create annotations + replies. |
| `viewer` | Read only. |
| `owner` (an editor) | Editor rights + delete the doc. |
Membership is **per document** — a routine doc and a figure doc are shared independently. Enforcement is at **each document's DO sync boundary** (not by rejecting CRDT cells): the DO authenticates the connection (Clerk JWT) and checks the doc's Membership/role from D1, accepting edits only from editors / annotations from commenters+ / read-only for viewers.

**Annotation visibility:** routine annotations are visible to all members of that routine. **`figureType` annotations (option 2)** are owned in the author's account doc but **visible to co-members of any shared routine where the figure appears**: when the client renders routine R for viewer U, it queries the **FigureTypeNoteIndex** for notes by `members(R)` whose `figureType`/`danceScope` match a figure in R, and loads them — co-membership of R authorizes that scoped cross-account read. A viewer never browses another user's account doc wholesale; only family-notes relevant to a shared routine surface.

### 5.2 Fork & copy (the v1 centerpiece)
- **Choreo fork ("make it your own"):** Automerge `clone` of the routine doc → new owned doc, **frozen at fork time** (Q-FORK-UX): it does **not** pull changes from its origin — "your own" means independent. `forkedFromRef` is kept for **provenance/lineage display only**. Referenced figures follow the copy-on-write rule below.
- **A figure's home is the choreo.** A custom or edited figure is **choreo-owned** by default — referenced by that one routine and **edited in place by everyone who can edit the choreo** (§5.1 cascade). No per-user divergence inside a choreo: the coach and the couple edit the same figure together, and it converges by CRDT rules.
- **Copy-on-write = freeze-on-edit-from-outside (Q-COW-TRIGGER, reconciled 2026-06):** editing a figure that lives **outside this choreo** — a **global-library** figure, or one of your **personal-library** figures placed into it — **automatically** spawns a **frozen, choreo-owned copy** (a new account figure; `baseFigureRef` = the source, **provenance only**) and re-points the placement — no prompt, toast "copied into this choreo". The copy is a **snapshot**: later edits to the source never flow into it, and edits to the copy never touch the source. The trigger is the figure's **location** (outside vs inside the choreo), not who owns it.
- **No live overlays / no flow-up (⟳ reversal):** the earlier "info flows up, store overrides" variant model — `baseFigureRef` + overlay resolved live against the base — is **retired**. Copies are frozen; `resolve(base, overlay)` no longer exists. This trades automatic propagation of library improvements for predictability and choreo isolation (the property dancers actually expect: an edit in one choreo never silently changes another).
- **Personal library (explicit reuse):** a user may **"save to my library"** → a personal-library figure (account-scoped, owned by them) reusable across **their** routines; editing it in place then flows to all of **their** routines that reference it (US-034). Placing a personal-library figure into a *different* choreo and editing it triggers copy-on-write (it lives outside that choreo). The same promotion runs from the **global library** ("↟ Save to my library", §4.2): a **frozen account-figure copy** with `baseFigureRef = globalFigureRef(dance, figureType)` (provenance only — the catalog figure has no DO of its own, so its cross-dance identity `(dance × figureType)` is its stable ref). The save is **auth-gated** and **idempotent on `(owner, baseFigureRef)`** (re-saving resolves the existing copy, never a duplicate; per-owner — two users each get their own copy). Server route: `POST /api/figures/save-to-library` reusing the `createFigureRows` account-figure path (no cross-user writes; owner stamped from the JWT).
- **Scopes & safety:** global-library figures are app-owned (never edited by users → always copy-on-write); choreo-owned figures are edited in place by that choreo's editors; editing a figure that belongs elsewhere copies it. This keeps the global library and every other routine safe while everyone can still tweak freely inside their choreo.

### 5.3 Concurrent editing
Each document is an Automerge CRDT; concurrent edits **merge by Automerge's rules** (no LWW, no two-zone). Soft-delete is a mergeable flip. Cross-document consistency is by reference (a placement references a figure doc by URL; the repo loads/syncs both).

**Ordering — `sortKey` fractional index (#63).** Sections and placements carry a **`sortKey`**: a compact, dependency-free **fractional-index** string (the "midpoint between two keys" construction over a base-62 alphabet, in `packages/domain/src/order.ts`). Reads order by `sortKey` (tie-broken by `id`); a reorder **sets the moved item's `sortKey` to a value strictly between its new neighbours** — a single per-field update, never a remove-and-reinsert. This fixes the earlier JSON-copy-splice limitation: that splice deleted the moved Automerge object and re-inserted a plain copy, so under concurrency a **concurrent edit to the moved item was lost** and two concurrent splices could **clobber the array order**. With `sortKey`, two replicas reordering within the **same section** converge — each writes a distinct field on a live object — to one deterministic order with **no lost edits**, and a concurrent edit to a moved item survives (its object is never deleted); two concurrent moves of the *same* item resolve by Automerge's per-field LWW to one agreed order. Keys are seeded by the builders and starter routine, backfilled for pre-`sortKey` docs by the migration ladder (v2→v3) **and**, defensively, by the store on first reorder (deterministic, so the backfill itself converges); a list still lacking keys reads in array order. Proven by the same-section reorder cases in `packages/domain/src/convergence.test.ts`.

### 5.4 Undo (per-user, history-based)
Automerge has **no turnkey per-user UndoManager** (unlike Yjs). Undo is implemented from history: compute the **inverse change** of the user's last change (Automerge tracks full history + actor ids, so we filter to the user's own changes and invert), apply it as a new change. This merges correctly with others' concurrent edits. **Scope (confirmed acceptable, Q-UNDO):** "undo my last change" within the document being edited; **no** cross-document undo of a copy-on-write; **no** hard "others built on this" refusal (the CRDT merges) — a soft "superseded" hint at most. This is heavier than Yjs's UndoManager but acceptable given the fork capabilities Automerge buys.

**AC-3 soft "superseded" hint — v1 realization (US-038 AC-3).** The advisory hint is implemented and shipped: `wasSupersededByOthers(doc, actorId)` (`packages/domain/src/undo.ts`) reports whether **another actor has built on** the change `undoLastChange` would revert — defined as *causal dependency in the Automerge change DAG*: some change by a different actor is a **transitive successor** (its `deps` reach the undo target's hash). This is the **exact** "built on" relation, not an approximation, so false positives are essentially nil; its deliberate scope limits are (a) a **purely concurrent** edit by another actor — one that never saw the target, so doesn't depend on it — is **not** flagged (it didn't build on the change; this is distinct from the same-cell LWW clobber noted above), and (b) it is **single-level**, inspecting only the next undo target. The store seam (`apps/web/src/store/routine.ts`) **peeks** the signal on the pre-undo doc and returns `{ undone, supersededByOthers }` from `undo()` — **undo still always proceeds** (the inverse is a normal mergeable change; never blocked). `Assemble.tsx` then softens the toast from "Undone" to **"Undone — others had built on this change"** (a `warning`-tone studio-paper toast; no modal, no refusal).

### 5.5 Invites — per document; an `editor` issues a signed expiring token; redeeming creates a Membership with the chosen role.

---

## 6. Architecture

A **graph of Automerge documents**, each hosted + persisted in its own Durable Object that is the sync + permission boundary. **D1** is the index + document registry. The client runs an **automerge-repo** that connects to the several DOs a view needs.

```
[ React 19 + Vite PWA ]   (installable shell)
   • Clerk client (session JWT)
   • automerge-repo (client): loads routine doc + its referenced figure docs;
     history-based per-user undo; bound to UI via store/ seam
        │  WebSocket sync per document (automerge-repo network adapter)   ▲ REST for list/search/invite/quota
        ▼                                                                 │
[ Worker + Durable Objects ]   (Smart Placement; Analytics Engine)
   • Worker (Hono): Clerk verify; list/search/invite/quota over the D1 index/registry → D1
   • Durable Object PER DOCUMENT (routine docs AND figure docs), SQLite-backed:
       – hosts the Automerge doc; persists it via an automerge-repo STORAGE ADAPTER in DO SQLite
       – automerge-repo NETWORK ADAPTER over (Hibernatable) WebSockets
       – authenticates each connection (Clerk JWT) + checks that doc's Membership/role (permission boundary)
       – alarm: compaction + project a thin index row to D1 + project the routine's lesson/practice annotations to the journal_entry index (T6) + invite expiry
        │
        ▼
[ D1 (Drizzle) ]  index only: users, memberships (per doc), DocumentRegistry, invites
        (R2 for media → v1.1; Queues → v1.1)
```

### 6.1 Module boundaries (pnpm workspaces)
`contract → domain`; `web → contract, domain`; `worker → contract, domain`.
- **`packages/domain/`** — pure TS, in-memory Automerge (no network): the **document schemas** (routine doc, figure doc), **fork/clone + copy-on-write** helpers (a copy is a **frozen snapshot** — no live overlay resolution), the **ATTRIBUTE_REGISTRY** + merge, **float-count timing**, **convergence invariants**, **history-based undo** (inverse-change of a user's last change), Zod schemas, the migration ladder. All unit/property-testable.
- **`apps/worker/`** — Hono routes (list/search/invite/quota), Clerk middleware (`auth/`), the **per-document SQLite-backed Durable Object** (`doc-do.ts`: automerge-repo host + **storage adapter (DO SQLite)** + **network adapter (WS)** + **permission boundary** + alarm), Drizzle/D1 index + registry, Analytics Engine helper.
- **`apps/web/store/`** — wraps **automerge-repo** (loads the routine doc + referenced figure docs, exposes typed reactive reads + mutations + history-based undo). Components never touch automerge-repo or the RPC client directly.
- **`apps/web/`** — presentational React; service worker.
- **`packages/contract/`** — Zod schemas + Hono RPC `typeof app` (REST surface) + shared document-shape types.

### 6.2 Data flow
1. Clerk JWT.
2. Opening a routine: the client repo connects to the **routine doc's DO**, reads its placements, then connects to each **referenced figure doc's DO** (each figure carries its own attributes — no overlay resolution); UI binds via `store/`.
3. Each DO verifies the JWT + that document's role, then syncs Automerge changes; it persists incoming changes to its SQLite (storage adapter).
4. **List/search/invite/quota/journal** are REST over the D1 index/registry (`GET /api/journal` UNIONs the `journal_entry` projection + the account `figureType` lesson/practice rows, T6).
5. Each DO's **alarm** compacts history, projects a thin index row to D1, **projects its routine's lesson/practice annotations to the `journal_entry` index** (armed coalesced on annotation edits so the Journal is timely, T6), and expires invites — off the request path.

### 6.3 File structure
```
packages/domain/src/
  ids.ts vocabulary.ts dances.ts timing.ts
  doc-routine.ts doc-figure.ts   # Automerge document schemas + typed helpers
  fork.ts                         # clone (choreo fork) + copy-on-write → frozen choreo-owned copy
  undo.ts                         # history-based inverse-change, per-user
  convergence.ts schemas.ts
apps/worker/src/
  index.ts auth/ routes/ (list, search, invite, quota)
  doc-do.ts                       # per-document SQLite-backed DO: automerge-repo host +
                                  #   storage adapter (DO SQLite) + network adapter (WS) +
                                  #   permission boundary + alarm
  db/schema.ts repo/ permissions.ts analytics.ts
apps/web/src/
  store/                          # automerge-repo wiring (multi-doc) behind a typed seam
  components/ (per screen) lib/ (rpc, sentry) sw.ts
```

---

## 7. Non-Functional Requirements

- **Performance:** mobile-first; shell interactive < ~2s. List/search from the D1 index (indexed; `EXPLAIN QUERY PLAN` in CI). Opening a routine is one sync to its DO + parallel syncs to referenced figure DOs (typically a handful); Smart Placement co-locates the Worker near D1. Higher paid-tier CPU + lifted request cap cover Automerge's heavier compute (WASM) and chatty multi-doc sync.
- **Connectivity:** online-first (sync requires the docs' DOs). Shell loads offline; clear "you're offline" for data. Automerge is local-first, so offline *editing* is an additive next step.
- **Cost:** **Workers Paid (~$5/mo, in place)**. **More DOs** (one per document, incl. figure docs) than a single-doc design, but each is tiny and **Hibernatable WebSockets** keep idle ones cheap; SQLite-backed DOs persist without extra storage cost; D1 is a small index. Pro plan monetizes the free cap.
- **Worker bundle:** Automerge's WASM dominates the bundle — **~920 KiB gzipped** (M0.5-measured), well under the 10 MB paid limit (and the 3 MB free limit); loaded once per isolate.
- **Accessibility:** WCAG AA — color never the sole signal; ≥44px; keyboard/SR navigable; reduced-motion.
- **Browser/PWA:** evergreen mobile + desktop; installable.
- **Data ownership:** a self-contained owned copy comes from **forking** (clone + copy-on-write of a routine **plus its referenced figure docs**); `schemaVersion` envelope + migration ladder upgrade older documents in place; unknown attribute values survive.
- **Ops:** Sentry (+ `@sentry/cloudflare`) for errors; **Analytics Engine** for product metrics; staging + prod; CI runs the test layers + EXPLAIN check.

---

## 8. Locked Technical Decisions

**Δ = changed by the v4 (fork / Automerge) decision.** Override any on review — cheap before code exists.

| # | Decision | Choice |
|---|---|---|
| D1–D5, D9, D15, D16 | Repo (pnpm workspaces), Biome, GitHub Actions, Wrangler (staging/prod), **ULID** ids, Clerk behind `auth/`, Sentry, Node 22/TS strict/ESM | unchanged |
| D7 | Validation / contract | **Zod** in `packages/contract`. |
| D8 | D1 index ORM | **Drizzle** + drizzle-kit; tests use `applyD1Migrations()`. |
| **D6 Δ** | Client data layer | **Core `@automerge/automerge`** (multi-document) behind the `store/` seam; TanStack Query for the REST list surface. (automerge-repo optional — adopt its sync protocol only if delta-efficiency needs it; M0.5 showed core is enough.) |
| **D13 Δ** | CRDT engine & shape | **Automerge** + a **document graph** (figure docs + routine docs), chosen for cross-routine inheritance + fork/merge/history. |
| **D12 Δ** | Fork | **In v1, full** — choreo fork (clone, **frozen** from origin; lineage = provenance only); **copy-on-write = frozen, choreo-owned copy** when editing a figure that lives outside the choreo (global library / personal library); choreo-owned figures edited in place by the choreo's editors. **Reconciled 2026-06:** live overlays / figure auto-update across routines are **retired** in favor of frozen copies (§5.2). |
| **D14 Δ** | Undo | **History-based per-user undo** (inverse of the user's last change); no op-log; richer refusal UX not required (Q-UNDO). |
| **D10 Δ** | Sync | **Custom Automerge change-sync over Hibernatable WebSockets**, one DO connection per document; REST for list/invite/quota. (Live WS/hibernation behavior is the M2 validation item per M0.5.) **Read/edit split (2026-06-28) — role-aware hybrid.** Goal: cut the per-document WS fan-out for the dominant READ path without losing live collaboration (US-015). A single REST **snapshot** (`GET /api/routines/:id/snapshot` — routine + its figures, each carrying its own attributes) hydrates the screen, kept fresh with **light client polling + refetch-on-focus**. Then: **viewers** open **zero WebSockets** (snapshot only). **Editors/owners/commenters** open **one** live **routine** WS immediately (so a collaborator's section/placement/annotation edits converge live), but **figures render from the snapshot** — a figure's **own** WS opens only when its step editor is opened (`openFigure`) or it's edited. This removes the eager **per-figure** socket fan-out (the bulk of the sockets) for everyone and gives viewers zero-socket reads, while preserving the live-convergence guarantee the edit-path sync contract above provides. (An earlier "read-by-default for everyone, upgrade on first edit" variant was rejected: a passive co-editor on a polled snapshot can't receive another editor's edits live — it broke the US-015 convergence journeys.) |
| **D23 Δ** | Persistence topology | **One SQLite-backed Durable Object per document** (routine + figure docs); the DO hosts the Automerge doc + is the sync + permission boundary. **D1 = index/registry only.** Persist **incremental Automerge changes** to DO SQLite, compact on the alarm (spike-validated). |
| D11 | Roles | **viewer/commenter/editor + owner**, **per document**. |
| D17 | Notation | **Attributes on a float-count timeline** (extensible kinds; optional per-attribute role). |
| D18 | Sections | **User-named** + optional preset quick-fills. |
| D19 | Role pref | **No `User.defaultRole`**; per-device view pref. |
| D20 | Annotations | **Unified**; v1 anchors **point + figure**; predicate query anchors deferred. |
| D21 | Plans/quota | **Free cap 3 owned routines**; pro/billing deferred. |
| D22 | Custom attribute kinds | **Creation UI in v1**. |
| D24 | Snapshot/cleanup | **DO alarms** for compaction + D1 index projection + **journal_entry projection (T6)** + invite expiry. |
| D25 | Edge placement | **Smart Placement**. |
| D26 | Product analytics | **Analytics Engine** alongside Sentry. |
| D27 | Async backbone (v1.1) | **Queues** reserved (media, billing webhooks, email). |
| **D28** | Figure scopes | **Global library = application-scoped** (app-owned canonical figures); **choreo-owned copies + personal-library figures = account-scoped**; placements routine-scoped (Q-FIGLIB). |
| **D29** | Cross-dance figures + note visibility | A **`figureType`** family spans dances (different steps, shared identity). **Figure-level + `figureType` annotations in v1**, scoped **this-dance or all-dances**, **owned account-scoped but visible to co-members of shared routines where the figure appears** (Q-FIGNOTE-VIS option 2 — via FigureTypeNoteIndex + co-membership gate). Predicate query anchors stay v1.1. |
| **D30** | Global library seed | Ship a **full Standard syllabus** (ISTD), all 5 dances, organized by `figureType`×dance (Q-LIBSEED) — a dedicated, accuracy-validated **content workstream** (§9), parallel to engineering. |

### Global constraints
- **TS strict;** no `any` without justification.
- **Cloudflare runtime:** Worker (Smart Placement) + **per-document SQLite-backed Durable Objects** (Automerge hosts) + D1 (index) + Static Assets; Hibernatable WebSocket sync; Analytics Engine. Queues/R2 → v1.1.
- **Canonical state lives in the Automerge documents** (persisted in each doc's DO SQLite); **D1 is a pure index/registry**. **No op-log; no CRDT content in D1.**
- **All ids are client-generated ULIDs; soft-delete only.**
- **Permission enforcement is per-document at the DO sync boundary** + on the REST surface — never by post-hoc CRDT cell rejection.
- **Figure copies are frozen snapshots in `domain/` (no live resolution); fork = clone; divergence = copy-on-write to a frozen choreo-owned copy.**
- **The client touches documents only through `store/` (automerge-repo).**
- **Quota check on routine create. Index every D1 query (EXPLAIN in CI). Accessibility WCAG AA.**

---

## 9. Implementation Roadmap (Milestones)

Fork/inheritance is in v1, so the document-graph, the fork/copy-on-write helpers, and the DO sync layer are the early work. **The M0.5 spike (✅ done) retired most of the feasibility risk** — Automerge-in-DO, SQLite persistence, convergence, permission, and multi-doc references all proven on the real runtime. The remaining early risk is the **live WebSocket sync layer** (M2). M0–M1 detailed; M2+ outlined. (A deliberately larger v1 than the single-doc design — the owner's call to get storage right.)

> **For agentic workers:** use `superpowers:subagent-driven-development` / `executing-plans`; steps use `- [ ]`.

| M | Milestone | Deliverable |
|---|---|---|
| **0** | **Foundation** | Monorepo; `domain`+`contract`; CI; Worker + **a SQLite-backed Durable Object scaffold hosting an Automerge doc over a WebSocket** (echo a change between two clients); Clerk session; D1 index migration. **Detailed below.** |
| **0.5** | **Architecture spike — ✅ DONE (GO)** | Ran against real workerd+DO+SQLite via vitest-pool-workers: Automerge runs in workerd, persists to DO SQLite + reloads, two clients converge, permission boundary holds, multi-doc + cross-document references work, and it bundles to **920 KiB gzip** (well under the paid limit). **Verdict: GO.** The throwaway code has been removed; findings + sharp edges are retained in [`docs/spike/SPIKE-FINDINGS.md`](spike/SPIKE-FINDINGS.md). One unknown deferred to M2: live WebSocket/hibernation sync (not testable in vitest). |
| **1** | **Domain core (walking skeleton)** | Pure `domain/`: ATTRIBUTE_REGISTRY (+merge), dances, float-count timing, the **routine + figure document schemas**, **fork (clone) + copy-on-write** (frozen choreo-owned copy), **Automerge convergence** property tests, **history-based per-user undo**, Zod. In-memory, no network. **Detailed below.** |
| **2** | DO + multi-doc sync + persistence | Per-document SQLite-backed DO persisting **incremental Automerge changes**; **live WebSocket sync + Hibernatable WebSockets** (the M0.5-deferred unknown — validate hibernation/wake here); **permission at the connection boundary**; client loads a routine doc + referenced figure docs; alarm compaction + D1 index projection; `store/` seam + Assemble/Timeline/Attribute-Editor. **Start with core `@automerge/automerge` + a thin custom sync; adopt automerge-repo only if delta-sync efficiency requires it.** |
| **3** | Auth, membership (per doc), permissions & quota | Clerk onboarding; per-document Membership + `authorizeConnection`; quota on routine create; invite issue/redeem; Share. |
| **4** | **Fork & copy UX** | Choreo fork (clone, **frozen** + provenance); **copy-on-write = frozen choreo-owned copy** when editing a figure from outside the choreo; choreo-owned figures edited in place; **save to personal library** (explicit reuse); **application-global library** + personal-library figures; figure library screen; "used in N routines". (Library *content* = the parallel workstream below.) |
| **5** | Undo/redo UX | History-based per-user undo wired to UI; "Undone" toast; soft superseded hint. |
| **6** | Annotations (incl. cross-dance) | Unified annotation + replies; anchors **point + figure + `figureType`** (per-dance / all-dances, account doc); **co-member visibility** via the FigureTypeNoteIndex (option 2); timeline + journal. |
| **7** | Custom attribute kinds + Lanes + sample/template + search | Create user-defined kinds; Lanes; sample + template; routine/figure search over the index. |
| **8** | Ops | Migration ladder for in-place schemaVersion upgrades; Sentry + Analytics Engine; EXPLAIN gate; staging/prod; Smart Placement. |
| **9** | PWA + a11y + cross-browser | Installable shell + offline-state; axe/keyboard/reduced-motion; iOS Safari + Android Chrome E2E. |
| *(later)* | *Offline editing; query anchors; billing; ownership transfer* | additive on the document-graph foundation (§11). |

### Content workstream — the full-syllabus global library (Q-LIBSEED)
Seeding a **full Standard syllabus** into the global library is a **major, accuracy-sensitive content effort** that runs **parallel to engineering**:
- **Source & system:** **ISTD is the system of record** for identity (the `figureType` families × the dances each appears in) + grade; **WDSF supplies timing/start/finish/notes**. The two seeds (`docs/seed/istd-standard-figures.json` + `docs/seed/wdsf-standard-figures.json`) are merged by `scripts/gen-library.mjs` into the client-bundled catalog (`packages/domain/src/library-data.ts`) — **241 figures across the 5 Standard dances** (net-new WDSF figures appended). Regenerate, don't hand-edit.
- **Per-count technique content (the part the books gate):** the public syllabus gives only **timing + start/finish phrases**, so by default `buildWdsfAttributes` (`packages/domain/src/wdsf-timing.ts`) emits a **scaffold** — one `footwork` attribute per count carrying the start phrase on count 1 and finish on the last, blank between, **no `direction`**. **Verified** per-count `direction` + `footwork` for **both roles** lives in **`packages/domain/src/figure-steps.ts`**, keyed by `dance:figureType`; `buildWdsfAttributes` emits that authored content when a figure's authored step-count matches its parsed timing, otherwise it falls back to the scaffold. So a **charted** figure arrives with a full both-role timeline (and reads "Library" / pre-filled when added, §4.3); an un-charted one carries the scaffold — **footwork is never invented**.
- **Charted so far (verified-first):** Waltz Natural Turn, Reverse Turn, both Closed Changes, Whisk, Outside Change, Chassé from PP; Foxtrot Feather Step, Three Step. Detailed footwork beyond this lives in the **paid ISTD/WDSF technique books**; until those are in hand, further entries are research-derived and want a dancer's check. **`figure-steps.ts` is the single place to extend** — a guard test keeps each entry's step count aligned to its WDSF timing so it can't silently fall back.
- **Accuracy matters, but isn't a launch blocker (owner):** start from current best-effort values and **refine with real testers** rather than gating on the coach up front. Because vocabulary + seed are data (ATTRIBUTE_REGISTRY, `figure-steps.ts`, seed JSON), corrections during testing are config/content edits, not code changes.
- **Recommended phasing (within the "full" goal):** ship a **validated core** (the most-used figures per dance) at launch, then expand to the full syllabus on a rolling basis — so a notation error never blocks release and the library grows verified. Seed data is versioned by `schemaVersion` and authored as global FigureDocs.

### Data model (D1 index — documents live in their DOs)
```mermaid
erDiagram
    User ||--o{ Membership : has
    DocumentRegistry ||--o{ Membership : grants
    DocumentRegistry ||--o{ Invite : has
    User { text id PK "Clerk sub"; text displayName; text identityColor; text plan "free|pro" }
    DocumentRegistry { text docRef PK "Automerge URL"; text type "routine|global-figure|account-figure|account"; text ownerId FK; text doName; text figureType "nullable (figure)"; text dance "nullable"; text title "nullable (routine)"; text forkedFromRef "nullable"; int bars "nullable (card proj.)"; int figureCount "nullable (routine card)"; int updatedAt; int deletedAt }
    Membership { text id PK; text docRef FK; text userId FK; text role "viewer|commenter|editor"; int createdAt; int deletedAt }
    Invite { text id PK; text docRef FK; text role; int expiresAt; int redeemedAt "nullable" }
```
> **Automerge documents (persisted in their DO's SQLite, not D1):** **routine docs** (sections → placements(figureRef) + routine annotations); **figure docs** — `global` (app-owned canonical, tagged `figureType`+`dance`) and `account` (frozen copies carrying `baseFigureRef` provenance, or custom); and one **account doc** per user holding **`figureType` annotations** (cross-dance, account-scoped) + the index of the user's account figures. **Reference data (bundle):** dances, the **FigureType catalog** (families × dances), standard attribute kinds. D1 rows are a derived projection updated by each DO's alarm.

### Sync + permission + fork flow
Open routine → repo connects to the routine doc's DO (JWT + role check) → reads placements → connects to each referenced figure doc's DO (each enforces its own membership; each figure carries its own attributes) → edits sync per doc, persisted to each DO's SQLite → per-user undo via history inverse → **fork** = clone the routine doc (shared history) → **edit a figure from outside the choreo** = copy-on-write to a frozen choreo-owned copy you own.

---

### Task Detail — Milestone 0: Foundation
#### 0.1 Monorepo (`pnpm-workspace.yaml`, root `package.json` pnpm@9/ESM, `.nvmrc` 22, `biome.json` `noExplicitAny:error`, `tsconfig.base.json` strict, `.gitignore`) → `pnpm install && pnpm biome check .` → commit.
#### 0.2 Scaffold `@ballroom/domain` (deps `zod`, `ulidx`, **`@automerge/automerge`**; dev `vitest`, `fast-check`) + `@ballroom/contract` → verify → commit.
#### 0.3 Worker + SQLite-backed Durable Object + D1 — Wrangler config (`staging`/`production`, `DB` D1 binding, a **`DOC_DO` Durable Object** binding, SPA assets); Hono `GET /api/health`; a minimal **DO hosting an Automerge doc with a WebSocket sync endpoint**; failing test: two simulated clients exchange a change through the DO and converge (`vitest-pool-workers`) → PASS → commit.
#### 0.4 Web SPA + Clerk + verified call — `/api/me` verified `sub`; Worker `auth/` networkless verify; failing test (mint JWT; 401 on missing) → PASS → commit.
#### 0.5 CI — GitHub Actions (pnpm + Node 22; install; biome; typecheck; `pnpm -r test`) → open PR; green → commit.

**M0 exit:** repo boots; CI green; verified call round-trips; two clients converge an Automerge change through a real DO; D1 binding present.

### Task Detail — Milestone 0.5: Architecture spike (throwaway, ahead of the build)
**Purpose:** the riskiest, least-proven part of this plan is the **DIY automerge-repo ↔ Cloudflare integration** (there's no blessed library). Before trusting the M2 milestone, prove it works — or learn early that it doesn't. This is a **timeboxed, throwaway** spike (a branch/sandbox, not production code); its deliverable is a **go/no-go decision + a short findings note** that feeds the real M2/M3 design.

- [ ] **S1 — Storage adapter (DO SQLite).** Implement a minimal automerge-repo **StorageAdapter** backed by a SQLite-backed Durable Object; persist an Automerge doc's incremental changes; **evict the DO and reconnect → the doc rehydrates** intact.
- [ ] **S2 — Network adapter (WebSocket).** Implement a minimal **NetworkAdapter** so a browser automerge-repo syncs with the DO over a (Hibernatable) WebSocket; **two clients converge** a change; confirm hibernation/wake doesn't drop state.
- [ ] **S3 — Permission boundary.** Gate the sync connection: the DO checks a (mocked) membership/role before accepting changes; a **non-member connection is rejected**, an editor's change is accepted, a viewer is read-only.
- [ ] **S4 — Partition/convergence sanity.** Two clients edit while "offline," then reconnect → **converge** with no lost edits; a duplicate change is idempotent.
- [ ] **S5 — Multi-doc reference.** A client opens two docs (a "routine" referencing a "figure") and syncs both through their separate DOs — confirms the per-document topology and connection fan-out are workable.
- [ ] **S6 — Findings + go/no-go.** Write a short note: does the approach hold? rough latency/cost per DO; any sharp edges (hibernation, large-doc compaction, WS limits); adjustments for M2/M3. **If no-go**, reconsider topology (e.g. fewer docs, or a single-routine-doc fallback) *before* building.

**M0.5 exit — ✅ met (GO).** The throwaway spike proved S1–S5 + smoke on the real runtime and a deployable 920 KiB-gzip bundle, then was **removed** (its job was a go/no-go). **Findings that refined the plan** (full write-up in [`docs/spike/SPIKE-FINDINGS.md`](../spike/SPIKE-FINDINGS.md)):
- **Testing infra:** SQLite-backed DOs break vitest-pool-workers *isolated storage* (it chokes on SQLite `-shm`/`-wal` sidecars) → set `isolatedStorage: false` + unique DO ids per test (§10).
- **Persistence:** keep the doc in memory + persist **incremental** changes to SQLite, compact on the alarm — not a full doc rewrite per edit (§2.4, §6).
- **Library:** **core `@automerge/automerge` + a thin custom DO sync** is viable and likely simpler than `automerge-repo`; start there, adopt automerge-repo's sync protocol only if delta-efficiency needs it (D13, §6.1) — this *lowers* the DIY-adapter risk.
- **Deferred to M2:** live **WebSocket + Hibernatable WebSocket** sync (the spike used DO RPC as the transport stand-in; vitest can't drive a real hibernation cycle).

### Task Detail — Milestone 1: Domain Core (walking skeleton)
Pure `domain/`, in-memory Automerge, TDD. **Proves the document graph, frozen copy-on-write, fork, convergence, and undo with no network.**
#### 1.1 ULID ids → commit.
#### 1.2 Dance metadata (`DANCES`) → commit.
#### 1.3 ATTRIBUTE_REGISTRY (+merge) — Tango omits `rise`; `footwork` is free-text (ISTD `HT`/`TH` pass through, `H`→`heel`/`T`→`toe` on read) with a separate `direction` headline kind; `turn` has `eighth_L`; `rise` has `NFR`; position single vs body-action multi; `CBP→CBMP`; a user-defined kind merges → commit.
#### 1.4 Float-count timing — `countLabel`/`countToPhrase` (`3.25`→"3e", `3.5`→"3&", `3.75`→"3a", `3.125`→"3ia", `3.375`→"3ai"); `barsForFigure` per role → commit.
#### 1.5 Document schemas (`doc-routine.ts`, `doc-figure.ts`) — build/read routine + figure Automerge docs (sections, placements w/ figureRef, attributes, annotations); typed helpers; soft-delete flips → commit.
#### 1.6 Frozen figure copy (`fork.ts`) — `copyOnWrite(...)` clones the source's attributes into a **frozen, choreo-owned copy**; `baseFigureRef` = provenance only; **no `resolve`/overlay** (the source is never mutated; later source edits never reach the copy); pure/deterministic → commit.
#### 1.7 Fork + copy-on-write wiring (`fork.ts`) — `cloneRoutine(doc)` (new id, shared history, `forkedFromRef`); `copyOnWrite(placement, sharedFigure, byUser)` re-points the placement to the frozen copy from 1.6 (own attributes + `baseFigureRef` provenance) → commit.
#### 1.8 Automerge convergence (property-based) — random edit sequences applied in different orders / two replicas; converge after exchanging changes; commutative; idempotent on duplicate changes → commit.
#### 1.9 History-based per-user undo (`undo.ts`) — invert a user's last change from history; A's undo reverts only A's change; B's concurrent edit survives; redo; new edit clears redo → commit.
#### 1.10 Zod schemas (registry-derived; lenient read vs strict write; timing range per meter) → commit.

**M1 exit:** the document graph, frozen copy-on-write, fork, convergence, and per-user undo are proven in-memory with unit + property tests, zero network.

### Milestones 2–9 (outline) — as in the table; each becomes its own detailed plan. The standout risks to de-risk early: the **live WebSocket/Hibernatable-WS sync layer** (M2 — the one piece M0.5 didn't cover), **per-document permission at the DO boundary** (M2–M3), and **per-document DO fan-out at scale** (M2, a perf question). (Storage/persistence, convergence, and copy-on-write are already spike-validated.)

---

## 10. Testing Strategy

Quality and a detailed testing plan are a non-negotiable owner requirement. The Automerge document-graph foundation makes **CRDT convergence + cross-document sync + fork/copy-on-write correctness** the top risks, alongside **per-document permission** and **quota**. The op-log/LWW tests of earlier drafts are gone.

> **Annex status:** the retained testing plan predates v2–v4; a useful per-screen *surface* checklist only — rows tied to two-chart/coach/side/typed-slots/op-log/LWW/single-doc are superseded by this section (its banner says so).

### 10.1 Philosophy
Push correctness down the pyramid (document schemas, fork/copy-on-write, convergence, history-based undo, registry/Zod are pure `domain/` with in-memory Automerge — exhaustive + property-based); test the **DO + multi-doc sync + per-doc permission** in `workerd` via `@cloudflare/vitest-pool-workers`; contract types-first + Zod; E2E for journeys + cross-process invariants (incl. two clients converging, and fork/inheritance flows); trace every surface; color never the only signal.

### 10.2 Layer ownership
- **Unit / property (pure `domain/`, in-memory Automerge):** float-count timing; **copy-on-write** (frozen snapshot of the source's attributes; new ids, provenance `baseFigureRef`, placement re-point, **no disturbance to the source**, no live flow-up); **fork clone**; **`figureType` annotation resolution** (an `all`-dances note matches a figure of that family in *any* dance; a `this-dance` note matches only its dance; copies inherit `figureType`); **Automerge convergence/commutativity/idempotence** (fast-check, shuffled/partitioned changes incl. across forks); **history-based per-user undo** (own-change inverse; remote edit preserved; redo); registry/Zod (`NFR`/`H`/`⅛`; Tango omits rise; position vs body-action; `CBP→CBMP`; unknown passthrough-on-read vs reject-on-write; user-defined kind merges; count fraction `e`/`&`/`a`); migration ladder.
- **Worker / DO / D1 (`vitest-pool-workers`):** **two clients converge** through a real per-document DO; a routine that **references a figure doc syncs both**; **permission per document at the boundary** — editor/commenter/viewer/non-member/forged-connection on a routine doc *and* on a figure doc; **copy-on-write** when editing a shared figure without rights; **quota** (4th owned routine → upsell); invite lifecycle; DO **SQLite persistence** (doc survives eviction/reload) + alarm compaction + D1 index projection; **EXPLAIN QUERY PLAN** on index/registry/membership/quota queries.
- **Component (browser + Testing Library + axe):** attribute editor (registry-derived; Tango hides rise; new user-defined kind appears); timeline role flip; Lanes; section rename; **figure library** screen (Library/Custom divergence badge, "used in N"); **copy-on-write** (auto, toast); annotation create (point/figure); viewer/commenter gating; toasts incl. "Undone"/quota/"copied into this choreo".
- **E2E (Playwright):** full authoring (create → section → figure → attributes → role flip); **two live contexts converge** on a routine; **fork a choreo → frozen/independent** (an edit to the *origin routine* does **not** appear in the fork); **edit your own personal-library figure → flows into a second routine** (reused-figure auto-update, US-034); **copy-on-write** (edit a global/personal-library figure inside a choreo → frozen choreo-owned copy created, source untouched, and a later edit to the source does **not** appear in the copy); **save to personal library** (a choreo figure becomes reusable); **cross-dance `figureType` note** (annotate *all Feathers* → it surfaces on a Feather in a Waltz routine *and* a Foxtrot routine; a *this-dance* note surfaces only in that dance); **note visibility (option 2)** — a coach's family-note surfaces for a **co-member** on a shared routine's matching figure, but **not** for a non-member (FigureTypeNoteIndex + co-membership gate); per-user undo across two clients; permission (forged sync connection rejected per doc); quota; invite redemption; PWA install/app-shell-offline; nav.
- **Contract:** `typeof app` + shared doc-shape types (drift fails `tsc`); runtime Zod; schema-drift CI gate.

### 10.3 Tooling, CI, fixtures
Vitest projects: `domain` (Node + fast-check + in-memory Automerge), `worker` (`vitest-pool-workers`, real per-doc DOs + D1 — **`isolatedStorage: false` + unique DO ids per test**, because SQLite-backed DOs break isolated-storage teardown; M0.5 finding), `component` (browser + `vitest-axe`). Playwright: `chromium-desktop`, `mobile-chrome`, `mobile-safari`. Per-suite isolated D1 + `applyD1Migrations()`; DO instances per test; `EXPLAIN QUERY PLAN` helper (index, no SCAN). Clerk test JWKS/PEM + `makeTestJWT`; real verify + per-doc role lookup at the DO boundary. CI: PR fast gate (typecheck+lint → unit/property → contract+drift → worker/DO/D1 incl. EXPLAIN → component+axe → E2E smoke incl. one convergence + one fork/copy-on-write); merge/nightly full Playwright matrix + Lighthouse-CI + staging→prod. No sleeps; deterministic auth+seed; convergence asserted by exchanging changes; `retries:1` + trace. Coverage: domain ≥ 95% (holds copy-on-write/fork/convergence/undo); worker/DO ≥ 90% with every convergence/fork/copy-on-write/permission/quota edge covered. Fixtures: a read-only **sample routine + a small shared figure library (incl. a frozen copy)** defined once and reused; pure factories; `seedDb(...)` for D1 + seeded Automerge docs; `authedContext(role)`. A11y/perf/cross-browser as before (axe; ≥44px; reduced-motion; <~2s shell; mobile WebKit/Chromium; PWA install + offline shell).

---

## 11. Out of Scope (v1) — additive on the document-graph foundation

- **Offline *editing*** (local Automerge persistence + sync-on-reconnect) — online-first in v1; additive (Automerge is local-first).
- **Attribute-predicate annotation anchors** ("all left sways", "all CBMPs", "all rising steps") — a note targeting a *dynamic set* of steps that match an attribute condition, not a single address or identity; v1.1. **Precise spec below — §11.1.**
- **Billing integration / payment provider** — quota enforced in v1; charging deferred. **Ownership transfer** deferred.
- **Latin / spot dances** — `travelling` flag present; v1 Standard only.
- **Per-step alignment** (could be a user-defined kind), finer turn/footwork magnitudes beyond the confirmed set.
- **Annotation/content search**, cross-routine annotations.
- **Media attachments** — v1.1.
- **Notifications, read/unread, reply editing, threading depth.**
- **Syllabus-system attribution**, amalgamations as a first-class entity, precede/follow validation.
- **Themes/backdrop settings**, fine-grained per-member access editing, **native app wrapper.**

> Fork (choreo + figure copy), the global figure library, and **cross-dance `figureType` annotations** are **in v1** (no longer deferred). Fork behavior is resolved: **choreo forks are frozen** from their origin (independent copy); editing a figure from **outside the current choreo** (global / personal library) is **copy-on-write to a frozen choreo-owned copy**; personal-library figures **reused** across a user's routines auto-update in place (US-034). Live overlays / cross-routine figure flow-up are **retired** (reconciled 2026-06). Only **predicate** query anchors ("all rising steps") remain deferred — identity-based `figureType` anchors ship in v1.

### 11.1 Deferred spec — attribute-predicate annotation anchors (v1.1)

*(Captured precisely so the feature can be executed later without re-deriving it. Deferred, not undecided — confirmed v1.1 on 2026-06-29.)*

**What it is.** A fourth annotation anchor type that targets **every step whose notation matches an attribute condition**, rather than one fixed spot (`point`), one figure instance (`figure`), or one figure family by id (`figureType`). It is the natural generalization of `figureType` from an **identity** match to an arbitrary **predicate** over attributes. Examples: *"soften every left-side sway"*, *"watch CBMP on every step that has it"*, *"all rising steps"*, *"every step with **no** sway logged"*.

**Anchor shape.** `attributePredicate { kind, value, role?, scope }`
- `kind` — an attribute kind from the merged ATTRIBUTE_REGISTRY (builtin **or** user-defined): `sway` / `position` / `bodyActions` / `turn` / `rise` / `direction` / `footwork` / a custom kind.
- `value` — a value of that kind to match, **including the sentinel `none`** ("every step with no sway logged" — `none`/absence is an explicit, selectable match value, per the design's link picker). Matched **by meaning**, normalized through the registry's read aliases (`CBP→CBMP`, `H→heel`, …) — the **same content comparison the "custom" badge uses** (§2.5.1 #20). Unknown persisted values pass through and do not match a known value.
- `role?` — optional: match leader-only, follower-only, or either (`null` = either/both), mirroring an attribute's own `role`.
- `scope` — how wide the predicate ranges (the design's 3-way picker, frames 3.6→3.7):
  - `routine` — *this choreo only*. Cheapest: resolvable entirely client-side from the open routine's figures.
  - `<DanceId>` — *all of this user's routines in that dance*.
  - `all` — *every dance* the value can appear in.

**Resolution semantics.** The match set is **dynamic — re-evaluated on read**: adding a step whose attribute matches makes the note surface there automatically; retagging/removing makes it drop. (Contrast: `point`/`figure` are fixed addresses, `figureType` is a fixed id — all static.) Matching is content-based (`kind | value`, optional `role`), normalized via registry aliases.

**Ownership & visibility.** Same model as `figureType` notes (Q-FIGNOTE-VIS = option 2): **owned in the author's account doc** (account-scoped) and **visible to co-members of any shared routine where a matching step appears**. Building it means extending the §2.7 index from `FigureTypeNoteIndex` to an analogous **attribute-predicate index** keyed by `{ kind, value, role?, scope }`, so a routine view can discover co-members' predicate notes matching the steps present without scanning account docs — same co-membership read gate.

**UI is already designed.** The v4 wireframes mock the full flow end-to-end: link picker "An attribute" → family→value (frame 3.6) → scope (frame 3.7) → chip *"↳ all left sways · every dance"*. So the screen work is **design-complete**; only the engine + index + the v1.1 gate are deferred.

**Why it's the one annotation capability deferred.** `figureType` ships in v1 because it's an **identity** match — a stored id on the figure, `O(1)`, no query layer, static set. An attribute predicate additionally needs (a) a small **matching/query layer** over notation, (b) **dynamic re-resolution** as content changes, and (c) for `<dance>`/`all` scopes, a new **cross-account index** like the figureType one. Those land together in v1.1. When built, the three link-picker target types (place / figure / attribute) and the figure/attribute scope toggles unify into one "target → scope" flow (as the design already shows), with `figureType` becoming a special case (a figure-identity predicate).

---

## 12. Open Questions & Decisions Needed

### ✅ Resolved on PR #9
- ✅ Roles → flat viewer/commenter/editor + owner, **per document** (D11).
- ✅ Notation → float-count attributes; optional role; standard kinds step/sway/turn/rise/position (alignment per-figure) (D17).
- ✅ Custom attribute kinds → creation UI in v1 (D22).
- ✅ Annotations → unified; v1 anchors point + figure + **`figureType`** (cross-dance); predicate query anchors deferred (D20/D29).
- ✅ Sections → user-named + quick-fills; alignment-per-figure suffices (D18).
- ✅ Plans/quota → free cap 3 owned routines; billing deferred (D21).
- ✅ **Fork scope** → **cross-routine, full power, in v1**: shared figure library + frozen copies (copy-on-write) + choreo fork with lineage/merge (D12).
- ✅ **CRDT engine/topology (Q-CRDT-LIB)** → **Automerge, document graph, one DO per document**; **M0.5 spike validated it** (Automerge-in-DO, SQLite persistence, convergence, permission, multi-doc references, 920 KiB-gzip bundle). Start with **core `@automerge/automerge` + a thin custom DO sync** (the spike showed automerge-repo may not be needed; adopt its sync protocol only if delta-efficiency demands). Cost (~$5/mo Workers Paid) accepted; SQLite-backed DOs + alarms + Hibernatable WS + Smart Placement + Analytics Engine adopted (D6/D13/D23–D26).
- ✅ **Q-UNDO** → history-based per-user undo, scope = "undo my last change in the doc I'm editing"; no cross-doc COW undo; soft superseded hint, no hard refusal. **Acceptable** (D14).
- ✅ **Q-FORK-UX** → **choreo forks are frozen** at fork time (no pull from origin; `forkedFromRef` = provenance only); figure copies are likewise **frozen snapshots** (no live flow-up). **Personal-library** figures reused across a user's own routines update in place (US-034) (D12). *Reconciled 2026-06: live overlays retired.*
- ✅ **Q-COW-TRIGGER** → **freeze-on-edit-from-outside**: editing a figure that lives **outside this choreo** (global library, or a personal-library figure placed in) silently creates a **frozen, choreo-owned copy**; a **choreo-owned** figure is edited in place by the choreo's editors. Trigger is *location*, not ownership (D12).
- ✅ **Q-FIGLIB** → **application-scoped global library + account-scoped figures** (choreo-owned by default, personal-library on explicit promotion) (D28). Editing a global figure → frozen choreo-owned copy.
- ✅ **Cross-dance figures (new)** → a **`figureType`** family spans dances; **figure-level + cross-dance `figureType` annotations are in v1**, scoped *this-dance* or *all-dances*, owned account-scoped (D29).
- ✅ **Q-FIGNOTE-VIS** → **option 2**: a `figureType` note is owned in your account doc but **visible to co-members of shared routines where the figure appears** (FigureTypeNoteIndex + co-membership gate). Adds a scoped cross-account read path (§2.7, §5.1) (D29).
- ✅ **Q-LIBSEED** → **full Standard syllabus (ISTD identity + WDSF timing)**, all 5 dances, as a parallel **content workstream** (§9); per-count footwork is charted **verified-first** in `figure-steps.ts` and scaffolded from WDSF start/finish otherwise; seed **best-effort values now, refine with testers** (not blocked on the coach); recommended phased (core → full) (D30).
- ✅ **Q-D4** → **proceed with the current `[confirm]` vocabulary** (`closed`/`promenade`/`wing`; `CBM`/`CBMP`; "CBP"→CBMP); **adjust the values during testing** with real users. Since vocabulary is data, no code change is needed to revise it.

### ★ Remaining open
- ✅ **Q-D3** → count fractions are the conventional **`e`=.25, `&`=.5, `a`=.75** ("1 e & a"); `i`-subdivisions `ia`=.125/`ai`=.375. (Earlier draft had `e`/`a` swapped — corrected.)
- **Deferrable, not blocking:** **Q-M1/2/3** — media (v1.1); **Q-SC1/2** — Latin/American target versions.
- **Settled infra:** Clerk boundary clean (D9); color collisions tolerated.

*No open items block the build — the product model, storage foundation, and notation are settled; vocabulary values refine with testers (Q-D4/Q-LIBSEED).*

---

## 13. Appendix: Media (v1.1)
Not in v1. Annotations carry `media[]`; UI "coming soon". When built: R2 presigned PUT URLs (browser→R2), client-side compression, object key in metadata; upload inline while online (iOS Safari lacks Background Sync → in-app retry queue). Q-M1/2/3 cover types/caps/entities.

---

## 14. Further detail & sources

| Document | What it adds | Status |
|---|---|---|
| [`docs/superpowers/specs/2026-06-24-testing-plan.md`](superpowers/specs/2026-06-24-testing-plan.md) | Verbatim per-screen surface checklist | Predates v2–v4; surface only. |
| [`docs/design/project/Ballroom Builder.dc.html`](design/project/Ballroom%20Builder.dc.html) | Wireframe prototype (Pencil) | **Design-parity program (2026-06-29) brought the shipped UI to full parity with this and [`docs/design/project/Ballroom Wireframes v4.dc.html`](design/project/Ballroom%20Wireframes%20v4.dc.html); these wireframes are now the authoritative design reference.** |
| `research/domain.md` | Ballroom domain reference | Behind §3. |
| `research/platform.md` | Platform/architecture research | Behind §6/§8. |
| `research/extensibility-crdt.md`, `research/critique-sync.md` | CRDT + sync reviews | **Load-bearing** for §6 (document graph, per-doc permission boundary). |
| `research/design-spec.md` + remaining `research/critique-*`, `research/extensibility-{attributes,undo}.md` | Wireframe enumeration + critiques/reviews | Background. |

**CRDT library research (June 2026, resolved into D13):** evaluated [Yjs](https://github.com/yjs/yjs) + [y-partyserver](https://github.com/cloudflare/partykit) (Cloudflare-maintained, but single-doc-per-room and weak cross-document/branch story), [Automerge / automerge-repo](https://github.com/automerge/automerge-repo) (Git-like clone/merge/history + many-document graph — chosen for fork/inheritance), and [Loro](https://github.com/loro-dev/loro) (fastest but API/encoding still experimental). Decision: **Automerge** for the document graph. **The M0.5 spike** ([`docs/spike/SPIKE-FINDINGS.md`](spike/SPIKE-FINDINGS.md); throwaway code since removed) validated Automerge-in-DO on the real runtime and found that **core `@automerge/automerge` + a thin custom DO sync** suffices — `automerge-repo` is optional. See [Yjs vs Automerge vs Loro 2026](https://www.pkgpulse.com/guides/yjs-vs-automerge-vs-loro-crdt-libraries-2026) and [Yjs subdocuments limitations](https://docs.yjs.dev/api/subdocuments) (why Yjs's cross-document model wasn't a fit).

**Removed** (folded into this plan): the original design spec, implementation plan, and consolidated open-questions doc.

---

*End of plan (v4.4, Automerge document graph + full fork in v1; M0.5 spike done → GO). The product model, storage foundation, and notation are settled, and the foundational feasibility risk is **retired by the spike** (Automerge-in-DO + SQLite + convergence + permission + multi-doc references + deployable bundle all proven). Sequence: **M0** stands up the stack; **M0.5 ✅** validated the architecture; **M1** proves the document graph + copy-on-write + fork + convergence in-memory; **M2** builds the live DO WebSocket sync (the one piece the spike deferred). Remaining watch-items: **live WS/hibernation sync** (M2) and **per-document DO fan-out at scale** — plus the full-syllabus content effort. The next move is to build, not plan.*
