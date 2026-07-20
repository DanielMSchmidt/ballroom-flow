# Author-defined role couplings — "if the leader has X, the follower has Y"

*(Created 2026-07-20 · areas: domain, web, contract, design. Design-complete sketch;
the `docs/design/` prototype for the coupling-map editor is owed before implementation.)*

## Summary

Today a role-aware attribute kind's **Both-lens** behaviour is baked into code: `direction`
and `sway` mirror the leader onto the follower through a **hardcoded value-pairing table**
(`forward ↔ back`, `to_L ↔ to_R`, …), `footwork` is leader-only, and everything else copies
a single shared value (`docs/concepts/notation.md` § Role lenses). An author who invents a
custom role-aware kind gets only "copy" — they cannot say *"when the leader is X, the
follower is Y"*.

This idea makes that pairing table **data an author declares**, not code we ship. When you
create or edit a role-aware **enum** kind, you may attach a **coupling map**: a short table
of `leader value → follower value` rows. Once a kind has a map, one edit under the **Both**
lens sets the leader's value verbatim and **auto-derives the follower's** from the map —
exactly the machinery `sway` already uses, but the table is yours. Unmapped leader values
leave the follower empty (author fills it under the Follower lens); a step whose follower
value has been hand-authored to *disagree* with the map locks under Both with the existing
🔒 + toast, precisely as a hand-diverged mirror does today.

The built-in mirror kinds become the **first instances** of the general mechanism: their
pairing tables move out of the derivation code and into the registry as data, and the
special-cased `bothWrite: "mirror"` branch is deleted. Nothing new touches sync,
permissions, the CRDT, or D1 — a coupling map is registry data that rides the account
document exactly like a custom kind's value list.

## Mental-model delta

- **[`docs/concepts/notation.md`](../concepts/notation.md) § Kinds** — a kind's declared
  properties gain an optional **coupling map** (`leader value → follower value`) alongside
  cardinality, value type, role-awareness, and the Both-write mode. Only **role-aware enum**
  kinds may carry one.
