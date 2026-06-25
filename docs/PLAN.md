# Ballroom Flow — Master Plan

**Status:** Draft for review — **v3 (CRDT foundation, 2026-06-25)**
**Date:** 2026-06-25

This is the single source of truth for Ballroom Flow. It consolidates the original design/implementation/testing/open-questions docs, then folds in two rounds of owner review on PR #9 — the second of which **resolved the architectural keystones**: a **CRDT document foundation** (built now so it's never swapped out; run online-first, with offline/fork mechanics layered on later), an **extensible attribute notation model**, **unified annotations**, **user-named sections**, **flat roles**, and **plans/quota**.

Three sources are **retained for detail this plan does not reproduce in full** (see [§14](#14-further-detail--sources)):

- **`docs/superpowers/specs/2026-06-24-testing-plan.md`** — the verbatim per-screen surface checklist (predates the v2/v3 redesign — see its banner);
- **`docs/design/Ballroom Builder.dc.html`** — the wireframe prototype (product sketch, not requirements);
- **`research/*.md`** — the deep-dive research, incl. `extensibility-crdt.md` and `critique-sync.md`, now load-bearing again.

**Guiding principle:** *quality and maintainability over feature count.* The owner has deliberately chosen the CRDT foundation — *more* upfront architecture — precisely to avoid a later rewrite; everything else stays YAGNI.

> **Workers Paid is now in place** (the owner upgraded), so the plan leans on the paid tier's capabilities where they *simplify* the design, not just add features: **SQLite-backed Durable Objects** (each routine DO persists its own CRDT — D1 drops to a pure index), **DO alarms** (debounced snapshots + invite expiry), **Hibernatable WebSockets** (idle sync stays cheap), **Smart Placement**, and **Analytics Engine** (first-party product metrics). Higher CPU and the lifted 100k/day request cap remove constraints the earlier draft tiptoed around. One open call remains (§12): **Q-UNDO** — a CRDT's **native per-user undo** (Yjs `UndoManager`) replaces the bespoke op-log/footprint machinery from earlier drafts; confirm we don't want the "can't undo — others built on this" refusal UX.

---

## Table of contents

1. [Overview & Goals](#1-overview--goals)
2. [Domain Model](#2-domain-model)
3. [Controlled Vocabularies — the ATTRIBUTE_REGISTRY](#3-controlled-vocabularies--the-attribute_registry)
4. [Features by Screen](#4-features-by-screen)
5. [Collaboration, Permissions & Undo](#5-collaboration-permissions--undo)
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

Ballroom Flow is a **collaborative, mobile-first PWA** for building and annotating ballroom dance choreography ("routines"). A routine is an ordered sequence of **figures**, each described as a **timeline of attributes** placed at a relative count from the figure's start. Some attribute kinds we know we need (footwork/"step", sway, turn, rise, position); the set is **user-extensible** because technique vocabulary is individual to dancers. Routines are organized into **sections** the user names however they structure their choreography. People **annotate** the routine — corrections, lessons, practice notes — anchored to a precise point or a figure. The data model is a **CRDT** from day one so collaborative editing, offline, and forking can be added without re-laying the foundation.

### 1.2 Who uses it

A **flat collaboration model** — everyone is on the same level:

- **Anyone** creates routines and invites others, granting **view**, **comment**, or **edit**. Edit covers structure (sections/figures/attributes) *and* annotations (sway, turn, notes…).
- A routine can be shared with **n people for reading** (less the norm, but supported). There is no special "leader/follower/coach" *user* role — see §1.5.

A small-N collaboration tool, not a social network or studio LMS.

### 1.3 Non-negotiable constraints (owner)

1. **Cloudflare-hosted** end to end.
2. **No self-run auth** — managed identity provider with a generous free tier.
3. **Cheap** — now on **Workers Paid (~$5/mo base)**; the design uses the *included* paid capabilities (SQLite-backed DOs, alarms, Hibernatable WebSockets, Smart Placement, Analytics Engine) so usage stays low at hobby scale; a future **pro plan** monetizes (§1.6).
4. **Performant** on mobile.
5. **PWA is the priority** (installable; no native app in v1).
6. **Quality & maintainability over feature count** — apply YAGNI (the CRDT foundation is the one deliberate exception, chosen to avoid a rewrite).
7. **A solid, detailed testing plan is required** (§10).

### 1.4 Primary user journey (the core loop)

1. Sign in (Clerk).
2. Open the **sample routine**, start from a **template**, or create a routine for a dance.
3. Add **sections** (named by you) → add **figures** from the library or compose custom.
4. Open a figure and **place attributes on its count timeline** (the hero flow) — footwork, sway, turn, rise, position, or any attribute kind you've added — for a count, optionally per role.
5. **Annotate**: leave a correction on a point/figure, or write a journal lesson/practice note — from the timeline *or* the journal; they are the same kind of thing.
6. **Undo** your own changes at per-action grain (via the CRDT's per-user undo).

### 1.5 Role of "leader / follower"

Leader vs follower is **a view dimension, not a user attribute.** A user has no stored default role; which role's steps you see is a **per-device preference** (remembered locally), **switchable in the timeline** (tap a step to flip role). Attributes carry an **optional `role`** for genuine divergences (e.g. a follower heel turn with no leader counterpart); attributes without a role apply to both.

### 1.6 Plans & quotas

A **free tier** and a later **pro plan**. v1 enforces a quota — **free accounts may own at most 3 routines** (counting *owned*, not shared-in) — with a clear upsell when exceeded. Pro limits + billing provider (Stripe?) are deferred (Q-PLAN); v1 builds the quota seam.

> **Offline:** v1 is **online-first** — the data is a CRDT, but v1 syncs only while online (the per-routine Durable Object is the live authority). Offline editing and divergent fork/merge are the "later mechanics" the CRDT foundation makes additive rather than a rewrite.

---

## 2. Domain Model

The canonical state of a routine is a **CRDT document** (recommended: **Yjs** — `Y.Map`/`Y.Array` give the ordered, nested structure here; Q-CRDT-LIB) **persisted in its routine's SQLite-backed Durable Object**. Around it, **D1** holds a pure cross-routine index (users, memberships, routine metadata/list-projection, invites) — no CRDT blobs. The *shapes* below describe the logical model; §6 explains how they split across the DO and D1.

### 2.1 Conventions

- **Client-generated IDs.** Every `id` is a client-generated ULID (sortable, collision-free) — the client knows an id before the server does. (CRDT map keys / list items reference these ids.)
- **Soft-delete / tombstones.** Deletable entities carry `deletedAt`; a delete sets it (filtered from normal views), never a hard removal — the remove-wins tombstone the CRDT needs and what makes delete reversible by the CRDT undo.
- **CRDT-native change tracking.** There is **no separate `EditOp` op-log**: the CRDT's update stream *is* the change history, and its `UndoManager` (per-origin = per-user) *is* undo/redo. (This is the bespoke machinery we deliberately don't build — Q-UNDO.)

### 2.2 Canonical entities

#### User *(D1)*
- `id` (from Clerk `sub`), `displayName`, `identityColor` (hex, global across their routines), `plan` (`free` | `pro`). **No `defaultRole`** (leader/follower is a per-device view pref, §1.5).

#### Routine *(metadata in D1; body in the CRDT doc)*
- D1 metadata: `id`, `title`, `dance` (§3.6), `ownerId` (creator; the quota counts owned routines), `forkedFromRoutineId` (nullable — reserved for the deferred fork mechanic), `templateOf` (nullable), `schemaVersion`, `createdAt`, `updatedAt`, `deletedAt`.
- CRDT body: the sections → figures → attributes → annotations tree.
- Derived: per-figure/per-role bar counts (§3); `dance`-derived color.

#### Section *(CRDT — renamed from "Side")*
- `id`, `name` (**free text**, user-set; the UI offers optional preset quick-fills like "Long Side"/"Corner"/"Intro"), order (CRDT list position). **No** long/short/corner enum or computed ordinals. A structured floor-position concept is **not** needed — **alignment-per-figure is enough** (owner).
- Owns an ordered list of Figures.

#### Figure *(CRDT)*
- `id`, `name`, `source` (`library` | `custom`), `libraryFigureId` (nullable), order, `entryAlignment`/`exitAlignment` (§3.8), `deletedAt`.
- Owns a set of **Attributes** (the timeline). Role is carried per attribute (§1.5), not as two separate charts.
- **Variant seam (deferred):** `baseFigureId` (nullable) is reserved so a figure can later become a **variant** of another (the "feather variant" that renames/drops steps and inherits the base's later additions). **The variant *inheritance* mechanic is postponed** (Q-ATTR e); v1 does not build resolution/inheritance. When it ships, the CRDT foundation absorbs it without migration.

#### Attribute *(CRDT — replaces "Step"; the central model)*
A figure is **a set of attributes placed on a count timeline**, not fixed typed columns. A "step" is just the attribute of kind `step` (it carries footwork). The vocabulary is **user-extensible**.
- `id`, `kind` (`step` | `sway` | `turn` | `rise` | `position` | … | a user-defined kind — §3), `count` (**float**, relative to figure start), **`role`** (`leader` | `follower` | `null` = both — *optional per attribute*), `value` (typed by `kind`), `deletedAt`.
- **Timing as a float count:** interpreted **modulo the dance's counted phrase** (Waltz/Viennese = 1–6; the rest = 1–8; bars derive from meter, §3.6). The **fraction** renders as ballroom marks — **`a` = .25, `&` = .5, `e` = .75**, with `i` for 1/8s (`ia` = .125, `ai` = .375). *([confirm] this mapping inverts the common "1 e & a" ordering — Q-D3.)*
- Multiple attributes share a count; the footwork-bearing `step` attributes ordered by count read as "the steps".

#### Annotation *(CRDT — unifies Thread/Comment and JournalEntry)*
One concept for every human note — correction, lesson, practice, discussion — created from the **timeline** or the **journal**.
- `id`, `authorId`, `kind` (`note` | `lesson` | `practice`), `text`, `tags[]`, `createdAt`, `media[]` (v1.1), `deletedAt`.
- **Anchors[]** (v1: `point {figureId, count, role?}` and `figure {libraryFigureId | name}`). **Query anchors** ("all rising steps", "all left-turning figures") are **postponed to v1.1** (Q-ANNO) — they need a predicate language. The `figureVariant` anchor follows whenever variants ship.
- Ordered **Replies** (`id`, `authorId`, `text`, `createdAt`, `deletedAt`; author-only delete).

#### Membership *(D1 — classic ACL)*
- `id`, `routineId`, `userId`, `role` (**`viewer` | `commenter` | `editor`**), `createdAt`, `deletedAt`.
- viewer = read; commenter = read + annotate/reply; editor = full edit of structure **and** annotations. The **owner** (creator, an editor) alone deletes the routine; ownership transfer → later.

#### User-defined AttributeKind *(CRDT, routine-scoped for v1)*
- `id`, `kind`, `label`, `color`, `cardinality`, `valueType`, `values[]`. Created in-app (the creation UI is **in v1** — Q-ATTR d). Account-level reuse across routines is a later refinement (Q-ATTR scope).

### 2.3 Entity-relationship summary

```
D1 index:   User 1──* Membership *──1 Routine(meta)   ·   Invite   ·   Snapshot(of CRDT doc)
                                          │
CRDT doc (per routine, Yjs): Routine-body 1──* Section 1──* Figure ──(baseFigureId: deferred seam)
                                          │                    └──* Attribute { kind, count(float), role?, value }
                                          ├──* Annotation 1──* Reply
                                          │        └──* Anchor ──▶ { point | figure }   (query/variant: deferred)
                                          └──* user-defined AttributeKind

LibraryFigure (static reference, per Dance; default attributes) ──▶ instantiated into Figure
ATTRIBUTE_REGISTRY (standard kinds, bundle) ∪ user-defined kinds (in doc) = the merged registry
```

### 2.4 Storage placement (DO SQLite is the per-routine source of truth; D1 is the index)
- **CRDT document per routine (Yjs, recommended):** the editable body — sections, figures, attributes, annotations + replies, user-defined kinds. Held authoritatively in a **SQLite-backed Durable Object** (one per routine): the Yjs update log + a current snapshot persist in the **DO's own SQLite** (transactional, up to 10 GB), so the DO is **self-contained** — no "serialize the whole doc to D1" path. The DO is also the **sync + permission boundary** (§6). Change history + per-user undo are native to the CRDT. A **DO alarm** debounces snapshot/compaction writes and handles invite expiry.
- **D1 (Drizzle) — a pure cross-routine index:** users, memberships, routine metadata (title/dance/owner/plan, a small list/search projection), invite tokens. **No CRDT blobs in D1** — listing/search read the projection, and a routine's body loads from its DO. The DO projects a thin index row to D1 on its snapshot alarm.
- **Client bundle:** dances, library figures, the **standard** attribute kinds. Versioned by `schemaVersion`.

---

## 3. Controlled Vocabularies — the ATTRIBUTE_REGISTRY

### 3.0 Standard kinds + user-defined kinds (creation UI in v1)
Two tiers, merged everywhere (editor, lanes, info-sheet, chips, Zod):
1. **Standard kinds** ship in `packages/domain/src/vocabulary.ts` (the **ATTRIBUTE_REGISTRY**): `{ kind, label, color, cardinality, valueType, values?, appliesToDances?, builtin:true }`.
2. **User-defined kinds** are **created in-app (v1)**, stored in the routine's CRDT doc, same shape (`builtin:false`).

Forward-compatible reads: registry **version** + per-value **aliases**; unknown values **pass through on read**; aliases normalize (`CBP → CBMP`); writes of unknown values to a known kind are rejected.

Standard kinds (v1):

### 3.1 Step / Footwork (`step`) — `#a9742c`
Footwork (5): `HT`, `T`, `TH`, `heel_pull`, **`H`** (bare Heel). Broader set **[confirm]/deferred**. The `step` value also carries the free-text action ("LF forward").

### 3.2 Rise & Fall (`rise`) — `#1f8a5b`
(7): `commence`, `body_rise`, `foot_rise`, `up`, `continue`, `lowering`, **`NFR`**. **Tango omits this kind** via `appliesToDances`. `body lower` **[confirm]**.

### 3.3 Body position + body-action (`position` / `bodyActions`) — `#8a5cab`
Position (single): `closed`, `promenade`, `wing` **[confirm]**; body-action (multi, may be empty): `CBM`, `CBMP` — **"CBP" treated as a CBMP typo** **[confirm] (Q-D4)**.

### 3.4 Sway (`sway`) — `#c0563f`
(3): `to_L`, `to_R`, `none`.

### 3.5 Turn (`turn`) — `#5b6b8a`
(8): **`eighth_L`**, `eighth_R`, `quarter_L`, `quarter_R`, `three_eighth_L`, `three_eighth_R`, `half_L`, `half_R`, `none`. Finer **[confirm]/deferred**.

### 3.6 Dance (`dance`)
v1: Standard travelling only — `waltz`, `viennese_waltz`, `quickstep`, `foxtrot`, `tango`. Metadata: color, `timeSignature`, `beatsPerBar` (3 Waltz/Viennese; 4 rest), `phraseBeats` (**6** Waltz/Viennese, **8** rest — the count cycle), `travelling:true`. Latin/spot → v1.1.

### 3.7 Small fixed enums
- Membership role: `viewer` | `commenter` | `editor`.
- Attribute role: `leader` | `follower` | absent (= both).
- (Section has **no** kind enum — free-text name + optional preset quick-fills.)

### 3.8 Alignment (per-figure — sufficient; no separate floor concept)
Optional `entryAlignment`/`exitAlignment` — qualifier (`facing`/`backing`/`pointing`) + direction (`LOD`/`ALOD`/`wall`/`centre`/`DW`/`DC`/`DW_against`/`DC_against`). Reads "Facing Diagonal to Wall". Per-step alignment could later be a user-defined attribute kind.

---

## 4. Features by Screen

### 4.0 Cross-cutting
| Capability | v1 decision |
|---|---|
| Auth / onboarding | Clerk hosted sign-in (Google + passkeys). Onboarding: displayName, identity color (no role). |
| Account / settings | Edit displayName/color; sign out; **plan/quota status** (owned vs free cap). |
| Delete flows | routine/section/figure/attribute/annotation; reply delete = author-only. Confirm dialogs. |
| Reorder | figures (within a section) and attributes (by count). Section reorder deferred. |
| Attribute add/edit/remove | place/edit/remove attributes on a figure's count timeline; switch role inline. Core authoring. |
| **Custom attribute kinds** | **v1** — create/edit user-defined kinds (Q-ATTR d). |
| **Undo / redo** | **v1 required** — per-user, via the CRDT `UndoManager` (§5.4). |
| Search | routine-list title/dance (indexed). Annotation search deferred. |
| Invite | invite by link (signed token → Membership with chosen role). |
| Media | "coming soon" (v1.1). |
| Sample/template | read-only sample + start-from-template. |
| Export/import | JSON export AND import (§7). |
| **Plans/quota** | enforce free cap (3 owned routines) with upsell; billing deferred. |
| Fork / variants | **deferred** (built on the CRDT foundation later; `baseFigureId`/`forkedFromRoutineId` seams present). |

### 4.1 Routine List (Choreo tab) — list your routines; card: dance-color icon, title, `dance · barLabel · created`. "+" → New Choreo (quota-checked, upsell if over cap). Empty → sample + template. Title/dance search.

### 4.2 Assemble — sections (user-named, collapsible) → figure cards (name, custom badge, attribute summary, alignment chips). Add figure / add section (name it, with preset quick-fills). Reorder/delete figures. Share button. **Role view toggle** (per-device pref). Edit affordances gated by membership role.

### 4.3 Figure Timeline (hero surface) — the figure as a **count timeline**: at each count, the attributes present (step/footwork, sway, turn, rise, position, custom kinds) as chips; tap to edit; tap a step to flip viewed role. **Add an attribute at a count**, edit, remove. **Lanes view:** one kind across all counts (fast tagging), kinds from the merged registry. Edit figure alignment here.

### 4.4 Attribute Editor (hero flow) — for a count (and role), attribute sections render **from the merged ATTRIBUTE_REGISTRY** — which kinds apply (Rise absent for Tango), values, single/multi-select — not hardcoded. Re-tap clears. An **"add a kind"** affordance creates a user-defined kind (v1).

### 4.5 Annotation (timeline + journal) — one concept. From a point/figure in the timeline, or the Journal tab, create a `note`/`lesson`/`practice` with **anchors** (point / figure) and a **reply thread**. People legend; author-color borders; reply bar; reply delete (author-only). Filters (all / lessons / practice / by figure). *(Query anchors → v1.1.)*

### 4.6 Anchor Picker — choose anchor(s): **point** (section → figure → role → count) or **figure**. (Query/variant anchors deferred.)

### 4.7 Share — member list (name, role). Invite by link (inviter picks viewer/commenter/editor). Remove a member (editor/owner). Microcopy: *"Anyone you invite can view, comment, or edit. Editors change steps and notes. Notes are shared with everyone."*

### 4.8 Profile — identity (avatar, name); editable name; note-color picker (global) + preview; **plan status + owned-routine count**; sign out.

### 4.9 Overlays — Add-figure sheet (dance-filtered library; instantiate with default attributes; or compose custom); New Choreo sheet (5 dance chips + name; or template; quota-checked); **Add-kind sheet** (create a user-defined attribute kind); Info sheet (per-kind values from the merged registry); Toast (incl. **"Undone"** and the **quota/upsell** toast).

---

## 5. Collaboration, Permissions & Undo

### 5.1 Rules
1. **Flat model:** anyone creates routines and invites others as viewer / commenter / editor.
2. **Editors edit structure *and* annotations;** commenters annotate/reply; viewers read.
3. **Annotations are shared and visible** to all members.
4. **Identity color is per-user and global.**
5. **Owner** (creator) alone deletes the routine; transfer → later.

### 5.2 Roles & access
| Role | Can do |
|---|---|
| `editor` | Create/edit/delete sections, figures, attributes, custom kinds, alignment; annotate + reply; invite/remove members; undo own actions. |
| `commenter` | Read; create annotations + replies; undo own annotation actions. |
| `viewer` | Read only. |
| `owner` (an editor) | Editor rights **+** delete the routine. |

Enforcement is at the **CRDT sync boundary** (the Durable Object), not by rejecting individual CRDT cells (§6) — the critique-sync warning that post-hoc cell rejection is incoherent with a CRDT is resolved by gating the *connection/update stream*: the DO authenticates the sync, checks Membership/role from D1, and only accepts structure updates from editors / annotation updates from commenters+ / nothing from viewers. (Splitting the doc into a `structure` and an `annotations` sub-doc so a commenter can write the latter but not the former is the recommended mechanism — Q-CRDT-LIB.)

### 5.3 Fork & variants (deferred onto the CRDT foundation)
Fork is integral but, per the owner, **postponed because the CRDT solves it cleanly later** — building it twice is the thing to avoid. Two grains, both deferred from v1: **routine fork** (`forkedFromRoutineId` lineage) and **figure variant** (`baseFigureId` + inherit-later-additions). The v1 data model reserves both seams so neither needs a migration; the offline/merge machinery a true fork wants is the same CRDT machinery, added once.

### 5.4 Concurrent editing & undo (CRDT-native)
- The routine's CRDT doc is the source of truth; clients sync deltas through the Durable Object (online-first). **Concurrent edits merge by the CRDT's rules** — no bespoke last-write-wins logic, no two-zone authority.
- **Delete is soft** (`deletedAt`), so it's a normal mergeable field flip; cascade-delete of a figure flips its subtree.
- **Undo/redo is per-user via the CRDT `UndoManager`** scoped to that user's origin — it gives "undo my last change" natively and merges correctly with others' concurrent edits. We do **not** build the structured op-log + footprint-undoability rule from earlier drafts (it would be the redundant machinery the CRDT replaces). A "can't redo — diverged" style message, if wanted, is a thin UX layer over the UndoManager (Q-UNDO).
- **Live refresh** is the sync itself (the DO pushes updates to connected clients over WebSocket / Hibernatable WebSockets).

### 5.5 Invites
An `editor` generates a signed, expiring **invite token** (link); redeeming it (authenticated) creates a `Membership` with the inviter's chosen role. Editors/owner remove members.

---

## 6. Architecture

A **CRDT document per routine** is the canonical editable state, hosted in a **SQLite-backed Durable Object** that persists it and is the sync + permission boundary. **D1** is a pure cross-routine index. Online-first; offline/fork are additive later. **Smart Placement** co-locates the Worker near D1; **Analytics Engine** captures first-party product metrics.

```
[ React 19 + Vite PWA ]   (vite-plugin-pwa: installable shell)
   • Clerk client (session JWT)
   • Yjs doc (in-memory) bound to UI via the store/ seam; UndoManager (per-user undo)
        │  WebSocket sync (Yjs updates)            ▲ REST/RPC for list, auth, invites, quota
        ▼                                          │
[ Worker + Durable Object ]   (Smart Placement; Analytics Engine binding)
   • Worker (Hono): Clerk JWT verify, routine list/search, invites, quota, export   → D1 index
   • Durable Object (one per routine, SQLite-backed): authoritative Yjs doc persisted in its own
     SQLite; authenticates each sync connection (Clerk JWT) + checks Membership/role; accepts editor
     structure updates / commenter annotation updates / viewer read-only; Hibernatable WebSockets;
     a DO alarm debounces snapshot/compaction + invite expiry, and projects a thin index row → D1
        │                                                   │
        ▼                                                   ▼
[ D1 (Drizzle) ]  index only: users,            [ Queues → v1.1: media, billing webhooks, email ]
  memberships, routine metadata, invites                (R2 for media → v1.1)
```

### 6.1 Module boundaries (pnpm workspaces)
`contract → domain`; `web → contract, domain`; `worker → contract, domain`.
- **`packages/domain/`** — pure TS, no network: the **ATTRIBUTE_REGISTRY** + merge; **float-count timing & per-role bars**; sortKey/order helpers; the **CRDT document schema** (the Yjs `Y.Map`/`Y.Array` shape for routine→sections→figures→attributes→annotations, + typed read/mutate helpers); **CRDT convergence invariants**; Zod schemas; the migration ladder. Yjs runs in-memory so all of this is unit/property-testable with no I/O.
- **`apps/worker/`** — Hono routes (list/search/invite/quota/export), Clerk middleware (behind `auth/`), the **SQLite-backed Durable Object** (`routine-do.ts`: Yjs host, persistence in DO SQLite, sync transport over Hibernatable WebSockets, **permission enforcement at the connection/update boundary**, an **alarm** for debounced snapshot/compaction + invite expiry + D1 index projection), Drizzle/D1 index, an **Analytics Engine** write helper.
- **`apps/web/store/` (client repository seam)** — the only place that touches the Yjs doc + sync provider; presents typed reactive-read + mutate + `UndoManager` to components. Components never import Yjs or the RPC client directly. Swapping the sync provider (adding offline persistence later) happens here.
- **`apps/web/`** — presentational React; service worker for installability.
- **`packages/contract/`** — Zod schemas + Hono RPC `typeof app` (for the REST surface) + the shared CRDT-doc type.

### 6.2 Data flow
1. Clerk JWT.
2. **Reads/edits of a routine** open a sync connection to its Durable Object; the DO verifies the JWT + role, then streams Yjs updates both ways. Local edits apply optimistically and merge. The DO persists updates to its own SQLite as they arrive.
3. **List/search/invite/quota** are plain Hono RPC over the D1 index (no DO needed). **Export** loads the routine from its DO.
4. The DO sets an **alarm** after edits settle to **compact/snapshot** in its SQLite and **project a thin index row** (title/dance/updatedAt) to D1 — keeping list/search cheap without putting the doc in D1.

### 6.3 File structure (reflecting the CRDT foundation)
```
packages/domain/src/
  ids.ts vocabulary.ts dances.ts timing.ts sortkey.ts
  doc.ts          # CRDT document schema (Yjs shape) + typed read/mutate helpers
  convergence.ts  # pure invariants used by property tests
  schemas.ts      # Zod, derived from the merged registry
apps/worker/src/
  index.ts auth/ routes/ (list, invite, quota, export)
  routine-do.ts   # SQLite-backed Durable Object: Yjs host + persistence + sync + permission boundary + alarm(snapshot/expiry/index)
  db/schema.ts repo/ permissions.ts (authorizeConnection + quota) analytics.ts
apps/web/src/
  store/          # Yjs doc + sync provider + UndoManager behind a typed seam
  components/ (per screen) lib/ (rpc, sentry) sw.ts
```

---

## 7. Non-Functional Requirements

- **Performance:** mobile-first; app shell interactive < ~2s on mid-range/3G. Routine list/search from the D1 index (indexed; `EXPLAIN QUERY PLAN` in CI). A routine opens via one sync handshake; the doc loads from its DO's SQLite. **Smart Placement** co-locates the Worker near D1. Higher paid-tier CPU + the lifted 100k/day request cap remove limits on export/migration/snapshot and chatty sync.
- **Connectivity:** online-first (sync requires the DO). The shell loads offline (installable PWA); a clear "you're offline" state for data. Offline *editing* (local CRDT persistence, sync-on-reconnect) is the next increment — additive, not a rewrite.
- **Cost:** on **Workers Paid (~$5/mo base)** — already in place. **SQLite-backed DOs** persist per-routine state without extra storage cost; D1 holds only a small index; Clerk free tier covers auth. **Hibernatable WebSockets** keep idle sync cheap **if the chosen Yjs layer exploits hibernation** (DO-level support exists; the Yjs doc rehydrates from DO SQLite on wake via `onLoad`) — verify per Q-CRDT-LIB; worst case the DO stays warm only while editors are connected, which is fine at this scale. The **pro plan** monetizes beyond the free cap.
- **Accessibility:** WCAG AA — color never the sole signal; ≥44px targets; keyboard/SR navigable; reduced-motion.
- **Browser/PWA:** evergreen mobile + desktop; installable.
- **Data ownership:** JSON **export AND import** (structure + attributes + annotations) loaded from the routine's DO; `schemaVersion` envelope + migration ladder; unknown attribute values survive round-trip.
- **Ops:** Sentry (+ `@sentry/cloudflare`) for errors; **Analytics Engine** for first-party product metrics (dance/attribute usage); staging + prod; CI runs the test layers + EXPLAIN check.

---

## 8. Locked Technical Decisions

**Δ = changed by the v3 (CRDT) review.** Override any on review — cheap before code exists.

| # | Decision | Choice |
|---|---|---|
| D1 | Repo layout | **pnpm workspaces**: `packages/{domain,contract}`, `apps/{web,worker}`. |
| D2 | Lint / format | **Biome**. |
| D3 | CI | **GitHub Actions**. |
| D4 | Deploy / envs | **Wrangler**, Workers Static Assets; `staging` + `production`. |
| D5 | Entity IDs | **ULID** (`ulidx`), client-side, TEXT keys / map keys. |
| D6 | Client data layer | **Yjs doc + sync provider + `UndoManager`** behind the `store/` seam (TanStack Query for the REST list/invite surface). |
| D7 | Validation / contract | **Zod** in `packages/contract`. |
| D8 | ORM / migrations (D1 index) | **Drizzle** + drizzle-kit; tests use `applyD1Migrations()`. |
| D9 | Auth boundary | **Clerk** isolated behind `auth/` (Q-A1). |
| **D10 Δ** | **Sync / live refresh** | **CRDT sync via a Durable Object over WebSocket** (Hibernatable); REST for list/invite/quota/export. (Replaces polling-only / online-only.) |
| D11 | Roles | **Classic `viewer`/`commenter`/`editor` + `owner`** (confirmed). |
| **D12 Δ** | **Fork** | **Deferred** onto the CRDT foundation (seams reserved); not in v1. |
| **D13 Δ** | **CRDT foundation** | **Build the CRDT document model now** (recommended **Yjs**); online-first; offline/fork later — *too foundational to swap out* (owner). |
| **D14 Δ** | **Undo** | **CRDT-native per-user undo (`UndoManager`)**; **no** bespoke op-log/footprint machinery (Q-UNDO). |
| D15 | Error monitoring | **Sentry** (+ `@sentry/cloudflare`); Tail Workers fallback. |
| D16 | Node / tooling | **Node 22 LTS**, pnpm 9, TS strict, ESM. |
| D17 | Notation model | **Attributes on a float-count timeline** (extensible kinds; optional per-attribute role) — confirmed. |
| D18 | Sections | **User-named sections** + optional preset quick-fills (no kind enum) — confirmed. |
| D19 | User role pref | **No `User.defaultRole`**; per-device view preference — confirmed. |
| D20 | Annotations | **Unified annotation** (note/lesson/practice); v1 anchors = **point + figure**; query/variant deferred — confirmed. |
| D21 | Plans/quota | **Free cap = 3 owned routines**; pro + billing deferred — confirmed. |
| **D22 Δ** | **Custom attribute kinds** | **Creation UI in v1** (routine-scoped; account-level reuse later) — confirmed. |
| **D23 Δ** | **Persistence topology** | **SQLite-backed Durable Object hosts + persists the per-routine Yjs doc** (sync + permission boundary; DO SQLite is the source of truth); **D1** holds a pure cross-routine index only. On **Workers Paid** (in place). |
| **D24** | **Snapshot/cleanup** | **DO alarms** debounce snapshot/compaction in DO SQLite, expire invites, and project a thin index row to D1 (off the request path). |
| **D25** | **Edge placement** | **Smart Placement** on the Worker (one config flag) to sit near D1. |
| **D26** | **Product analytics** | **Analytics Engine** (first-party, near-free) for usage metrics, alongside Sentry for errors. |
| **D27** | **Async backbone (v1.1)** | **Cloudflare Queues** reserved for v1.1 media processing and later billing webhooks / email invites — not built in v1. |

### Global constraints (every task inherits)
- **TypeScript strict;** no `any` without justification.
- **Cloudflare runtime:** Worker (Smart Placement) + **SQLite-backed Durable Object** (per-routine CRDT host + persistence) + D1 (index) + Static Assets. Hibernatable WebSocket sync; Analytics Engine for metrics. Queues/R2 → v1.1.
- **Canonical routine state is the CRDT doc in the DO's SQLite;** D1 holds a pure index. **No bespoke op-log; no CRDT blobs in D1.**
- **All ids are client-generated ULIDs; soft-delete only.**
- **Permission enforcement is at the sync boundary (the DO)** + on the REST surface — never by post-hoc CRDT cell rejection.
- **Attribute vocabulary lives in the merged ATTRIBUTE_REGISTRY** (standard + user-defined).
- **The client touches the CRDT doc only through `store/`.**
- **Quota check on routine create.**
- **Index every D1 query (EXPLAIN in CI). Accessibility WCAG AA.**

---

## 9. Implementation Roadmap (Milestones)

Phased: M0–M1 detailed (the walking skeleton — the attribute/CRDT notation model proven pure, in-memory); M2–M9 outlined. The CRDT decision moves sync/permission earlier and **drops the op-log milestone**; undo is largely free (native) so its milestone is small (UX only).

> **For agentic workers:** use `superpowers:subagent-driven-development` / `executing-plans`; steps use `- [ ]`.

| M | Milestone | Deliverable |
|---|---|---|
| **0** | **Foundation** | Monorepo; `domain` + `contract`; CI green; Worker + **Durable Object scaffold + Yjs doc + WebSocket sync echo**; Clerk session; D1 index migration. **Detailed below.** |
| **1** | **Domain core (walking skeleton)** | Pure `domain/`: ATTRIBUTE_REGISTRY (+ user-defined merge), dances, **float-count timing**, sortKey/order, the **CRDT document schema + typed helpers**, **convergence/commutativity/idempotence property tests** (in-memory Yjs), **per-user `UndoManager`** behavior, Zod. No network. **Detailed below.** |
| **2** | Persistence + sync + notation CRUD | DO hosts the per-routine Yjs doc; **WebSocket sync**; **permission at the connection/update boundary**; D1 index + **snapshotting**; `store/` binds the doc + UndoManager to React; Assemble / Figure-Timeline / Attribute-Editor screens. |
| **3** | Auth, membership, permissions & quota | Clerk onboarding (name/color); Membership (viewer/commenter/editor + owner); `authorizeConnection`; **quota check on create**; invite issue/redeem; Share. |
| **4** | Undo/redo UX | Wire the `UndoManager` to the UI (per-user undo/redo, "Undone" toast); optional diverged-message UX. (Logic is native — small milestone.) |
| **5** | Annotations | Unified annotation + replies; anchors (point + figure); timeline + journal surfaces; identity colors. |
| **6** | Custom attribute kinds | Create/edit user-defined kinds; propagate to editor/lanes/info; validate. |
| **7** | Lanes + sample/template + search | Registry-derived Lanes; sample + start-from-template; routine search over snapshots. |
| **8** | Export / import + ops | schemaVersion'd JSON round-trip from snapshots + migration ladder; Sentry; EXPLAIN-QUERY-PLAN CI gate; staging/prod. |
| **9** | PWA + a11y + cross-browser | Installable shell + offline-state; axe/keyboard/reduced-motion; iOS Safari + Android Chrome E2E. |
| *(later)* | *Fork & variants; offline editing; query anchors; billing* | *Additive on the CRDT foundation — out of v1 (§11).* |

### Data model (M2)

**D1 — index only** (the routine body lives in its DO's SQLite, not here):

```mermaid
erDiagram
    User ||--o{ Membership : has
    Routine ||--o{ Membership : grants
    Routine ||--o{ Invite : has
    User { text id PK "ULID"; text clerkSub UK; text displayName; text identityColor; text plan "free|pro" }
    Membership { text id PK; text routineId FK; text userId FK; text role "viewer|commenter|editor"; int createdAt; int deletedAt }
    Routine { text id PK; text title; text dance; text ownerId FK; text forkedFromRoutineId "nullable (seam)"; text templateOf "nullable"; int schemaVersion; int updatedAt; int deletedAt; "← thin list/search projection, updated by the DO alarm" }
    Invite { text id PK; text routineId FK; text role; int expiresAt; int redeemedAt "nullable" }
```

> **CRDT document (Yjs, per routine — persisted in the DO's own SQLite, not D1):** `Y.Map` routine-body → `Y.Array` sections → `Y.Array` figures → `Y.Array` attributes `{kind,count,role?,value}`; `Y.Array` annotations (+ anchors + replies); `Y.Map` user-defined kinds. The DO stores the Yjs update log + a compacted snapshot in SQLite. **Reference data (bundle):** dances, library figures, standard attribute kinds. The D1 `Routine` row is a derived projection (title/dance/updatedAt) for list/search only.

### Sync + permission flow
Open routine → client connects to the routine's DO → DO verifies Clerk JWT + looks up Membership/role in D1 → DO streams Yjs updates (read-only for viewers; structure-writable for editors; annotation-writable for commenters+) and persists incoming updates to its SQLite → local `UndoManager` provides per-user undo → after edits settle, a **DO alarm** compacts the snapshot and projects the index row to D1.

---

### Task Detail — Milestone 0: Foundation

#### Task 0.1: Monorepo — `pnpm-workspace.yaml`, root `package.json` (`pnpm@9`, ESM, `pnpm -r` scripts), `.nvmrc` 22, `biome.json` (`noExplicitAny:error`), `tsconfig.base.json` (strict, Bundler, ES2022), `.gitignore`. Verify `pnpm install && pnpm biome check .` → commit `chore: initialize pnpm monorepo with Biome + strict TS`.
#### Task 0.2: Scaffold `@ballroom/domain` (deps `zod`, `ulidx`, **`yjs`**; dev `vitest`, `fast-check`) + `@ballroom/contract`. Verify test + typecheck → commit `chore: scaffold domain + contract packages`.
#### Task 0.3: Worker + Durable Object + D1 — Wrangler config (`staging`/`production`, `DB` D1 binding, **a `ROUTINE_DO` Durable Object binding**, SPA assets); Hono `GET /api/health → {ok:true}`; a minimal **DO with a WebSocket echo** (`/api/routine/:id/sync`); failing health + DO-echo tests (`vitest-pool-workers`) → PASS → commit `feat(worker): Hono health + Durable Object sync echo + D1 binding`.
#### Task 0.4: Web SPA + Clerk + verified call — Vite + React + Clerk; `/api/me` returns verified `sub`; Worker `auth/` verifies JWT networklessly; failing integration test (mint JWT; 401 on missing) → PASS → commit `feat: Clerk-gated SPA + networkless JWT verify`.
#### Task 0.5: CI — GitHub Actions (pnpm + Node 22, install, biome, typecheck, `pnpm -r test`); open PR; confirm green → commit `ci: lint + typecheck + unit/integration tests on PR`.

**M0 exit:** repo boots; CI green; verified call round-trips; a client opens a WebSocket to the routine DO and echoes; D1 binding present.

---

### Task Detail — Milestone 1: Domain Core (walking skeleton)
All in `packages/domain` — pure, TDD, unit + property tests. **Proves the attribute model + CRDT document + per-user undo, in-memory (no network).**

#### Task 1.1: ULID ids → `feat(domain): ULID ids`.
#### Task 1.2: Dance metadata (`DANCES`; Waltz/Viennese 3/4 phraseBeats 6; rest 4/4 phraseBeats 8; `travelling`) → `feat(domain): dance metadata`.
#### Task 1.3: ATTRIBUTE_REGISTRY (+ merge) — `ATTRIBUTE_REGISTRY`, `mergeKinds(standard,userDefined)`, `kindsForDance`, `valuesFor`, `VALUE_ALIASES` (`CBP→CBMP`).
- [ ] Failing test: Tango excludes `rise`; `step` includes `H`; `turn` includes `eighth_L`; `rise` includes `NFR`; position single vs body-action multi; `CBP→CBMP`; body values `[confirm]`; a user-defined kind merges in. → `feat(domain): ATTRIBUTE_REGISTRY (standard + user-defined merge)`.
#### Task 1.4: Float-count timing — `countToBar`, `countLabel` (integer beat mod `phraseBeats` + fraction `a`/`&`/`e`, `i`-subdivisions `ia`/`ai`), `barsForFigure(attrs, dance, role)` = `ceil(maxCount/beatsPerBar)` per role.
- [ ] Failing test: Waltz count 6 → bar 2; count 4 → 2 bars; Foxtrot count 8 → 2; `3.5`→"3&", `3.25`→"3a", `3.75`→"3e", `3.125`→"3ia", `3.375`→"3ai" (per Q-D3); per-role independent; empty → 0; wraps mod phrase. → `feat(domain): float-count timing + fraction notation`.
#### Task 1.5: sortKey/order helpers — `keyBetween(a,b,actorId)` (lexicographic, actor tiebreak) for ordered lists not covered by Yjs array semantics → `feat(domain): fractional sort keys`.
#### Task 1.6: CRDT document schema — `doc.ts`: build a routine Yjs doc (`Y.Map`/`Y.Array` per §9), with typed helpers `addSection/addFigure/setAttribute/addAnnotation/...` and typed reads.
- [ ] Failing test: helpers create the right Yjs shape; reads return typed views; ids are ULIDs; soft-delete flips a field (not array removal). → `feat(domain): CRDT document schema + typed helpers`.
#### Task 1.7: CRDT convergence (property-based, fast-check) — generate random edit sequences applied in different orders / on two replicas; assert **convergence** (both replicas equal after exchanging updates), **commutativity**, **idempotence** of duplicate updates.
- [ ] Failing property until invariants hold → `test(domain): CRDT convergence/commutativity/idempotence`.
#### Task 1.8: Per-user undo — wrap a Yjs `UndoManager` scoped to a user origin; `undo()/redo()` affect only that user's changes; a remote concurrent edit is preserved across an undo.
- [ ] Failing test: A's undo reverts A's last change only; B's interleaved edit survives; redo re-applies; a fresh edit clears redo. → `feat(domain): per-user undo via UndoManager`.
#### Task 1.9: Zod schemas (derived from the merged registry; lenient read vs strict write; timing range per meter) → `feat(domain): registry-derived Zod schemas`.

**M1 exit:** the attribute model, float-count timing, the CRDT document + convergence, and per-user undo are proven in-memory with unit + property tests, zero network.

---

### Milestones 2–9 (outline — each becomes its own detailed plan)
- **M2 — Persistence + sync + notation CRUD.** SQLite-backed DO hosts + **persists** the Yjs doc in its own SQLite; WebSocket sync (Hibernatable); permission at the connection/update boundary; **DO alarm** compacts snapshots + projects the D1 index row; `store/` seam; Assemble/Timeline/Attribute-Editor. Tests: two-client convergence over the real DO; permission (editor/commenter/viewer) at the boundary; DO-SQLite persistence + reload; alarm-driven index projection; core authoring E2E.
- **M3 — Auth, membership, permissions & quota.** User mapping; onboarding; Membership; `authorizeConnection`; **quota on create**; invite issue/redeem; Share. Tests: connection authorization truth table + forged-connection rejection; quota enforcement; invite lifecycle.
- **M4 — Undo/redo UX.** Wire UndoManager; toasts; optional diverged message. Tests: per-user undo across two live clients (E2E).
- **M5 — Annotations.** Unified annotation + replies; anchors (point + figure); timeline + journal. Tests: anchor integrity; commenter-can-annotate; merge of concurrent annotations.
- **M6 — Custom attribute kinds.** Creation UI; propagation to editor/lanes/info; validation; kinds sync via the doc. Tests: a new kind appears for all clients; validates.
- **M7 — Lanes + sample/template + search.** Registry-derived Lanes; sample + template; search over snapshots.
- **M8 — Export / import + ops.** schemaVersion'd round-trip (export loads from the DO) + migration ladder; Sentry + **Analytics Engine** metrics; EXPLAIN gate on the D1 index; staging/prod; Smart Placement enabled.
- **M9 — PWA + a11y + cross-browser.**

---

## 10. Testing Strategy

Quality and a detailed testing plan are a non-negotiable owner requirement. **The CRDT decision brings back the CRDT/merge test surface that the earlier online-only draft had deleted** — convergence/commutativity/idempotence property tests, and *sync-boundary* permission tests — while removing the bespoke op-log/footprint tests (that machinery is gone). The new highest-risk areas: **CRDT convergence + the sync/permission boundary, the attribute model, and quota enforcement.**

> **Annex status:** the retained testing plan predates v2/v3; it's a useful per-screen *surface* checklist, but rows tied to two-chart/coach/side/typed-slots/LWW-op-log are superseded by this section (its banner says so).

### 10.1 Philosophy
1. **Push correctness down the pyramid** — the attribute model, float-count timing, the **CRDT document + convergence**, per-user undo, registry/Zod are pure `domain/` (Yjs runs in-memory), tested exhaustively + property-based.
2. **Test the real runtime where a mock would lie** — the **Durable Object + sync + permission boundary** and the D1 index run inside `workerd` via `@cloudflare/vitest-pool-workers` (real DO + D1, `applyD1Migrations()`).
3. **Contract types-first, runtime-validated second** — Hono RPC `typeof app` (REST surface) + the shared CRDT-doc type + Zod; CI fails on drift.
4. **E2E proves journeys and cross-process invariants** (incl. **two live clients converging**); smallest layer, most guarded.
5. **Every surface is traced** against the wireframe inventory; deferred items in §11.
6. **Color is never the only signal under test.**

### 10.2 Layer ownership
- **Unit / property (pure `domain/`, in-memory Yjs):** float-count timing & per-role bars; **CRDT convergence/commutativity/idempotence** over random shuffled/partitioned edit sequences (fast-check); **per-user `UndoManager`** (undo affects only own changes; remote edit preserved; redo cursor); document-schema helpers + soft-delete; registry/Zod (`NFR`/`H`/`⅛` valid; Tango omits rise; position single vs body-action multi; `CBP→CBMP`; unknown-value passthrough-on-read vs reject-on-write; **user-defined kind merges & validates**; count fraction mapping per Q-D3); migration ladder.
- **Worker / DO / D1 (`vitest-pool-workers`):** **two simulated clients converge** through the real DO; **permission at the boundary** — editor structure update accepted, commenter structure update rejected / annotation accepted, viewer read-only, non-member connection rejected, forged connection rejected; **quota** (4th owned routine on free → rejected with upsell); invite issue/redeem/expiry; **DO SQLite persistence** (doc survives DO eviction/reload) + **alarm-driven** snapshot compaction and D1 index-row projection; export loads from the DO; **EXPLAIN QUERY PLAN** on list/search/membership/quota-count → index, no SCAN.
- **Component (browser mode + Testing Library + axe):** attribute editor (chips from merged registry; re-tap clears; Tango hides rise; **a newly-created user-defined kind appears**); timeline role flip; Lanes across counts; section rename + preset quick-fills; annotation create from timeline + journal with the point/figure anchor picker; empty states; viewer/commenter affordance gating; toasts incl. "Undone" + quota upsell.
- **E2E (Playwright):** full authoring journey (create → section → figure → place attributes → switch role); **two live browser contexts editing the same routine converge** (the CRDT replacement for the old LWW test); per-user undo across two clients; permission (viewer/commenter blocked; **forged sync connection rejected by the DO**); **quota** (free cap blocks the 4th, upsell shown); invite redemption; annotation (point + figure); export→import; PWA install/app-shell-offline; tab nav.
- **Contract:** compile-time `typeof app` + shared CRDT-doc type (drift fails `tsc`); runtime Zod both ends; schema-drift CI gate.

### 10.3 Tooling, CI, fixtures
- **Vitest projects:** `domain` (Node + fast-check + in-memory Yjs), `worker` (`vitest-pool-workers`, **real Durable Object + D1**), `component` (browser mode + `vitest-axe`). **Playwright:** `chromium-desktop`, `mobile-chrome`, `mobile-safari`.
- **Cloudflare test config:** per-suite isolated D1; `applyD1Migrations()`; DO instances per test; an `EXPLAIN QUERY PLAN` helper (index, no SCAN).
- **Clerk in tests:** injected test JWKS/PEM; `makeTestJWT`; the real verify + role lookup runs at the DO boundary against minted tokens. E2E uses Clerk testing-mode tokens seeded per fixture.
- **CI:** PR fast gate (typecheck+lint → unit/property → contract+drift → worker/DO/D1 incl. EXPLAIN → component+axe → E2E smoke incl. one two-client convergence). Merge/nightly: full Playwright matrix + Lighthouse-CI + staging→prod. No sleeps; deterministic auth + seed; convergence asserted by exchanging updates (not racing); `retries:1` with trace.
- **Coverage gates:** domain ≥ 95% (holds the CRDT + timing correctness); worker/DO ≥ 90% with *every convergence, permission-boundary, and quota edge case* covered; component/E2E by surface coverage.
- **Fixtures:** the read-only **sample routine** (sections, library + custom figures, attributes across kinds incl. one user-defined, a couple of annotations) defined once and reused across layers; pure factories; `seedDb(...)` for the D1 index + a seeded Yjs snapshot; `makeTestJWT` + `authedContext(role)` with users matching the seed (so permission/quota/convergence/undo tests are realistic).
- **A11y / perf / cross-browser:** axe on every screen (zero serious/critical); keyboard nav; color-not-sole-signal; ≥44px; reduced-motion; app-shell <~2s (Lighthouse-CI); mobile-safari + mobile-chrome core journeys; PWA install + app-shell-offline.

---

## 11. Out of Scope (v1) — explicit YAGNI cuts (all additive on the CRDT foundation)

- **Offline *editing*** (local CRDT persistence + sync-on-reconnect) — online-first in v1; the CRDT makes this additive, not a rewrite.
- **Fork & figure variants** (routine fork; `baseFigureId` variant + inherit-later-additions) — seams reserved; mechanic deferred (Q-FORK/Q-ATTR e).
- **Query anchors** for annotations ("all rising steps", "all left-turning figures") — need a predicate language; v1.1 (Q-ANNO).
- **Billing integration / payment provider** — quota *enforcement* is in v1; charging is deferred (Q-PLAN). Ownership transfer deferred.
- **Account-level (cross-routine) user-defined attribute kinds** — v1 kinds are routine-scoped.
- **Latin / spot dances** — `travelling` flag present; v1 ships Standard only.
- **Per-step alignment** (could later be a user-defined kind), separate feet-vs-body turn amounts, richer footwork/turn magnitudes beyond the confirmed set.
- **Cross-routine annotations**, annotation search.
- **Media attachments** — v1.1.
- **Notifications, read/unread, reply editing, threading depth.**
- **Syllabus-system attribution**, amalgamations as a first-class entity, precede/follow validation.
- **Themes/backdrop settings**, per-member fine-grained access editing, **section reorder**, **native app wrapper.**

---

## 12. Open Questions & Decisions Needed

The PR review resolved the prior keystones. Remaining items are sub-decisions opened by the CRDT choice, plus carried-over domain confirms.

### ✅ Resolved on PR #9
- ✅ **Roles** → flat `viewer`/`commenter`/`editor` + `owner` (D11).
- ✅ **Notation** → attributes on a float-count timeline; **optional role per attribute**; standard kinds step/sway/turn/rise/position (alignment stays per-figure) (D17).
- ✅ **Custom attribute kinds** → **creation UI in v1**, routine-scoped (D22).
- ✅ **Variant inheritance** → **postponed** (D12; seam reserved).
- ✅ **Annotations** → unified; v1 anchors **point + figure**; **query anchors postponed** (D20).
- ✅ **Sections** → user-named + optional preset quick-fills; **alignment-per-figure is enough**, no floor concept (D18).
- ✅ **Plans/quota** → free cap **3 owned routines**; billing deferred (D21).
- ✅ **Fork** → **do it with CRDTs** so it isn't rebuilt; **build the CRDT foundation now**, online-first, fork/offline mechanics later (D12/D13).
- ✅ **Cost / topology (Q-CRDT)** → **Workers Paid is in place.** Adopt **SQLite-backed DOs** (DO SQLite = per-routine source of truth; D1 = index only), **DO alarms** (snapshot/compaction + invite expiry + index projection), **Hibernatable WebSockets**, **Smart Placement**, **Analytics Engine** (D23–D26). **Queues reserved for v1.1** (D27).

### ★ Remaining open
- **★ Q-UNDO — Undo machinery.** Recommendation: use the CRDT's **native `UndoManager`** (per-user undo, merges correctly) and **drop the bespoke op-log/footprint-undoability** from earlier drafts. Confirm we don't need the "can't undo — others built on this" *refusal* semantics (the CRDT just merges); a soft "your change was superseded" message can layer on if wanted.
- **Q-CRDT-LIB — Library + integration layer.** *(Researched June 2026.)* **CRDT engine: Yjs** (production default — ~920K weekly downloads, largest ecosystem, best Cloudflare support; Loro is faster but its docs still call the API/encoding experimental; Automerge is smaller but has Git-like branch/merge history — reconsider only if forking becomes central). **Integration layer (recommended): [`y-partyserver`](https://github.com/cloudflare/partykit/blob/main/packages/y-partyserver/README.md)** — Cloudflare-maintained (PartyKit), purpose-built (`YServer extends DurableObject`, React `YProvider`/`useYProvider`, `onLoad`/`onSave` persistence hooks we wire to **DO SQLite**). **Alternative: [`napolab/y-durableobjects`](https://github.com/napolab/y-durableobjects)** — Hono-native (`yRoute`, `$ws`, `upgrade`; auth via Hono middleware before the WS upgrade), a tight fit with our Hono Worker but a smaller community. **Fallback: [Y-Sweet](https://github.com/jamsocket/y-sweet)** if we'd rather not hand-roll persistence/auth (but it persists to R2, not DO SQLite, and its CF port lags on Hibernatable WebSockets). Persistence is **BYO glue** (`onSave`/`onLoad` → DO SQLite) in all of these. Sub-question still open: split each routine doc into `structure` + `annotations` sub-docs so a commenter can write annotations but not structure, or keep one doc and gate by update type?
- **Q-OFFLINE-NEXT — Sequencing.** Online-first now; when does offline *editing* (local Yjs persistence + sync-on-reconnect) land — v1.1, or later? (Cheap once the foundation exists.)

### Carried-over confirms
- **★ Q-D4 — Body position + body-action vocabulary (pending the owner's coach).** Confirm `closed`/`promenade`/`wing`, `CBM`/`CBMP`, "CBP" = CBMP typo. Doesn't block (registry stub; values are data).
- **Q-D3 — Count fraction mapping.** Confirm `a`=.25, `&`=.5, `e`=.75 + `i`-subdivisions — this **inverts the common "1 e & a" order**, so flag if `e`/`a` should swap.
- **Q-M1/2/3 — Media (v1.1)** types/caps/entities. **Q-SC1/2 — Latin/spot & American** target versions.

### Settled infra defaults
Q-A1 Clerk boundary clean (D9); Q-A2 color collisions tolerated (initials primary).

---

## 13. Appendix: Media (v1.1)

Not in v1. Annotations carry `media[]`; UI shows "coming soon". When built (v1.1): R2 with Worker-issued **presigned PUT URLs** (browser→R2, zero egress); client-side compression; metadata holds the object key. Upload inline while online (iOS Safari lacks Background Sync — fallback is an in-app retry queue). **Q-M1/2/3** cover types/caps/entities.

---

## 14. Further detail & sources

| Document | What it adds | Status note |
|---|---|---|
| [`docs/superpowers/specs/2026-06-24-testing-plan.md`](superpowers/specs/2026-06-24-testing-plan.md) | The verbatim per-screen surface coverage matrix | **Predates v2/v3.** Useful surface checklist; rows tied to two-chart/coach/side/typed-slots/op-log are superseded by §10. |
| [`docs/design/Ballroom Builder.dc.html`](design/Ballroom%20Builder.dc.html) | The wireframe prototype / feature inventory | Sketch, not requirements. |
| `research/domain.md` | Ballroom domain reference | Authority behind §3. |
| `research/platform.md` | Platform/architecture research | Behind §6/§8 (incl. CRDT/DO options). |
| `research/extensibility-crdt.md` | The CRDT extensibility review | **Now load-bearing** — the basis for the v3 foundation. |
| `research/critique-sync.md` | The sync critique | **Now load-bearing** — its warning (no post-hoc cell rejection) shapes the §5.2/§6 permission boundary. |
| `research/design-spec.md` | The exhaustive wireframe enumeration | Surface checklist. |
| `research/critique-{domain,product,testing,scope}.md`, `research/extensibility-{attributes,undo}.md` | The remaining critiques/reviews | Background for the model + scope. |

**Removed** (folded into this plan): the original design spec, implementation plan, and consolidated open-questions doc.

---

*End of plan (v3, CRDT foundation on Workers Paid). The product model (attributes, sections, annotations, roles, quota) and the paid-tier topology (SQLite-backed DOs + alarms, Hibernatable WebSockets, Smart Placement, Analytics Engine) are settled; the remaining open items (Q-UNDO, Q-CRDT-LIB) are flagged in §12. M0 stands up the CRDT/DO skeleton; M1 proves the notation + CRDT model in-memory; M2 makes it real and persistent over the Durable Object.*
