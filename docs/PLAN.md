# Ballroom Flow — Master Plan

**Status:** Draft for review — **v4.2 (full-syllabus global library + co-member figure-family notes, 2026-06-25)**
**Date:** 2026-06-25

This is the single source of truth for Ballroom Flow. It consolidates the original design/implementation/testing/open-questions docs, then folds in successive owner reviews on PR #9. The latest decision is the foundational one: **full fork/inheritance is in v1** — at both the **choreography** and **figure** level — and to support it correctly the data layer is an **Automerge document graph**, not a single per-routine CRDT. The owner deliberately took on this complexity now to make the storage choice right and avoid a later rewrite.

Three sources are **retained for detail this plan does not reproduce in full** (see [§14](#14-further-detail--sources)):

- **`docs/superpowers/specs/2026-06-24-testing-plan.md`** — verbatim per-screen surface checklist (predates the redesign — see its banner);
- **`docs/design/Ballroom Builder.dc.html`** — the wireframe prototype (product sketch, not requirements);
- **`research/*.md`** — deep-dive research; `extensibility-crdt.md` and `critique-sync.md` remain load-bearing.

**Guiding principle:** *quality and maintainability over feature count.* Fork/inheritance is the one place the owner has chosen *more* upfront complexity, on purpose — everything else stays YAGNI.

> **What's new in v4 (the fork decision and its consequences):** The data model is a **graph of Automerge documents** — reusable **figure documents** (edit once, the change flows into every routine that references it) and **routine documents** (sections + ordered figure *placements* + annotations). A **choreo fork** is an Automerge `clone` (shared history → can merge/pull from origin). A **figure variant** is a figure doc that references a base and stores only an **overlay** (overrides + dropped-step tombstones + additions + rename), resolved live so base edits flow up. **Editing any non-owned figure is auto copy-on-write** → it spawns an account variant you own; forks **auto-pull** upstream. The **global library is application-scoped**, variants/notes **account-scoped**. Figures carry a **cross-dance `figureType`** family identity so a note can target *this Feather* or *every Feather across dances*. The foundation's cost: **Automerge has no Cloudflare-blessed server** (we build the automerge-repo storage + network adapters on SQLite-backed Durable Objects, one DO per document) and **per-user undo is history-based, not turnkey** (accepted). All reflected below.

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

Ballroom Flow is a **collaborative, mobile-first PWA** for building and annotating ballroom dance choreography ("routines"). A routine is an ordered sequence of **figures**, each described as a **timeline of attributes** placed at a relative count. **Figures are reusable, forkable units:** there's an **application-wide global library** of canonical figures plus your **account variants**; a routine *references* figures; refining one of your figures flows into every routine that uses it; and you can **fork a figure into a variant** that inherits the base's step info and stores only your overrides. Figures also have a **cross-dance identity** — a *Feather* exists in Waltz, Foxtrot, and Quickstep with different steps but one family, so a note can target the whole family (this dance or all dances). Whole **routines fork** too — "make it your own" clones a routine (keeping lineage so changes can merge back). Attribute *kinds* are user-extensible. People **annotate** the routine — corrections, lessons, practice notes — anchored to a point, a figure, or a whole figure family across dances. The whole thing is built on a **CRDT document graph** so collaboration, offline, and forking are first-class rather than retrofitted.

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
3. Add **sections** (named by you) → add **figures** from your library / the catalog / compose custom / **fork a figure into a variant**.
4. Open a figure and **place attributes on its count timeline** (the hero flow) — footwork, sway, turn, rise, position, or any kind you've added — for a count, optionally per role. Refining a shared figure flows into every routine that references it; editing a shared figure inside a fork creates your own variant (copy-on-write).
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
- **Soft-delete / tombstones** (`deletedAt`) — the remove-wins marker the CRDT and the overlay model both need; never a hard removal.
- **CRDT-native history.** Automerge keeps full, compressed history per document — the basis for undo (inverse changes), fork lineage, and merge. There is **no separate op-log**.

### 2.2 Figure document — global library + account variants *(reusable, forkable)*

**Three scopes (Q-FIGLIB):** the **global figure library is application-scoped** — canonical, app-owned figure definitions everyone references and nobody edits directly; **variants and custom figures are account-scoped** — your personal divergences/creations; **placements are routine-scoped**. Editing a figure you don't own is always **copy-on-write to an account-scoped variant** (§5.2), so a user never mutates a figure out from under others.

- `id` (Automerge URL), `scope` (`global` | `account`), `ownerId` (the account, or the app for global), **`figureType`** (stable family id, e.g. `feather`), **`dance`** (the dance this definition is for), `name`, `source` (`library` | `custom`), `entryAlignment`/`exitAlignment` (§3.8), `schemaVersion`, `deletedAt`.
- **Cross-dance figure identity (new):** a **`figureType`** (e.g. *Feather*) names a *family* of similar figures that exist in **multiple dances with different steps** (Feather in Foxtrot vs Quickstep vs Waltz). Each (`figureType` × `dance`) is its own global FigureDoc with its own attributes, but they **share the `figureType`** so a note can target the whole family across dances (§2.6). `figureType` lives in the global catalog; a variant **inherits** its base's `figureType` + `dance`.
- **Attributes** (the timeline): a set of `{ id, kind, count (float), role?, value }` (§2.5).
- **Variant fields (the inheritance model):** `baseFigureRef` (nullable Automerge URL of the base figure doc). When set, this doc is a **variant** and stores **only an overlay**:
  - `overrides` — keyed by base attribute id → replacement value;
  - `tombstones` — base attribute ids this variant drops;
  - `additions` — variant-only attributes;
  - `rename` — variant name.
  - **Resolution (`resolve(base, overlay)`):** effective attributes = base attributes − tombstones, with overrides applied, plus additions. Because the base is a **live document**, base edits/additions to non-overridden attributes **flow up** into the variant automatically.
- A figure doc edited in place flows to **every routine placement referencing it** (the shared-library behavior).

### 2.3 Routine document
- `id` (doc id / Automerge URL), metadata mirrored in D1 (title, dance, ownerId, `forkedFromRef` lineage, `templateOf`, `schemaVersion`, timestamps, `deletedAt`).
- **Sections:** ordered list of `{ id, name (free text + optional preset quick-fills) }`. (No long/short/corner enum; alignment-per-figure is enough — no separate floor concept.)
- **Figure placements:** each section owns an ordered list of `{ id, figureRef (Automerge URL of a figure or variant doc), perPlacementAlignment? }`. The routine doesn't *contain* figures — it **references** them, which is what makes the shared-library + fork model work.
- **Annotations** (§2.6) scoped to this routine.

### 2.4 Fork & copy-on-write (the unifying rule — see §5.2)
- **Choreo fork** = Automerge **`clone`** of the routine doc → new doc id, **shared history** (so it can pull/merge from origin). Referenced figure docs are, by default, **still shared** (updates flow). 
- **Editing a referenced figure from inside a routine you don't own the figure in is copy-on-write:** it spawns a **variant** (a new figure doc with `baseFigureRef` = the shared figure) owned by the editor, and the placement re-points to the variant. This unifies "make it your own / copy all info" with "info flows up": you only diverge where you actually edit; everything else keeps inheriting.

### 2.5 Attribute *(the notation unit)*
`{ id, kind (`step`|`sway`|`turn`|`rise`|`position`|… user-defined), count (float, relative to figure start), role (`leader`|`follower`|null=both), value (typed by kind), deletedAt }`. A "step" is the `step`-kind attribute (carries footwork). **Float-count timing** is interpreted modulo the dance's counted phrase (Waltz/Viennese 1–6; rest 1–8); the fraction renders as **`a`=.25, `&`=.5, `e`=.75**, `i` for 1/8s (`ia`=.125, `ai`=.375) — *[confirm], inverts the common "1 e & a" order (Q-D3)*.

### 2.6 Annotation *(unifies Thread/Comment + Journal)*
`{ id, authorId, kind (`note`|`lesson`|`practice`), text, tags[], createdAt, media[] (v1.1), deletedAt }` with **anchors[]** and ordered **Replies** (author-only delete). v1 anchor types:
- `point {figureRef, count, role?}` — a count in a routine figure.
- `figure {figureRef}` — a whole figure instance in a routine.
- **`figureType {figureType, danceScope: <DanceId> | "all"}` *(new — figure-level notes across dances)*** — a note on a whole library figure **family**: this dance only, or **all dances the figure exists in** (e.g. one note on every *Feather*, whether Waltz, Foxtrot, or Quickstep). Applies to global-library figures and to account variants (which inherit `figureType`).

Routine anchors (`point`/`figure`) live in the **routine doc** and are visible to all members of that routine. A **`figureType` annotation is *owned* in your account doc** (account-scoped — it follows the family across all your routines), but per **Q-FIGNOTE-VIS = option 2** it is **visible to co-members of any shared routine where that figure appears** — so a coach's "on every Feather, keep the head left" surfaces for the student on their Feathers (this-dance or all-dances). This needs a small **scoped cross-account read path** (§2.7, §5.1). Predicate **query anchors** ("all rising steps") remain v1.1; `figureType` is *identity-based*, not a predicate, which is why it ships in v1.

### 2.7 D1 index (not document content)
- **User** `{ id (Clerk sub), displayName, identityColor, plan }`.
- **Membership** `{ id, docRef, userId, role (viewer|commenter|editor) }` — **per document** (a routine doc; an account figure can also be shared).
- **DocumentRegistry** `{ docRef, type (routine | global-figure | account-figure | account), ownerId, doName, figureType?, dance?, updatedAt, + list/search projection }` — routes each doc to its DO and powers list/search without reading CRDT content. (`account` = the per-user **account doc** that holds `figureType` annotations and the index of the user's variants.)
- **FigureType catalog (reference data, bundle):** the family ids (e.g. `feather`) and which dances each exists in — drives the all-dances annotation scope and library browsing.
- **FigureTypeNoteIndex** `{ accountDocRef, authorId, figureType, danceScope }` — lets a routine view discover **co-members'** `figureType` notes matching the figures present (Q-FIGNOTE-VIS option 2) without scanning account docs; reading a note's content is gated by **co-membership of a routine containing that figure**.
- **Invite** `{ id, docRef, role, expiresAt, redeemedAt? }`.

### 2.8 Entity-relationship summary

```
D1 index:   User 1──* Membership *──1 DocumentRegistry(routine|global-figure|account-figure|account) · Invite
                                              │ routes to its DO        FigureType catalog (bundle)
Automerge graph (one doc per DO):
  RoutineDoc ──* Section ──* Placement ──(figureRef)──▶ FigureDoc
  RoutineDoc ──* Annotation ──* Reply ;  anchor ──▶ { point | figure }            (routine-scoped)
  FigureDoc  ──* Attribute { kind, count(float), role?, value } ; { figureType, dance, scope }
  FigureDoc(account variant) ──(baseFigureRef)──▶ FigureDoc(global)  [overlay: overrides/tombstones/additions/rename]
  RoutineDoc(fork) ──(forkedFromRef, shared history)──▶ RoutineDoc(origin)
  AccountDoc ──* Annotation ; anchor ──▶ figureType{ family, danceScope: dance|all }   (account-scoped, cross-dance)

Scopes:  application = global library (FigureDocs, app-owned) ;  account = variants + figureType notes ;  routine = placements + routine notes
```

---

## 3. Controlled Vocabularies — the ATTRIBUTE_REGISTRY

Two tiers, merged everywhere (editor, lanes, info-sheet, chips, Zod): **standard kinds** ship in `packages/domain/src/vocabulary.ts` (`{ kind, label, color, cardinality, valueType, values?, appliesToDances?, builtin:true }`); **user-defined kinds** are created in-app (**creation UI in v1**) and stored in the relevant document. Forward-compatible reads: registry version + value aliases; unknown values pass through on read; aliases normalize (`CBP→CBMP`); unknown-value writes to a known kind rejected.

Standard kinds (v1): **`step`** (footwork `HT`/`T`/`TH`/`heel_pull`/`H`, + free-text action) `#a9742c`; **`rise`** (`commence`/`body_rise`/`foot_rise`/`up`/`continue`/`lowering`/`NFR`; **Tango omits** via `appliesToDances`) `#1f8a5b`; **`position`** (single: `closed`/`promenade`/`wing`) + **`bodyActions`** (multi: `CBM`/`CBMP`; "CBP"→CBMP **[confirm] Q-D4**) `#8a5cab`; **`sway`** (`to_L`/`to_R`/`none`) `#c0563f`; **`turn`** (`eighth_L`…`half_R`/`none`) `#5b6b8a`.

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
| **Fork — choreo** | **v1** — clone a routine ("make it your own"); lineage kept; can pull/merge from origin. |
| **Fork — figure (variant)** | **v1** — fork a figure into a variant that inherits the base and stores overrides; **copy-on-write** when editing a shared figure inside a routine. |
| **Figure library** | **v1** — reusable figures; editing one flows into every routine referencing it. |
| **Undo / redo** | **v1** — per-user, history-based (§5.4). |
| Search | routine + figure list by title/name/dance (D1 index). Annotation/content search deferred. |
| Invite | per-document invite by link (signed token → Membership with chosen role). |
| Media | "coming soon" (v1.1). |
| Sample/template | read-only sample + start-from-template. |
| Export/import | JSON export AND import of a routine + its referenced figures (§7). |
| Plans/quota | free cap (3 owned routines) + upsell; billing deferred. |

### 4.1 Routine List (Choreo tab) — your routines (D1 index); card: dance-color icon, title, `dance · barLabel · created`. "+" → New Choreo (quota-checked). **Fork** action on a routine. Empty → sample + template. Search.
### 4.2 Figure Library — browse the **application-global library** (canonical figures, grouped by `figureType`, filterable by dance) and **your account variants/custom figures** (variant badge shows base lineage); create/fork/edit; "used in N routines". Editing one of *your* figures flows into all your referencing routines; editing a global one is **auto-variant**. From a figure family you can open the **cross-dance note** surface (annotate this dance or all dances — §4.6).
### 4.3 Assemble — sections (user-named) → placement cards (figure name, variant/custom badge, attribute summary, alignment chips). Add/fork figure, add section, reorder/delete placements. Share. Role view toggle. Edit affordances gated by membership role.
### 4.4 Figure Timeline (hero surface) — a figure as a count timeline: attributes per count as chips; tap to edit; tap a step to flip viewed role. Add/edit/remove attributes; **Lanes** (one kind across all counts). Edit alignment. **Fork into a variant** here; editing a shared figure prompts copy-on-write.
### 4.5 Attribute Editor (hero flow) — sections render from the merged ATTRIBUTE_REGISTRY (Tango omits rise; single/multi from the registry); re-tap clears; **"add a kind"** affordance (v1).
### 4.6 Annotation (timeline + journal) — one concept; anchors **point / figure / figureType**; reply thread; filters (all/lessons/practice/by figure). The anchor picker offers, for a figure: "this step", "this figure here", or "this **figure family**" with a **dance scope toggle (this dance | all dances it exists in)**. `figureType` notes surface on every matching figure across your routines. Predicate query anchors → v1.1.
### 4.7 Share — per-document member list + roles; invite by link; remove member (editor/owner); **fork** action. Microcopy explains roles + that edits to a shared figure affect every routine using it (else fork/variant).
### 4.8 Profile — identity; editable name; note-color picker (global); **plan status + owned-routine count**; sign out.
### 4.9 Overlays — Add/fork-figure sheet; New Choreo sheet (quota-checked); Add-kind sheet; Info sheet (registry-derived); Toast (incl. "Undone", quota upsell, and **"copied as your variant"** on copy-on-write).

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

### 5.2 Fork & inheritance (the v1 centerpiece)
- **Choreo fork ("make it your own"):** Automerge `clone` of the routine doc → new owned doc, `forkedFromRef` set, **shared history**. **Upstream changes auto-pull** (Q-FORK-UX): a fork stays live with its origin by default (background merge), rather than an explicit review-and-merge step — Automerge merges cleanly, and the small collaboration scale makes silent convergence the least-surprising behavior. Referenced figure docs stay **shared by reference** (updates flow) until diverged.
- **Figure variant ("info flows up, store overrides"):** a figure doc with `baseFigureRef` + overlay (overrides/tombstones/additions/rename), resolved live against the base (§2.2). Base edits to non-overridden steps flow up.
- **Copy-on-write = auto-variant (Q-COW-TRIGGER):** editing **any figure you don't own** (a global-library figure, or someone else's shared figure) **automatically** spawns an account-scoped variant you own and re-points the placement — no prompt. Editing **your own** figure edits it in place (flowing to all your routines that use it). One rule covers "copy all info," "flows up," and "don't disturb others."
- **Scopes & safety:** global-library figures are app-owned (never edited by users → always auto-variant); account figures are edited only by their owner (others auto-variant). This is how the shared/global library stays safe while everyone can still tweak freely.

### 5.3 Concurrent editing
Each document is an Automerge CRDT; concurrent edits **merge by Automerge's rules** (no LWW, no two-zone). Soft-delete is a mergeable flip. Cross-document consistency is by reference (a placement references a figure doc by URL; the repo loads/syncs both).

### 5.4 Undo (per-user, history-based)
Automerge has **no turnkey per-user UndoManager** (unlike Yjs). Undo is implemented from history: compute the **inverse change** of the user's last change (Automerge tracks full history + actor ids, so we filter to the user's own changes and invert), apply it as a new change. This merges correctly with others' concurrent edits. **Scope (confirmed acceptable, Q-UNDO):** "undo my last change" within the document being edited; **no** cross-document undo of a copy-on-write; **no** hard "others built on this" refusal (the CRDT merges) — a soft "superseded" hint at most. This is heavier than Yjs's UndoManager but acceptable given the fork capabilities Automerge buys.

### 5.5 Invites — per document; an `editor` issues a signed expiring token; redeeming creates a Membership with the chosen role.

---

## 6. Architecture

A **graph of Automerge documents**, each hosted + persisted in its own Durable Object that is the sync + permission boundary. **D1** is the index + document registry. The client runs an **automerge-repo** that connects to the several DOs a view needs.

```
[ React 19 + Vite PWA ]   (installable shell)
   • Clerk client (session JWT)
   • automerge-repo (client): loads routine doc + its referenced figure docs;
     resolves variant overlays; history-based per-user undo; bound to UI via store/ seam
        │  WebSocket sync per document (automerge-repo network adapter)   ▲ REST for list/search/invite/quota
        ▼                                                                 │
[ Worker + Durable Objects ]   (Smart Placement; Analytics Engine)
   • Worker (Hono): Clerk verify; list/search/invite/quota/export over the D1 index/registry → D1
   • Durable Object PER DOCUMENT (routine docs AND figure docs), SQLite-backed:
       – hosts the Automerge doc; persists it via an automerge-repo STORAGE ADAPTER in DO SQLite
       – automerge-repo NETWORK ADAPTER over (Hibernatable) WebSockets
       – authenticates each connection (Clerk JWT) + checks that doc's Membership/role (permission boundary)
       – alarm: compaction + project a thin index row to D1 + invite expiry
        │
        ▼
[ D1 (Drizzle) ]  index only: users, memberships (per doc), DocumentRegistry, invites
        (R2 for media → v1.1; Queues → v1.1)
```

### 6.1 Module boundaries (pnpm workspaces)
`contract → domain`; `web → contract, domain`; `worker → contract, domain`.
- **`packages/domain/`** — pure TS, in-memory Automerge (no network): the **document schemas** (routine doc, figure doc), **variant overlay resolution** (`resolve(base, overlay)`), **fork/clone + copy-on-write** helpers, the **ATTRIBUTE_REGISTRY** + merge, **float-count timing**, **convergence invariants**, **history-based undo** (inverse-change of a user's last change), Zod schemas, the migration ladder. All unit/property-testable.
- **`apps/worker/`** — Hono routes (list/search/invite/quota/export), Clerk middleware (`auth/`), the **per-document SQLite-backed Durable Object** (`doc-do.ts`: automerge-repo host + **storage adapter (DO SQLite)** + **network adapter (WS)** + **permission boundary** + alarm), Drizzle/D1 index + registry, Analytics Engine helper.
- **`apps/web/store/`** — wraps **automerge-repo** (loads the routine doc + referenced figure docs, resolves overlays, exposes typed reactive reads + mutations + history-based undo). Components never touch automerge-repo or the RPC client directly.
- **`apps/web/`** — presentational React; service worker.
- **`packages/contract/`** — Zod schemas + Hono RPC `typeof app` (REST surface) + shared document-shape types.

### 6.2 Data flow
1. Clerk JWT.
2. Opening a routine: the client repo connects to the **routine doc's DO**, reads its placements, then connects to each **referenced figure doc's DO**; overlays resolve client-side; UI binds via `store/`.
3. Each DO verifies the JWT + that document's role, then syncs Automerge changes; it persists incoming changes to its SQLite (storage adapter).
4. **List/search/invite/quota** are REST over the D1 index/registry. **Export** loads a routine doc + its referenced figure docs.
5. Each DO's **alarm** compacts history, projects a thin index row to D1, and expires invites — off the request path.

### 6.3 File structure
```
packages/domain/src/
  ids.ts vocabulary.ts dances.ts timing.ts
  doc-routine.ts doc-figure.ts   # Automerge document schemas + typed helpers
  overlay.ts                      # variant resolution: base ⊕ {overrides,tombstones,additions,rename}
  fork.ts                         # clone (choreo fork) + copy-on-write (figure)
  undo.ts                         # history-based inverse-change, per-user
  convergence.ts schemas.ts
apps/worker/src/
  index.ts auth/ routes/ (list, search, invite, quota, export)
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
- **Accessibility:** WCAG AA — color never the sole signal; ≥44px; keyboard/SR navigable; reduced-motion.
- **Browser/PWA:** evergreen mobile + desktop; installable.
- **Data ownership:** JSON **export AND import** of a routine **plus its referenced figure docs** (so a fork/export is self-contained); `schemaVersion` envelope + migration ladder; unknown attribute values survive round-trip.
- **Ops:** Sentry (+ `@sentry/cloudflare`) for errors; **Analytics Engine** for product metrics; staging + prod; CI runs the test layers + EXPLAIN check.

---

## 8. Locked Technical Decisions

**Δ = changed by the v4 (fork / Automerge) decision.** Override any on review — cheap before code exists.

| # | Decision | Choice |
|---|---|---|
| D1–D5, D9, D15, D16 | Repo (pnpm workspaces), Biome, GitHub Actions, Wrangler (staging/prod), **ULID** ids, Clerk behind `auth/`, Sentry, Node 22/TS strict/ESM | unchanged |
| D7 | Validation / contract | **Zod** in `packages/contract`. |
| D8 | D1 index ORM | **Drizzle** + drizzle-kit; tests use `applyD1Migrations()`. |
| **D6 Δ** | Client data layer | **automerge-repo** (multi-document) behind the `store/` seam; TanStack Query for the REST list surface. |
| **D13 Δ** | CRDT engine & shape | **Automerge** + a **document graph** (figure docs + routine docs), chosen for cross-routine inheritance + fork/merge/history. |
| **D12 Δ** | Fork | **In v1, full** — choreo fork (clone + lineage, **auto-pull** upstream), figure variants (overlay), **copy-on-write = auto-variant** for any non-owned figure. |
| **D14 Δ** | Undo | **History-based per-user undo** (inverse of the user's last change); no op-log; richer refusal UX not required (Q-UNDO). |
| **D10 Δ** | Sync | **automerge-repo network adapter over Hibernatable WebSockets**, one connection per document; REST for list/invite/quota/export. |
| **D23 Δ** | Persistence topology | **One SQLite-backed Durable Object per document** (routine + figure docs); the DO is the automerge-repo storage host + sync + permission boundary. **D1 = index/registry only.** We build the automerge-repo **Cloudflare storage + network adapters ourselves** (no blessed lib). |
| D11 | Roles | **viewer/commenter/editor + owner**, **per document**. |
| D17 | Notation | **Attributes on a float-count timeline** (extensible kinds; optional per-attribute role). |
| D18 | Sections | **User-named** + optional preset quick-fills. |
| D19 | Role pref | **No `User.defaultRole`**; per-device view pref. |
| D20 | Annotations | **Unified**; v1 anchors **point + figure**; query/variant-query deferred. |
| D21 | Plans/quota | **Free cap 3 owned routines**; pro/billing deferred. |
| D22 | Custom attribute kinds | **Creation UI in v1**. |
| D24 | Snapshot/cleanup | **DO alarms** for compaction + D1 index projection + invite expiry. |
| D25 | Edge placement | **Smart Placement**. |
| D26 | Product analytics | **Analytics Engine** alongside Sentry. |
| D27 | Async backbone (v1.1) | **Queues** reserved (media, billing webhooks, email). |
| **D28** | Figure scopes | **Global library = application-scoped** (app-owned canonical figures); **variants/custom = account-scoped**; placements routine-scoped (Q-FIGLIB). |
| **D29** | Cross-dance figures + note visibility | A **`figureType`** family spans dances (different steps, shared identity). **Figure-level + `figureType` annotations in v1**, scoped **this-dance or all-dances**, **owned account-scoped but visible to co-members of shared routines where the figure appears** (Q-FIGNOTE-VIS option 2 — via FigureTypeNoteIndex + co-membership gate). Predicate query anchors stay v1.1. |
| **D30** | Global library seed | Ship a **full Standard syllabus** (ISTD), all 5 dances, organized by `figureType`×dance (Q-LIBSEED) — a dedicated, accuracy-validated **content workstream** (§9), parallel to engineering. |

### Global constraints
- **TS strict;** no `any` without justification.
- **Cloudflare runtime:** Worker (Smart Placement) + **per-document SQLite-backed Durable Objects** (Automerge hosts) + D1 (index) + Static Assets; Hibernatable WebSocket sync; Analytics Engine. Queues/R2 → v1.1.
- **Canonical state lives in the Automerge documents** (persisted in each doc's DO SQLite); **D1 is a pure index/registry**. **No op-log; no CRDT content in D1.**
- **All ids are client-generated ULIDs; soft-delete only.**
- **Permission enforcement is per-document at the DO sync boundary** + on the REST surface — never by post-hoc CRDT cell rejection.
- **Figure inheritance is resolved in `domain/` (`resolve(base, overlay)`); fork = clone; divergence = copy-on-write.**
- **The client touches documents only through `store/` (automerge-repo).**
- **Quota check on routine create. Index every D1 query (EXPLAIN in CI). Accessibility WCAG AA.**

---

## 9. Implementation Roadmap (Milestones)

Fork/inheritance is in v1, so the document-graph, overlay resolution, and the DIY automerge-repo Cloudflare adapters are the early, highest-risk work. M0–M1 detailed; M2+ outlined. (This is a deliberately larger v1 than the single-doc design — the owner's call to get storage right.)

> **For agentic workers:** use `superpowers:subagent-driven-development` / `executing-plans`; steps use `- [ ]`.

| M | Milestone | Deliverable |
|---|---|---|
| **0** | **Foundation** | Monorepo; `domain`+`contract`; CI; Worker + **a SQLite-backed Durable Object scaffold hosting an Automerge doc over a WebSocket** (echo a change between two clients); Clerk session; D1 index migration. **Detailed below.** |
| **1** | **Domain core (walking skeleton)** | Pure `domain/`: ATTRIBUTE_REGISTRY (+merge), dances, float-count timing, the **routine + figure document schemas**, **overlay resolution** (`resolve(base,overlay)`), **fork (clone) + copy-on-write**, **Automerge convergence** property tests, **history-based per-user undo**, Zod. In-memory, no network. **Detailed below.** |
| **2** | DO + multi-doc sync + persistence | The **automerge-repo storage adapter (DO SQLite)** + **network adapter (WS)**; per-document DO; client repo loads a routine doc + referenced figure docs; **permission at the DO boundary**; alarm compaction + D1 index projection; `store/` seam + Assemble/Timeline/Attribute-Editor. |
| **3** | Auth, membership (per doc), permissions & quota | Clerk onboarding; per-document Membership + `authorizeConnection`; quota on routine create; invite issue/redeem; Share. |
| **4** | **Fork & inheritance UX** | Choreo fork (clone + lineage + **auto-pull**); figure variants (overlay) + **auto-variant** copy-on-write; **application-global library** + account variants; figure library screen; "used in N routines". (Library *content* = the parallel workstream below.) |
| **5** | Undo/redo UX | History-based per-user undo wired to UI; "Undone" toast; soft superseded hint. |
| **6** | Annotations (incl. cross-dance) | Unified annotation + replies; anchors **point + figure + `figureType`** (per-dance / all-dances, account doc); **co-member visibility** via the FigureTypeNoteIndex (option 2); timeline + journal. |
| **7** | Custom attribute kinds + Lanes + sample/template + search | Create user-defined kinds; Lanes; sample + template; routine/figure search over the index. |
| **8** | Export / import + ops | schemaVersion'd round-trip (routine + referenced figures) + migration ladder; Sentry + Analytics Engine; EXPLAIN gate; staging/prod; Smart Placement. |
| **9** | PWA + a11y + cross-browser | Installable shell + offline-state; axe/keyboard/reduced-motion; iOS Safari + Android Chrome E2E. |
| *(later)* | *Offline editing; query anchors; billing; ownership transfer* | additive on the document-graph foundation (§11). |

### Content workstream — the full-syllabus global library (Q-LIBSEED)
Seeding a **full Standard syllabus** (ISTD, all 5 dances) into the global library is a **major, accuracy-sensitive content effort** that runs **parallel to engineering**, not a code task:
- **Source & system:** one syllabus system (**ISTD**, per Q-D8), enumerated as `figureType` families × the dances each appears in, with each (family×dance) figure's attributes (steps/footwork/sway/turn/rise/position/alignment).
- **Accuracy is the risk:** "a notation tool that gets the notation wrong is worse than a blank notebook" — every seeded figure needs **coach/dancer validation** (ties to Q-D4, still pending the coach). 
- **Recommended phasing (within the "full" goal):** ship a **validated core** (the most-used figures per dance) at launch, then expand to the full syllabus on a rolling basis — so a notation error never blocks release and the library grows verified. Seed data is versioned by `schemaVersion` and authored as global FigureDocs.

### Data model (D1 index — documents live in their DOs)
```mermaid
erDiagram
    User ||--o{ Membership : has
    DocumentRegistry ||--o{ Membership : grants
    DocumentRegistry ||--o{ Invite : has
    User { text id PK "Clerk sub"; text displayName; text identityColor; text plan "free|pro" }
    DocumentRegistry { text docRef PK "Automerge URL"; text type "routine|global-figure|account-figure|account"; text ownerId FK; text doName; text figureType "nullable (figure)"; text dance "nullable"; text title "nullable (routine)"; text forkedFromRef "nullable"; int updatedAt; int deletedAt }
    Membership { text id PK; text docRef FK; text userId FK; text role "viewer|commenter|editor"; int createdAt; int deletedAt }
    Invite { text id PK; text docRef FK; text role; int expiresAt; int redeemedAt "nullable" }
```
> **Automerge documents (persisted in their DO's SQLite, not D1):** **routine docs** (sections → placements(figureRef) + routine annotations); **figure docs** — `global` (app-owned canonical, tagged `figureType`+`dance`) and `account` (variants carrying `baseFigureRef`+overlay, or custom); and one **account doc** per user holding **`figureType` annotations** (cross-dance, account-scoped) + the index of the user's variants. **Reference data (bundle):** dances, the **FigureType catalog** (families × dances), standard attribute kinds. D1 rows are a derived projection updated by each DO's alarm.

### Sync + permission + fork flow
Open routine → repo connects to the routine doc's DO (JWT + role check) → reads placements → connects to each referenced figure doc's DO (each enforces its own membership) → overlays resolve client-side → edits sync per doc, persisted to each DO's SQLite → per-user undo via history inverse → **fork** = clone the routine doc (shared history) → **edit a shared figure without rights** = copy-on-write to a new variant doc you own.

---

### Task Detail — Milestone 0: Foundation
#### 0.1 Monorepo (`pnpm-workspace.yaml`, root `package.json` pnpm@9/ESM, `.nvmrc` 22, `biome.json` `noExplicitAny:error`, `tsconfig.base.json` strict, `.gitignore`) → `pnpm install && pnpm biome check .` → commit.
#### 0.2 Scaffold `@ballroom/domain` (deps `zod`, `ulidx`, **`@automerge/automerge`**; dev `vitest`, `fast-check`) + `@ballroom/contract` → verify → commit.
#### 0.3 Worker + SQLite-backed Durable Object + D1 — Wrangler config (`staging`/`production`, `DB` D1 binding, a **`DOC_DO` Durable Object** binding, SPA assets); Hono `GET /api/health`; a minimal **DO hosting an Automerge doc with a WebSocket sync endpoint**; failing test: two simulated clients exchange a change through the DO and converge (`vitest-pool-workers`) → PASS → commit.
#### 0.4 Web SPA + Clerk + verified call — `/api/me` verified `sub`; Worker `auth/` networkless verify; failing test (mint JWT; 401 on missing) → PASS → commit.
#### 0.5 CI — GitHub Actions (pnpm + Node 22; install; biome; typecheck; `pnpm -r test`) → open PR; green → commit.

**M0 exit:** repo boots; CI green; verified call round-trips; two clients converge an Automerge change through a real DO; D1 binding present.

### Task Detail — Milestone 1: Domain Core (walking skeleton)
Pure `domain/`, in-memory Automerge, TDD. **Proves the document graph, overlay inheritance, fork/copy-on-write, convergence, and undo with no network.**
#### 1.1 ULID ids → commit.
#### 1.2 Dance metadata (`DANCES`) → commit.
#### 1.3 ATTRIBUTE_REGISTRY (+merge) — Tango omits `rise`; `step` has `H`; `turn` has `eighth_L`; `rise` has `NFR`; position single vs body-action multi; `CBP→CBMP`; a user-defined kind merges → commit.
#### 1.4 Float-count timing — `countLabel`/`countToBar` (`3.5`→"3&", `3.25`→"3a", `3.75`→"3e", `3.125`→"3ia", `3.375`→"3ai"; per Q-D3); `barsForFigure` per role → commit.
#### 1.5 Document schemas (`doc-routine.ts`, `doc-figure.ts`) — build/read routine + figure Automerge docs (sections, placements w/ figureRef, attributes, annotations); typed helpers; soft-delete flips → commit.
#### 1.6 Overlay resolution (`overlay.ts`) — `resolve(base, overlay)`: base − tombstones + overrides + additions; **base additions flow up**; overrides win; rename applies; pure/deterministic → commit.
#### 1.7 Fork + copy-on-write (`fork.ts`) — `cloneRoutine(doc)` (new id, shared history, `forkedFromRef`); `copyOnWrite(placement, sharedFigure, byUser)` → new variant doc with `baseFigureRef` + empty overlay, placement re-pointed → commit.
#### 1.8 Automerge convergence (property-based) — random edit sequences applied in different orders / two replicas; converge after exchanging changes; commutative; idempotent on duplicate changes → commit.
#### 1.9 History-based per-user undo (`undo.ts`) — invert a user's last change from history; A's undo reverts only A's change; B's concurrent edit survives; redo; new edit clears redo → commit.
#### 1.10 Zod schemas (registry-derived; lenient read vs strict write; timing range per meter) → commit.

**M1 exit:** the document graph, overlay inheritance, fork/copy-on-write, convergence, and per-user undo are proven in-memory with unit + property tests, zero network.

### Milestones 2–9 (outline) — as in the table; each becomes its own detailed plan. The standout risks to de-risk early: the **automerge-repo Cloudflare storage/network adapters** (M2), **per-document permission at the DO boundary** (M2–M3), and **overlay + copy-on-write correctness** (M1, M4).

---

## 10. Testing Strategy

Quality and a detailed testing plan are a non-negotiable owner requirement. The Automerge document-graph foundation makes **CRDT convergence + cross-document sync + overlay/fork correctness** the top risks, alongside **per-document permission** and **quota**. The op-log/LWW tests of earlier drafts are gone.

> **Annex status:** the retained testing plan predates v2–v4; a useful per-screen *surface* checklist only — rows tied to two-chart/coach/side/typed-slots/op-log/LWW/single-doc are superseded by this section (its banner says so).

### 10.1 Philosophy
Push correctness down the pyramid (document schemas, overlay resolution, fork/copy-on-write, convergence, history-based undo, registry/Zod are pure `domain/` with in-memory Automerge — exhaustive + property-based); test the **DO + multi-doc sync + per-doc permission** in `workerd` via `@cloudflare/vitest-pool-workers`; contract types-first + Zod; E2E for journeys + cross-process invariants (incl. two clients converging, and fork/inheritance flows); trace every surface; color never the only signal.

### 10.2 Layer ownership
- **Unit / property (pure `domain/`, in-memory Automerge):** float-count timing; **overlay resolution** (inherit/override/tombstone/addition/rename; base-addition flow-up); **fork clone + copy-on-write** (new ids, lineage, placement re-point, no disturbance to the shared base); **`figureType` annotation resolution** (an `all`-dances note matches a figure of that family in *any* dance; a `this-dance` note matches only its dance; variants inherit `figureType`); **Automerge convergence/commutativity/idempotence** (fast-check, shuffled/partitioned changes incl. across forks); **history-based per-user undo** (own-change inverse; remote edit preserved; redo); registry/Zod (`NFR`/`H`/`⅛`; Tango omits rise; position vs body-action; `CBP→CBMP`; unknown passthrough-on-read vs reject-on-write; user-defined kind merges; count fraction per Q-D3); migration ladder.
- **Worker / DO / D1 (`vitest-pool-workers`):** **two clients converge** through a real per-document DO; a routine that **references a figure doc syncs both**; **permission per document at the boundary** — editor/commenter/viewer/non-member/forged-connection on a routine doc *and* on a figure doc; **copy-on-write** when editing a shared figure without rights; **quota** (4th owned routine → upsell); invite lifecycle; DO **SQLite persistence** (doc survives eviction/reload) + alarm compaction + D1 index projection; export loads routine + referenced figures; **EXPLAIN QUERY PLAN** on index/registry/membership/quota queries.
- **Component (browser + Testing Library + axe):** attribute editor (registry-derived; Tango hides rise; new user-defined kind appears); timeline role flip; Lanes; section rename; **figure library** screen (variant badge, "used in N"); **fork/variant** affordances + copy-on-write prompt; annotation create (point/figure); viewer/commenter gating; toasts incl. "Undone"/quota/"copied as your variant".
- **E2E (Playwright):** full authoring (create → section → figure → attributes → role flip); **two live contexts converge** on a routine; **fork a choreo → lineage kept → an upstream change auto-pulls in**; **edit your own shared figure → flows into a second routine**; **auto-variant** (edit a global/non-owned figure → account variant created, original untouched); **cross-dance `figureType` note** (annotate *all Feathers* → it surfaces on a Feather in a Waltz routine *and* a Foxtrot routine; a *this-dance* note surfaces only in that dance); **note visibility (option 2)** — a coach's family-note surfaces for a **co-member** on a shared routine's matching figure, but **not** for a non-member (FigureTypeNoteIndex + co-membership gate); per-user undo across two clients; permission (forged sync connection rejected per doc); quota; invite redemption; export→import (with referenced figures); PWA install/app-shell-offline; nav.
- **Contract:** `typeof app` + shared doc-shape types (drift fails `tsc`); runtime Zod; schema-drift CI gate.

### 10.3 Tooling, CI, fixtures
Vitest projects: `domain` (Node + fast-check + in-memory Automerge), `worker` (`vitest-pool-workers`, real per-doc DOs + D1), `component` (browser + `vitest-axe`). Playwright: `chromium-desktop`, `mobile-chrome`, `mobile-safari`. Per-suite isolated D1 + `applyD1Migrations()`; DO instances per test; `EXPLAIN QUERY PLAN` helper (index, no SCAN). Clerk test JWKS/PEM + `makeTestJWT`; real verify + per-doc role lookup at the DO boundary. CI: PR fast gate (typecheck+lint → unit/property → contract+drift → worker/DO/D1 incl. EXPLAIN → component+axe → E2E smoke incl. one convergence + one fork/copy-on-write); merge/nightly full Playwright matrix + Lighthouse-CI + staging→prod. No sleeps; deterministic auth+seed; convergence asserted by exchanging changes; `retries:1` + trace. Coverage: domain ≥ 95% (holds overlay/fork/convergence/undo); worker/DO ≥ 90% with every convergence/fork/copy-on-write/permission/quota edge covered. Fixtures: a read-only **sample routine + a small shared figure library (incl. a variant)** defined once and reused; pure factories; `seedDb(...)` for D1 + seeded Automerge docs; `authedContext(role)`. A11y/perf/cross-browser as before (axe; ≥44px; reduced-motion; <~2s shell; mobile WebKit/Chromium; PWA install + offline shell).

---

## 11. Out of Scope (v1) — additive on the document-graph foundation

- **Offline *editing*** (local Automerge persistence + sync-on-reconnect) — online-first in v1; additive (Automerge is local-first).
- **Query anchors** for annotations ("all rising steps") — predicate language; v1.1.
- **Billing integration / payment provider** — quota enforced in v1; charging deferred. **Ownership transfer** deferred.
- **Latin / spot dances** — `travelling` flag present; v1 Standard only.
- **Per-step alignment** (could be a user-defined kind), finer turn/footwork magnitudes beyond the confirmed set.
- **Annotation/content search**, cross-routine annotations.
- **Media attachments** — v1.1.
- **Notifications, read/unread, reply editing, threading depth.**
- **Syllabus-system attribution**, amalgamations as a first-class entity, precede/follow validation.
- **Themes/backdrop settings**, fine-grained per-member access editing, **native app wrapper.**

> Fork (choreo + figure), the global figure library, inheritance, and **cross-dance `figureType` annotations** are **in v1** (no longer deferred). Fork behavior is resolved: **auto-pull** upstream + **auto-variant** copy-on-write. Only **predicate** query anchors ("all rising steps") remain deferred — identity-based `figureType` anchors ship in v1.

---

## 12. Open Questions & Decisions Needed

### ✅ Resolved on PR #9
- ✅ Roles → flat viewer/commenter/editor + owner, **per document** (D11).
- ✅ Notation → float-count attributes; optional role; standard kinds step/sway/turn/rise/position (alignment per-figure) (D17).
- ✅ Custom attribute kinds → creation UI in v1 (D22).
- ✅ Annotations → unified; v1 anchors point + figure + **`figureType`** (cross-dance); predicate query anchors deferred (D20/D29).
- ✅ Sections → user-named + quick-fills; alignment-per-figure suffices (D18).
- ✅ Plans/quota → free cap 3 owned routines; billing deferred (D21).
- ✅ **Fork scope** → **cross-routine, full power, in v1**: shared figure library + variants (overlay/copy-on-write) + choreo fork with lineage/merge (D12).
- ✅ **CRDT engine/topology (Q-CRDT-LIB)** → **Automerge + automerge-repo, document graph, one DO per document**, with **DIY Cloudflare storage/network adapters**. Cost (~$5/mo Workers Paid) accepted; SQLite-backed DOs + alarms + Hibernatable WS + Smart Placement + Analytics Engine adopted (D6/D13/D23–D26).
- ✅ **Q-UNDO** → history-based per-user undo, scope = "undo my last change in the doc I'm editing"; no cross-doc COW undo; soft superseded hint, no hard refusal. **Acceptable** (D14).
- ✅ **Q-FORK-UX** → **auto-pull**: forks track origin and shared figures update live (background merge), no explicit review-and-merge surface in v1 (D12).
- ✅ **Q-COW-TRIGGER** → **auto-variant**: editing any non-owned figure silently creates an account-scoped variant; editing your own edits in place (D12).
- ✅ **Q-FIGLIB** → **application-scoped global library + account-scoped variants** (D28). Editing a global figure → auto-variant.
- ✅ **Cross-dance figures (new)** → a **`figureType`** family spans dances; **figure-level + cross-dance `figureType` annotations are in v1**, scoped *this-dance* or *all-dances*, owned account-scoped (D29).
- ✅ **Q-FIGNOTE-VIS** → **option 2**: a `figureType` note is owned in your account doc but **visible to co-members of shared routines where the figure appears** (FigureTypeNoteIndex + co-membership gate). Adds a scoped cross-account read path (§2.7, §5.1) (D29).
- ✅ **Q-LIBSEED** → **full Standard syllabus (ISTD)**, all 5 dances, as a parallel **content workstream** (§9), validated by the coach, recommended phased (validated core → full) (D30).

### ★ Remaining open
- **★ Q-D4 — Body position + body-action vocabulary (pending the owner's coach).** Also now **gates the content workstream** — seeding syllabus figures needs validated technique values. Confirm `closed`/`promenade`/`wing`, `CBM`/`CBMP`, "CBP"→CBMP.
- **Q-D3** — count fraction mapping (inverts "1 e & a"); **Q-M1/2/3** — media (v1.1); **Q-SC1/2** — Latin/American target versions.
- **Settled infra:** Clerk boundary clean (D9); color collisions tolerated.

---

## 13. Appendix: Media (v1.1)
Not in v1. Annotations carry `media[]`; UI "coming soon". When built: R2 presigned PUT URLs (browser→R2), client-side compression, object key in metadata; upload inline while online (iOS Safari lacks Background Sync → in-app retry queue). Q-M1/2/3 cover types/caps/entities.

---

## 14. Further detail & sources

| Document | What it adds | Status |
|---|---|---|
| [`docs/superpowers/specs/2026-06-24-testing-plan.md`](superpowers/specs/2026-06-24-testing-plan.md) | Verbatim per-screen surface checklist | Predates v2–v4; surface only. |
| [`docs/design/Ballroom Builder.dc.html`](design/Ballroom%20Builder.dc.html) | Wireframe prototype | Sketch. |
| `research/domain.md` | Ballroom domain reference | Behind §3. |
| `research/platform.md` | Platform/architecture research | Behind §6/§8. |
| `research/extensibility-crdt.md`, `research/critique-sync.md` | CRDT + sync reviews | **Load-bearing** for §6 (document graph, per-doc permission boundary). |
| `research/design-spec.md` + remaining `research/critique-*`, `research/extensibility-{attributes,undo}.md` | Wireframe enumeration + critiques/reviews | Background. |

**CRDT library research (June 2026, resolved into D13):** evaluated [Yjs](https://github.com/yjs/yjs) + [y-partyserver](https://github.com/cloudflare/partykit) (Cloudflare-maintained, but single-doc-per-room and weak cross-document/branch story), [Automerge / automerge-repo](https://github.com/automerge/automerge-repo) (Git-like clone/merge/history + many-document graph — chosen for fork/inheritance), and [Loro](https://github.com/loro-dev/loro) (fastest but API/encoding still experimental). Decision: **Automerge** for the document graph; we build the Cloudflare DO storage/network adapters. See [Yjs vs Automerge vs Loro 2026](https://www.pkgpulse.com/guides/yjs-vs-automerge-vs-loro-crdt-libraries-2026) and [Yjs subdocuments limitations](https://docs.yjs.dev/api/subdocuments) (why Yjs's cross-document model wasn't a fit).

**Removed** (folded into this plan): the original design spec, implementation plan, and consolidated open-questions doc.

---

*End of plan (v4, Automerge document graph + full fork in v1). The product model and the storage foundation are settled; the open items (Q-UNDO ergonomics, Q-FORK-UX merge granularity, Q-COW-TRIGGER, Q-FIGLIB) are fork/UX refinements, not architecture. M0 stands up an Automerge DO; M1 proves the document graph + overlay + fork + convergence in-memory; M2 builds the DIY automerge-repo Cloudflare adapters — the highest-risk piece — early.*
