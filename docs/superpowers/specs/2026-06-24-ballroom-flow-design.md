# Ballroom Flow — Design Specification

**Status:** Draft for review — **v3**
**Date:** 2026-06-24
**Sources of truth:** `research/design-spec.md` (wireframe enumeration), `research/domain.md` (ballroom domain reference), `research/platform.md` (platform/architecture research). This document synthesizes all three plus the owner's locked decisions into one coherent spec. Where a question remains genuinely open, it is deferred to §11.

Guiding principle: **quality and maintainability over feature count.** Every feature is sorted v1 / v1.1 / out-of-scope and YAGNI is applied ruthlessly. The wireframe is a *product sketch*, not a requirements list.

---

## Changelog — v3 (2026-06-24)

v3 folds in owner-approved **extensibility** decisions from three reviews (`research/extensibility-{attributes,crdt,undo}.md`). The unifying insight: **the op-log, shaped correctly, serves undo today AND the future CRDT AND new op kinds — one mechanism, not three.** None of this adds v1 features; it shapes the v1 foundations so the planned increments (offline read, CRDT sync, non-core technique slots) land without migrations. YAGNI still holds: reserved seams are *documented, not built*.

- **Client-generated IDs.** All entity `id`s are client-generated globally-unique sortable identifiers (ULID / UUIDv7), TEXT primary keys in D1 — no autoincrement. Makes optimistic create unambiguous now; prerequisite for future offline creation. (§2.1)
- **Soft-delete / tombstones.** Deletable entities carry `deletedAt`; delete sets it (never a bare row-drop), inverse flips it back, so cascade-undo restores the whole subtree with original ids. Also the remove-wins tombstone the future CRDT needs. (§2.1, §5.4)
- **Op-log reshaped.** `EditOp` widened to carry an HLC/Lamport clock, server-assigned `seq` (ordering authority, not identity), structured self-describing `forward`/`inverse` diffs, and a `footprint`. An **op registry** means new op kinds don't touch undo machinery. Retention contract: the op-log is **not** the source of current state (D1 rows are) — no replay-on-load; snapshot/prune is a planning detail. (§2.1, §5.4)
- **Unified undoability rule.** An op is undoable iff **no later not-yet-undone op — by any user — touches any entity in its footprint.** Subsumes the v2 field-only "changed since" check and correctly handles cascade-delete and cross-user dangling. Explicit **per-user redo cursor** (not "undo-the-undo"). (§5.4)
- **SLOT_REGISTRY.** A single `domain/vocabulary.ts` is the ONE source of truth for technique slots; tag editor, Lanes, Info-sheet, chips, and Zod all derive from it (no hand-reconciled glossary). Retires `hasRiseFall` (Tango just isn't in rise's `appliesToDances`). Core 5 slots stay typed Drizzle **columns** (hybrid, not EAV); a documented `stepAttributes` seam is **reserved, not built**. Forward-compatible reads: unknown enum values pass through; registry carries a version + value aliases (CBP→CBMP). (§3, referenced in §2.1/§4)
- **`schemaVersion`** on the export/import envelope **and** the Routine row (the offline-read cache needs it); importers/mergers run a migration ladder; a future sync engine refuses clients below a declared minimum. (§2.1, §8)
- **`store/` repository seam.** Client touches data only through a thin typed reactive-read + mutate layer; components never import the RPC client directly. v1 implements it over RPC + cache (TanStack Query); the future CRDT engine swaps the implementation behind the same interface. (§7.1)
- **Micro-defaults pinned** (test-planner flagged): bar derivation `bars = ceil(maxBeat / beatsPerBar)` per role, partial final bars shown as-is; side ordinal computed from current order (renumbers on deletion), not stored; enum reconciliation now resolved by the SLOT_REGISTRY.

---

## Changelog — v2 (2026-06-24)

The owner (a dancer) locked a set of decisions that **significantly simplify the architecture** and resolve most domain blockers. v2 rewrites the affected sections and deletes the now-moot content.

**Architecture — radically simpler (online-only):**
- **Offline-first is DEFERRED to a future version.** v1 is **online-only**; offline *read* is the planned next additive step. Consequently **removed entirely:** the CRDT (TinyBase MergeableStore), Durable Objects, the per-document sync coordinator, WebSockets, two-zone write-authority, and all offline-merge/sync-reconcile logic. The entire sync-correctness surface is gone.
- **Lean stack:** React + Vite PWA (vite-plugin-pwa for installability/app-shell only — *not* offline data) → **Hono on Cloudflare Workers** (Hono RPC + Zod typed contract) → **D1 + Drizzle** (single relational source of truth) → **Clerk** auth. R2/media → v1.1.
- **Server-authoritative, last-write-wins.** No client-side merge logic.
- **Shared editing of ONE routine.** Dropped owner-only editing, fork-to-edit, the "duplicate to edit" mechanism, two-zone model, and fork lineage. Both partners co-edit the same routine. Coach = view + comment. "Duplicate" is now a plain "save a copy" convenience, not the edit path.
- **Undo is a required v1 feature**, made cheap by online-only: a per-routine server-side **op-log** of reversible mutations, exposing **per-user undo at per-action grain** ("undo my last change").

**Domain — owner answers (reverses/sets several v1 assumptions):**
- **TWO step charts per figure (leader + follower), authoritative.** Reverses v1's single-chart decision. The charts are independent ordered lists (counts not necessarily 1:1). Knock-on: thread/journal anchors now target a step in a *specific role's* chart; bar/timing derive per-role.
- **Alignment is per-figure (entry + exit), added to the Figure entity.** (Not per-step in v1.)
- **Meter-based timing** (owner-confirmed) replaces the broken "bars = count of steps where count=='1'". Counts run continuously across a two-bar phrase — **1–6 for 3/4 dances (Waltz, Viennese Waltz)** and **1–8 for 4/4 dances (Foxtrot, Quickstep, Tango)** — with sub-beat markers `e`/`&`/`a`; bars derive from the dance's meter.
- **Body = position + body-action** modeled flexibly (position single-select + independent CBM/CBMP action), pending the owner's coach (Q-D4). "CBP" treated as a suspected typo for CBMP.
- **Enum additions confirmed:** bare **Heel** (Footwork), **⅛** (Turn), **NFR/no-foot-rise** (Rise); **Tango suppresses the rise slot** (`hasRiseFall=false`).
- **Structured per-step tagging is the v1 hero flow** — the tagging UX is optimized accordingly.

