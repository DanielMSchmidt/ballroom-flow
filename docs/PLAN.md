# Ballroom Flow — Master Plan

**Status:** Draft for review — **v2 (owner-review pass, 2026-06-25)**
**Date:** 2026-06-25

This is the single source of truth for Ballroom Flow. It consolidates the original design spec, implementation plan, testing plan, and open-questions docs into one plan, then folds in the **owner review on PR #9**, which reshaped several foundations (flat collaboration model, fork/variants in v1, an extensible per-count *attribute* notation model, unified annotations, sections instead of sides, plans/quotas).

Three sources are **retained for detail this plan does not reproduce in full** (see [§14 Further detail & sources](#14-further-detail--sources)):

- **`docs/superpowers/specs/2026-06-24-testing-plan.md`** — the verbatim per-screen prototype feature coverage matrix (this plan summarises it; note the testing plan predates the v2 redesign — see its banner);
- **`docs/design/Ballroom Builder.dc.html`** — the wireframe prototype, the **product sketch** (feature inventory, not a requirements list);
- **`research/*.md`** — the deep-dive research the decisions trace back to.

**Guiding principle:** *quality and maintainability over feature count.* Every feature is sorted v1 / v1.1 / out-of-scope and YAGNI is applied ruthlessly — but the owner has pulled a few "extensibility" capabilities (fork, user-defined attributes, rich annotation anchors) *into* v1 because they are integral to how dancers actually work.

> **Reading note (open architectural decisions).** The v2 review opened several decisions that are genuinely the owner's and that the rest of the design hinges on. They are written here as **★ open decisions** in [§12](#12-open-questions--decisions-needed), each with a recommendation, and the affected sections are written to accommodate either resolution. The biggest is **Q-FORK** (how fork/variants are implemented — server-side copy now, or a CRDT later), because it determines whether v1 stays online-only.

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

Ballroom Flow is a **collaborative, mobile-first PWA** for building and annotating ballroom dance choreography ("routines"). A routine is an ordered sequence of **figures** (named movement patterns), each described as a **timeline of attributes** placed at a relative count from the figure's start. Some attributes we know we need (footwork/"step", sway, turn, rise, body position); the set is **user-extensible** because technique vocabulary is individual to dancers. Routines are organized into **sections** the user names however they structure their choreography. People **annotate** the routine — corrections, lessons, practice notes — anchored to a precise point, a figure (or figure variant), or a *query* like "all rising steps". Figures can be **forked into named variants** that inherit the original's detail.

### 1.2 Who uses it

A **flat collaboration model** — everyone is on the same level:

- **Anyone** can create routines and invite others.
- An invitee is granted one of **view**, **comment**, or **edit**. **Edit** covers both structure (sections/figures/attributes) and annotations (sway, turn, notes…).
- A routine can be shared with **n people for reading**, though the common case is still small (a couple plus a coach, all as editors/commenters). There is no special "leader/follower/coach" *user* role — see §1.5.

A small-N collaboration tool, not a social network or studio LMS.

### 1.3 Non-negotiable constraints (owner)

1. **Cloudflare-hosted** end to end.
2. **No self-run auth** — managed identity provider with a generous free tier.
3. **Cheap** — ~$0/month at hobby scale; usage-based beyond. (A future **pro plan** monetizes; the free tier is capped — §1.6.)
4. **Performant** on mobile.
5. **PWA is the priority** (installable; no native app in v1).
6. **Quality & maintainability over feature count** — apply YAGNI.
7. **A solid, detailed testing plan is required** (§10).

### 1.4 Primary user journey (the core loop)

1. Sign in (Clerk).
2. Open the **sample routine**, start from a **template**, or create a routine for a dance.
3. Add **sections** (named by you) → add **figures** from the library, compose custom, or **fork a variant** of an existing figure.
4. Open a figure and **place attributes on its count timeline** (the hero flow) — footwork, sway, turn, rise, position, or any attribute kind you've added — for a count, optionally per role.
5. **Annotate**: leave a correction on a point/figure/variant or a query ("all left-turning figures"), or write a journal lesson/practice note — from the timeline *or* the journal; they are the same kind of thing.
6. **Undo** any of your own changes at per-action grain.

### 1.5 Role of "leader / follower"

Leader vs follower is **a view dimension, not a user attribute.** A user has no stored default role. Which role's steps you see is a **per-device preference** (remembered locally) and is **switchable directly in the timeline** (tap a step to flip the role you're viewing/editing). Attributes can carry a role when the two roles genuinely differ (e.g. a follower heel turn with no leader counterpart); attributes without a role apply to both. (Exactly how role overrides interact with the attribute model is **Q-ATTR**, §12.)

### 1.6 Plans & quotas

A "classic" SaaS shape is planned: a **free tier** and a later **pro plan**. v1 enforces a quota — **free accounts may own at most 3 routines** — with a clear upsell when exceeded. The billing provider/integration is deferred (Q-PLAN); v1 builds the *quota seam* (owned-routine count check on create) so turning on pro later is additive.

> **Note on offline:** v1 is **online-only by default**. Offline-first was an earlier goal; the next planned increment is offline *read*. **Caveat:** if fork/variants are implemented via a CRDT (Q-FORK path B), an offline/local-first capability comes along with it — so this default is contingent on that decision.

---

## 2. Domain Model

### 2.1 Conventions applying to every entity

Everything lives in **D1** (single relational source of truth); static reference data (dance metadata, figure catalog, the **standard** attribute kinds) ships **in the client bundle**.

- **Client-generated IDs.** Every `id` is a client-generated, globally-unique, sortable identifier (**ULID** / UUIDv7), a **TEXT primary key** — **no autoincrement**. The client knows an id before the server does (unambiguous optimistic create; prerequisite for offline creation).
- **Soft-delete / tombstones.** Deletable entities carry a nullable **`deletedAt`**; a delete sets it (filtered from normal queries), never a bare row-drop. Delete is reversible (inverse flips `deletedAt`), so cascade-undo restores a whole subtree with original ids — and it is the remove-wins tombstone a future CRDT requires.

### 2.2 Canonical entities

#### User
- `id` (mapped from Clerk `sub`), `displayName`, `identityColor` (hex, user-chosen, **global across their routines** — attributes their notes consistently), `plan` (`free` | `pro`, default `free` — §1.6).
- **No `defaultRole`** (leader/follower is a per-device view preference, §1.5).

#### Routine
- `id`, `title`, `dance` (enum, §3.6), `ownerId` (the creator; the quota in §1.6 counts a user's owned routines), `forkedFromRoutineId` (nullable — fork lineage, §5.3), `templateOf` (nullable — read-only sample/templates), `schemaVersion` (int — migration/offline-cache key), `createdAt`, `updatedAt`, `deletedAt`.
- Derived: per-figure/per-role bar counts (meter-based, §3); `dance`-derived display color.
- **Owns** an ordered list of Sections.

#### Section *(renamed from "Side")*
- `id`, `routineId`, `name` (**free text**, user-set — people structure choreography differently), `sortKey` (fractional index + actor tiebreak), `deletedAt`.
- **Owns** an ordered list of Figures.
- The old fixed `long`/`short`/`corner` kind enum and computed ordinal names are **gone**. Optional preset name suggestions (e.g. "Long Side", "Corner") may be offered in the UI as quick-fills, but the stored value is just a name (Q-SECTION).

#### Figure
- `id`, `sectionId`, `name`, `source` (`library` | `custom`), `libraryFigureId` (nullable), `sortKey`, `deletedAt`.
- **Variant / inheritance (new — fork at the figure grain):** `baseFigureId` (nullable). A figure may be a **variant** of a base figure (e.g. a "Feather to PP" off a "Feather"): it shares the base's structure, may **rename**, may **drop a step/attribute**, and **inherits later additions** to the still-shared attributes of the base, while not differing structurally elsewhere. The variant stores its **overrides/removals** only; unchanged attributes resolve from the base. *(The precise inheritance/override resolution — copy-on-write vs live-inherit, and how it composes with undo — is **Q-ATTR/Q-FORK**, §12.)*
- **Alignment (per-figure):** `entryAlignment` / `exitAlignment`, each `{ qualifier: facing|backing|pointing, direction: LOD|ALOD|wall|centre|DW|DC|DW_against|DC_against }` (§3.8). Nullable.
- **Owns a set of Attributes** (the timeline; see below). No more "two step charts" as two ordered lists — role is carried per attribute (§1.5).
- Position forward-compat: position is `(sectionId, sortKey)`; v1 reorders within a section; cross-section move (if added) writes position as one atomic value.

#### Attribute *(replaces "Step" — the central v2 change)*
The notation model is **a figure is a set of attributes placed on a count timeline**, not a list of step rows with fixed typed columns. A "step" is simply the attribute of kind `step` (it carries footwork). This makes the vocabulary **user-extensible**: dancers can add attribute kinds beyond the standard set.

- `id`, `figureId`, **`kind`** (`step` | `sway` | `turn` | `rise` | `position` | … | a user-defined kind — §3), `count` (**float**, relative to the figure start — see timing below), **`role`** (`leader` | `follower` | `null` = applies to both), `value` (typed by `kind`; e.g. the `step` kind's value includes footwork), `deletedAt`.
- **Timing as a float count (replaces `{beat,sub,value}`):** the count is a float relative to the figure's start, interpreted **modulo the dance's counted phrase** (Waltz/Viennese = counts 1–6; the rest = 1–8; bars derive from meter, §3.6). The **fractional part** renders as ballroom subdivision marks — **`a` = .25, `&` = .5, `e` = .75**, with `i` for 1/8-note subdivisions (`ia` = .125, `ai` = .375, …). *([confirm] this exact letter→fraction mapping — it inverts the common "1 e & a" ordering, so flag if `e`/`a` should swap — Q-D3.)*
- Multiple attributes share a count (e.g. at count `3`: a `step` with footwork, a `sway`, a `turn`). The footwork-bearing `step` attributes, ordered by count, form what a dancer reads as "the steps".
- Derived: per-role step index `n`; bars from `ceil(maxCount / beatsPerBar)` per role.

> **Why this matters (owner):** "turn, sway, body position … could be very individual to specific dancers, so we need input/edit for *kinds* of attributes and a standard set we support." The standard kinds (step, sway, turn, rise, position) ship built-in; user-defined kinds are additive (§3.0). This is the model the old v3 spec only *reserved* as a `stepAttributes` seam — the owner has now made it the primary model.

#### Annotation *(unifies Thread+Comment and JournalEntry — they "are essentially the same")*
One concept for every human note — a correction, a lesson, a practice log, a discussion. Created from the **timeline** or the **journal**; both surfaces show them.
- `id`, `routineId`, `authorId`, `kind` (`note` | `lesson` | `practice` — extensible), `text`, `tags[]` (free-text themes), `createdAt`, `media[]` (v1.1; §13), `deletedAt`.
- **Has `anchors[]`** (one or more — see below) and an ordered list of **Replies** (the discussion thread).
- Visible to co-members; authorship/color via `identityColor`.

#### AnnotationAnchor *(rich, polymorphic — un-cuts the old "9-cell" model the owner now wants)*
A note can target any of:
- `point` — a precise spot: `{ figureId, count, role? }`.
- `figureVariant` — a specific variant: `{ figureId }`.
- `figure` — a figure *type* across the routine: `{ libraryFigureId | name }`.
- `query` — a derived set: `{ dimension, predicate }`, e.g. *all rising steps*, *all left-turning figures*. (Which query dimensions ship in v1 vs v1.1 is **Q-ANNO**, §12.)

#### Reply
- `id`, `annotationId`, `authorId`, `text`, `createdAt`, `deletedAt`. (Author-only delete.)

#### Membership (classic sharing / ACL)
- `id`, `routineId`, `userId`, `role` (**`viewer` | `commenter` | `editor`**), `createdAt`, `deletedAt`.
- `viewer` = read only; `commenter` = read + annotate/reply; `editor` = full edit of structure **and** annotations. The routine **owner** (creator) is an editor and is the only one who can delete the routine or transfer ownership (transfer → v1.1).

#### EditOp (op-log — undo today, the CRDT seam tomorrow)
Unchanged in shape: `id` (client ULID), `routineId`, `actorId`, `clock` (HLC), `seq` (server ordering authority), `createdAt`, `kind`, `forward`/`inverse` (structured self-describing diffs), `footprint` (entities touched + `versionBefore`), `undone`. Op-kind **registry** so new kinds (now including user-defined attribute kinds, fork/variant ops) need no undo-machinery changes. The log is **not** the source of state (D1 rows are); no replay-on-load. Appended on **every** mutation, in the same transaction.

### 2.3 Entity-relationship summary

```
User 1──* Membership *──1 Routine 1──* Section 1──* Figure ──(baseFigureId)──▶ Figure (variant)
                                  │                         └──* Attribute { kind, count(float), role?, value }
                                  ├──* Annotation 1──* Reply
                                  │        └──* AnnotationAnchor ──▶ { point | figureVariant | figure | query }
                                  └──* EditOp (append-only op-log, per-user undo)

LibraryFigure (static reference, per Dance; carries default attributes) ──▶ instantiated into Figure
AttributeKind: standard set ships in bundle (ATTRIBUTE_REGISTRY); user-defined kinds are additive (§3.0)
```

Full field-level schema is the M2 data model in §9.

### 2.4 Storage placement
**Everything is in D1** (Drizzle-typed). The routine list is an indexed query; a routine's full tree (sections → figures (+variants) → attributes → annotations + replies) loads via Hono RPC. Static reference data (dances, library figures, **standard** attribute kinds) ships in the client bundle, versioned by `schemaVersion`; **user-defined attribute kinds** live in D1 (scope — per-routine vs per-account — is Q-ATTR).

---

## 3. Controlled Vocabularies — the ATTRIBUTE_REGISTRY

### 3.0 Standard kinds + user-defined kinds
Attribute vocabulary has **two tiers**:

1. **Standard kinds** — ship in one module, `packages/domain/src/vocabulary.ts`, the **ATTRIBUTE_REGISTRY** (formerly SLOT_REGISTRY). Each entry:
   ```
   { kind, label, color, cardinality: "single" | "multi",
     valueType: "enum" | "text" | "compound",
     values?: [{ value, label, aliases?, confirm? }],
     appliesToDances?: [...],   // omit a dance to hide the kind for it
     builtin: true }
   ```
2. **User-defined kinds** — created in-app, stored in D1, with the same shape (`builtin: false`). The editor, timeline lanes, info-sheet, chips, and Zod validation all **derive from the merged registry** (standard ∪ user-defined) — there is no separately-maintained glossary.

Forward-compatible reads carry over: a registry **version** and per-value **aliases**; an unknown value **passes through on read** rather than hard-failing; aliases normalize (e.g. **`CBP` → `CBMP`**). Validation rejects only on *write* of an unknown value for a known kind.

> Whether v1 ships the *creation UI* for user-defined kinds, or only the extensible mechanism + standard set, is **Q-ATTR**. Either way the data model and registry are built to support it.

The standard kinds (v1):

### 3.1 Step / Footwork (`step`) — color `#a9742c`
The footwork-bearing attribute. Footwork values (5): `HT`, `T`, `TH`, `heel_pull`, **`H`** (bare Heel). Broader set (`B`, `F`/`WF`, `BH`, `IE`/`OE`) **[confirm]/deferred**. The `step` attribute's value may also carry the free-text action (e.g. "LF forward").

### 3.2 Rise & Fall (`rise`) — color `#1f8a5b`
Values (7): `commence`, `body_rise`, `foot_rise`, `up`, `continue`, `lowering`, **`NFR`** (no foot rise). **Tango omits this kind** via `appliesToDances` (no `hasRiseFall` boolean). `body lower` **[confirm]**.

### 3.3 Body position + body-action (`position` / `bodyActions`) — color `#8a5cab`
Two fields (owner: flexible, pending coach): **position** (single) `closed`, `promenade`, `wing` **[confirm]**; **body-action** (multi, possibly empty) `CBM`, `CBMP` — wireframe **"CBP" treated as a CBMP typo** **[confirm] (Q-D4)**.

### 3.4 Sway (`sway`) — color `#c0563f`
Values (3): `to_L`, `to_R`, `none`.

### 3.5 Turn (`turn`) — color `#5b6b8a`
Values (8): **`eighth_L` (⅛)**, `eighth_R`, `quarter_L`, `quarter_R`, `three_eighth_L`, `three_eighth_R`, `half_L`, `half_R`, `none`. Finer magnitudes **[confirm]/deferred**.

### 3.6 Dance (`dance`)
v1 ships **International Standard / Smooth (travelling) only**: `waltz`, `viennese_waltz`, `quickstep`, `foxtrot`, `tango`. Metadata: display color, `timeSignature`, `beatsPerBar` (3 for Waltz/Viennese; 4 for the rest), `phraseBeats` (the count cycle: **6** for Waltz/Viennese, **8** for the rest), `travelling: true`. The float-count timing (§2.2) reads the count modulo `phraseBeats`. Latin/spot → v1.1; `travelling` flag present so they slot in without a migration.

### 3.7 Small fixed enums
- Membership role: `viewer` | `commenter` | `editor`.
- Role (per attribute / view): `leader` | `follower` (or absent = both).
- (Section has **no** kind enum — free-text name.)

### 3.8 Alignment (per-figure)
Optional `entryAlignment` / `exitAlignment` — qualifier (`facing`/`backing`/`pointing`) + direction (`LOD`/`ALOD`/`wall`/`centre`/`DW`/`DC`/`DW_against`/`DC_against`). Reads "Facing Diagonal to Wall". Per-step alignment deferred (or expressible later as a user-defined attribute kind).

---

## 4. Features by Screen

Each screen scaled to complexity; **v1** vs **deferred** marked.

### 4.0 Cross-cutting
| Capability | v1 decision |
|---|---|
| Auth / onboarding | Clerk hosted sign-in (Google + passkeys). Onboarding: displayName, identity color (no role). |
| Account / settings | Edit displayName/color; sign out; **plan/quota status** (owned routines vs free cap). |
| Delete flows | routine/section/figure/attribute/annotation; reply delete = author-only. Confirm dialogs. |
| Reorder | figures (within a section) and attributes (by count) via `sortKey`/count. Section reorder deferred. |
| Attribute add/edit/remove | place/edit/remove attributes on a figure's count timeline; switch role inline. Core authoring. |
| **Fork / variant** | **v1** — fork a routine, and fork a figure into a named variant (§5.3). |
| **Undo** | **v1 required** — per-user, per-action (§5.4). |
| Search | routine-list search by title/dance (indexed). Annotation search deferred. |
| Invite | invite by link (signed token → Membership with chosen role). |
| Media | "coming soon" (v1.1; §13). |
| Sample/template | read-only sample routine + start-from-template. |
| Export/import | JSON export AND import (§7). |
| **Plans/quota** | enforce free cap (3 owned routines) with upsell; billing deferred. |

### 4.1 Routine List (Choreo tab) — list routines you're a member of; card shows dance-color icon, title, `dance · barLabel · created`. "+" → New Choreo (blocked with upsell if over free cap). Empty state → sample + template. Title/dance search.

### 4.2 Assemble (routine overview) — sections (user-named, collapsible) → figure cards (name, variant badge if `baseFigureId`, custom badge, attribute summary, entry/exit alignment chips). "Add figure" / "fork variant" / "add section" (name it). Reorder/delete figures within a section. Share button. **Role view toggle** (leader/follower) — a per-device view preference, also flippable per step in the timeline. Edit affordances gated by membership role (viewer/commenter see no structural edit).

### 4.3 Figure Timeline (the hero surface) — the figure as a **count timeline**: at each count, the attributes present (footwork/step, sway, turn, rise, position, custom kinds) shown as chips; tap to edit; tap a step to flip the role you're viewing. **Add an attribute at a count**, edit its value, remove it. **Lanes view:** one attribute kind across all counts at once (fast cross-count tagging), kinds derived from the merged registry. Edit figure alignment here. **Fork into a variant** from here.

### 4.4 Attribute Editor (the hero flow) — for a count (and role), the attribute sections render **from the merged ATTRIBUTE_REGISTRY** — which kinds apply (Rise absent for Tango), their values, single/multi-select — not hardcoded UI. Re-tapping clears. Optimized for speed (large touch targets, minimal taps). If user-defined kinds ship (Q-ATTR), an "add a kind" affordance lives here.

### 4.5 Annotation (timeline + journal) — annotations are one concept (§2.2). From a point/figure in the timeline, or from the Journal tab, create a `note`/`lesson`/`practice` with **anchors** (point / figure / variant / query) and a **reply thread**. People legend; author-color borders; reply bar; reply delete (author-only). Filters (all / lessons / practice / by figure / by query). Deferred: notifications, read/unread, reply editing.

### 4.6 Link / Anchor Picker — choose anchor(s): **point** (section → figure → role → count), **figure variant**, **figure type**, or **query** (pick a dimension + predicate, e.g. turn = left). Query anchors may be v1.1 (Q-ANNO).

### 4.7 Share — member list (name, role: viewer/commenter/editor). Invite by link (inviter picks role). Remove a member (editor/owner). **Fork** button → fork the routine (§5.3). Microcopy: *"Anyone you invite can view, comment, or edit. Editors change steps and notes. Notes are shared with everyone on the routine."*

### 4.8 Profile — identity (avatar, name); editable name; note-color picker (global) with live preview; **plan status + owned-routine count**; sign out. (No default-role setting.)

### 4.9 Overlays — Add-figure sheet (dance-filtered library; instantiate with catalog default attributes; or compose custom; or **fork a variant**); New Choreo sheet (5 Standard dance chips + name; or start-from-template; quota-checked); Info sheet (per-kind values **read from the merged registry**); Toast (incl. **"Undone"** with action name, and the **quota/upsell** toast).

---

## 5. Collaboration, Permissions & Undo

### 5.1 Rules
1. **Flat model:** anyone creates routines and invites others as viewer / commenter / editor (§2.2).
2. **Editors edit structure *and* annotations.** Commenters annotate/reply but don't change structure. Viewers read.
3. **Annotations are shared and visible** to all members.
4. **Identity color is per-user and global.**
5. **Owner** (creator) alone deletes the routine; ownership transfer → v1.1.

### 5.2 Roles & access
| Role | Can do |
|---|---|
| `editor` | Create/edit/delete sections, figures, variants, attributes, alignment; annotate + reply; invite/remove members; undo own actions. |
| `commenter` | Read; create annotations + replies; undo own annotation actions. |
| `viewer` | Read only. |
| `owner` (an editor) | All editor rights **plus** delete the routine. |

### 5.3 Fork & variants (★ pulled into v1 — Q-FORK)
Fork is "somewhat integral" (owner), at two grains:

- **Routine fork** — copy a routine into a new one you own (`forkedFromRoutineId` set for lineage). Replaces the old "save a copy". Whether annotations/journal copy is **Q-D5** (default: structure + attributes only).
- **Figure variant** — fork a figure into a **named variant** (`baseFigureId`) that may rename/drop steps but otherwise tracks the base, **inheriting later additions** to shared attributes (the "feather variant" mechanic, §2.2).

**Two implementation paths (the keystone decision — Q-FORK):**
- **Path A (recommended for v1) — server-side copy + lineage, no CRDT.** Routine fork = deep copy with new ids + lineage pointer. Figure variant = a base pointer + stored overrides/removals, resolved server-side; "inherit later additions" is a read-time merge of base attributes minus the variant's removals plus its overrides. Stays **online-only**, server-authoritative, LWW. No merge engine.
- **Path B — defer concurrent fork/merge to a CRDT.** If true divergent-then-merge-back or offline editing is wanted, that implies a CRDT (the v3 op-log/footprint seams already point this way). This **reintroduces local-first** and is a much larger build; the owner is OK *postponing fork* if it's bundled with CRDTs rather than half-built now.

The doc is written so either path works; §6/§8/§11 flag where Path B would change things. **Recommendation: Path A in v1** (it delivers the integral fork/variant capability without the CRDT cost), revisit Path B when offline-write is scheduled.

### 5.4 Concurrent editing & undo (server-authoritative, LWW)
- Every mutation → Worker validates permission, applies to D1, **appends an `EditOp`** (forward + inverse + footprint), bumps `routine.updatedAt`, returns new state.
- **Last-write-wins** on the same field; edits to different attributes/fields both persist. Acceptable at this collaboration scale.
- **Delete is soft;** inverse flips `deletedAt`. A figure delete cascades to its attributes/annotations/anchors/replies as a **compound op** (one footprint) → undo restores the subtree with original ids.
- **Live refresh:** poll / stale-while-revalidate on `updatedAt`. No WebSocket/CRDT in Path A.
- **Undo (required, per-user) — unified footprint rule:** a user undoes their own last not-yet-undone op; the undo is itself logged. **An op is undoable iff no later not-yet-undone op — by ANY user — touches any entity in its `footprint`.** Reduces to "changed since" for a field edit; handles cascade-delete; refuses the cross-user dangling case (A adds a figure, B annotates inside it → A's undo-of-add refused). Clear refusal message.
- **Redo** is an explicit per-user cursor; a fresh edit clears it.
- Granularity (D13): coalesce same-field edits within ~1s; a compound create undoes as one op; a reorder is one op.

### 5.5 Invites
An `editor` generates a signed, expiring **invite token** (link); redeeming it (authenticated) creates a `Membership` with the inviter's chosen role. Editors/owner can remove members.

---

## 6. Architecture

Lean, server-authoritative, single relational store (Path A). Path B (CRDT) would add a local store + merge engine behind the `store/` seam.

```
[ React 19 + Vite PWA ]   (vite-plugin-pwa: installable app-shell only — NOT offline data in Path A)
   • Clerk client (session JWT)
        │  HTTPS — Hono RPC (typed) + Zod      ▲ poll on updatedAt (live refresh)
        ▼                                       │
[ Worker ]  Workers Static Assets (serves SPA) + Hono API
   • Clerk JWT verify (networkless)   • permission checks   • op-log append   • invite tokens   • quota check
        │
        ▼
[ D1 (Drizzle) ]  single source of truth: users, memberships, routines → sections → figures(+variants) →
                  attributes, annotations + anchors + replies, user-defined attribute kinds, EditOp log
        (R2 for media → v1.1)
```

### 6.1 Module boundaries (enforced by pnpm workspaces)
`contract → domain`; `web → contract, domain`; `worker → contract, domain`. `domain` has no I/O.
- **`packages/domain/`** — pure TS: the **ATTRIBUTE_REGISTRY** (`vocabulary.ts`), `sortKey`, **float-count timing & per-role bar derivation**, **figure-variant resolution (base + overrides)**, the **op registry** + apply/invert/footprint + undoability, deep-copy/fork, the migration ladder, Zod schemas.
- **`apps/worker/`** — Hono routes, Clerk middleware (behind `auth/`), **permission enforcement** (`authorizeOp`, pure) + **quota check**, Drizzle/D1, op-log append, invite tokens.
- **`apps/web/store/` (client repository seam)** — components access data only through this typed reactive-read + mutate layer; **never import the RPC client directly.** Path A implements it over RPC + TanStack Query; Path B's CRDT engine swaps the implementation here without touching components.
- **`apps/web/`** — presentational React, service worker for installability.
- **`packages/contract/`** — Zod schemas + Hono RPC `typeof app`.

### 6.2 Data flow — Clerk JWT → Hono RPC (Worker verifies, checks Membership/role + quota, reads/writes D1) → every mutation appends an `EditOp` and bumps `updatedAt`; optional poll refetch.

### 6.3 File structure (domain modules reflect the v2 model)
```
packages/domain/src/
  ids.ts          # ULID
  vocabulary.ts   # ATTRIBUTE_REGISTRY (standard kinds) + merge(user-defined)
  dances.ts       # dance metadata (meter, phraseBeats, travelling)
  timing.ts       # float count → bar/fraction (a/&/e, i-subdivisions), per role
  sortkey.ts      # fractional index + actor tiebreak
  variants.ts     # figure-variant resolution: base attributes + overrides − removals
  oplog.ts        # op registry, apply/invert, footprint, undoability
  fork.ts         # deep routine fork (new ids, lineage)
  schemas.ts      # Zod schemas derived from the merged registry
apps/worker/src/ … (auth/, db/schema.ts, repo/, permissions.ts incl. quota, oplog.ts, routes/)
apps/web/src/ …   (store/, components/ per screen, lib/ rpc+sentry, sw.ts)
```
The rest of the repo scaffolding (root config, wrangler envs, CI) is as in §9 / the M0 tasks.

---

## 7. Non-Functional Requirements

- **Performance:** mobile-first; app shell interactive < ~2s on mid-range/3G. Routine list + load are indexed queries / one RPC; **`EXPLAIN QUERY PLAN` in CI** guards the D1 rows-scanned trap.
- **Connectivity:** online-only in Path A; offline *read* is the next increment (Path B's CRDT would bring offline write). Clear "you're offline" state for data.
- **Cost ceiling:** **$0/mo at hobby scale** (Workers + D1 free tiers; Clerk 50k MRU). The **pro plan** monetizes beyond the free cap; billing provider TBD (Q-PLAN).
- **Accessibility:** WCAG AA — color never the *only* signal (labels/initials); ≥ 44px targets; keyboard/SR navigable; reduced-motion respected.
- **Browser/PWA:** evergreen mobile + desktop; installable.
- **Data ownership:** JSON **export AND import** (structure + attributes + annotations); envelope carries `schemaVersion`; import runs a migration ladder; unknown attribute values survive round-trip via the registry pass-through/alias rule.
- **Ops:** Sentry (or Tail Workers); staging + prod; CI runs the test layers and the EXPLAIN check.

---

## 8. Locked Technical Decisions

Infra decisions are stable; the v2 review changed several product/model decisions (marked **Δ**). **Override any on review** — none are expensive before code exists.

| # | Decision | Choice |
|---|---|---|
| D1 | Repo layout | **pnpm workspaces**: `packages/{domain,contract}`, `apps/{web,worker}`. |
| D2 | Lint / format | **Biome**. |
| D3 | CI | **GitHub Actions**. |
| D4 | Deploy / envs | **Wrangler**, Workers Static Assets serving the SPA; `staging` + `production`. |
| D5 | Entity IDs | **ULID** (`ulidx`), client-side, TEXT PKs. |
| D6 | Client data layer | **TanStack Query** behind the `store/` seam. |
| D7 | Validation / contract | **Zod** in `packages/contract`. |
| D8 | ORM / migrations | **Drizzle** + drizzle-kit; tests use `applyD1Migrations()`. |
| D9 | Auth boundary | **Clerk** isolated behind `auth/` (Q-A1). |
| D10 | Live refresh | **Polling / SWR**; SSE deferred (Q-S1). |
| **D11 Δ** | **Roles** | **Classic `viewer`/`commenter`/`editor` + `owner`** (replaces couple+coach; editors edit structure *and* annotations). |
| **D12 Δ** | **Fork** | **In v1 via Path A** (server-side routine fork + figure variants); CRDT (Path B) deferred — Q-FORK. |
| D13 | Undo granularity | Coalesce same-field ~1s; compound create = one op; reorder = one op. |
| D14 | Identity-color collisions | Tolerated; initials are the primary signal (Q-A2). |
| D15 | Error monitoring | **Sentry** (+ `@sentry/cloudflare`); Tail Workers fallback. |
| D16 | Node / tooling | **Node 22 LTS**, pnpm 9, TS strict, ESM everywhere. |
| **D17 Δ** | **Notation model** | **Attributes-on-a-float-count timeline** (extensible kinds) replaces typed step-slot columns — Q-ATTR. |
| **D18 Δ** | **Sections** | **User-named sections** replace the long/short/corner Side enum + computed ordinals — Q-SECTION. |
| **D19 Δ** | **User role pref** | **No `User.defaultRole`**; leader/follower is a per-device view preference, switchable in the timeline. |
| **D20 Δ** | **Annotations** | **Unified annotation** (note/lesson/practice) with polymorphic + query anchors replaces separate Thread/Comment + JournalEntry. |
| **D21 Δ** | **Plans/quota** | **Free tier capped at 3 owned routines**; pro plan + billing provider deferred (Q-PLAN); v1 builds the quota seam. |

### Global constraints (every task inherits)
- **TypeScript strict**; no `any` without justification.
- **Cloudflare-only** runtime: Worker + D1 + Static Assets. (Path A: no DO/WebSocket/R2 in v1; Path B would add a local store.)
- **All ids are client-generated ULIDs**, TEXT PKs; **soft-delete only**.
- **Every mutation appends an `EditOp`** (forward + inverse + footprint), in the same transaction; the op-log is **not** the source of state.
- **Attribute vocabulary lives in the merged ATTRIBUTE_REGISTRY** (standard + user-defined); no `hasRiseFall` boolean.
- **The client accesses data only through `store/`.**
- **Quota check on routine create** (free cap).
- **Cost ceiling ~$0/mo;** index every query (EXPLAIN in CI). **Accessibility WCAG AA.**

---

## 9. Implementation Roadmap (Milestones)

Phased: M0–M1 detailed (the walking skeleton that proves the **attribute/notation + op-log** model); M2–M9 outlined, each expanded into its own plan when reached. Undo (M4) is sequenced after the notation core proves out. **The v2 model changes (attributes, sections, variants, annotations, roles) reshape M1–M6** vs the original plan; the M0 foundation is unchanged.

> **For agentic workers:** use `superpowers:subagent-driven-development` or `superpowers:executing-plans`; steps use `- [ ]`.

| M | Milestone | Deliverable | Detail |
|---|---|---|---|
| **0** | **Foundation** | Monorepo boots; `domain` + `contract`; CI green; Worker serving a "hello" SPA with verified Clerk session + empty D1 migration | **Detailed below** |
| **1** | **Domain core (walking skeleton)** | Pure `domain/`: ATTRIBUTE_REGISTRY (standard + merge), dances, **float-count timing**, sortKey, **figure-variant resolution**, op-log apply/invert + footprint undoability, deep fork — unit + property tested, no I/O | **Detailed below** |
| **2** | Persistence + notation CRUD | Drizzle schema (sections, figures+variants, attributes, user-defined kinds, soft-delete, ULIDs), migrations, repo + Hono routes (routine/section/figure/variant/attribute), op-log append-in-tx, `store/` seam + Assemble/Figure-Timeline/Attribute-Editor screens | outline |
| **3** | Auth, membership, permissions & quota | Clerk onboarding (name/color), Membership (viewer/commenter/editor + owner), `authorizeOp`, **quota check**, invite issue/redeem, Share | outline |
| **4** | Undo / redo | Worker undo/redo over footprint undoability; per-user; toasts; refusal UX; cross-user + cascade + variant tests | outline |
| **5** | Annotations | Unified annotation + replies; anchors (point/figure/variant; query per Q-ANNO); timeline + journal surfaces; identity colors; polling refresh | outline |
| **6** | Fork & variants UX | Routine fork (Path A) + figure-variant authoring/inheritance UI; lineage display | outline |
| **7** | Lanes + sample/template + search + custom kinds | Registry-derived Lanes; sample + start-from-template; routine search; (user-defined attribute kinds UI if Q-ATTR = yes) | outline |
| **8** | Export / import + ops | schemaVersion'd JSON round-trip + migration ladder; Sentry; EXPLAIN-QUERY-PLAN CI gate; staging/prod | outline |
| **9** | PWA + a11y + cross-browser | Installable shell + offline-state; axe/keyboard/reduced-motion; iOS Safari + Android Chrome E2E | outline |

### Data model (M2 schema)

```mermaid
erDiagram
    User ||--o{ Membership : has
    Routine ||--o{ Membership : grants
    User ||--o{ Annotation : authors
    User ||--o{ Reply : authors
    User ||--o{ EditOp : actor
    Routine ||--o{ Section : owns
    Section ||--o{ Figure : owns
    Figure ||--o{ Figure : "variant of (baseFigureId)"
    Figure ||--o{ Attribute : has
    Routine ||--o{ Annotation : "scoped to"
    Annotation ||--o{ Reply : has
    Annotation ||--o{ AnnotationAnchor : "anchored by"
    Routine ||--o{ AttributeKind : "user-defined kinds"
    Routine ||--o{ EditOp : "op-log"

    User { text id PK "ULID"; text clerkSub UK; text displayName; text identityColor "hex"; text plan "free|pro" }
    Membership { text id PK; text routineId FK; text userId FK; text role "viewer|commenter|editor"; int createdAt; int deletedAt }
    Routine { text id PK; text title; text dance; text ownerId FK; text forkedFromRoutineId FK "nullable"; text templateOf "nullable"; int schemaVersion; int createdAt; int updatedAt; int deletedAt }
    Section { text id PK; text routineId FK; text name "free text"; text sortKey; int deletedAt }
    Figure { text id PK; text sectionId FK; text name; text source "library|custom"; text libraryFigureId "nullable"; text baseFigureId FK "nullable (variant)"; text sortKey; text entryAlignment "json nullable"; text exitAlignment "json nullable"; int deletedAt }
    Attribute { text id PK; text figureId FK; text kind "step|sway|turn|rise|position|custom"; real count "float, rel. figure start"; text role "leader|follower|null"; text value "json typed by kind"; int deletedAt }
    AttributeKind { text id PK; text routineId FK "scope TBD Q-ATTR"; text kind; text label; text color; text cardinality; text valueType; text values "json"; int deletedAt }
    Annotation { text id PK; text routineId FK; text authorId FK; text kind "note|lesson|practice"; text text; text tags "json"; int createdAt; int deletedAt }
    AnnotationAnchor { text id PK; text annotationId FK; text type "point|figureVariant|figure|query"; text figureId FK "nullable"; real count "nullable"; text role "nullable"; text query "json nullable" }
    Reply { text id PK; text annotationId FK; text authorId FK; text text; int createdAt; int deletedAt }
    EditOp { text id PK "ULID"; text routineId FK; text actorId FK; int seq; text clock "json HLC"; text kind; text forward "json"; text inverse "json"; text footprint "json"; int undone; int createdAt }
```

> **Reference data (client bundle, not D1):** `Dance` metadata, the `LibraryFigure` catalog (default attributes), and the **standard** attribute kinds. Versioned by `schemaVersion`. **User-defined** attribute kinds live in D1.

### Mutation + undo flow
Unchanged from v1 in shape (optimistic apply with client ULID → RPC mutate → Worker `authorizeOp` + quota → tx applies change + appends EditOp + bumps `updatedAt` → authoritative response; undo finds the actor's latest non-undone op, applies its inverse iff no later op touches its footprint, else refuses).

---

### Task Detail — Milestone 0: Foundation
*(unchanged from v1 — the foundation is model-agnostic)*

#### Task 0.1: Initialize the monorepo
**Files:** `pnpm-workspace.yaml`, `package.json`, `.nvmrc`, `biome.json`, `tsconfig.base.json`, `.gitignore`
- [ ] Workspace lists `packages/*` + `apps/*`; `.nvmrc` 22; root `package.json` `"packageManager":"pnpm@9","type":"module"`, scripts delegate with `pnpm -r`.
- [ ] `biome.json` (formatter + linter, `noExplicitAny: error`); `tsconfig.base.json` strict, Bundler resolution, ES2022.
- [ ] `.gitignore` (node_modules, dist, .wrangler, .dev.vars, coverage, playwright-report, test-results).
- [ ] `pnpm install && pnpm biome check .` clean → commit `chore: initialize pnpm monorepo with Biome + strict TS`.

#### Task 0.2: Scaffold `domain` + `contract`
- [ ] `@ballroom/domain` (`"main":"src/index.ts"`, deps `zod`,`ulidx`; dev `vitest`,`fast-check`), `@ballroom/contract` (deps domain + zod). Verify `pnpm --filter @ballroom/domain test` + `pnpm -r typecheck` → commit `chore: scaffold domain + contract packages`.

#### Task 0.3: Scaffold the Worker (Hono + assets + empty D1)
- [ ] Wrangler config (`staging`/`production`, `DB` D1 binding, SPA assets), Hono `GET /api/health → {ok:true}`, failing health test (`vitest-pool-workers`) → PASS → commit `feat(worker): Hono health endpoint + D1 binding + SPA assets`.

#### Task 0.4: Web SPA + Clerk + verified call
- [ ] Vite + React + Clerk; `/api/me` returns verified `sub`; Worker `auth/` verifies JWT networklessly; failing integration test (mint JWT; 401 on missing) → PASS → commit `feat: Clerk-gated SPA + networkless JWT verify`.

#### Task 0.5: CI
- [ ] GitHub Actions on PR + main: pnpm + Node 22, install, biome, typecheck, `pnpm -r test`. Open PR; confirm green → commit `ci: lint + typecheck + unit/integration tests on PR`.

**M0 exit:** repo boots; CI green; verified call round-trips; D1 binding present.

---

### Task Detail — Milestone 1: Domain Core (walking skeleton)
All in `packages/domain` — pure, TDD, unit + property tests. **Proves the v2 attribute/notation + op-log model.**

#### Task 1.1: ULID ids — `newId()`, `isId()`. → commit `feat(domain): ULID ids`.
#### Task 1.2: Dance metadata — `DANCES` (Waltz/Viennese 3/4 phraseBeats 6; rest 4/4 phraseBeats 8; all `travelling`). → `feat(domain): dance metadata`.
#### Task 1.3: ATTRIBUTE_REGISTRY (standard + merge)
**Produces:** `ATTRIBUTE_REGISTRY: AttrKindDef[]` (standard kinds: step/sway/turn/rise/position), `mergeKinds(standard, userDefined)`, `kindsForDance(d)`, `valuesFor(kind)`, `isKnownValue`, `REGISTRY_VERSION`, `VALUE_ALIASES` (`CBP→CBMP`).
- [ ] Failing test: `kindsForDance("tango")` excludes `rise`; `step` footwork includes `H`; `turn` includes `eighth_L`; `rise` includes `NFR`; position single vs body-action multi; `CBP`→`CBMP`; body values carry `[confirm]`; a user-defined kind merges in and is queryable. → implement → `feat(domain): ATTRIBUTE_REGISTRY (standard + user-defined merge)`.
#### Task 1.4: Float-count timing
**Produces:** `countToBar(count, dance)`, `countLabel(count, dance)` rendering integer beat (modulo `phraseBeats`) + fraction (`a`/`&`/`e`, `i`-subdivisions `ia`/`ai`), `barsForFigure(attrs, dance, role)` = `ceil(maxCount/beatsPerBar)`.
- [ ] Failing test: Waltz count 6 → bar 2; count 4 → 2 bars; Foxtrot count 8 → 2; `3.5` → "3&", `3.25` → "3a", `3.75` → "3e", `3.125` → "3ia", `3.375` → "3ai" (per the [confirm] mapping, Q-D3); per-role derivation independent; empty → 0; out-of-phrase wraps via modulo. → implement → `feat(domain): float-count timing + fraction notation`.
#### Task 1.5: Fractional sort keys — `keyBetween(a,b,actorId)` (lexicographic, actor tiebreak, no rebalance). → `feat(domain): fractional sort keys`.
#### Task 1.6: Figure-variant resolution
**Produces:** `resolveVariant(base: Attribute[], variant: {overrides, removals, renamed})` → the effective attribute set; "inherit later base additions" = base attrs not in `removals`, with `overrides` applied.
- [ ] Failing test: variant inherits a newly-added base attribute; a removed step stays removed; an overridden value wins over the base; renaming the figure doesn't alter inheritance; resolution is pure/deterministic. → implement → `feat(domain): figure-variant resolution`.
#### Task 1.7: Op registry + apply/invert
**Produces:** `OP_REGISTRY` (`kind → {apply, invert, footprintOf}`), `applyOp`, `invertOp`. M1 kinds: `attribute.set`, `attribute.add`, `attribute.remove`, `figure.add` (compound: figure + default attributes), `figure.remove`, `figure.fork` (variant create), `section.add`, `section.rename`, `figure.reorder`. `Footprint = {entities[], versionBefore}`.
- [ ] Failing round-trip test (per kind, apply→invert restores deep-equal; `figure.add` undoes figure + its attributes as one op; `figure.fork` undoes the variant; `footprintOf` lists every touched id). → implement → `feat(domain): op registry, apply/invert, footprint`.
#### Task 1.8: Property-based op invertibility (fast-check) — `invert(apply)` round-trips for every generated op of every registered kind (auto-covers user-defined kinds). → `test(domain): property-based op invertibility`.
#### Task 1.9: Footprint-based undoability — `isUndoable(target, laterOps)` (`superseded`/`dependent`), `latestUndoableForUser`, `nextRedoForUser`.
- [ ] Failing tests: (a) field edit then nothing → undoable; (b) edit-twice → first `superseded`; (c) A adds figure, B annotates inside → A's undo `dependent`; (d) cascade footprint includes attributes/annotations; (e) redo cursor re-targets, cleared by a new edit. → implement → `feat(domain): footprint-based undoability + redo cursor`.
#### Task 1.10: Deep routine fork — `forkRoutine(routine, byUserId)` (new ids throughout, sections/figures/variants/attributes preserved, `forkedFromRoutineId` set, annotations omitted per D5 default).
- [ ] Failing test: fork has new ids, structure + attributes preserved, lineage set, no annotations carried. → implement → `feat(domain): deep routine fork`.

**M1 exit:** vocabulary (standard + extensible), float-count timing, ordering, variant resolution, op apply/invert, footprint undoability, fork — implemented and unit + property tested, zero I/O.

---

### Milestones 2–9 (outline — each becomes its own detailed plan)
- **M2 — Persistence + notation CRUD.** Drizzle tables per §9, migrations, `repo/`, Hono routes (routine/section/figure/variant/attribute), op-log append-in-tx, `store/` seam + Assemble/Figure-Timeline/Attribute-Editor. Tests: vitest-pool-workers integration; component; core authoring E2E.
- **M3 — Auth, membership, permissions & quota.** User mapping, onboarding, Membership (viewer/commenter/editor + owner), `authorizeOp` truth table, **quota check on create**, invite issue/redeem, Share. Tests: permission + quota enforcement + forged-request rejection; invite lifecycle.
- **M4 — Undo / redo.** Worker endpoints over `isUndoable`; per-user cursors; toasts/refusal. Tests: cascade + cross-user + variant undo at integration + E2E.
- **M5 — Annotations.** Unified annotation + replies; anchors (point/figure/variant; query per Q-ANNO); timeline + journal. Tests: anchor integrity (incl. query anchors), author-color, commenter-can-annotate, LWW.
- **M6 — Fork & variants UX.** Routine fork (Path A); figure-variant authoring + inheritance UI; lineage. Tests: fork copies structure not annotations; variant inherits base additions; override/removal persist.
- **M7 — Lanes + sample/template + search (+ custom kinds if Q-ATTR=yes).** Registry-derived Lanes; sample + template; search; user-defined-kind creation. Tests: Lanes across counts; custom kind propagates to editor/lanes/info.
- **M8 — Export / import + ops.** schemaVersion'd round-trip + migration ladder; Sentry; EXPLAIN gate; staging/prod.
- **M9 — PWA + a11y + cross-browser.**

---

## 10. Testing Strategy

Quality and a detailed testing plan are a non-negotiable owner requirement. The pyramid, tooling, CI, and fixtures below are **unchanged in shape** by the v2 review; what changed is **the subjects under test** (attributes-on-a-count not typed step-slots; sections not sides; variants and fork; unified annotations with query anchors; classic roles; quota). The new highest-risk areas: **undo/op-log footprint logic (incl. cascade + cross-user + variant), the attribute/variant-resolution model, and Worker-side permission + quota enforcement.**

> **Annex status:** the retained testing plan (`docs/superpowers/specs/2026-06-24-testing-plan.md`) predates the v2 redesign. Its per-screen coverage matrix is still a useful checklist of *surfaces*, but several rows (two-chart, coach role, side auto-naming, typed slots) are superseded by this section. It carries a banner saying so and will be re-pinned once Q-FORK/Q-ATTR/Q-ANNO settle.

### 10.1 Philosophy
1. **Push correctness down the pyramid** — the hardest logic (op-log invert/undo, float-count timing, variant resolution, fork, registry/Zod validation) is pure `domain/` with no I/O, tested exhaustively + property-based.
2. **Test the real runtime where a mock would lie** — Worker/D1 inside `workerd` against real D1 via `@cloudflare/vitest-pool-workers` + `applyD1Migrations()`.
3. **Contract types-first, runtime-validated second** — Hono RPC `typeof app` + shared Zod; CI fails on drift.
4. **E2E proves journeys and cross-process invariants**; smallest layer, most guarded.
5. **Every surface is traced** against the wireframe inventory; deferred items listed in §11.
6. **Color is never the only signal under test.**

### 10.2 Pyramid & layer ownership
- **Unit (pure `domain/`):** float-count timing & per-role bars; **variant resolution** (inherit/override/remove); op apply/invert + `apply(inverse(apply(op,s)))===s` (property-based, all kinds incl. user-defined); **footprint undoability** (reduces to "changed since"; refuses cross-user dependent; allows disjoint); per-user redo cursor; coalesced inverse; sortKey ordering; deep fork; registry/Zod (`NFR`/`H`/`⅛` valid; Tango omits rise; position single vs body-action multi; `CBP`→`CBMP`; unknown-value passthrough-on-read vs reject-on-write; **user-defined kind merges & validates**; count fraction mapping per Q-D3); schemaVersion migration ladder.
- **Worker / D1 (`vitest-pool-workers`):** every mutation persists rows **and** appends exactly one `EditOp` (`seq` monotonic); routine-load returns the full tree (sections→figures(+variants)→attributes→annotations) in one fetch; routine-list returns only the caller's memberships. **Permissions:** viewer rejected on any write; commenter accepted on annotate/reply, rejected on structure; editor succeeds; non-member rejected; only owner deletes routine. **Quota:** creating a 4th owned routine on a free plan is rejected with the upsell error. **Undo endpoint:** inverse applied, op marked, undo logged; stale/cross-user → defined refusal; soft-delete round-trips. **LWW.** **Invites** issue/redeem/expiry. **Fork/variant** routes copy structure (not annotations) and resolve variant inheritance. **Sample/template** read-only. **Export/import** round-trip. **EXPLAIN QUERY PLAN** on list/load/membership/op-log-tail/quota-count → index, no SCAN.
- **Component (browser mode + Testing Library + axe):** attribute editor (chips from merged registry; re-tap clears; Tango hides rise; user-defined kind appears); timeline role flip; Lanes across counts; section rename; variant badge; annotation create from timeline + journal with anchor picker; empty states; viewer/commenter affordance gating; toasts incl. "Undone" + quota upsell.
- **E2E (Playwright):** full authoring journey (create → section → figure/variant → place attributes → switch role); concurrent LWW (two contexts, sequenced writes); cross-user undo + refusal; permission (viewer/commenter blocked; forged write rejected by Worker); **quota** (free cap blocks 4th, upsell shown); invite redemption; fork a routine + a figure variant (inheritance visible); annotation with a query anchor (per Q-ANNO); export→import; PWA install/app-shell-offline; tab nav.
- **Contract:** compile-time `typeof app` (drift fails `tsc`); runtime Zod both ends; schema-drift CI gate.

### 10.3 Tooling, CI, fixtures (unchanged)
- **Vitest projects:** `domain` (Node + fast-check), `worker` (`vitest-pool-workers`, real bindings), `component` (browser mode + `vitest-axe`). **Playwright:** `chromium-desktop`, `mobile-chrome`, `mobile-safari`.
- **Cloudflare test config:** per-suite isolated D1; `applyD1Migrations()`; an `EXPLAIN QUERY PLAN` helper asserting `USING INDEX`, no `SCAN`.
- **Clerk in tests:** inject test JWKS/PEM; `makeTestJWT`; the real verify + `sub`→user runs against minted tokens. E2E uses Clerk testing-mode/test tokens seeded per fixture.
- **CI:** PR fast gate (typecheck+lint → unit/fast-check → contract+drift → worker/D1 incl. EXPLAIN → component+axe → E2E smoke). Merge/nightly: full Playwright matrix + Lighthouse-CI + staging→prod. No arbitrary sleeps; deterministic auth + seed; LWW tests sequence writes; `retries:1` with trace.
- **Coverage gates:** domain ≥ 95%; worker routes ≥ 90% with *every undo, attribute/variant, permission, and quota edge case* covered; component/E2E by feature coverage against the surface inventory.
- **Fixtures:** the read-only **sample routine** (sections, library + custom figures, a variant, attributes across kinds incl. one user-defined, a couple of annotations) defined once and reused across all layers; pure factories (`makeRoutine/Section/Figure/Variant/Attribute/Membership/Annotation/Reply/EditOp`); `seedDb(...)`; `makeTestJWT` + `authedContext(role)` with users matching the seed (so permission/quota/undo tests are realistic).
- **A11y / perf / cross-browser:** axe on every screen (zero serious/critical); full keyboard nav; color-not-sole-signal; ≥44px; reduced-motion; app-shell <~2s (Lighthouse-CI); one-RPC routine load; mobile-safari + mobile-chrome run core journeys; PWA install + app-shell-offline.

---

## 11. Out of Scope (v1) — explicit YAGNI cuts

- **Offline-first / offline data** (CRDT, Durable Objects, WebSocket sync, IndexedDB store) — online-only in Path A; offline *read* is the next increment. *(Path B would pull a CRDT in alongside fork — Q-FORK.)*
- **Concurrent fork-merge-back / diff between forks** — fork creates an independent copy (lineage pointer only); no merge engine in v1.
- **Billing integration / payment provider** — the pro plan and quota *enforcement* are in v1, but charging is deferred (Q-PLAN).
- **Ownership transfer.**
- **Latin / spot dances** — `travelling` flag present; v1 ships Standard only.
- **Per-step alignment** (could later be a user-defined attribute kind), separate feet-vs-body turn amounts, richer footwork/turn magnitudes beyond the confirmed set.
- **Cross-routine annotations**, annotation search.
- **Query-anchor dimensions beyond the v1 set** (Q-ANNO decides which ship).
- **Media attachments** — v1.1.
- **Notifications, read/unread, reply editing, threading depth.**
- **Syllabus-system attribution (ISTD/IDTA/WDSF/American)**, amalgamations as a first-class entity, precede/follow compatibility validation.
- **Themes/backdrop settings**, per-member fine-grained access editing, **section reorder**, **native app wrapper.**

> The cheap-now CRDT *seams* (client ULIDs, `schemaVersion`, soft-delete tombstones, footprint/op-registry op-log) are still built and tested in v1, so Path B remains an additive future step rather than a rewrite.

---

## 12. Open Questions & Decisions Needed

The v2 review resolved the old questions and opened new ones. Prior history (the v2/v3 "how we got here" archaeology) has been dropped as noise — only live decisions remain. **★ = blocks the relevant subsystem.**

### ★ New keystone & model decisions (from the PR review)
- **★ Q-FORK — How are fork & figure-variants implemented in v1?** Recommendation: **Path A** (server-side routine fork + variant base/override resolution, online-only, no CRDT) now; defer **Path B** (CRDT-based concurrent/offline fork-merge) to when offline-write is scheduled. Decides whether v1 stays online-only (§5.3, §6, §11).
- **★ Q-ATTR — Confirm the attribute notation model.** (a) Attributes-on-a-float-count replace typed step-slots (D17) — confirm. (b) How does leader/follower map on top — a `role?` per attribute (shared unless overridden), or two parallel attribute sets? (c) Which standard kinds ship (step/sway/turn/rise/position + alignment?). (d) Does v1 ship the **user-defined kind creation UI**, or only the extensible mechanism + standard set? (e) Variant inheritance semantics (live-inherit vs copy-on-write) and how they compose with undo.
- **★ Q-ANNO — Unified annotation anchors.** Which anchor types ship in v1 — `point`, `figure`, `figureVariant` for sure; are **query anchors** ("all rising steps", "all left-turning figures") v1 or v1.1? They are the most powerful and the most complex (they need a predicate language over attributes).
- **Q-ROLE — Confirm the flat classic role model** (viewer/commenter/editor + owner; editors edit structure *and* annotations; no leader/follower user role; per-device view preference). (D11/D19)
- **Q-SECTION — Sections are free-text-named** (D18). Offer optional preset quick-fills ("Long Side", "Corner", "Intro")? Any need to keep a structured floor-position concept for alignment, or is alignment-per-figure enough?
- **Q-PLAN — Plans/quota.** Free cap = **3 owned routines** — confirm the number and that it counts *owned* (not shared-in) routines. Pro tier limits + billing provider (Stripe?) deferred — confirm deferral.

### Carried-over domain question
- **★ Q-D4 — Body position + body-action vocabulary (pending the owner's coach).** Confirm position set (`closed`/`promenade`/`wing`), body-action `CBM`/`CBMP` multi-select, "CBP" = CBMP typo. Doesn't block the build (registry stub; values are data).
- **Q-D3 — Count fraction mapping.** Confirm `a`=.25, `&`=.5, `e`=.75 and `i`-subdivisions (`ia`=.125, `ai`=.375). This **inverts the common "1 e & a" ordering**, so flag if `e`/`a` should swap.
- **Q-D5 — Does a routine fork carry annotations?** Default **no** (fresh artifact). Cheap to flip.
- **Q-M1/2/3 — Media (v1.1):** types, caps, which entities.
- **Q-SC1/2 — Latin/spot & American** target versions (forward-compat; `travelling` flag present).

### Settled infra defaults (flippable before code)
Q-S1 live-refresh → polling (D10); Q-S2 undo granularity → coalesce/compound/reorder (D13); Q-A1 Clerk boundary clean (D9); Q-A2 color collisions tolerated (D14).

---

## 13. Appendix: Media (v1.1)

Not in v1. Annotations carry `media[]`; UI shows "coming soon". When built (v1.1): R2 with Worker-issued **presigned PUT URLs** (browser→R2 directly, zero egress); client-side compression; metadata holds the object key. Upload inline while online (no background-sync; iOS Safari lacks Background Sync — fallback is an in-app retry queue). **Q-M1/2/3** cover types/caps/entities.

---

## 14. Further detail & sources

This plan is self-contained for building v1. The documents below are **retained for detail this plan does not reproduce in full**.

| Document | What it adds | Status note |
|---|---|---|
| [`docs/superpowers/specs/2026-06-24-testing-plan.md`](superpowers/specs/2026-06-24-testing-plan.md) | The verbatim per-screen surface coverage matrix (one row per interaction with key assertions) | **Predates the v2 redesign** — useful as a surface checklist; rows tied to two-chart/coach/side/typed-slots are superseded by §10. To be re-pinned after Q-FORK/Q-ATTR/Q-ANNO. |
| [`docs/design/Ballroom Builder.dc.html`](design/Ballroom%20Builder.dc.html) | The wireframe prototype — the product sketch / feature inventory | Sketch, not requirements. |
| `research/domain.md` | Ballroom domain reference (counts, footwork, alignment, terminology systems) | Authority behind §3. |
| `research/platform.md` | Platform/architecture research (Cloudflare stack, toolchain) | Behind §6/§8. |
| `research/design-spec.md` | The exhaustive wireframe enumeration | The surface checklist the matrix traces against. |
| `research/critique-{domain,sync,product,testing,scope}.md` | Five adversarial critiques | Drove the original simplification. |
| `research/extensibility-{attributes,crdt,undo}.md` | Three extensibility reviews | Behind the op-log/ULID/soft-delete seams that now also underpin Path B. |

**Removed** (folded into this plan, no longer maintained separately): the original design specification, the implementation plan, and the consolidated open-questions document.

---

*End of plan (v2, owner-review pass). The architectural keystones (Q-FORK, Q-ATTR, Q-ANNO) are flagged in §12 for the next round of comments; M0 is execution-ready, M1 reflects the v2 notation model, and M2–M9 expand into their own detailed plans as reached.*
