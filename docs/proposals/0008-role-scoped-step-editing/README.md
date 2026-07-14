---
title: Role-scoped step editing with a Both write mode
wep: 0008
owning-areas: [domain, web]
status: implemented
authors: [danielmschmidt]
approver: owner
created: 2026-07-14
last-updated: 2026-07-14
see-also: ["PLAN §1.5", "PLAN §4.4", "US-030", "docs/design/project/Ballroom Builder v3.dc.html"]
replaces: null
superseded-by: null
---

# WEP-0008: Role-scoped step editing with a Both write mode

## Summary

Reading a figure keeps the two-way **Leader | Follower** lens exactly as today. **Editing**
gains a third lens, **Both**, and the edit lens becomes the *write scope*:

- Under **Leader** or **Follower**, every value you place is stored role-scoped
  (`role: "leader"` / `role: "follower"`) and is visible only under that role's lens —
  today the quick-add path writes `role: null`, so a value added "for the leader" leaks
  into the follower's view. Editing a shared value under a single-role lens splits it:
  the other role keeps the old value.
- Under **Both**, one edit notates both dancers at once. **Direction** is stored verbatim
  for the leader and **mirrored** for the follower (forward ↔ back, diagonal_forward ↔
  diagonal_back, behind ↔ in_front; side/close/diagonal/in_place unchanged). **Sway**
  mirrors to_L ↔ to_R. **Footwork** is *not* derivable (there is no 1:1 mapping from the
  leader's heel/toe work to the follower's), so it is written for the leader only and the
  follower's stays empty until authored separately. Every other kind (rise, position,
  body actions, turn, custom kinds) is written once as a shared value (`role: null`),
  which both lenses already display.
- Both mode never clobbers hand-authored divergence: a (kind, count) whose stored values
  are **not** consistent with the derivation rule is locked under the Both lens — switch
  to Leader or Follower to edit it.

What becomes true that isn't today: an editor can notate a whole symmetric figure once
and get a correct follower chart for free; and a value placed under one role no longer
shows up under the other.

## Motivation

### Goals

- The edit-mode "STEPS FOR" toggle offers **Leader | Follower | Both**; the read-mode
  lens stays **Leader | Follower**.
- Every write is scoped by the active edit lens; single-role writes are invisible under
  the other role's lens (grid, recap, lanes, reading view).
- Both-mode derivation: direction mirrored, sway mirrored, footwork leader-only,
  everything else shared — matching how the verified WDSF seed charts are authored.
- Both mode edits only *derivation-consistent* state; genuinely diverged values are
  read-only under Both.

### Non-Goals

- No bulk "derive the follower chart" migration/backfill of existing figures or seed
  data — derivation happens at write time only.
- No attempt to derive follower **footwork** (heel turns etc. are authored, never
  computed) and no changes to the seed pipeline or `buildWdsfAttributes`.
- No change to the stored `Attribute` shape, the write schema, sync, permissions, or
  the worker — `role ∈ {leader, follower, null}` already carries everything needed.
- No "Both" option in the read-mode lens (a side-by-side comparison view is a separate
  idea, not this WEP).

## Proposal

**Named scenario — the Foxtrot Three Step.** The Three Step is symmetric: the leader
dances forward H·HT·TH while the follower dances the exact opposite directions. Today an
editor notating it opens count 1, taps the Step cell, and the quick-add writes a
`role: null` presence attribute; picking "forward" stores it for *both* roles — the
follower's chart now wrongly says "forward". To fix it they must open the per-cell
overlay, switch its ROLES control to "Per role", and hand-enter every value twice.

Proposed: the editor selects **Both** in the STEPS FOR toggle, taps count 1's Step cell,
picks "forward" and footwork "H". Stored: direction `forward (leader)` + `back (follower)`,
footwork `H (leader)` only. Adding rise "commence" on the same count stores one shared
`role: null` attribute. Flipping the lens to Follower shows "back" with empty footwork —
ready for the follower's footwork to be added under the Follower lens, where the write is
scoped to `role: "follower"` and the leader's chart is untouched.

**Diverged-cell rule (owner decision, 2026-07-14):** if count 3's direction is already
leader `forward` / follower `side` (hand-authored asymmetry, e.g. an outside swivel), the
Both lens shows that Step cell locked; editing it requires picking a role. A pair that
exactly matches the derivation rule (e.g. the pair Both mode itself just wrote) counts as
consistent, so Both mode can always re-edit its own output.

**Risks & mitigations:**
- *Wrong mirror for an edge value* — the mirror maps are data reviewed against the WDSF
  charts (leader back-feather `back`/`TH` pairs with follower `forward`/`H flat` in the
  seed); property test asserts the maps are involutions over the enum.
- *Splitting a shared value surprises the editor* — the split preserves the other role's
  view exactly (it sees the same value before and after); undo covers mistakes.
- *Existing scaffold data* (`role: null` everywhere) — unchanged semantics: shared values
  keep showing under both lenses and remain editable under every lens.

## Design Details

No document/schema/sync/permission changes. All work is in `packages/domain` (pure
helpers + registry data) and `apps/web` (lens plumbing + write-path semantics).

**Registry (kinds are data):** `RegistryKind` gains an optional
`bothWrite?: "copy" | "mirror" | "leaderOnly"` (default `"copy"`) and, for mirror kinds,
`mirror: Record<string, string>` — a total involution over `values`. `direction` and
`sway` are `"mirror"`; `footwork` is `"leaderOnly"`; everything else (including custom
kinds) defaults to `"copy"`.

**Domain helpers (new `packages/domain/src/role-write.ts`):**
- `deriveFollowerValue(kind, value)` → the follower's value for a Both write: the mirror
  image, the value itself (copy), or `undefined` (leaderOnly / presence `null` values).
