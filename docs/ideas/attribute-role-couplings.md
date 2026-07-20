# Author-defined role couplings — "if the leader has X, the follower has Y"

*(Created 2026-07-20 · areas: domain, web, contract, design. Design-complete sketch;
the `docs/design/` prototype for the coupling-map editor is owed before implementation.)*

## Summary

A role-aware attribute kind already carries a **value-pairing table** that turns the leader's
value into the follower's under the **Both** lens: `sway` ships
`mirror: { to_L: "to_R", to_R: "to_L" }` and `direction` ships
`{ forward: "back", back: "forward", … }` (`packages/domain/src/vocabulary.ts`). The domain
already applies it generically — `deriveFollowerValue` (`role-write.ts:23`) does
`kind.mirror?.[value] ?? value`. **The table is already data, not code.** The only thing
missing is that an author who invents a **custom** role-aware kind cannot *declare* one:
custom kinds fall back to `bothWrite: "copy"`, so setting the leader under Both just copies
the same value onto the follower.

This idea exposes that existing-but-internal mechanism to authoring. When you create or edit a
role-aware **enum** kind, you may fill in its pairing table — a short grid of
`leader value → follower value` rows — and the Both lens then derives the follower through it,
using the exact code path `sway` uses today. Because the field is generalized past symmetric
mirrors to any author map, it's renamed **`coupling`** (a `mirror` is the special case where
the map is its own inverse); `sway`/`direction` keep their tables verbatim under the new name.

Nothing new touches sync, permissions, the CRDT, or D1. A coupling table is registry data that
rides the account document exactly like a custom kind's value list already does, and the
follower-derivation, role-split, and lock-on-divergence machinery are all already shipped and
unchanged.

## Mental-model delta

- **[`docs/concepts/notation.md`](../concepts/notation.md) § Kinds** — a kind's declared
  properties gain (well: **rename + expose**) a **coupling map** (`leader value → follower
  value`) beside cardinality, value type, role-awareness, and the Both-write mode. It already
  exists as `mirror` on built-ins; it becomes author-declarable on **role-aware enum** custom
  kinds and is renamed `coupling`.
- **§ Role lenses** — the section already documents the three Both-write modes (mirror /
  leader-only / copy). The delta is small and mostly *conceptual honesty*: "mirror" is now
  understood as *"a coupling map that happens to be symmetric,"* and the same derivation is
  available to custom kinds. An unmapped leader value still **copies** to the follower (today's
  identity fallback, `?? value`) — unchanged. The lock-on-divergence rule
  (`isBothConsistent`, `role-write.ts:75`) is untouched; it already asks "is the stored pair a
  possible output of this kind's derivation?", which now reads an author-supplied table.
- Mechanics land in **[`docs/system/architecture.md`](../system/architecture.md)
  § The domain package**: no new derivation logic — the change is the registry/contract type
  (`mirror` → `coupling`, now writable by custom kinds) and the add-kind editor.
  `docs/DESIGN-SYSTEM.md` / the design bundle gain the coupling-map grid.
- **Explicit non-changes**: no new anchor type, no annotation change, no permission surface,
  no D1 index, no sync-protocol change, no new document, **no change to `deriveFollowerValue`
  / `bothWriteTargets` behaviour**. Reading lenses (Leader | Follower) are untouched — this is
  a *write-time* derivation the code already performs; a reader still just sees each role's
  stored value.

## Motivation

### Goals

- Let an author express a real leader/follower relationship on **their own** custom kind:
  set the leader once under Both, the follower fills itself — the capability `sway` already
  has, opened to custom kinds.
- Reach it by **exposing an existing mechanism**, not building a new one: the derivation,
  storage, role-split, and divergence-lock are all shipped.
- Rename `mirror` → `coupling` so the field's name stops implying symmetry (the coach's map
  below is not an involution).

### Non-goals

