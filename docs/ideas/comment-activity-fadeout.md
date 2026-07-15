# Comment activity fade-out in the timeline reading view

*(Created 2026-07-14 as WEP-0007, migrated 2026-07-15 · areas: web, domain, design.
Presentation-only — no data-shape change. **Design-complete and dispatch-ready as of
2026-07-15**: the collapsed divider, expand-in-place, and active-only margin derivation are
prototyped in `docs/design/project/Ballroom Builder v3.dc.html` — thread `f3|2` seeds the
comeback burst (9 collapsed + 3 active), `f4|1` the quiet >28-day thread that stays fully
readable with no divider. Execution plan:
[`comment-activity-fadeout.plan.md`](comment-activity-fadeout.plan.md).)*

## Summary

Comments should fade in importance over time **without ever being lost**. In the timeline
reading view (the notes margin and the per-anchor thread panel), only **active** comments
render by default; the rest collapse behind an honest, counted expander ("4 more comments")
that restores them on demand. A comment is *active* when its thread saw activity **within
the last 28 days**, *or* within **7 days of the newest comment in its list** — the second
clause is a session-gap window and guarantees a quiet routine never goes dark: the last
conversation stays readable no matter how long ago it happened.

Nothing is deleted, resolved, or marked read — staleness is a pure function of existing
timestamps and the current time, computed at render time. No migration, no new per-user
state.

## Mental-model delta

- [`docs/concepts/annotations.md`](../concepts/annotations.md) § Where notes appear: the
  reading view's margin cells and thread panels show **active** comments by default, with a
  counted expander for the rest; the margin cell's snippet/avatars derive from active
  comments only. The one-sentence user rule: *"comments from the last 4 weeks, plus the last
  conversation."*
- Explicit non-changes: no read/unread state, no resolve/archive, no reordering, no other
  surface (journal, library family notes) — reading view only.
- Mechanics: a pure domain partition helper; render-time evaluation. No system-doc impact
  beyond a note that this is the app's first wall-clock-dependent rendering (tests inject
  `now`).

## Motivation

Annotations accumulate for the life of a routine (soft-delete only), and the reading view
renders them all with equal weight. A routine coached for a season carries months of settled
feedback that visually drowns the two notes from this week's practice — the ones that matter
on the floor.

### Goals

- Default view = active comments only; stale ones behind a counted in-place expander.
- **A non-empty comment list never renders empty** (the newest comment is active by
  construction, and its whole 7-day burst comes with it).
- Nothing lost; expanding always restores full history.
- A reply to a stale thread **reactivates it** (activity is per thread: newest of the
  comment's and its live replies' timestamps).
- Explainable in one sentence.

### Non-goals

No read/unread tracking (a deliberate v1 fence — per-user state on shared docs); no
resolve/archive (manual gardening + permission questions; recorded below as the natural v2
companion); no reordering; no data-shape change; no notifications or live mid-session
ticking; no per-device persistence of the expanded state.

## Proposal

### The rule

For a rendered comment list (comments sharing one anchor), with
`lastActivity(c) = max(c.createdAt, createdAt of c's non-deleted replies)` and
`anchor = max(lastActivity)` over the list:

```
active(c) ⇔ lastActivity(c) ≥ now − 28×24h          (absolute window)
          ∨ lastActivity(c) ≥ anchor − 7×24h        (activity-relative window)
```

Rolling durations against stored unix-ms timestamps — never calendar days, so the set
doesn't depend on timezone or flip at midnight. The relative window is inclusive of its own
anchor, which guarantees never-empty. The composition is a recency window + a
**session-gap window** (the Google-Analytics/Flink-session construct); the relative clause
exists because human commenting is bursty with heavy-tailed gaps (Barabási 2005) — any fixed
window is simultaneously too short for quiet documents and too long for busy ones (the
documented GitHub stale-bot failure).

### Named scenario — the comeback Waltz

Dani and partner drill *Comp Waltz 2026* through May; the coach leaves 14 notes, 9 of them a
two-week burst on the Whisk's count 3. Summer break — 8 quiet weeks. In September the
partner adds one note on the Whisk: *"arm line collapsed again — video from Tue."*

*Today:* the thread shows all 10 comments with equal weight; May's settled corrections are
indistinguishable from this week's note.

*Proposed:* the thread opens on the September note; above it one divider reads **"9 more
comments"**; tapping expands the May burst in place, order preserved. The margin cell's
snippet and avatars derive from the active comment only.

The low-traffic half (the reason for the relative clause): the same couple's *Tango* was
last commented 6 weeks ago — three comments within four days. A pure 4-week cutoff renders
the thread empty, as if never coached; under this rule all three are active, no expander.

### Risks & mitigations

- *Cliff effect* (a comment collapses crossing day 28): the expander is always visible with
  an honest count — collapse never reads as loss (silent/miscounted hiding is the documented
  failure mode). A dimmed pre-fade near the boundary is a design option, not required.
- *Boundary flapping* (one new comment can collapse an old burst; deleting it uncollapses):
  accepted — the transition is the feature working; a hysteresis margin is a recorded
  refinement if it annoys in practice, not built speculatively.
- *Clock skew* (client-stamped timestamps): a future-dated comment is trivially active —
  harmless; a badly past-dated one collapses early but remains expandable.