- **§ Role lenses** — the three hardcoded Both-write modes (mirror / leader-only / copy)
  collapse into **one rule driven by data**: if the kind has a coupling map, the follower is
  derived through it; if it has none, the follower **copies** the leader (today's default);
  **leader-only** becomes "a map with no rows" (nothing derives, follower stays empty until
  authored). `direction` and `sway` are re-expressed as built-in coupling maps; `footwork`
  as the empty map. The lock-on-divergence rule is unchanged — it already keys off "is the
  stored pair consistent with the derivation?", which now reads the map.
- Mechanics land in **[`docs/system/architecture.md`](../system/architecture.md)
  § The domain package**: the Both-write derivation helper stops branching on a hardcoded
  mode enum and instead applies the kind's coupling map; the registry/vocabulary types gain
  the map field. `docs/DESIGN-SYSTEM.md` / the design bundle gain the coupling-map editor.
- **Explicit non-changes**: no new anchor type, no annotation change, no permission surface,
  no D1 index, no sync-protocol change, no new document. Reading lenses (Leader | Follower)
  are untouched — this is a *write-time* derivation only; a reader still just sees each
  role's stored value.

## Motivation

### Goals

- Let an author express a real leader/follower relationship on **their own** custom kind:
  set the leader once under Both, the follower fills itself.
- **Unify** the mirror/leader-only/copy special-casing into one data-driven rule — less code,
  one behaviour to test, `sway`'s mirror stops being a hardcoded exception.
- Preserve every existing guarantee: hand-authored divergence is never clobbered; a
  single-role edit still splits; readers are unaffected.

### Non-goals

- **Not** a general constraint/validation engine. A coupling is a *write-time default*, not
  an enforced invariant — the follower can always be overridden under its own lens (the
  override then locks Both, as today). We do not reject an "inconsistent" pair on write.
- **Not** cross-*kind* dependency ("if `sway` is `to_L` then `rise` is `no_foot_rise`"). One
  map couples the two roles of **one** kind. Cross-kind rules are a much larger predicate
  surface — deliberately out (see Alternatives).
- **Not** for free-text kinds (an infinite domain has no finite pairing table) — enum only.
- **No** bidirectional back-propagation in v1: the map is read **leader → follower**. Setting
  the follower directly is a manual override, not a reverse lookup (see Alternatives for why
  symmetric built-ins like `sway` still work).

## Proposal

### In the wild

The mechanism is a well-worn input pattern under three names, and this repo already ships a
degenerate case of it:

- **Key-remapping tables** — PowerToys Keyboard Manager and Linux Input Remapper present an
  *input column → output column* grid with an "add row" button
  ([PowerToys Keyboard Manager](https://learn.microsoft.com/en-us/windows/powertoys/keyboard-manager)).
  That is exactly the coupling-map editor: a **leader-value → follower-value** grid, one row
  per pairing.
- **Cascading / selection-dependent inputs** — a choice in one control determines the valid
  value of another (Excel dependent drop-downs via `INDIRECT`/named ranges
  ([Ablebits](https://www.ablebits.com/office-addins-blog/dependent-cascading-dropdown-lists-excel/)),
  and the general "if field A === X, then B" form pattern
  ([UXmatters, selection-dependent inputs](https://www.uxmatters.com/mt/archives/2007/02/selection-dependent-inputs.php))).
  That is the *runtime* behaviour: the leader's selection drives the follower's value.
- **This codebase's own `sway` mirror** — `to_L ↔ to_R` is a two-row coupling map that
  happens to be hardcoded. The whole idea is: stop hardcoding it.

Two lessons carried from those: keep the editor a plain add-a-row grid (no formula language),
and make an unmapped input a *no-op that leaves the target editable*, never a forced blank —
the failure mode of over-eager cascading is silently wiping a field the user meant to keep.

### Named scenario — the coach's "Poise" kind

A coach builds a custom **role-aware enum** kind `poise` (the body's lean relative to
partner) with values `forward` / `upright` / `back`, to annotate a Rumba's forward walks. In
this couple's technique the leader's forward poise pairs with the follower's back poise, and
upright pairs with upright.

*Today:* `poise` is custom, so Both-lens editing only **copies** — set the leader to
`forward` under Both and the follower also reads `forward`, which is wrong. The coach must
switch to the Follower lens on every step and hand-enter `back`. Fourteen walks, twenty-eight
edits, and any missed step silently carries the wrong follower value.

*Proposed:* when creating `poise` the coach adds a coupling map — two rows,
`forward → back` and `upright → upright` (they leave `back` unmapped; a leader never poises
back in this figure). Now under **Both**, setting a walk's leader to `forward` writes
leader `forward` **and** follower `back` in one tap. The one walk where the follower genuinely
stays upright against a forward-poised leader: the coach switches to the Follower lens and
sets `upright`; that step now **locks under Both** (🔒 + "hand-authored — edit per role"),
exactly as a diverged `sway` does — the coupling never overwrites the deliberate exception.

*The built-in half:* the same edit on a `sway` cell behaves identically to today, because
`sway`'s `to_L ↔ to_R` table is now just a built-in coupling map read by the same code path.

### Risks & mitigations

- **Re-expressing the built-in mirror as data touches shipped derivation code** — the exact
  area of the recent role-lens bug (`#284`). *Mitigation:* a golden-master test asserts the
  data-driven derivation produces **byte-identical** attributes to the current hardcoded
  mirror for every `direction`/`sway` value and every count, across all dances, **before**
  the old branch is deleted; convergence tests stay green.
- **A partial map surprising the author** ("I set the leader, the follower stayed empty").
  *Mitigation:* the editor shows unmapped leader values explicitly ("`back` → (no follower —
  authored per role)"), and the empty follower renders as *present-but-unset*, its normal
  state, not an error.
- **Author edits a coupling map after steps exist.** The map is a write-time default, so
  existing attributes are **not** retro-rewritten (that would clobber authored data); only
  future Both-lens edits use the new rows. *Mitigation:* documented in the concept doc as the
  same "defaults apply going forward" rule the value-list edit already follows.

## Design details

*(Sketch — complete against the exact registry seams before implementing; the code map from
this session's `explore-attrs` pass lands the file:line references.)*

- **Data shape.** The attribute-kind registry entry (built-in + custom; pure domain,
  `packages/domain` vocabulary/registry module) gains an optional
  `coupling?: { fromLeader: string; toFollower: string }[]` — an ordered list of value
  pairings, both sides drawn from the kind's own enum `values`. Validity: only when
  `roleAware === true` and value type is enum; each `fromLeader`/`toFollower` must be a
  declared value; at most one row per `fromLeader` (a function, not a relation). A custom
  kind's map rides the account document beside its value list — **no new storage, no
  migration for custom kinds** (the field is optional; absent = today's copy behaviour).
- **Contract.** The custom-kind create/edit schema (`packages/contract`) gains the optional
  `coupling` array with the above Zod validation (declared-values-only, single-row-per-leader,
  enum+roleAware gate) — rejected on write, tolerated-and-ignored on read for forward-compat.
- **Derivation.** The pure Both-write helper (domain) replaces its `mode` switch
  (mirror / leader-only / copy) with: *if the kind has a non-empty `coupling`, look
  `leaderValue` up in it — a hit derives the follower, a miss leaves the follower unset;
  if the kind has no `coupling`, copy the leader as one shared value.* Leader-only kinds ship
  `coupling: []` (present but empty). The **lock-on-divergence** predicate (already "is the
  stored (leader,follower) pair a possible output of the derivation?") now asks the map — no
  new concept.
- **Built-in migration.** `direction` and `sway` ship built-in `coupling` tables encoding
  their current pairings (`forward→back`, `back→forward`, `diagonal_forward→diagonal_back`,
  `behind→in_front`, `to_L→to_R`, `to_R→to_L`; symmetric self-pairs like `none→none` /
  upright collapse to a shared value). `footwork` ships `coupling: []`. The old hardcoded
  `bothWrite` branch is deleted once the golden-master test is green.
- **Web.** Components reach this only through `apps/web/src/store/` and the `ui` design
  system (unchanged boundary). The custom-kind editor (Profile → attribute types, and the
  add-kind sheet) gains a **coupling-map grid** — visible only when the kind is role-aware +
  enum: rows of `leader value ▸ follower value`, an "add pairing" button, each side a select
  over the kind's own values; unmapped values listed as authored-per-role. No change to the
  step editor's write call — it already routes Both-lens edits through the derivation helper.
- **Design.** Prototype the coupling-map grid in
  `docs/design/project/Ballroom Builder v3.dc.html` (the add-kind sheet) **before** building —
  the bundle stays the canonical visual source. *This prototype is owed.*
- **Invariants respected.** Soft-delete only (editing a map is a value change, not a delete;
  removing a row never touches existing attributes); client ULIDs unchanged; permissions at
  the DO boundary unchanged (editing a kind already requires the account owner); D1 untouched
  (registry is CRDT content, never indexed); components via the store only.

## Test plan & ship gate

- **Domain (unit + property):** the derivation helper under a coupling map — mapped leader
  derives the follower; unmapped leader leaves follower unset; no-map copies; empty-map
  derives nothing; the lock predicate flags a hand-diverged pair and clears when re-consistent.
  **Golden-master:** data-driven `direction`/`sway` derivation is byte-identical to the
  retired hardcoded mirror for every value × count × dance. Convergence unchanged.
- **Contract:** schema accepts a valid map, rejects a non-declared value / a duplicate
  `fromLeader` / a map on a non-roleAware or free-text kind.
- **Web (component):** the coupling-map grid appears only for role-aware enum kinds; adding a
  pairing then Both-editing a step fills the follower; the diverged step renders 🔒.
- **Ship gate — `apps/web/e2e/attribute-role-couplings.spec.ts`:** author creates a custom
  role-aware enum kind, adds a `leader X → follower Y` pairing, opens the figure editor under
  **Both**, sets a step's leader to X, and both the leader (X) and follower (Y) cells fill in
  one action; then a Follower-lens override to Z locks that step under Both. Green on
  chromium-desktop `@smoke`. Shipping folds the delta into `notation.md` (both sections) +
  `architecture.md`, updates the design bundle, and **deletes this file**.

## Drawbacks

- Deleting the hardcoded mirror in favour of data is a change to sensitive, recently-bugfixed
  derivation code — carried only because the golden-master test makes the equivalence
  provable and the net result is *less* special-casing.
- A new author-facing concept (the coupling grid) in the add-kind sheet — mitigated by its
  being optional, hidden unless role-aware + enum, and visually the familiar remap-table grid.
- A partial map is a mild footgun (leader set, follower empty) — mitigated by showing unmapped
  values explicitly and by the follower's empty state being ordinary, not an error.

## Alternatives

- **Leave the built-in mirror hardcoded; add couplings only for custom kinds.** Less risk
  (doesn't touch `sway`), but keeps two parallel mechanisms for the same idea — the exact
  special-casing this is meant to remove — and leaves `sway`'s mirror untestable through the
  general path. Fails the *"unify the derivation"* goal. Kept as the fallback if the
  golden-master equivalence can't be made green.
- **A full constraint engine (cross-kind predicates, "if sway=to_L then rise=…").** Strictly
  more powerful, but it is a validation/predicate surface an order of magnitude larger, invites
  contradictory-rule debugging, and no scenario needs cross-*kind* coupling — the ask is
  leader↔follower on one kind. Fails the YAGNI fence; the coach's `poise` scenario needs none
  of it.
- **Enforce the coupling as a hard invariant (reject an inconsistent follower on write).**
  Kills the deliberate exception — the one Rumba walk where the follower stays upright against
  a forward leader becomes unwritable. Real choreography diverges from technique; the lens
  model already treats divergence as first-class (lock, don't forbid). Fails the coach's
  override step.
- **Bidirectional / symmetric maps (setting either role derives the other).** Tempting for
  `sway` (genuinely symmetric), but it doubles the mental model (which side wins on a
  conflict?) and most real couplings are asymmetric. v1 is leader→follower; a symmetric
  built-in like `sway` still works because its map is an involution *and* Both-lens edits are
  authored leader-first. Revisit only if authors ask to drive from the follower side.
- **Per-step coupling instead of per-kind.** Setting the pairing on each placement is the
  status quo (hand-authoring the follower every step) — the scenario's twenty-eight edits.
  The whole value is declaring it **once** on the kind. Fails the scenario by definition.
