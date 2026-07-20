# Collaboration — people, roles, liveness, undo & offline

*The mental model of working together. For how permissions are enforced and how sync works,
see [`docs/system/architecture.md`](../system/architecture.md) and
[`docs/system/sync-and-offline.md`](../system/sync-and-offline.md).*

## Who uses this

A **flat collaboration model** — everyone is on the same level. Anyone creates choreos and
figures and invites others. There is no "coach account" or "student account"; leader/follower
is a view lens, not a person type ([`notation.md`](notation.md) § Role lenses). It's a
small-N collaboration tool for a couple and their coaches — not a social network or studio
LMS.

**Primary persona (an explicit owner decision):** the owner — a competitive dancer writing
down the choreographies they'll dance for years and annotating them with a partner and
coaches. The up-front cost of structured notation is *acceptable to this persona*; scope
decisions weigh this persona over a hypothetical low-patience newcomer.

The only privileged people are **admins** (app operators): they edit the global catalog in
place, approve catalog elevations, and can raise a user's routine cap. Nothing else is
admin-gated.

## Roles — per document

Sharing is **per document**: a choreo and a figure are shared independently (though choreo
roles cascade — below).

| Role | Can do |
|---|---|
| `viewer` | Read only. |
| `commenter` | Read; create annotations + replies; edit/delete **their own** notes only. |
| `editor` | Edit structure + annotations; invite/remove members; undo their own actions. |
| `owner` | Editor rights + delete the document. |

- **The cascade:** a choreo member's role extends to the figures that choreo places — a
  choreo *editor* may edit those figures; a commenter/viewer reads them. The cascade never
  grants *delete* on a figure.
- **Global catalog figures:** every signed-in user is implicitly a viewer; only admins write
  (a non-admin edit becomes a variant — [`figures.md`](figures.md) § Variants).
- **Your account data** (library bookmarks, family notes) is private to you — visible to
  others only through the scoped family-note rule
  ([`annotations.md`](annotations.md) § Ownership & visibility).
- Role changes take effect **immediately**, including on someone currently connected —
  removing an editor doesn't wait for them to reload.

## Invites

An editor shares by **link**: a server-issued, single-use, expiring token that — when
redeemed — creates a membership with the chosen role. Re-opening an already-redeemed link as
an existing member isn't an error (you're simply taken into the choreo); a non-member on a
dead token is rejected. The share sheet lists members, allows role changes and removal
(editor+), offers the fork action, and explains in microcopy that **edits to a shared figure
affect every routine using it** (fork for an independent copy).

## Live editing — what "together" means

Every document is collaborative in real time. Concurrent edits **merge** — there is no
locking, no "someone else is editing" refusal, no lost work:

- Two people editing different things: both land.
- Two people editing the *same* value: one value wins deterministically, and nothing else in
  either person's work is disturbed.
- Reordering merges with concurrent edits to the moved item (a move never destroys the thing
  moved).
- Deletions are tombstones, so a concurrent edit to a deleted item still merges sanely.

Propagation is the point: the couple and the coach edit the *same figure* together, and it's
live in every choreo that places it ([`figures.md`](figures.md) § The core rule).

## Undo — per person, per surface

Undo reverts **your own last change**, merging correctly with everyone else's concurrent
work — it never reverts a collaborator's edit.

- **Undo follows the surface being edited:** in the Assemble view it targets the choreo;
  inside the figure editor it targets *that figure* (this is what makes the editor's
  "no Save button" contract honest — a mis-tap in the grid is recoverable right there).
- Pressing undo with nothing left to undo is a no-op, never destructive.
- If someone else has **built on** the change you're undoing, undo still proceeds (the merge
  is safe) but the toast softens to *"Undone — others had built on this change"* — a hint,
  not a refusal.
- There is no cross-document undo (undoing a figure edit from the choreo view) and no undo
  of another person's work, by design.

## Deleting

**Nothing is ever hard-deleted.** Every removal — routine, section, placement, figure,
attribute, annotation, reply, membership, bookmark — is a reversible tombstone. Destructive
*actions* still get confirm dialogs (deleting a routine is owner-only), but the data model
underneath always keeps the history.

## Offline

The app is a PWA; the shell loads offline, and **editing works offline** for documents this
device has already opened: your edits persist locally, survive reloads, and replay when the
connection returns — exactly once, merged with whatever happened meanwhile. This covers
choreo structure, notation, annotations/replies, library bookmarks, and family notes.

**Creation stays online-only** ("live-gated"): new choreo, fork, invites, a new custom kind,
the *first* edit of a catalog figure (variant-spawn mints a new document), and **attaching
media to an annotation** (the upload is server-minting — a grant is issued and caps are
checked before the bytes stream to R2). These have server-side quota/permission effects the
user isn't present to resolve on replay — a product choice, not a technical limit. Offline,
they show an honest disabled state, never a queued half-action. Note that the note **text**
stays fully offline-capable: only *attaching media* to it needs a live connection.

Truth-telling is the bar: a pending chip shows undelivered changes; if replay is terminally
rejected (access revoked while away), the content stays readable under an unmissable alert —
**silent loss is the one forbidden outcome**. Coverage is cache-what-you-visited: a choreo
you never opened on this device isn't editable offline.

## Plans, quotas & identity

- **Free tier: at most 3 owned routines** (owned, not shared-in), with an upsell toast; a pro
  plan monetizes later (billing deferred — the quota seam exists now). An invite that would
  exceed a redeemer's editable cap downgrades to commenter on redeem. Admins can raise a
  specific user's cap ([`OPS.md`](../../OPS.md)).
- **Identity:** onboarding sets a display name + identity color (used to color your notes and
  avatar everywhere). Before someone onboards, co-members still see a real name (from their
  sign-in identity, or their email) and a per-choreo distinct default color — never a raw id
  or a color collision.
- **Language:** the UI is bilingual EN/DE (per-profile switch). User-authored content is
  never translated, and the figure catalog keeps its canonical English names in both
  languages.
- Each top-level page shows a short, skippable first-visit tour; "Replay the intro tours"
  lives on Profile.

---

**Under the hood:** permission enforcement (the document boundary, not the data), invite
token mechanics, quota seams, and identity caching are in
[`docs/system/architecture.md`](../system/architecture.md); sync, convergence guarantees,
offline persistence/replay, and liveness detection in
[`docs/system/sync-and-offline.md`](../system/sync-and-offline.md).