**Product — owner-accepted defaults:**
- Ship a read-only **sample routine** + "start from template" (cold-start fix).
- **Lanes view reinstated in v1** as the fast cross-step tagging surface.
- **Journal:** figure-wide linking included in v1; Link model trimmed to `{step | figure} × routine-scope` only.
- **Ops baseline:** Sentry (or Tail Workers) error monitoring; JSON **export AND import**; an `EXPLAIN QUERY PLAN` CI check guarding the D1 rows-scanned trap; staging + prod environments.

**Net effect:** a smaller, sharper spec. The biggest v1 risk areas (sync/merge, fork) are deleted; the new highest-risk areas are **undo/op-log correctness, two-chart data integrity, and Worker-side permission enforcement**.

---

## 1. Overview & Goals

### 1.1 What it is

Ballroom Flow is a **collaborative, mobile-first PWA** for building and annotating ballroom dance choreography ("routines"). A routine is an ordered sequence of **figures** (named standardized movement patterns), each holding **two step charts** (leader + follower); every step is annotated across technique dimensions (rise & fall, body, footwork, sway, turn). Routines are organized into **sides** (Long / Short / Corner) that mirror the rectangular competition floor. Partners and a coach **discuss** the routine through per-step comment threads and a per-user **journal** of lessons and practice notes that link back into the choreography.

### 1.2 Who uses it

- **A couple** (a leader and a follower) building and practising one routine together — both can edit it.
- **An optional coach** who reviews and comments (view + comment).

Typical sharing graph: 2–3 people per routine. A small-N collaboration tool, not a social network or studio LMS.

### 1.3 Non-negotiable constraints (owner)

1. **Cloudflare-hosted** end to end.
2. **No self-run auth** — managed identity provider with a generous free tier.
3. **Cheap** — ~$0/month at hobby scale; usage-based beyond.
4. **Performant** on mobile.
5. **PWA is the priority** (installable; no native app in v1).
6. **Quality & maintainability over feature count** — apply YAGNI.
7. **A solid, detailed testing plan is required** (§9).

> **Note on offline:** v2 is **online-only**. Offline-first was an earlier goal but is deferred; the next planned increment is offline *read* (cache the last-opened routines for read-only viewing). The architecture keeps the door open for it (§7) but builds none of it now.

### 1.4 Primary user journey (the core loop)

1. Sign in (Clerk).
2. Open the **sample routine**, start from a **template**, or create a routine for a dance.
3. Add sides → add figures from the library (or compose custom) → the figure arrives with leader+follower step charts.
4. Open a figure, **tag each step's technique slots** (the hero flow) — per row in Step Detail, or fast across all steps in **Lanes view**.
5. Discuss specific steps in threads; record lessons/practice in the journal, linked to a step or a figure.
6. **Undo** any of your own changes at per-action grain.

---

## 2. Domain Model

### 2.1 Canonical entities

The model reconciles the wireframe inventory with the domain reference and the owner's answers. Everything lives in **D1** (single relational source of truth); static reference data (dance metadata, figure catalog, technique vocabularies) ships **in the client bundle**.

**Conventions applying to every entity below (v3):**
- **Client-generated IDs.** Every `id` is a client-generated, globally-unique, sortable identifier (**ULID** or **UUIDv7**), stored as a **TEXT primary key** in D1 — **no autoincrement**. The client knows an entity's id before the server does, which makes v1 optimistic-create unambiguous (no id reconciliation round-trip) and is the prerequisite for future offline creation (two offline clients never collide).
- **Soft-delete / tombstones.** Deletable entities (Routine, Side, Figure, Step, Thread, Comment, JournalEntry, Link, Membership) carry a nullable **`deletedAt`**. A v1 delete **sets `deletedAt`** (filtered out of normal queries) — it is **never a bare row-drop**. This makes delete reversible (inverse = flip `deletedAt` back to null, §5.4) so cascade-undo restores a whole subtree with original ids and nothing dangles, and it is the remove-wins tombstone a future CRDT requires.

#### User
- `id` (internal, mapped from Clerk `sub`), `displayName`, `defaultRole` (`leader` | `follower` | `coach`), `identityColor` (hex, user-chosen, **global across all their routines** — attributes their notes consistently).