## Design details

- **Data shape: unchanged.** Needs only `createdAt` + `deletedAt`, which exist. No sync,
  permission, DO, or D1 impact — read-side presentation only.
- **Domain helper** (pure): `partitionByActivity(annotations, now): { active, stale }` +
  exported window constants. Tombstoned replies don't count as activity; tombstoned
  annotations are already dropped by the store read.
- **Where it applies:** the reading view's per-anchor lists — the thread panel collapses
  stale comments behind one divider row (stale are the older ones, so the divider sits above
  the active tail); the margin cell derives snippet/avatars from active comments only. An
  all-stale non-empty cell cannot occur (never-empty guarantee). **Family notes that fold
  into the same margin cells are exempt** (2026-07-15): co-member family notes ride the
  projection and can lack an authored-time trail, and the margin has no expander for them —
  fade-out governs the routine-anchored comment lists only.
- **Evaluation time:** `now` captured per view mount and passed down; recomputation
  piggybacks on existing memoization — the store's referential-stability guarantees
  ([`docs/system/sync-and-offline.md`](../system/sync-and-offline.md) § Flicker) must be
  preserved. A view left open across a boundary re-evaluates on next data change or remount.
- **Lens split respected:** the read lens renders annotations, the editing lens doesn't —
  fade-out touches the read lens only.
- New en/de strings for the expander; no casts, no new types.
- **Design source:** `docs/design/project/Ballroom Builder v3.dc.html` — the counted
  divider row (collapsed) and its "showing all · collapse older" expanded state in the
  thread panel, and the margin cells deriving snippet/avatars from active comments only.

## Test plan & ship gate

Domain unit + property: window edges (both inclusive); reply reactivation; tombstoned
replies ignored; properties — non-empty input ⇒ non-empty active set; newest always active;
active ∪ stale is an order-preserving partition; everything within 28d active regardless of
anchor. Component: divider count/expand-in-place; margin derivation; no divider for
all-recent and all-within-session lists; axe on both states. E2E seeding needs backdated
`createdAt` via the test-support document builders (the UI stamps now).

**Ship gate — `apps/web/e2e/comment-activity-fadeout.spec.ts`:** (1) a 9-comment backdated
burst + one fresh comment on one anchor → margin shows the fresh snippet, thread shows fresh
+ "9 more comments", tap reveals all ten in order; (2) a routine whose only comments are a
3-comment >28d-old cluster → all three render, no divider. Shipping also folds the delta
into the concept docs and deletes this file.

## Drawbacks

- First wall-clock-dependent rendering: every covering test must inject `now`.
- A binary boundary (no gradual decay in v1) — mitigated by the counted expander.
- The relative anchor makes the active set non-monotone: *adding* a comment can *shrink*
  what's visible. Correct per the rule; will surprise at least one user once.
- Client-stamped timestamps now have visible consequences.
- Hidden-by-default invites "where did the feedback go?" — the counted expander and the
  never-empty guarantee are the load-bearing mitigations and must survive future design
  changes.

## Alternatives

- **Absolute window only** (the stale-bot model) — fails the Tango half: a quiet routine
  renders empty. The industry pattern with the worst documented backlash.
- **Continuous decay score with a threshold** (Elasticsearch-style) — more tunable, but
  fails explainability: "last 4 weeks plus the last conversation" survives a user asking
  *why is this hidden*; a score threshold doesn't. The hybrid rule is a degenerate
  two-parameter decay, so the path stays open.
- **Show-newest-N regardless of age** (Gmail's "N older messages") — never empty, but N is
  arbitrary: it splits the May burst mid-conversation and shows dead comments on abandoned
  routines as current. Fallback floor if the hybrid confuses.
- **Explicit resolve/archive** (Docs/Figma/GitHub) — the strongest industry signal, but a
  data-shape + permission change requiring manual gardening; the natural v2 companion (a
  resolved comment collapses always; the rules compose).
- **Per-user read/unread** — reopens a settled scope fence for no scenario benefit.
- **Burst clustering** (Kleinberg-style labeled episodes, latest expanded) — the most
  faithful model of coaching rhythm (the relative clause is its one-window special case) but
  strictly more UX/implementation for the same default view; natural successor if the single
  expander proves too coarse.
- **Stored staleness flag / background job** — staleness is a pure function of existing
  timestamps and `now`; storing it invents mutable derived state needing a writer and
  invalidation.

## Research notes

Session windows: Google Analytics sessions
(<https://support.google.com/analytics/answer/12798876>); Flink/Beam session windows
(<https://nightlies.apache.org/flink/flink-docs-stable/docs/dev/datastream-v2/builtin-funcs/windows/>).
Burst structure: Kleinberg, KDD 2002 (<https://www.cs.cornell.edu/home/kleinber/bhs.pdf>);
Barabási, Nature 435 (2005) (<https://www.nature.com/articles/nature03459>). Time-aware
ranking: Li & Croft, CIKM 2003 (<https://ciir.cs.umass.edu/pubfiles/ir-297.pdf>);
Elasticsearch decay functions. Collapsing UX: Gmail's "N older messages"; GitHub's
hidden-conversations backlash
(<https://github.com/orgs/community/discussions/130618>); the stale-bot criticism
(<https://github.com/actions/stale>).