- **Not** a general constraint/validation engine. A coupling is a *write-time default*, not
  an enforced invariant — the follower can always be overridden under its own lens (the
  override then locks Both, as today). No write is rejected for being "inconsistent."
- **Not** cross-*kind* dependency ("if `sway` is `to_L` then `rise` is `no_foot_rise`"). One
  map couples the two roles of **one** kind — the shape `mirror`/`coupling` already has.
  Cross-kind rules are a far larger predicate surface — deliberately out (see Alternatives).
- **Not** for free-text kinds (an infinite domain has no finite pairing table) — enum only,
  matching where `roleAware` + a value list already coexist.
- **No** bidirectional back-propagation in v1: the map is read **leader → follower**
  (`deriveFollowerValue` takes the leader value). Setting the follower directly is a manual
  override, not a reverse lookup (see Alternatives for why symmetric built-ins still work).

## Proposal

### In the wild

The mechanism is a well-worn input pattern under three names, and this repo already **ships**
it internally:

- **Key-remapping tables** — PowerToys Keyboard Manager and Linux Input Remapper present an
  *input column → output column* grid with an "add row" button
  ([PowerToys Keyboard Manager](https://learn.microsoft.com/en-us/windows/powertoys/keyboard-manager)).
  That is exactly the coupling-map editor: a **leader-value → follower-value** grid, one row
  per pairing.
- **Cascading / selection-dependent inputs** — a choice in one control determines the value
  of another (Excel dependent drop-downs via `INDIRECT`/named ranges
  ([Ablebits](https://www.ablebits.com/office-addins-blog/dependent-cascading-dropdown-lists-excel/)),
  the general "if field A === X, then B" form pattern
  ([UXmatters, selection-dependent inputs](https://www.uxmatters.com/mt/archives/2007/02/selection-dependent-inputs.php))).
  That is the *runtime* behaviour: the leader's selection drives the follower's value —
  precisely what `bothWriteTargets` (`role-write.ts:38`) already computes.
- **This codebase's own `sway`/`direction` maps** — `to_L ↔ to_R` is a two-row coupling map
  that already lives in the registry as data and is already applied generically. The idea is
  simply: let an author write one for their own kind.

Two lessons carried from those: keep the editor a plain add-a-row grid (no formula language),
and make an unmapped input **copy through** (the existing `?? value` fallback), never
force-blank the target — silently wiping a field is the classic over-eager-cascade failure.

### Named scenario — the coach's "Poise" kind

A coach builds a custom **role-aware enum** kind `poise` (the body's lean relative to partner)
with values `forward` / `upright` / `back`, to annotate a Rumba's forward walks. In this
couple's technique the leader's forward poise pairs with the follower's back poise, and upright
pairs with upright.

*Today:* `poise` is custom, so it has no coupling table and defaults to `bothWrite: "copy"`
(`deriveFollowerValue` returns the leader value). Set the leader to `forward` under Both and
the follower also reads `forward`, which is wrong. The coach must switch to the Follower lens
on every step and hand-enter `back` (`splitSharedForRole` then a per-role write). Fourteen
walks, twenty-eight edits, and any missed step silently carries the wrong follower value.

*Proposed:* when creating `poise` the coach fills its coupling grid — one row,
`forward → back` (they leave `upright` and `back` to copy through: upright↔upright is correct,
and a leader never poises `back` in this figure). Now under **Both**, setting a walk's leader
to `forward` writes leader `forward` **and** follower `back` in one tap —
`bothWriteTargets(kind, "forward")` already returns `{ leader: "forward", follower: "back" }`
the moment `kind.coupling` has that row. The one walk where the follower genuinely stays
upright against a forward-poised leader: the coach switches to the Follower lens and sets
`upright`; that step now **locks under Both** (🔒 + "hand-authored — edit per role") via the
unchanged `isBothConsistent` check — the coupling never overwrites the deliberate exception.

*The built-in half:* the same edit on a `sway` cell behaves byte-for-byte as today, because
`sway`'s table is the same field read by the same function — only its name changed.

### Risks & mitigations

- **Renaming `mirror` → `coupling`** touches the registry type, the two built-in kinds, the
  contract schema, and the derivation read site. *Mitigation:* it is a mechanical rename with
  no behaviour change; existing derivation/convergence tests are the safety net, and a short
  transition can accept `mirror` as a read alias if any serialized custom kind ever used it
  (none do today — custom kinds can't set it yet). If even the rename feels too broad, the
  fallback is to keep the field named `mirror` and only expose it (Alternatives).
- **A partial map surprising the author** ("I set the leader, the follower copied instead of
  staying blank"). *Mitigation:* this is the *existing, documented* fallback (`?? value`); the
  editor shows unmapped values explicitly ("`back` → (copies to follower)") so the behaviour is
  visible, not a surprise.
- **Author edits a coupling map after steps exist.** The map is a write-time default, so
  existing attributes are **not** retro-rewritten (that would clobber authored data); only
  future Both-lens edits use the new rows — the same "defaults apply going forward" rule the
  value-list edit already follows.

## Design details

*(Grounded in this session's `explore-attrs` code map; complete against these seams before
implementing.)*

- **Data shape.** `RegistryKind` (`packages/domain/src/vocabulary.ts:19`) today has
  `bothWrite?: "copy" | "mirror" | "leaderOnly"` and `mirror?: Record<string, string>`. Rename
  `mirror` → `coupling` (same `Record<leaderValue, followerValue>` shape). Validity: authorable
  only when `roleAware === true` and the kind is enum (has `values`, `freeText !== true`); every
  key/value must be a declared `value`. `bothWrite` stays: `"mirror"` is retained as the mode
  name meaning "derive through `coupling`" (or, cleaner, drop the enum and treat a *non-empty
  `coupling`* as the derive signal with `leaderOnly` an explicit flag) — decide at build time;
  either way `deriveFollowerValue`'s body is unchanged apart from the field name. A custom
  kind's `coupling` rides the account document beside its value list — **no new storage, no
  migration** (optional field; absent = copy).
- **Derivation — already built.** `deriveFollowerValue` (`role-write.ts:23`) and
  `bothWriteTargets` (`role-write.ts:38`) already produce `{ shared }` /
  `{ leader, follower }` / `{ leader }` from the map; no logic change. The Both-lens write site
  `AttributeEditor.tsx:150` already calls `bothWriteTargets` and stores the result. The
  divergence lock `isBothConsistent` (`role-write.ts:75`) already gates re-editing a
  hand-diverged pair.
- **Contract.** The custom-kind create/edit schema (`packages/contract`, validated in
  `packages/domain/src/schemas.ts` `superRefine` at ~:139) gains the optional `coupling` map
  with Zod validation: keys+values ∈ declared `values`, kind is `roleAware` + enum, at most one
  follower per leader (it is a `Record`, so that is structural). Rejected on write,
  tolerated-and-ignored on read for forward-compat.
- **Web.** Components reach this only through `apps/web/src/store/` and the `ui` design system
  (unchanged boundary). The custom-kind editor (Profile → attribute types, and the add-kind
  sheet) gains a **coupling-map grid** — visible only when the kind is role-aware + enum: rows
  of `leader value ▸ follower value`, an "add pairing" button, each side a select over the
  kind's own `values`; values without a row shown as "copies to follower." **No change to the
  step editor** (`AttributeEditor.tsx`) — it already routes Both-lens writes through
  `bothWriteTargets`.
- **Design.** Prototype the coupling-map grid in
  `docs/design/project/Ballroom Builder v3.dc.html` (the add-kind sheet) **before** building —
  the bundle stays the canonical visual source. *This prototype is owed.*
- **Invariants respected.** Soft-delete only (editing a map is a value change; removing a row
  never touches existing attributes); client ULIDs unchanged; permissions at the DO boundary
  unchanged (editing a kind already requires the account owner); D1 untouched (registry is CRDT
  content, never indexed); components via the store only.

## Test plan & ship gate

- **Domain (unit + property):** `deriveFollowerValue` / `bothWriteTargets` under an
  author-supplied `coupling` — a mapped leader derives the follower (role-pair written); an
  unmapped leader copies (shared written); no map copies; `isBothConsistent` flags a
  hand-diverged pair and clears when re-consistent. A rename-equivalence assertion:
  `sway`/`direction` derivations are unchanged after `mirror`→`coupling` (byte-identical output
  for every value × count × dance). Convergence unchanged.
- **Contract:** schema accepts a valid coupling, rejects a non-declared value, a map on a
  non-roleAware or free-text kind.
- **Web (component):** the coupling grid appears only for role-aware enum kinds; adding a
  pairing then Both-editing a step fills the follower; the diverged step renders 🔒.
- **Ship gate — `apps/web/e2e/attribute-role-couplings.spec.ts`:** author creates a custom
  role-aware enum kind, adds a `leader X → follower Y` pairing, opens the figure editor under
  **Both**, sets a step's leader to X, and both the leader (X) and follower (Y) cells fill in
  one action; then a Follower-lens override to Z locks that step under Both. Green on
  chromium-desktop `@smoke`. Shipping folds the delta into `notation.md` (both sections) +
  `architecture.md`, updates the design bundle, and **deletes this file**.

## Drawbacks

- A rename (`mirror` → `coupling`) ripples through the registry type, two built-ins, the
  schema, and one read site — pure churn, justified only because "mirror" misdescribes an
  asymmetric author map and the field is about to become user-facing. The no-rename fallback
  is in Alternatives.
- A new author-facing concept (the coupling grid) in the add-kind sheet — mitigated by its
  being optional, hidden unless role-aware + enum, and visually the familiar remap-table grid.
- A partial map is a mild footgun (leader set, follower *copies* rather than staying blank) —
  mitigated by the grid showing unmapped values explicitly; and it is the pre-existing default,
  not a new behaviour.

## Alternatives

- **Expose the field but keep it named `mirror`.** Zero rename churn, lowest risk — but the
  name lies for the coach's asymmetric `forward → back` map, and it's about to be a label in
  the authoring UI. Kept as the fallback if the rename is judged not worth the diff.
- **A full constraint engine (cross-kind predicates, "if sway=to_L then rise=…").** Strictly
  more powerful, but an order-of-magnitude larger validation/predicate surface that invites
  contradictory-rule debugging, and no scenario needs cross-*kind* coupling. Fails the YAGNI
  fence; the coach's `poise` scenario needs none of it.
- **Enforce the coupling as a hard invariant (reject an inconsistent follower on write).**
  Kills the deliberate exception — the one Rumba walk where the follower stays upright against a
  forward leader becomes unwritable. The lens model already treats divergence as first-class
  (lock, don't forbid); `isBothConsistent` exists precisely to *allow* it. Fails the coach's
  override step.
- **Unmapped leader leaves the follower blank (instead of copying).** Diverges from the shipped
  `?? value` fallback for a marginal gain and reintroduces a real footgun (silent blanks). Only
  worth it if authors ask for "derive some, leave the rest unset"; deferred.
- **Bidirectional / symmetric maps (setting either role derives the other).** Tempting for
  `sway` (genuinely symmetric), but it doubles the mental model (which side wins on a
  conflict?) and most real couplings are asymmetric. v1 is leader→follower; a symmetric built-in
  like `sway` still works because its map is an involution *and* Both-lens edits are authored
  leader-first. Revisit only if authors ask to drive from the follower side.
- **Per-step coupling instead of per-kind.** Setting the pairing on each placement is the
  status quo (hand-authoring the follower every step) — the scenario's twenty-eight edits. The
  whole value is declaring it **once** on the kind. Fails the scenario by definition.