#### Routine
- `id`, `title`, `dance` (enum, §3.6), `createdAt`, `updatedAt`, `createdByUserId`, `templateOf` (nullable — marks the read-only sample/templates), `copiedFromRoutineId` (nullable — provenance for "save a copy"; no live link), **`schemaVersion`** (int — the data-model version this routine was written under; the planned offline-read cache and import/migration ladder key on it, §8).
- Derived: `barsPerRole` (meter-based: **`bars = ceil(maxBeat / beatsPerBar)` per role**, where `maxBeat` is the highest beat used in that role's chart; a partial/incomplete final bar displays as-is, §3).
- `dance`-derived display color.
- **Owns** an ordered list of Sides.

#### Side
- `id`, `routineId`, `kind` (`long` | `short` | `corner`), `sortKey` (fractional index for stable order).
- **Owns** an ordered list of Figures.
- **The ordinal display name is computed, not stored.** "1st Long Side", "Corner 2", etc. is derived from the side's position among same-`kind` sides in current order, so deleting a side **renumbers** the rest automatically. (No `name` column to keep in sync.)
- Sides apply to **travelling** dances (all v1 dances are travelling). The `travelling` flag lives on the dance metadata for forward-compat; for a future spot dance, a routine could use a single implicit side. Not built in v1.

#### Figure
- `id`, `sideId`, `name`, `source` (`library` | `custom`), `libraryFigureId` (nullable), `sortKey`.
- **Alignment (per-figure, new):** `entryAlignment` and `exitAlignment`, each a pair `{ qualifier: facing | backing | pointing, direction: LOD | ALOD | wall | centre | DW | DC | DW_against | DC_against }` (ISTD-style; §3.8). Nullable (optional to fill).
- **Owns TWO ordered step lists:** `leaderSteps[]` and `followerSteps[]` (see Step + the two-chart decision below).
- Derived: `isCustom`, per-step `threadCount` (per role).
- **Position forward-compat:** a figure's position is the pair `(sideId, sortKey)`. v1 only reorders *within* a side. If cross-parent move is ever added, write position as a **single atomic value** (both `sideId` and `sortKey` in one op) so a move can't half-apply. `sortKey` keys append the creating **actor's id as a tiebreak** for deterministic ordering under future concurrent inserts; v1 uses a generous key space and **never rebalances**.

##### KEY MODEL DECISION (LOCKED) — two step charts per figure
Every figure holds **two independent, authoritative step charts**, one per role. They are **not necessarily 1:1**: the follower may have steps the leader does not (e.g. a heel turn) and vice versa. Each chart is its own ordered list of Steps with its own counts, footwork, sway, turn, etc.

**Authoring UX (locked):** each person defaults to viewing **their own role's** chart. **During entry, both charts are shown side-by-side and the follower's values are pre-filled equal to the leader's, then the user edits the differences.** This makes the common case (mirrored/identical detail) cheap while supporting genuine divergence. Pre-fill is a one-time seeding convenience at step-creation, not a live binding — once seeded the two charts are independent.

#### Step
- `id`, `figureId`, **`role` (`leader` | `follower`)**, `sortKey`, `action` (free text, e.g. "LF forward"), `timing` (see below), and the **core technique slots** as **typed Drizzle columns** (hybrid storage, not EAV): `rise`, `body` (position) + `bodyActions` (CBM/CBMP set), `foot`, `sway`, `turn` — all nullable. Their keys, cardinality, allowed values, and dance/role applicability come from the **SLOT_REGISTRY** (`domain/vocabulary.ts`, §3), the single source of truth.
- **Reserved (not built) extensibility seam:** a documented `stepAttributes(stepId, slotKey, value)` side table for *future non-core* slots (e.g. Alignment-per-step, Lead) so they can land **without a Step migration**. v1 builds none of it — the seam is described, the table is not created. Registry entries mark `storage: "column"` (the core 5) vs `storage: "attribute"` (future).
- Derived: `n` (1-based index within its role's chart).
- **`timing` (meter-based, replaces the broken bar rule):** `{ beat: number, sub?: "e" | "&" | "a", value?: beatValue }` where `beat` is the continuous position within a two-bar phrase (1–6 for 3/4 dances, 1–8 for 4/4), `sub` is an optional subdivision marker, and `value` is the optional beat-value the step occupies (e.g. S = 2 beats, Q = 1). **Bars derive from the dance's meter:** for a 3/4 dance a bar = 3 beats, so beats 1–3 are bar 1 of the phrase and 4–6 bar 2; for 4/4, 1–4 / 5–8. Bar/timing derivation runs **per role** (the two charts can have different step counts but share the same phrase meter). *(Owner-confirmed — this is a locked requirement, not an open question.)*
- **Turn** is a property of the step (the amount of turn occurring on/into this step), matching the wireframe; no separate feet-vs-body amount in v1.

#### Thread + Comment
- **Thread**: `id`, `routineId`, `anchor`, ordered Comments. **Anchor (new, role-aware):** `{ type: "step", figureId, role, stepId }`. Threads attach to a step **in a specific role's chart** (a correction is usually role-specific). A figure-level thread is **not** modeled in v1 (figure-level discussion goes in the journal via figure links).
- **Comment**: `id`, `threadId`, `authorId`, `createdAt`, `text`. (No separate `targetRole` field — the anchor already carries the role.)
- Comments are **shared and visible to all members** of the routine.

#### Journal Entry
- `id`, `authorId`, `kind` (`lesson` | `practice`), `who` (free label: "Anna", "solo", "w/ Lena"), `createdAt`, `text`, `links[]` (see Link), `tags[]` (free-text themes: "frame", "musicality"), `media[]` (v1.1; §6).
- Per-user, **visible to co-members** of the routine it links to. Authorship/color via `identityColor`.
- A v1 journal entry links **within a single routine** (keeps queries simple).

#### Link (trimmed)
v1 supports exactly two anchor shapes, both routine-scoped:
- `{ type: "step", figureId, role, stepId }` — a specific step in a role's chart.
- `{ type: "figure", figureId }` — a whole figure (all roles, all steps).

The wireframe's 9-cell polymorphic model (attribute anchors × dance/global scopes) is **dropped** (§10). The two shapes cover the validated need; more is YAGNI.

#### Membership (sharing / ACL)
- `routineId`, `userId`, `role` (`editor` | `coach`), `createdAt`.
- **`editor`** = full co-edit (both partners). **`coach`** = view + comment. There is no single "owner" gate on editing; the routine creator is an editor like the other partner. (Whether a coach may edit *tags* specifically is a minor open question — default **comment-only**, Q-D6.)
- Routine deletion / member removal is restricted to editors.

#### EditOp (op-log — undo today, the CRDT seam tomorrow)
The op-log is shaped once to serve **three** consumers: v1 undo, the future CRDT sync engine, and any new op kind (added via the registry, below). Fields:
- `id` (client ULID), `routineId`, `actorId`, **`clock`** (a Lamport / hybrid-logical clock for causal ordering — the seam the future CRDT merges on), **`seq`** (server-assigned monotonic-per-routine projection — the **ordering authority in v1**, *not* the op's identity), `createdAt`, `kind`, `forward`, `inverse`, **`footprint`**, `undone` (bool).
- **`forward`/`inverse` are structured, self-describing diffs** — `{ entityType, id, field, before, after }` (or a small list for compound ops) — **not opaque blobs**. This is what lets undo, audit, and a future merge all read an op without bespoke code per kind.
- **`footprint`** = the set of entities the op touched, each with its `versionBefore`. It is what the unified undoability rule (§5.4) checks.
- **Op registry:** each op `kind` is one entry in a registry describing how to apply, invert, and compute the footprint. **New op kinds add a registry entry and touch nothing in the undo machinery.**
- **Retention contract (important):** the op-log is **NOT the source of current state** — the D1 entity rows are. There is **no replay-on-load**; reads hit the rows directly. The log exists for undo/redo and future sync. **Snapshot/prune** of old ops is a planning detail (Q-S2-adjacent), safe precisely because state never depends on replaying the log.
- Appended on **every** structural/tag/delete mutation. Powers **per-user undo + redo** (§5.4). What counts as one undoable "action" is the granularity question (Q-S2).

### 2.2 Entity-relationship summary

```
User 1──* Membership *──1 Routine 1──* Side 1──* Figure
                                  │                  ├── leaderSteps[]   1──* Step(role=leader)
                                  │                  └── followerSteps[] 1──* Step(role=follower)
                                  │                                            │
                                  │                            Thread(anchor: figureId+role+stepId) 1──* Comment
                                  ├──* JournalEntry *──* Link ──▶ {step in a role chart | figure}
                                  └──* EditOp (append-only op-log, per-user undo)

LibraryFigure (static reference, per Dance; carries default leader+follower charts) ──▶ instantiated into Figure
```

### 2.3 Storage placement
**Everything is in D1** (Drizzle-typed). There is no Durable Object and no separate live store. The routine list is a plain indexed D1 query; a routine's full tree (sides → figures → both step charts → threads/comments + its journal entries) is loaded via Hono RPC. Static reference data (dance metadata, figure catalog with default charts, technique vocabularies) ships in the client bundle.

---

## 3. Controlled Vocabularies / Enums

### 3.0 SLOT_REGISTRY — the single source of truth
All technique-slot vocabulary lives in **one** module, `domain/vocabulary.ts`, the **SLOT_REGISTRY**. Each entry:

```
{ key, label, color, cardinality: "single" | "multi",
  values: [{ value, label, aliases?: [...] }],
  appliesToDances: [...],   // omit a dance to hide the slot for it
  appliesToRoles:  [...],   // both roles by default
  storage: "column" | "attribute" }   // core 5 = column; future = attribute
```

The **tag editor, Lanes view, Info-sheet glossary, chips, and Zod validation all DERIVE from this registry** — there is no separately-maintained glossary to hand-reconcile (this is what finally retires the v1 Info-sheet-vs-editor inconsistency: the editor *is* the registry, the Info sheet *reads* it). Two forward-compat behaviors are baked in:
- **`appliesToDances` retires `hasRiseFall`.** Tango simply isn't in rise's `appliesToDances`, so the rise slot is absent for Tango with no special-case boolean anywhere.
- **Forward-compatible reads.** The registry carries a **version** and per-value **aliases**; an unknown enum value (e.g. read from an older export or a newer client) **passes through rather than hard-failing**, and known aliases normalize (e.g. **`CBP` → `CBMP`**). Validation rejects only on write of an unknown value, not on read.

The subsections below specify the registry's v1 contents. The Tag editor remains the canonical authority for selectable values; values still needing a dancer/coach are marked **[confirm]**.

### 3.1 Rise & Fall (`rise`) — color `#1f8a5b`
Canonical values (7): `commence`, `body_rise`, `foot_rise`, `up`, `continue`, `lowering`, **`NFR`** (no foot rise — *owner-confirmed addition*).
- **Tango suppresses this slot entirely** — expressed by omitting Tango from rise's `appliesToDances` in the SLOT_REGISTRY (no `hasRiseFall` boolean). `body lower` remains **[confirm]** (rare).

### 3.2 Body — position + body-action (`body` / `bodyActions`) — color `#8a5cab`
Modeled as **two independent fields** (owner: flexible, pending coach):
- **Position** (single-select): `closed`, `promenade` (display "Promenade (PP)"), `wing`. **[confirm]** completeness.
- **Body-action** (multi-select, possibly empty): `CBM` (body action), `CBMP` (foot position). The wireframe's **"CBP" is treated as a suspected typo for CBMP** — **[confirm] (Q-D4)**. The domain reference is explicit that CBM and CBMP are distinct and a step may have either/both/neither, which is exactly why this is two fields.

### 3.3 Footwork (`foot`) — color `#a9742c`
Canonical values (5): `HT`, `T`, `TH`, `heel_pull`, **`H`** (bare Heel — *owner-confirmed addition*).
- Broader set (`B`, `F`/`WF`, `BH`, `IE`/`OE`) remains **[confirm]/deferred** — additive.

### 3.4 Sway (`sway`) — color `#c0563f`
Canonical values (3): `to_L`, `to_R`, `none`. Stable.

### 3.5 Turn (`turn`) — color `#5b6b8a`
Canonical values (8): **`eighth_L` (⅛, 45°)** + **`eighth_R`** (*owner-confirmed additions*), `quarter_L` (¼), `quarter_R`, `three_eighth_L` (⅜), `three_eighth_R`, `half_L` (½), `half_R`, `none`.
- Finer magnitudes (⅝, ¾) remain **[confirm]/deferred**.

### 3.6 Dance (`dance`)
v1 ships **International Standard / Smooth (travelling) only**: `waltz`, `viennese_waltz`, `quickstep`, `foxtrot`, `tango`. Each carries metadata: display color (Waltz blue, Quickstep green, Foxtrot purple, Tango red, Viennese blue-gray), `timeSignature`, `beatsPerBar` (3 for Waltz/Viennese; 4 for Foxtrot/Quickstep/Tango), `phraseBeats` (6 or 8, the two-bar phrase used by timing §2.1), `travelling: true`. (Which slots apply to which dance — e.g. Tango having no rise — lives in the **SLOT_REGISTRY** `appliesToDances`, §3.0, not on the dance record.) Latin/spot dances → v1.1; the `travelling` flag is present so they slot in without a migration.

### 3.7 Small fixed enums
- Side kind: `long` | `short` | `corner`.
- Membership role: `editor` | `coach`.
- Step role: `leader` | `follower`.

### 3.8 Alignment (per-figure, new)
Each Figure carries optional `entryAlignment` and `exitAlignment`, a pair:
- **Qualifier:** `facing` | `backing` | `pointing`.
- **Direction:** `LOD` | `ALOD` | `wall` | `centre` | `DW` | `DC` | `DW_against` | `DC_against`.

Reads e.g. "Facing Diagonal to Wall". This is the main column real ISTD charts carry; the owner placed it at **figure** grain (entry + exit) rather than per-step for v1 — choreographers think per-figure at the joins, and it keeps the per-step tag editor focused. Per-step alignment remains deferred.

---

## 4. Features by Screen

Each screen scaled to complexity; **v1** vs **deferred** marked. Items the wireframe stubs/omits but a real app needs are called out.

### 4.0 Cross-cutting (wireframe omits; v1 must design)
| Capability | Wireframe state | v1 decision |
|---|---|---|
| Auth / onboarding | absent | **v1.** Clerk hosted sign-in (Google + passkeys). Onboarding: displayName, default role, identity color. |
| Account / settings | absent | **v1 minimal.** Edit displayName/role/color; sign out. No theme settings (editor-only props dropped). |
| Delete flows | absent | **v1** for routine, side, figure, step, journal entry; comment delete = author-only. Confirm dialogs. |
| Reorder UX | append-only | **v1** — figures and steps reorderable within their parent (within a role's chart) via `sortKey`. Side reorder deferred. |
| Step add/edit/remove | only whole-figure add | **v1** — add/edit/remove steps within a figure's chart, edit timing/action. Core authoring. |
| **Undo** | absent | **v1 required** — per-user, per-action (§5.4). |
| Search | absent | **v1** routine-list search by title/dance (indexed D1). Journal search deferred. |
| Invite | toast only | **v1** invite by link (signed token → Membership). Email invite deferred. |
| "Duplicate" | toast only | **v1** = save-a-copy (deep copy, provenance only; §5.3). Not an edit mechanism. |
| Media | "coming soon" | **v1.1** (§6); model carries `media[]`, UI shows "coming soon". |
| Sample/template | n/a | **v1** read-only sample routine + start-from-template. |
| Export/import | n/a | **v1** JSON export AND import (§8). |

### 4.1 Routine List (`scList`) — Choreo tab, default
- **v1:** list routines the user is a member of (indexed D1 query). Card: dance-color icon, title, `dance · barLabel · created`, chevron. Tap → Assemble. "+" → New Choreo sheet. **Empty state** (wireframe lacks one): show the sample routine + "start from template". Title/dance search.

### 4.2 Assemble (`scAssemble`) — routine overview
- **v1:** sides → figures view; collapsible side headers with derived bar labels; figure cards (name, custom badge, count summary, **entry/exit alignment** chips, tap → Figure Timeline). "Add figure" → Add-figure sheet; "add side" → inline Long/Short/Corner picker (auto-naming). Reorder/delete figures within a side. Share button → Share. **Role toggle** (leader/follower) sets which chart's summary chips show; defaults to the viewer's own role.
- **Edit access:** any `editor` member edits freely (both partners). A `coach` sees read + comment affordances only.
- Reading-vs-editing as separate modes is collapsed — editors just edit; the only gate is the membership role.

### 4.3 Figure Timeline (`scFigure`)
- **v1 step list:** rows per step (timing, action, thread badge, the five slot chips, expand). Tapping a row opens Step Detail. **Add/remove step, edit timing/action.** **Role view** (leader | follower | **both side-by-side**); "both" is the pre-filled side-by-side entry mode (§2.1).
- **v1 Lanes view (REINSTATED):** one technique dimension across all steps at once — the fast cross-step tagging surface (e.g. set sway for every step in a column). Per role. Lanes (which dimensions exist, their values, cardinality) are **derived from the SLOT_REGISTRY** (§3.0).
- **Alignment:** edit the figure's entry/exit alignment here.

### 4.4 Step Detail + Tag Editor (`scStep`) — the hero flow
- **v1:** "Tag · step N (leader|follower)"; step card (timing, action, figure name, thread button → thread). Slot sections are **rendered from the SLOT_REGISTRY** (§3.0) — which slots appear (Rise absent for Tango via `appliesToDances`), their values, and single- vs multi-select (chips) all derive from the registry, not hardcoded UI. Re-tapping clears. Edit timing/action. Optimized for speed (large touch targets, minimal taps, keyboard-free).

### 4.5 Thread (`scThread`)
- **v1:** per-step thread (role-aware anchor); people legend; comments with author-color border, "Name (role) · time", text; reply bar. Comment delete (author-only). Any member (editor or coach) may post. Deferred: comment editing, read/unread, notifications, threading depth.

### 4.6 Share (`scShare`)
- **v1:** member list (name, role: editor/coach). Invite by link (signed token; inviter picks editor/coach). Remove a member (editor-only). "Duplicate" button → save-a-copy (§5.3). Explanatory card rewritten: *"Both partners can edit this routine together. Coaches can view and comment. Notes are shared with everyone on the routine."* (replaces the old fork microcopy). Deferred: transfer/ownership concepts (no owner gate), per-member fine-grained access.

### 4.7 Journal List (`scJournal`) — Journal tab
- **v1:** entries (author avatar, "Kind · who", date, text, tag chips). Tap → editor. "+ entry". Functional filter chips **all / lessons / practice** (client filter). **`by figure` filter is v1** (figure links exist now). Empty state. Journal search deferred.

### 4.8 Entry Editor (`scEntry`)
- **v1:** author row; textarea; LINKED TO list with add/remove; save. **Link picker supports step links AND figure links** (4.9). Media row (voice/photo/video) → "coming soon" (v1.1).

### 4.9 Link Picker (`lpOpen`)
- **v1:** two paths — (a) **step:** side → figure → **role** → step; (b) **figure:** side → figure. Scope is implicitly the current routine. The attribute anchors and dance/global scopes are dropped (§10).

### 4.10 Profile (`scProfile`) — Profile tab
- **v1:** identity (avatar, name, role); **editable** name and default role; note-color picker with live preview ("Each member picks their own colour; consistent across every routine"). Sign out. Compute the shared-routine count (no hard-coded literal). Deferred: themes/backdrop.

### 4.11 Overlays
- **Add-figure sheet (v1):** dance-filtered library list, filter input, "+" to add (instantiates the figure with its catalog default **leader + follower** charts, or a generic placeholder for custom). Empty state. "Create my own figure" → compose (name + placeholder steps for both roles).
- **New Choreo sheet (v1):** 5 Standard dance chips, name input, create → Assemble. Plus "start from template".
- **Info sheet (v1-lite):** per-slot name + value list **read from the SLOT_REGISTRY** (§3.0) — never a separately-maintained glossary; terse copy. Full teaching glossary deferred.
- **Toast (v1):** transient confirmations, including **"Undone"** with the action name.

---

## 5. Collaboration & Permissions Model

### 5.1 Rules (revised)
1. **Both partners co-edit ONE routine.** There is no owner-only structure and no fork-to-edit. Editing is shared among `editor` members.
2. **Notes/comments are shared and visible** to all members.
3. **Coaches view + comment**, do not edit structure/figures/steps (tag-edit by coach is **Q-D6**, default no).
4. **Identity color is per-user and global**, attributing every note consistently.

### 5.2 Roles & access
| Role | Can do |
|---|---|
| `editor` (both partners) | Create/edit/delete sides, figures, steps, tags, alignment; comment; journal; invite/remove members; delete routine; undo own actions. |
| `coach` | View everything; comment; journal; (tag-edit: default no — Q-D6). |

No single owner gate. The creator is an `editor` like their partner. Member removal and routine deletion require `editor`.

### 5.3 "Duplicate" = save a copy (not an edit path)
- Deep copy of the routine (sides, figures, **both charts**, tags, alignment) into a new routine; `copiedFromRoutineId` set for provenance only. The copier becomes an `editor` of the new routine.
- Comments/threads and journal entries are **not** copied (fresh artifact). **[confirm] Q-D5.**
- **No live link, no merge-back, no diff** (out of scope). This is just a convenience for "try a variation" — the *edit* path is direct co-editing of the shared routine.

### 5.4 Concurrent editing & undo (server-authoritative, LWW)

This replaces v1's entire CRDT/two-zone analysis. Because v1 is **online-only and server-authoritative**, concurrency is simple:

- **Every mutation is a request to the Worker**, which validates permission, applies it to D1, **appends an `EditOp`** (structured forward + inverse + footprint, §2.1), bumps `routine.updatedAt`, and returns the new state. The server is the single source of truth.
- **Last-write-wins on conflict:** if two editors change the same field near-simultaneously, the later-arriving write wins (defined, deterministic outcome — there is no merge). Edits to *different* fields/steps are independent and both persist. Acceptable because (a) only 2–3 people, (b) they are co-present and talking, (c) the grain is fine (a single slot/field).
- **Delete is soft (§2.1):** a delete op sets `deletedAt`; its `inverse` flips `deletedAt` back to null. A figure delete cascades to its steps/threads/comments/links as a **compound op** (one footprint), so undoing it restores the whole subtree with original ids.
- **Live refresh (lightweight):** clients poll or use a cheap Server-Sent-Events tick on `updatedAt` to refetch a changed routine. **No WebSocket, no CRDT.** Near-real-time is a nice-to-have, not a correctness requirement (Q-S1).
- **Undo (required, per-user) — unified undoability rule:** the op-log lets a user undo their own last not-yet-undone op. Undo applies the op's `inverse` as a **new** forward op (the undo is itself logged). **An op is undoable iff no later not-yet-undone op — by ANY user — touches any entity in its `footprint`.** This single rule:
  - reduces exactly to the v2 "changed since" check for a plain field edit (no regression);
  - correctly handles **cascade-delete** (the whole subtree's entities are in the footprint);
  - correctly handles the **cross-user dangling case** — A adds a figure, B tags a step inside it; A's undo-of-add is **refused** because B's later op touches an entity in A's footprint. (Otherwise B's comment/tag would dangle on a removed figure.)
  When undo is refused, the user gets a clear message ("can't undo — changed since by Lena").
- **Redo is an explicit per-user cursor**, not "undo the undo" (which is incoherent with 2+ interleaving users). Each user has a redo stack of *their own* just-undone ops; a fresh non-undo edit by that user clears their redo cursor.
- Op-log granularity (what is one "action") is **Q-S2**.

### 5.5 Invites
- An `editor` generates a signed, expiring **invite token** (link). Redeeming it (authenticated) creates a `Membership` with the role the inviter chose (`editor` | `coach`). An `editor` can remove a member.

---

## 6. Media (deferred to v1.1)

Not in v1. The model carries `media[]` on Journal Entries and the UI shows "coming soon". When built (v1.1): R2 with Worker-issued **presigned PUT URLs** (bytes go browser→R2 directly, zero egress); client-side compression; entry metadata holds the R2 object key. Because the app is online-only, there is no background-sync/deferred-upload machinery — upload happens inline while online. **Q-M1/Q-M2/Q-M3** cover types, caps, and which entities.

---

## 7. Architecture

Lean, online-only, server-authoritative. Single relational store.

```
[ React 19 + Vite PWA ]   (vite-plugin-pwa: installable app-shell only — NOT offline data)
   • Clerk client (session JWT)
        │  HTTPS — Hono RPC (typed) + Zod      ▲ optional SSE tick on updatedAt (live refresh)
        ▼                                       │
[ Worker ]  Workers Static Assets (serves SPA) + Hono API
   • Clerk JWT verify (networkless, edge)   • permission checks   • op-log append   • invite tokens
        │
        ▼
[ D1 (Drizzle) ]  single source of truth: users, memberships, routines → sides → figures → both step charts,
                  threads/comments, journal entries + links, EditOp log
        (R2 for media → v1.1)
```

### 7.1 Component boundaries (small, independently testable)
- **`domain/`** — pure TypeScript, no I/O: the **SLOT_REGISTRY** (`vocabulary.ts`, §3.0), `sortKey` generation, **meter-based timing & per-role bar derivation**, side ordinal computation, **two-chart pre-fill seeding**, the **op registry** + **op apply/invert/footprint + undoability rule** (§5.4), deep-copy (save-a-copy), the **schemaVersion migration ladder**, Zod schemas. Fully unit-testable.
- **`worker/`** — Hono routes (RPC), Clerk middleware, **permission enforcement**, Drizzle/D1 access, op-log append, invite tokens, (R2 presign in v1.1).
- **`store/` (client repository seam — v3):** the client accesses data **only** through this thin layer, which presents typed **reactive-read + mutate** functions. **Components never import the Hono RPC client directly.** v1 implements `store/` over RPC + a cache (e.g. TanStack Query); the planned offline-read cache and the future CRDT engine **swap the implementation behind the same interface** without touching components. This is the key seam that keeps the online-only v1 from hard-coding assumptions the local-first future would have to unwind.
- **`client/`** — React components (presentational), reading/mutating via `store/` (not RPC directly), service worker for installability.
- **Shared `contract/`** — Zod schemas + Hono RPC `typeof app` export, imported by client and worker for end-to-end types.

### 7.2 Data flow
1. Client authenticates with Clerk → holds session JWT.
2. All reads/writes go through Hono RPC over HTTPS; the Worker verifies the JWT, checks D1 Membership/role, and reads/writes D1.
3. Every mutation appends an `EditOp` and bumps `routine.updatedAt`; the client may optimistically apply and then reconcile with the server's authoritative response (LWW).
4. Optional SSE tick notifies other connected clients that a routine changed; they refetch.

This is deliberately boring — the smallest moving-part design that meets the requirements, which is exactly the "quality & maintainability over features" the owner asked for.

---

## 8. Non-Functional Requirements

- **Performance:** mobile-first; app shell interactive < ~2s on a mid-range phone over 3G (precached shell). Routine list is an indexed D1 query. Routine load is one RPC fetching the tree; **index every query and guard with `EXPLAIN QUERY PLAN` in CI** to avoid the D1 rows-scanned cost trap.
- **Connectivity:** v1 requires connectivity for all data operations (online-only). The app shell loads offline (installable PWA) but shows a clear "you're offline" state for data. Offline *read* is the planned v-next increment.
- **Cost ceiling:** **$0/mo at hobby scale** (Cloudflare Workers + D1 free tiers; Clerk 50k MRU). No DO/WebSocket duration to worry about. $5/mo Workers Paid lifts the 100k req/day cap if ever needed.
- **Accessibility:** WCAG AA — color never the *only* signal (slots and identity carry labels/initials); touch targets ≥ 44px; keyboard/screen-reader navigable; reduced-motion respected.
- **Browser/PWA:** evergreen mobile (iOS Safari, Chrome Android) + desktop; installable (manifest + service worker for shell).
- **Data ownership:** **JSON export AND import** of a routine (structure + both charts + comments + linked journal) — round-trippable so export is a *restorable* backup, not a dead artifact. The export **envelope carries `schemaVersion`** (matching the Routine row, §2.1). **Policy:** import runs a **migration ladder keyed on `schemaVersion`** (each step upgrades one version) before validating; a future sync engine **refuses to merge a client below a declared minimum `schemaVersion`** rather than risk a bad merge. Unknown technique-slot values survive a round-trip via the registry's pass-through/alias rule (§3.0).
- **Ops:** **Sentry (or Tail Workers)** for error monitoring; **staging + prod** environments; CI runs the test layers (§9) and the `EXPLAIN QUERY PLAN` check.

---

## 9. Testing Strategy

Rewritten for the lean, online-only stack. The deleted CRDT/offline-merge surface removes the old two-client offline tests. **New highest-risk areas: the unified undo/op-log footprint logic (incl. soft-delete cascade restore and the cross-user dangling refusal), two-chart data integrity, and Worker-side permission enforcement.** Concurrency is now LWW (deterministic), so it is tested for a *defined outcome* rather than merge survival. The SLOT_REGISTRY and op registry are pure-`domain/` modules, so most of the new v3 surface is fast unit-tested.

### 9.1 Unit (Vitest) — pure `domain/`
- **Meter-based timing & per-role bar derivation:** beats 1–6 / 1–8 map to the right bars per dance; sub-beat markers parse; per-role derivation handles charts of *different* lengths.
- **Two-chart pre-fill seeding:** creating a step seeds the follower equal to the leader; subsequent edits to one chart do **not** mutate the other (independence).
- **Op apply/invert/footprint + unified undoability rule (highest-risk):** every op kind has a correct inverse and footprint; apply-then-invert restores prior state; the rule "undoable iff no later non-undone op touches the footprint" — verify it (a) reduces to "changed since" for a plain field edit, (b) refuses the **cross-user dangling case** (A adds figure, B tags inside, A's undo-of-add refused), (c) allows undo when later ops touch *disjoint* entities; **per-user redo cursor** (own undone ops, cleared by a fresh edit); a **new op kind** added via the registry needs no change to the undo engine.
- **Soft-delete / cascade restore:** delete sets `deletedAt` (no row-drop); inverse restores; figure-delete cascade restores the whole subtree (steps/threads/comments/links) with **original ids**, nothing dangling.
- **Client-ID & ordering:** ULID/UUIDv7 are sortable & collision-free; `sortKey` ordering (insert-between, ends, repeated same-gap inserts stay distinct, actor-id tiebreak).
- Side **ordinal computation** (renumbers on deletion; not stored).
- Deep-copy (save-a-copy): copies both charts + tags + alignment, sets `copiedFromRoutineId`, omits comments/journal, regenerates ids.
- **SLOT_REGISTRY-derived validation (Zod):** confirmed additions valid (`NFR` rise, `H` foot, `⅛` turn); body position vs body-action separation; **Tango → rise slot absent via `appliesToDances`** (no `hasRiseFall`); **alias normalization `CBP`→`CBMP`** and **unknown-value pass-through on read** vs reject-on-write.
- **schemaVersion migration ladder:** an older-version export migrates step-by-step to current and validates; the ladder is idempotent at the current version.

### 9.2 Worker / D1 integration (`@cloudflare/vitest-pool-workers`, real bindings)
- Hono routes against real D1 with `applyD1Migrations()`: create routine; add side/figure/step (both charts); set slot; reorder; delete — each writes the row(s) **and** an `EditOp`.
- **Permission enforcement (high-risk):** a `coach` mutating structure/steps is **rejected**; commenting is **accepted**; a non-member is rejected entirely; an `editor` succeeds. (Coach-edits-tags gated by Q-D6.)
- **Undo/redo endpoints:** undo applies the inverse, logs the undo, marks the op undone; undo blocked by a later footprint-overlapping op returns the defined refusal; redo replays from the per-user cursor. Soft-delete delete→undo round-trips through real D1 rows.
- **LWW:** two sequential writes to the same field — second wins; writes to different fields both persist.
- Invite-token issue → redeem creates the correct Membership; expired token rejected.
- `EXPLAIN QUERY PLAN` assertion: list and routine-load queries use indexes (no full scans).

### 9.3 Component (Vitest browser mode + Testing Library)
- Tag editor against a seeded `store/` (the repository seam): chips reflect slot values; toggling updates; **slot sections render from the SLOT_REGISTRY** — Tango hides rise via `appliesToDances`; body position (single) vs body-action (multi) cardinality comes from the registry.
- **Two-chart UI:** role toggle switches charts; side-by-side entry pre-fills the follower; editing one side leaves the other unchanged.
- Lanes view sets a dimension across all steps.
- Coach sees no edit affordances; empty states render.

### 9.4 E2E (Playwright)
- Core authoring flow: create routine → add side/figure → tag steps in both charts → appears correctly.
- **Concurrent LWW (replaces offline-merge):** two browser contexts (two editors) edit the *same* field online → assert the defined last-write-wins result on both after refresh; edits to *different* steps both survive.
- **Undo correctness E2E:** user makes several edits, undoes their last, sees prior state; partner's interleaved edit is unaffected; undo of a field the partner since changed shows the refusal message.
- Permission E2E: a coach has no structural edit UI and a forged structural request is rejected by the Worker.
- Export → import round-trip reproduces the routine.

### 9.5 Contract (Hono RPC + Zod)
- Compile-time: `typeof app` typed client catches drift. Runtime: shared Zod schemas validate payloads both ends; malformed op rejected with a typed error; CI fails if client/worker schema versions diverge.

### 9.6 Quality tooling / CI
TypeScript strict; ESLint+Prettier (or Biome); Drizzle typed D1; Sentry/Tail Workers wired in staging+prod; CI runs all layers on PRs plus the `EXPLAIN QUERY PLAN` guard. Target: **every undo, two-chart, and permission edge case has a unit or `vitest-pool-workers` test.**

---

## 10. Out of Scope (v1) — explicit YAGNI cuts

- **Offline-first / offline data** (CRDT, Durable Objects, WebSocket sync, IndexedDB data store) — online-only; offline *read* is the planned v-next increment.
- **Fork-to-edit / fork lineage / merge-back / diff** — replaced by shared co-editing; "Duplicate" is a plain copy.
- **Latin / spot dances** — `travelling` flag present; v1 ships Standard only.
- **Per-step alignment**, separate feet-vs-body turn amounts, richer footwork/turn magnitudes beyond the confirmed set.
- **Attribute-anchored journal links** and **dance/global link scopes** — only step + figure links, routine-scoped.
- **Cross-routine journal entries**, journal search.
- **Media attachments** (voice/photo/video) — v1.1.
- **Notifications, read/unread, comment editing, threading depth.**
- **Precede/follow figure compatibility validation**, syllabus-system attribution (ISTD/IDTA/WDSF/American), amalgamations as a first-class entity.
- **Themes/backdrop settings**, multi-owner concepts, per-member fine-grained access editing.
- **Native app wrapper.**

---

## 11. Open Questions & Decisions Needed

Resolved items are marked ✅ and kept briefly for traceability; the live list is short and sharp. Starred (★) items still block the data model.

### ✅ Resolved by the owner (v2)
*(v3-resolved extensibility items are grouped in their own block below.)*
- ✅ **One vs two step charts** → **two** (independent, role-keyed, side-by-side pre-fill entry).
- ✅ **Turn as step property** → yes (no feet-vs-body split).
- ✅ **Alignment** → **per-figure** entry + exit (not per-step).
- ✅ **Enum additions** → Heel, ⅛ turn, NFR rise; Tango suppresses rise.
- ✅ **Editing model / "duplicate to edit"** → shared co-editing; "Duplicate" = save-a-copy. No CRDT, no two-zone, no fork lineage.
- ✅ **Sync model** → online-only, server-authoritative, LWW; offline deferred.
- ✅ **Undo** → required, per-user, per-action via op-log.
- ✅ **Journal links** → step + figure, routine-scoped (trimmed from the 9-cell model).
- ✅ **Scope** → Standard travelling dances only in v1; Latin → v1.1.
- ✅ **Lanes view / sample routine / export+import / Sentry / EXPLAIN-QUERY-PLAN CI** → in v1.
- ✅ **Timing model (Q-D3)** → confirmed: counts run continuously across a **two-bar phrase** — 1–6 for 3/4 dances (Waltz, Viennese Waltz), 1–8 for 4/4 dances (Foxtrot, Quickstep, Tango) — sub-beats `e`/`&`/`a`, bars derived from meter, derivation per role. Locked requirement (§2.1).

### ✅ Resolved by extensibility review (v3)
- ✅ **ID strategy** → client-generated ULID/UUIDv7 TEXT primary keys; no autoincrement (§2.1).
- ✅ **Delete semantics** → soft-delete tombstones (`deletedAt`); inverse restores subtree (§2.1, §5.4).
- ✅ **Op-log shape** → HLC clock + server `seq` + structured forward/inverse + footprint + op registry; log is not state, no replay-on-load (§2.1).
- ✅ **Undoability rule** → unified footprint rule (no later op touches footprint), subsumes "changed since", handles cascade + cross-user dangling; explicit per-user redo cursor (§5.4).
- ✅ **Vocabulary architecture** → single SLOT_REGISTRY; UI/validation derive from it; retires `hasRiseFall`; reserved (not built) `stepAttributes` seam; unknown-value pass-through + aliases (CBP→CBMP) (§3.0).
- ✅ **schemaVersion** → on export envelope + Routine row; migration ladder; minimum-version gate for future sync (§2.1, §8).
- ✅ **Client data access** → `store/` repository seam; components never touch RPC directly; CRDT-swappable later (§7.1).
- ✅ **Micro-defaults** → bar derivation `ceil(maxBeat/beatsPerBar)` per role; side ordinal computed (renumbers on delete); enum reconciliation owned by SLOT_REGISTRY (§2.1, §3.0).

### Still open
- **★ Q-D4 — Body position + body-action vocabulary (PENDING THE OWNER'S COACH).** Confirm the position set (`closed`/`promenade`/`wing` — complete?), that body-action is `CBM`/`CBMP` multi-select, and that **"CBP" was a typo for CBMP**. Why: wrong values teach incorrect technique; this is the one slot the owner explicitly left to a coach.
- **Q-D5 — Does "save a copy" carry comments/journal?** Default **no** (fresh artifact). Why: cheap to flip; affects user expectation.
- **Q-D6 — May a `coach` edit technique tags** (not structure), or comment-only? Default **comment-only**. Why: changes Worker permission checks and the coach's tag-editor affordances.
- **Q-S1 — Live-refresh mechanism & expectation.** Polling vs a lightweight SSE tick on `updatedAt`; is near-real-time expected or is manual/periodic refresh fine? Why: small infra choice; both are cheap and online-only.
- **★ Q-S2 — Op-log granularity (one "action" = ?).** Is a single slot-set one undoable action, or are rapid edits coalesced (debounced) into one? Does a multi-field edit (e.g. add figure with its steps) undo as one op or many? Why: defines undo UX and op-log size; central to the undo feature's feel. **Recommended default (to be confirmed during implementation planning):** (1) coalesce rapid edits to the *same field* within a short debounce window (~1s) into one undoable op; (2) a compound create (e.g. "add figure" that seeds both leader + follower step charts) undoes as **one** op, not many; (3) reorder of a single item is one op.
- **Q-A1 — Clerk lock-in tolerance.** Depend on Clerk long-term, or keep the auth boundary clean for a later swap (e.g. Better-Auth-in-Worker)? Why: dependency risk; recommended keep the boundary clean.
- **Q-A2 — Identity-color collisions.** Must members of a routine have distinct colors (warn on collision) or is overlap tolerated? Why: colors attribute notes.
- **Q-M1 — Media types (v1.1):** voice+photo+video, or voice+photo only? **Q-M2 — caps/retention.** **Q-M3 — media on journal only, or also comments/steps?** Why: R2 budget and scope for v1.1.
- **Q-SC1 — Latin/spot dances** target version, and **Q-SC2 — American Smooth/Rhythm** hybrid floor model later? Why: forward-compat planning; the `travelling` flag is already in the model.

---

*End of specification (v3).*
