# Attribute-predicate annotation anchors

*(Created 2026-07-13 as WEP-0003, migrated 2026-07-15 · areas: domain, worker, web.
Deliberately parked for after v1 — confirmed 2026-06-29; captured precisely so it can be
executed later without re-deriving it.)*

## Summary

A fourth annotation anchor type, `attributePredicate { kind, value, role?, scope }`,
targeting **every step whose notation matches an attribute condition** — "soften every
left-side sway", "all rising steps", "every step with *no* sway logged" — rather than one
fixed spot (`point`), one figure instance (`figure`), or one family by identity
(`figureType`). The natural generalization of `figureType` from an identity match to a
predicate over attributes.

## Mental-model delta

- [`docs/concepts/annotations.md`](../concepts/annotations.md) § Anchors gains the fourth
  type: a **dynamic** anchor whose match set is re-evaluated on read (add a matching step →
  the note surfaces there automatically; retag/remove → it drops). The three existing
  anchors are static addresses/identities; this is the first content-dependent one.
- The link picker's three target types (place / figure / attribute) unify into one
  "target → scope" flow, with `figureType` becoming a special case (a figure-identity
  predicate) — updates § The Journal's picker description.
- Ownership/visibility copies the family-note model unchanged (author-owned, visible to
  co-members of shared choreos where a matching step appears).
- Mechanics land in [`docs/system/architecture.md`](../system/architecture.md)
  § Annotations & projections: a new cross-account index analogous to the family-note index,
  keyed by `{ kind, value, role?, scope }`, same co-membership read gate; plus a small
  read-time matching layer over notation.

## Motivation

### Goals

- Coach/practice notes that follow the *technique*, not the address: one note surfaces on
  every matching step, dynamically, as choreography changes.
- Unify the link-picker targets into one flow.

### Non-goals

- A full query language — scope is a single `kind` + `value` (+ optional `role`) match, with
  the `none`/absence sentinel, matched by meaning through registry read-aliases.

## Why parked

`figureType` shipped in v1 because it is an **identity** match — a stored id, O(1), static
set, no query layer. A predicate additionally needs (a) a matching/query layer over
notation, (b) **dynamic re-resolution on read** as content changes, and (c) for
dance-/all-scoped notes a new cross-account index with the same co-membership gate. Those
land together or not at all. The UI is already design-complete in the v4 wireframes (link
picker "An attribute" → family → value → scope → chip *"↳ all left sways · every dance"*),
so revival is engine + index work.

## Design details

**Anchor shape:** `attributePredicate { kind, value, role?, scope }`

- `kind` — any kind from the merged registry, built-in or custom.
- `value` — a value of that kind to match, **including the sentinel `none`** ("every step
  with no sway logged" — absence is an explicit, selectable match value). Matched **by
  meaning**, normalized through the registry's read aliases — the same content comparison
  the "custom" badge uses ([`docs/concepts/figures.md`](../concepts/figures.md) § The custom
  badge). Unknown persisted values pass through and do not match a known value.
- `role?` — leader-only, follower-only, or either (absent = either/both).
- `scope` — `routine` (*this choreo only* — resolvable entirely client-side) ·
  `<DanceId>` (*all of this user's choreos in that dance*) · `all` (*every dance*).

**Resolution:** dynamic — re-evaluated on read; content-based matching over the resolved
timeline.

**Ownership & visibility:** identical to family notes — owned in the author's account doc,
visible to co-members of any shared choreo where a matching step appears, discovered via a
new attribute-predicate index (never by scanning account docs).

## Test plan & ship gate

Domain: predicate matching incl. the `none` sentinel, alias normalization, dynamic
re-resolution. Worker: the new index + co-membership gate (indexed queries). E2E ship gate:
a journey asserting a predicate note surfaces on a matching step, disappears when the step
is retagged, and is invisible to a non-member.

## Drawbacks

A read-time query layer over notation is the first dynamic (content-dependent) read path in
the annotation system; its cost scales with routine size and needs the same
referential-stability care as the store's other materializers
([`docs/system/sync-and-offline.md`](../system/sync-and-offline.md) § Flicker).

## Alternatives

- **Ship it in v1** — rejected 2026-06-29: three subsystems for a note type with no v1 user,
  while identity-based `figureType` anchors covered the concrete coach scenarios on the
  table.
- **Precompute match sets on write** (store matched step ids on the note) — rejected: the
  set must be dynamic on read (adding a matching step must surface the note automatically);
  a write-time set is stale by design.
