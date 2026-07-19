# Annotations & the journal

*The mental model of notes — corrections, lessons, practice observations — and where they
surface. For storage and the cross-account read path, see
[`docs/system/architecture.md`](../system/architecture.md).*

## One concept

Timeline comments and journal entries are **one thing**: an **annotation** —

```
{ author, kind (note | lesson | practice), text, tags, anchors[], replies[] }
```

- **Kinds** carry intent: a plain `note`, a `lesson` (what the coach said), a `practice`
  (what you noticed). Lessons and practice notes additionally appear in the Journal (below).
- **Replies** form a thread under each annotation; a reply is deletable by its author only.
- Deleting an annotation is a reversible tombstone, like everything else.
- Media attachments are a planned increment —
  [`docs/ideas/annotation-media-embeds.md`](../ideas/annotation-media-embeds.md).

## Anchors — what a note points at

An annotation targets the choreography through one of three anchor types:

1. **`point`** — one count of one figure placement in one choreo ("count 3 of *this* Whisk,
   here"). Optionally role-scoped.
2. **`figure`** — one whole figure placement in one choreo.
3. **`figureType`** — a whole figure **family** ([`figures.md`](figures.md) § Families),
   scoped to **one dance** or to **all dances** the family exists in ("every Feather,
   whether Waltz, Foxtrot, or Quickstep"). A family note may additionally be **timed**
   (carry a count, optionally a role) — but only with a concrete dance scope, never across
   dances: counts don't align between a Waltz Whisk's 1-2-3 and its Quickstep sibling's
   S-Q-Q. On read, a timed family note pins to its count on every matching figure that
   covers it; a shorter variant degrades gracefully to whole-figure surfacing — a note is
   never hidden.

A fourth anchor type — a *predicate* over notation ("all left sways") — is a designed future
idea: [`docs/ideas/attribute-predicate-anchors.md`](../ideas/attribute-predicate-anchors.md).

## Ownership & visibility

- **Routine-anchored notes** (`point` / `figure`) live with the choreo and are visible to all
  its members.
- **Family notes** (`figureType`) belong to their **author's account** — they follow the
  family across all the author's choreos — but are **visible to co-members of any shared
  choreo where a matching figure appears**: a coach's "on every Feather, keep the head left"
  surfaces for the student on their Feathers. A viewer never browses another person's notes
  wholesale; co-membership of a shared choreo is what authorizes seeing exactly the relevant
  ones. *(This visibility rule was an explicit choice — the alternative, strictly-private
  family notes, would have broken the coach→student scenario the feature exists for.)*
- Creating notes/replies requires **commenter** or better; anyone may only edit or delete
  **their own** ([`collaboration.md`](collaboration.md) § Roles).

## Where notes appear

- **The reading programme's notes margin:** the right ~29% of every figure is a margin — the
  figure header and each step row carry a cell with the note authors' avatars, a ＋ compose
  affordance (commenter+), and the latest note as a two-line snippet. Tapping a cell opens
  that anchor's thread. **Family notes surface here too** (2026-07-15): a `figureType` note
  matching the figure folds into the same margin cells as the routine-anchored notes — one
  merged, newest-first set, with family-scope notes tagged as such (a timed family note lands
  on its count's row, an untimed one on the figure header).
- **The figure detail (read lens):** the per-figure annotation thread plus the family-notes
  surface. The editing lens deliberately shows neither — the authoring surface stays clean.
- **The library:** from a figure family you can open the cross-dance note surface (annotate
  this dance or all dances) — the catalog-side home for family notes.
- **Filters:** all / lessons / practice / by figure.

*(A planned refinement — fading long-settled comments behind a counted expander — is
specified in [`docs/ideas/comment-activity-fadeout.md`](../ideas/comment-activity-fadeout.md).)*

## The Journal

The Journal tab is a **cross-choreo view over lesson/practice annotations** — not a separate
store. It merges (a) the routine-anchored lessons/practice notes from every choreo you can
see, author-colored, with resolved link chips, and (b) family-note lessons/practice entries.
Filter pills: all / lessons / practice / by figure. The entry editor has a Lesson/Practice
toggle, handwritten-style text, link chips, and a (disabled, planned) media affordance.

**The link picker is choreo-first** — one linear flow:

```
choreo → figure from that choreo (type-ahead) → placement on the figure's
attribute grid (entire figure, or one count, with a role lens) → scope last
```

The scope step offers exactly what the anchor model can honor:

- **whole figure** → *every dance this family exists in* (`figureType`/all) · *all my
  choreos of this dance* (`figureType`/dance) · *only this choreo* (`figure`);
- **one count** → *this dance* (timed `figureType`) · *only this choreo* (`point`) — never
  across dances.

The family scopes require a real catalog family: a from-scratch custom figure names no
family, so both family rows drop and the note falls through to a plain choreo annotation.
There is deliberately **no catalog path** — a figure links only from a choreo that places it
(the journal is about *your* dancing); the library's family-note surface remains the
catalog-side escape hatch.

*(A speech-driven capture path — speak a note, have the right anchor proposed — is a
dispatch-ready idea: [`docs/ideas/ai-voice-notes.md`](../ideas/ai-voice-notes.md).)*

---

**Under the hood:** where each note class is stored, the family-note index and its
co-membership read gate, and the Journal's merged read are in
[`docs/system/architecture.md`](../system/architecture.md) § Annotations & projections.
**Design source:** `docs/design/project/Ballroom Builder v3.dc.html` (link-picker section).
