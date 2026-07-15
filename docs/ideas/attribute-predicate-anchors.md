# Attribute-predicate annotation anchors

*(Created 2026-07-13 as WEP-0003, migrated 2026-07-15 · areas: domain, worker, web.
Was deliberately parked for after v1 (confirmed 2026-06-29); **un-parked and made
dispatch-ready 2026-07-15** — v1 is complete and shipped, so the parking condition no
longer holds. Design details below are complete; the UI is design-complete in
`docs/design/project/Ballroom Wireframes v4.dc.html` § 3.6 ("Link picker — ATTRIBUTE").
Execution plan: [`attribute-predicate-anchors.plan.md`](attribute-predicate-anchors.plan.md).)*

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

## Why this was parked — and why it's now dispatchable

`figureType` shipped in v1 because it is an **identity** match — a stored id, O(1), static
set, no query layer. A predicate additionally needs (a) a matching/query layer over
notation, (b) **dynamic re-resolution on read** as content changes, and (c) for
dance-/all-scoped notes a new cross-account index with the same co-membership gate. Those
land together or not at all — which is why it waited for v1 to ship. v1 shipped; the three
pieces are now scoped below and land in one PR-sized campaign. The UI is design-complete in
`Ballroom Wireframes v4.dc.html` § 3.6 (link picker "An attribute" → family → value →
scope → chip *"↳ all left sways · every dance"*; the disabled "coming later · v1.1" row in
§ 3.4 graduates to enabled), so the work is engine + index + picker wiring.

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

**The matching layer (domain):** a pure function in `packages/domain` —
`matchPredicate(anchor, resolvedFigure): matchedCounts[]` over the same resolved timeline
the reading view already materializes (post-variant `resolveFigure` output, so variant-owned
beats match by what the dancer actually sees). Values compare **by meaning** through the
merged registry's read aliases — reuse the normalization the "custom" badge comparison uses;
`none` matches a count carrying no live attribute of `kind` (for `role`-scoped predicates:
none for that role). Unknown persisted values pass through and match nothing known.

**Ownership & visibility:** identical to family notes — owned in the author's account doc
(a fourth anchor variant on the same annotation union), visible to co-members of any shared
choreo where a matching step appears, discovered via a new attribute-predicate index (never
by scanning account docs).

**The index (worker/D1):** `attribute_predicate_note_index`, mirroring
`figure_type_note_index` exactly (see `apps/worker/src/db/family-notes.ts`): columns
`noteId, accountDocRef, authorId, attrKind, attrValue, attrRole, scope, kind, text,
updatedAt, deletedAt`, alarm-projected from the account DO — non-destructive, idempotent,
tombstone-aware, DO is the single writer. Indexed to serve the read below with no SCAN
(`expectIndexedQuery` in CI). Rows carry the note content, like the family-note index.

**Read path (mirrors family notes):** `routine`-scoped predicate notes resolve entirely
client-side from the author's own account doc (self-read, offline-capable, merged live via
the same seam as `mergeLiveFamilyNotes`). Dance-/all-scoped notes of *others* come from the
new index gated by the same **accessible-authors set** the family-note read uses; the
client then runs `matchPredicate` against the resolved timelines it can already see — a
note row is visible only to co-members (same privacy envelope as family notes), and it
*surfaces* only where a step actually matches. The store materializer must preserve
referential stability (`store/reconcile.ts` rules — unchanged match sets keep object
identity), since this is the first content-dependent read path.

**The picker (web):** the v4 § 3.6 flow grafts onto the shipped choreo-first picker as a
new top-level target alongside the place/figure path: attribute family (from the merged
registry, custom kinds included) → value (incl. the explicit *no value logged* row) →
optional role → scope (*this choreo* · *all my &lt;dance&gt; choreos* · *every dance*).
`figureType` stays its own path — identity match, unchanged semantics; the unification is
the shared "target → scope" shape, not a data-model merge.

**Sync/permissions/migrations:** no new document types, no DO boundary change — the anchor
is new data in existing account-doc annotations (`anchors[]` union gains a variant; lenient
readers ignore unknown anchor types, so old clients degrade to not surfacing the note). No
migration step.

## Test plan & ship gate

Domain (unskip-first): `matchPredicate` — value match, alias normalization, the `none`
sentinel (incl. role-scoped absence), role filter, unknown-value pass-through, dynamic
re-resolution (retag → match set changes), property: match set ⊆ resolved counts. Worker:
alarm projection of predicate notes to the index (create/update/tombstone), the
accessible-authors read gate (co-member 200 with rows, non-member sees none), and
`expectIndexedQuery` on the new query. Web component: picker flow produces the anchor
shape; margin surfacing on matched steps; referential stability (no flicker on unrelated
doc changes); axe on the picker steps.

**Ship gate — `apps/web/e2e/attribute-predicate-anchors.spec.ts`:** (1) author creates
*"soften every left sway"* scoped to the dance → the note surfaces on every step carrying a
left sway across two of their choreos of that dance; (2) retagging the sway away drops the
note from that step, adding a left sway to a new step surfaces it there — no reload; (3) a
co-member of one shared choreo sees the note on its matching steps; a signed-in non-member
sees nothing via UI or direct index read. Shipping folds the delta into
`concepts/annotations.md` § Anchors + `system/architecture.md` § Annotations & projections
and deletes this file.

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
