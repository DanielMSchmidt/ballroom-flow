---
title: Attribute-predicate annotation anchors
wep: 0003
owning-areas: [domain, worker, web]
authors: ["@danielmschmidt"]
approver: owner
status: deferred
created: 2026-07-13
last-updated: 2026-07-13
see-also: ["PLAN §11.1 (the canonical deferred spec)", "PLAN §2.6", "PLAN D20/D29"]
replaces: null
superseded-by: null
---

# WEP-0003: Attribute-predicate annotation anchors

*(Seeded from PLAN §11.1, where this v1.1 feature was captured "precisely so it can be
executed later without re-deriving it" — deferred, not undecided; confirmed v1.1 on
2026-06-29. PLAN §11.1 remains the canonical spec text while this WEP is `deferred`; on
revival, promote this WEP to `provisional`/`implementable` and migrate the full design here,
leaving §11.1 a pointer.)*

## Summary

A fourth annotation anchor type, `attributePredicate { kind, value, role?, scope }`, targeting
**every step whose notation matches an attribute condition** — "soften every left-side sway",
"all rising steps", "every step with *no* sway logged" — rather than one fixed spot (`point`),
one figure instance (`figure`), or one family by id (`figureType`). The natural generalization
of `figureType` from an identity match to a predicate over attributes.

## Motivation

### Goals

- Coach/practice notes that follow the *technique*, not the address: one note surfaces on
  every matching step, dynamically, as choreography changes.
- Unify the three link-picker targets (place / figure / attribute) into one "target → scope"
  flow, with `figureType` becoming a special case (a figure-identity predicate).

### Non-Goals

- Full query language — v1.1 scope is a single `kind`+`value` (+optional `role`) match with
  the `none`/absence sentinel, matched by meaning through registry read-aliases.

## Why deferred (the status rationale)

`figureType` shipped in v1 because it is an **identity** match — a stored id, `O(1)`, static
set, no query layer. A predicate additionally needs (a) a matching/query layer over notation,
(b) **dynamic re-resolution on read** as content changes, and (c) for `<dance>`/`all` scopes a
new cross-account index analogous to `FigureTypeNoteIndex` with the same co-membership read
gate. Those land together or not at all — hence one deferred unit. The UI is already
design-complete in the v4 wireframes (frames 3.6→3.7), so revival is engine + index work.

## Proposal / Design Details / Test Plan / Ship Gate

See **PLAN §11.1** for the precise deferred spec (anchor shape, `none` sentinel, resolution
semantics, ownership & visibility = Q-FIGNOTE-VIS option 2, the index extension). To be
migrated into this WEP and completed on revival. The ship gate will be a Playwright journey
asserting a predicate note surfaces on a matching step, disappears when the step is retagged,
and respects the co-membership gate for a non-member.

## Drawbacks

A read-time query layer over notation is the first dynamic (content-dependent) read path in
the annotation system; its cost scales with routine size and needs the same
referential-stability care as the store's other materializers.

## Alternatives

- **Ship it in v1** — rejected 2026-06-29: three subsystems for a note type with no v1 user,
  while identity-based `figureType` anchors covered the concrete coach scenarios on the table.
- **Precompute match sets on write** (store matched step ids on the note) — rejected in the
  §11.1 analysis by implication: the set must be **dynamic on read** (adding a matching step
  must surface the note automatically); a write-time set is stale by design.