- `bothWriteTargets(kind, value)` → `{ shared: value }` when the derived follower value
  equals the leader's (side steps, sway "none", every copy kind) — stored as one
  `role: null` attribute — else `{ leader, follower? }` stored as role-tagged attributes.
- `isBothConsistent(kind, attrsAtCount)` → whether the Both lens may edit this (kind,
  count): true for empty, shared-only, or a role-tagged set where the follower's values
  are exactly the derivation of the leader's (for `leaderOnly`, any follower value ⇒
  inconsistent). Cardinality-aware (multi kinds compare as sets).
- `splitSharedForRole(attrs, kind, count, role)` → the single-role-edit split: rewrites a
  `role: null` attribute of that kind/count as the *other* role's attribute so the
  current role's edit can't leak. IDs stay deterministic (`kind-count-value-scope`).

**Web:**
- `role-view.ts`: `RoleView` stays `"leader" | "follower"` (read lens). New
  `EditRoleView = RoleView | "both"`. `filterByRoleView` unchanged; the new
  `asReadView(lens)` coerces an edit lens to its read projection, so under Both
  every display surface filters by the leader-verbatim side
  (`filterByRoleView(attrs, asReadView(lens))`).
- `reading-columns-role.ts`: `bb_role` persists the edit lens too; read surfaces coerce a
  stored `"both"` to `"leader"`.
- `FigureTimeline`: the edit-mode toggle renders Leader | Follower | Both (read mode
  keeps two options). Quick-add writes `role: <lens>` (Both → `role: null` presence).
  Cells whose (kind, count) fails `isBothConsistent` under Both render locked (no edit
  affordance, `aria-disabled`, lock glyph) with a toast/hint pointing at the role lenses.
- `AttributeEditor`: the per-cell ROLES control ("Same for both" / "Per role") is
  **removed** — the top-level lens is the single role scope, one concept instead of two
  competing ones. The editor receives the edit lens and (a) renders only that scope's
  values, (b) writes via `bothWriteTargets` under Both, (c) splits shared values via
  `splitSharedForRole` before a single-role write or remove. Read-only rendering filters
  by the lens instead of today's any-role match.
- Design bundle: the Builder v3 prototype's figure-editor frame gains the third segment
  and the locked-cell treatment (`docs/design/project/Ballroom Builder v3.dc.html`),
  updated in the same change.

**Back-compat:** existing docs need no migration. `role: null` attributes keep their
meaning (shared, visible everywhere). Verified seed charts (role-tagged pairs) that
happen to match the mirror maps become Both-editable; the rest are locked under Both —
both outcomes are correct.

## Test Plan

TDD, new tests first at every layer:

- **Domain unit/property** (`packages/domain/src/role-write.test.ts`): mirror maps are
  total involutions over the enum values; `bothWriteTargets` collapses symmetric values
  to shared; `isBothConsistent` truth table (empty / shared / derived pair / diverged
  pair / follower-footwork present / multi-kind sets); `splitSharedForRole` preserves the
  other role's visible values. Keeps domain coverage ≥90 lines.
- **Component** (`apps/web/src/components/attribute-editor.test.tsx`,
  `figure-timeline.test.tsx`): edit toggle shows three options (read shows two);
  quick-add under Leader writes `role: "leader"`; a leader-scoped value is absent under
  the Follower lens; Both-mode direction pick emits the mirrored pair; Both-mode rise
  pick emits one shared attribute; diverged cell is locked under Both and editable under
  Leader; single-role edit of a shared value splits it.
- **E2E** (ship gate below): the Three Step journey through a real browser.

## Ship Gate

`apps/web/e2e/role-steps.spec.ts` (@smoke) green on the implementing PR: an editor sets
the lens to Both, places direction+footwork on a count, sees the mirrored direction and
empty footwork under the Follower lens and the verbatim pair under Leader; adds a
follower-only value and confirms it is invisible under the Leader lens; a hand-diverged
count is locked under Both. Marking this WEP `implemented` updates PLAN §1.5/§4 and
`docs/TEST-MAP.md` in the same change.

## Drawbacks

- The write path gains real branching (three lenses × four derivation modes) where today
  every write is "attach role, append" — carried in pure, property-tested helpers.
- Removing the per-cell ROLES control changes a shipped affordance; editors who used
  "Per role" rails now switch the top-level lens instead (one fewer concept, but a
  visible change).
- A Both-written asymmetric pair is two attributes, not one — figure docs grow slightly
  versus a hypothetical single "mirrored" attribute (rejected below).

## Alternatives

- **Store a single attribute with `role: "both-mirrored"`** and derive the follower on
  read. Rejected: changes the stored `Attribute` shape and every read path (grid, lanes,
  reading, divergence compare, WEP-0003's future predicate anchors) for the benefit of
  one write path; violates "no schema change" for no user-visible gain. Scenario it
  fails: the Three Step's follower chart must be independently editable afterwards
  (adding her footwork) — which forces materializing per-role attributes anyway.
- **Both mode overwrites diverged cells** (write-wins). Rejected by owner (2026-07-14):
  an outside swivel's hand-authored asymmetry silently destroyed by a Both-mode tap is
  exactly the data-loss shape undo exists to prevent, and locking is cheap.
- **Keep the per-cell "Same for both / Per role" control alongside the lens.** Rejected:
  two role scopes can contradict each other (lens says Leader, rail says both), and the
  incumbent control is the reason today's quick-add leaks (`role: null`) — the scenario
  this WEP exists to fix.
- **Mirror follower footwork too** (e.g. HT → TH). Rejected by owner (in the request):
  real charts disagree (leader `TH` pairs with follower `H flat` in the Back Feather);
  a plausible-looking wrong value is data corruption (no-fabrication rule, PLAN D30).
