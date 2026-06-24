# Extensibility Review — Adding New Step/Figure Attributes Over Time

**Axis:** How hard is it to add new technique attributes (enum values, whole slots, dance/role-conditional slots) to Ballroom Flow as the domain reveals more of itself?
**Reviewing:** `docs/superpowers/specs/2026-06-24-ballroom-flow-design.md` v2 against `research/domain.md` and `research/critique-domain.md`.
**Verdict:** The current model is *correct* for v1 content but *structurally hostile* to attribute growth, and the domain guarantees that growth. The fix is cheap now and expensive later. Adopt a **vocabulary/slot registry** (hybrid: keep the core slots as typed columns, but make the slot SET and per-dance/per-role applicability data-driven). Defer the generic EAV store.

---

## 0. Why this axis is real, not hypothetical

The spec already absorbed a wave of additions *during* v2 (NFR rise, bare Heel, ⅛ turn, two charts, per-figure alignment, Body split). `critique-domain.md` lists the *next* wave as concrete, not speculative:

- New **values** in existing slots: ⅝/¾/⅞ turn, `B`/`WF`/`BH`/`IE`/`OE` footwork, `body lower` rise, position values (`Outside Partner`, `Fallaway`, `Shadow`, `Wing` completeness).
- New **slots**: per-step **Alignment** (currently per-figure only — the critique calls this a likely future move), **Lead/Foot Position** (a real ISTD column, `domain.md` §2 #10), **Amount-of-turn body-vs-feet** ("body turns less"), **head/shape** for Latin.
- New **dance/role conditionals**: Tango has no rise (already special-cased as `hasRiseFall`); Latin v1.1 adds *different dimensions* (bounce, leg lines, spot vs travelling) and removes the side/corner model entirely; some attributes are role-only (heel-turn footwork is the follower's).
- **Beat-value** as a first-class per-step field (the critique's Q-NEW-4 fix) is itself a new slot landing soon.

So "add an attribute" is the single most frequent change this codebase will see post-v1. The design should optimize for it.

---

## 1. Ranked findings

### [MAJOR] E-1 — Adding a new SLOT is an N-place change because slots are fixed named columns *and* every consumer hard-codes the slot list.

`Step` (spec §2.1) has five named technique columns (`rise`, `body`, `bodyActions`, `foot`, `sway`, `turn`) plus `timing`. Adding a slot (say per-step `alignment`, or `lead`, or `beatValue`, or Latin's `head`) currently touches **every one of**:

1. **D1 schema + Drizzle** — new column, a migration on the most-referenced table (Step).
2. **Zod contract** (`contract/`, §7.1) — the Step schema, shared client/worker.
3. **Tag editor UI** (§4.4) — a new slot section, chip set, single/multi-select behavior.
4. **Lanes view** (§4.3) — a new per-dimension column/lane renderer.
5. **Info-sheet glossary** (§4.11) — "per-slot name + canonical value list."
6. **Step Detail / Figure Timeline chips** (§4.3) — the "five slot chips" row.
7. **Export/import** (§8) — round-trippable JSON must carry it.
8. **Op-log** (§2.1 `step.setSlot`) — the kind/forward/inverse must address the new slot.
9. **Tests** (§9.1/9.3) — enum validation, Tango-suppression, chip behavior.

The spec **names the slots independently in at least four of these places** (§2.1 schema, §3 vocabularies, §4.4 tag sections, §4.3 Lanes, §4.11 glossary). There is no single source of truth that says "these are the slots, here are their values, here is their selection cardinality, here is which dances/roles they apply to." That duplication is the core extensibility tax. (`critique-domain.md` §3.8 explicitly anticipates per-step alignment as a future move — i.e. this exact N-place change is already on the roadmap.)

### [MAJOR] E-2 — Dance/role applicability is hard-coded as ad-hoc booleans (`hasRiseFall`), not modeled as data, so each conditional attribute invents its own flag.

Tango's "no rise" is handled by a single boolean `hasRiseFall` on dance metadata (§3.6) that the UI must special-case (hide the rise section). This pattern does not generalize:

- Latin v1.1 will need "no sway-as-Standard," "has bounce," "has leg lines," "no side/corner" — each would become *another* bespoke boolean (`hasSway`, `hasBounce`, …) with bespoke UI branching. That is `hasRiseFall × N` flags, each touched in schema, UI, glossary, tests.
- **Role applicability** isn't modeled at all. `heel_pull` footwork is effectively follower-only; `domain.md` notes role-specific attributes. Today nothing says "this value/slot applies to role X," so role-specific vocabularies can't be expressed except by convention.

The right shape is **applicability-as-data**: a slot declares the set of dances and roles it applies to, and a vocabulary value can declare the same. Then "Tango has no rise" is a row, not a code branch, and Latin's new dimensions are config.

### [MAJOR] E-3 — Vocabularies ship hard-coded in the client bundle, coupling every value addition to a full app deploy and (worse) to persisted-data validation drift.

§2.3/§3 ship enums "in the client bundle." Adding an enum value (⅝ turn) means: edit the enum, redeploy client, redeploy worker (shared Zod), and ensure old persisted rows still validate. Because the **same Zod enum validates persisted data**, the enum is simultaneously (a) the UI's value list and (b) the storage validation boundary. Those have different lifecycles:

- **Tightening** (removing/renaming a value — e.g. resolving the `CBP`→`CBMP` typo, Q-D4) can make **already-saved rows fail validation** on read. The spec has no story for this; export/import (§8) round-trips raw values, so a renamed value silently breaks restore.
- **Loosening** (adding ⅝) is safe forward but means old clients (a PWA — cached service worker, §7) may receive a value they don't know how to render. PWA caching makes stale clients a *normal* condition, not an edge case.

This is low-severity now (small N, online-only) but it is the **direct precursor to the offline/CRDT problem** the spec defers (§10): once two clients can hold different vocabulary versions offline, an unknown enum value is a merge hazard. Designing the vocabulary as *versioned data with forward-compatible unknown-value handling* now is the cheap insurance.

### [MINOR] E-4 — `body` + `bodyActions` already proves the fixed-column model fragments under one real attribute.

The v2 Body split (one single-select `body` position + one multi-select `bodyActions`) is correct domain modeling (`critique-domain.md` D-3) but it shows the fixed-column model forces a *new column per cardinality variant*. The next multi-select attribute (e.g. multiple footwork annotations, or position + action for Latin) repeats this. A slot registry that carries `cardinality: single | multi` as a field absorbs this without new columns.

### [MINOR] E-5 — Op-log (`step.setSlot`) and JSON export schema are slot-aware; a registry keeps them generic.

The undo op `step.setSlot` (§2.1) and the export format (§8) both enumerate what a "slot" is. If slots are registry-driven and stored as `(stepId, slotKey, value)` the op kind becomes `step.setAttribute{slotKey, value}` once, and export iterates the registry — neither needs editing per new slot. With fixed columns, both grow per attribute.

---

## 2. The three extension scenarios, costed

| Scenario | Today (fixed columns + hard-coded enums + duplicated slot lists) | With recommended registry (hybrid) |
|---|---|---|
| **2a. New enum VALUE in existing slot** (⅝ turn, `WF` foot) | Edit enum in bundle → redeploy client **and** worker (shared Zod) → glossary list updated separately → tests. Persisted-data risk only on *rename*, not add. **Medium-low cost, but touches 3–4 places.** | Add one row to the value table for that slot. Zod derives from registry; glossary, chips, Lanes all read the registry. **One edit. Config, not code.** |
| **2b. New whole SLOT** (per-step alignment, lead, beatValue, Latin head) | **9-place change** (E-1 list): migration on Step, Zod, tag editor section, Lanes lane, glossary, chips, export, op-log, tests. **High cost, recurring.** | If core-typed: one typed column + one registry entry + a generic slot-section renderer already iterating the registry. If non-core: a single attributes-table row type — **zero migration**. **Low–medium, mostly config.** |
| **2c. Dance/role-conditional slot** (Tango no rise; Latin new dims; follower-only values) | A bespoke boolean per condition (`hasRiseFall`, future `hasBounce`…), each special-cased in UI + glossary + tests. Role applicability not expressible at all. **High and non-uniform.** | Slot/value rows carry `appliesToDances[]` / `appliesToRoles[]`. "Tango no rise" = data. UI filters the registry by `(dance, role)`. **Low, uniform.** |

---

## 3. Fixed columns vs generic attribute model vs hybrid

**Generic EAV** (`Step` owns an `attributes: Map<slotKey, value>` table, no named columns) maximizes add-cheapness but loses type-safety (every read is `attributes["sway"] as Sway | undefined`), complicates indexing/query (can't index a column you don't have), and inflates the testing burden (no compiler check that a slot is handled). For a **small relational D1 app that values type-safety and maintainability** (owner constraint #6), pure EAV is the wrong trade — it pushes correctness from compile time to runtime exactly where the spec wants strictness (§9.6 "TypeScript strict").

**Pure fixed columns** (status quo) gives best type-safety and query, worst add-cost (E-1/E-2).

**Recommended: HYBRID — typed core columns + a data-driven slot/vocabulary registry that *describes* them and gates applicability.**

- Keep the v1 slots (`rise`, `body`, `bodyActions`, `foot`, `sway`, `turn`, `timing`) as **typed Drizzle columns** on `Step`. Type-safe, indexable, zero perf cost. v1 ships exactly as specified.
- Introduce a **single source of truth**: a `slotRegistry` (static, in the bundle but defined once) that for each slot carries: `key`, `label`, `color`, `cardinality (single|multi)`, `values[]` (each `{key,label,gloss}`), `appliesToDances[]`, `appliesToRoles[]`. Zod schemas, the tag editor, Lanes, the glossary, and chip rows **all read this one registry** instead of re-listing slots.
- Result: scenario 2a (new value) = add to `values[]`. Scenario 2c (Tango/Latin/role) = set `appliesToDances`/`appliesToRoles`. Scenario 2b (new *core* slot) is still a typed column + migration, **but** every UI/glossary/Lanes consumer already iterates the registry, so adding the column + a registry entry lights up the whole UI automatically — the 9-place change collapses to ~3 (column, Zod-from-registry already covers it, registry entry, renderer if a new cardinality).

This keeps compile-time safety for the values that matter while making *enumeration and applicability* — the parts that actually duplicate — data-driven. It is the minimal change that makes the common extension (value/applicability) free and the rare extension (new column) cheap.

### Schema sketch (registry — pure `domain/`, fully unit-testable)

```ts
// domain/vocabulary.ts — the SINGLE source of truth
export type Cardinality = "single" | "multi";

export interface SlotValue { key: string; label: string; gloss?: string;
  appliesToDances?: DanceId[];  // omitted => all
  appliesToRoles?: StepRole[];  // omitted => both
}
export interface SlotDef {
  key: string;            // "rise" | "foot" | "turn" | "alignment" | ...
  label: string;          // "Rise & Fall"
  color: string;          // "#1f8a5b"
  cardinality: Cardinality;
  values: SlotValue[];
  appliesToDances?: DanceId[]; // e.g. rise omits "tango"  => replaces hasRiseFall
  appliesToRoles?: StepRole[];
  storage: "column" | "attribute"; // core-5 = "column"; future = "attribute"
}

export const SLOT_REGISTRY: SlotDef[] = [ /* rise, body, bodyActions, foot, sway, turn */ ];

// applicability, computed not hard-coded:
export const slotsFor = (dance: DanceId, role: StepRole): SlotDef[] =>
  SLOT_REGISTRY.filter(s =>
    (!s.appliesToDances || s.appliesToDances.includes(dance)) &&
    (!s.appliesToRoles  || s.appliesToRoles.includes(role)));

// Zod for a Step's slot values derives FROM the registry (single-select => enum of value keys,
// multi => array), so adding a value cannot drift from validation. Unknown persisted values
// pass through as a tagged `{ unknown: string }` rather than failing read (forward-compat).
```

`hasRiseFall: false` becomes `rise.appliesToDances = ["waltz","viennese_waltz","quickstep","foxtrot"]` (Tango absent). The Tango-hides-rise test (§9.1) becomes a `slotsFor("tango","leader")` assertion — one place.

---

## 4. Single source of truth audit (finding for the spec)

The spec currently enumerates slots in **§2.1 (schema), §3 (vocabularies/colors), §4.4 (tag-editor sections), §4.3 (Lanes), §4.11 (Info-sheet glossary)** — five enumerations of the same list, plus colors duplicated between §3 headings and the tag editor. The Info-sheet glossary is *explicitly* "reconciled to match" the tag editor (§3 intro) — i.e. the spec already acknowledges two copies that must be kept in sync by hand. **That reconciliation should be a derivation, not a discipline.** Drive glossary, tag editor, Lanes, and chips from `SLOT_REGISTRY`.

---

## 5. Linkage to migration of saved data (note, don't solve here)

Every value/slot addition interacts with already-persisted rows:

- **Additive value/slot** (the common case): safe if the read path tolerates unknown values (the `{unknown}` passthrough above) and treats absent new columns as null. Make the registry **forward-compatible on read now** — cheap, and it is the exact property the deferred offline/CRDT layer (§10) will require when two clients hold different vocabulary versions. Note the linkage; don't build CRDT.
- **Renaming/removing a value** (e.g. Q-D4 `CBP`→`CBMP`): needs a one-time data migration mapping old→new on the stored rows, *and* the op-log inverses (§2.1) that reference the old value must remain replayable. Give the registry an optional `aliases: { oldKey: newKey }` so reads remap transparently and the undo log stays valid. This is the only genuinely expensive migration class — flag it, and prefer additive changes.
- Export/import (§8) should write the **registry version** alongside the data so an import can remap via aliases instead of failing on an unknown value.

---

## 6. Recommended spec changes NOW (cheap now, expensive later) — minimal

1. **Add §7.1 `domain/vocabulary.ts` as a named module** = the single `SLOT_REGISTRY` source of truth (slot key, label, color, cardinality, values, `appliesToDances`, `appliesToRoles`, `storage`). [primary fix; ~half a day]
2. **Re-express §3 as the data in that registry**, and state that §4.3 Lanes, §4.4 tag editor, §4.11 glossary, and the chip rows **render from it** — delete the "glossary reconciled to match" manual-sync language.
3. **Replace `hasRiseFall` with `rise.appliesToDances`** (Tango omitted). Generalize: dance/role applicability is registry data, not per-condition booleans. (Resolves the critique's Tango-rise-suppression requirement *and* makes it the pattern for Latin.)
4. **Specify forward-compatible read**: unknown persisted slot values pass through as `{unknown}` rather than failing Zod; the registry carries a `version` and optional `aliases`. Export writes the version. [the offline/CRDT insurance]
5. **Keep the core 5 slots as typed columns** (do not adopt EAV) but tag each registry entry `storage: "column"`, reserving `storage: "attribute"` + a generic `stepAttributes(stepId, slotKey, value)` table as the documented path for *future non-core* slots so they land without a Step migration. Building the attribute table is **deferred**; documenting the seam is the cheap part.
6. **Make the op-log slot-generic**: `step.setSlot{slotKey, value}` keyed by registry key (already close in §2.1), so new slots need no new op kind.

## 7. Fine to defer (YAGNI holds)

- The actual `stepAttributes` EAV table — document the seam (#5), build it only when the first non-core slot (per-step alignment / lead / Latin head) is greenlit.
- A server-stored / user-editable vocabulary (custom values). Static-in-bundle registry is right for v1; the registry shape doesn't preclude moving it server-side later.
- Per-value i18n, syllabus-system attribution (ISTD/IDTA/WDSF) on values — additive once the registry exists.
- CRDT/offline conflict handling for vocabulary versions — only the *forward-compatible read* (#4) is needed now; the merge logic stays deferred with the rest of offline (§10).

---

## TL;DR

The fixed-column + hard-coded-enum + slot-list-duplicated-in-5-places design ships v1 correctly but taxes every future attribute — and the domain guarantees a steady stream of them (the critique already names the next batch). Don't go full EAV (kills type-safety the owner wants). Adopt the **hybrid**: keep the typed core columns, but introduce one `SLOT_REGISTRY` that every UI/validation/glossary consumer reads, with **applicability (dance/role) as data** (retiring `hasRiseFall`) and **forward-compatible reads + aliases** for persisted-data safety. New value or dance/role rule = a config edit; new core slot = ~3 places not 9; new non-core slot = a documented attribute-table seam, no migration. Defer the EAV table itself and server-side vocabularies.
