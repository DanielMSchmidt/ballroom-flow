---
title: Comment activity fade-out in the timeline reading view
wep: 0007
owning-areas: [web, domain, design]
status: provisional
authors: ["@danielmschmidt"]
approver: owner
created: 2026-07-14
last-updated: 2026-07-14
see-also:
  [
    "PLAN §2.6 (annotation model — createdAt/deletedAt only)",
    "PLAN §4.3 (reading view notes margin)",
    "PLAN §4.6 (annotation filters — kind/figure, never time)",
    "PLAN §10 (read/unread is a v1 non-goal — deliberately untouched)",
    "WEP-0003 (anchor model — orthogonal, same Annotation type)",
    "WEP-0004 (journal links — writes to the same annotation surfaces)",
    "WEP-0005 (annotation media embeds — the margin's media chip must derive from active comments too)",
  ]
replaces: null
superseded-by: null
---

# WEP-0007: Comment activity fade-out in the timeline reading view

## Summary

Comments should fade in importance over time **without ever being lost**. In the
timeline reading view (`RoutineReadingView` — the notes margin and the per-anchor
thread panel), only **active** comments render by default; the rest collapse
behind an honest, counted expander ("4 more comments") that restores them on
demand. A comment is *active* when its thread saw activity **within the last
28 days**, *or* within **7 days of the newest comment in its list** — the second
clause is a session-gap window (the construct behind web-analytics sessions and
stream-processing session windows) and guarantees a quiet routine never goes
dark: the last conversation stays readable no matter how long ago it happened.

What becomes true that isn't today: a routine picked up after a break shows this
week's feedback instead of an undifferentiated pile of every note ever written,
while the old notes remain one tap away. Nothing is deleted, resolved, or marked
read — staleness is a pure function of existing `createdAt` timestamps and the
current time, computed at render time. No data-shape change, no migration, no
new per-user state.

## Motivation

Annotations accumulate for the life of a routine (soft-delete only, D-ledger),
and the reading view renders them all with equal weight — the notes margin's
snippet/avatar stack and the thread panel have no notion of age (`PLAN` §4.6:
filters are kind/figure only). A routine that has been coached for a season
carries months of settled feedback that visually drowns the two notes from this
week's practice, which are the ones that matter on the floor.

### Goals

- The timeline reading view shows **only active comments** by default, per the
  definition above; stale ones collapse behind a counted "N more comments"
  expander, expandable in place.
- **A non-empty comment list never renders empty.** The newest comment is active
  by construction (it is 0 days from itself), and the whole burst it belongs to
  (7-day session window) comes with it.
- **Nothing is lost.** Fading is presentation-only: no deletion, no archival
  flag, no stored staleness state. Expanding always restores full history.
- A reply to a stale thread **reactivates it**: activity is measured per thread
  (newest of the comment's and its non-deleted replies' `createdAt`), not per
  original comment.
- The rule is explainable in one sentence to a user ("comments from the last
  4 weeks, plus the last conversation").

### Non-Goals

- **No read/unread tracking.** PLAN §10 keeps per-user read state out of v1;
  this WEP deliberately does not reopen that decision — staleness here is a
  property of the comment's timestamps, identical for every viewer.
- **No resolve/archive state** (Google-Docs-style). That is manual gardening
  with permission questions (who may resolve?); recorded under Alternatives as
  the natural v2 companion, not part of this WEP.
- **No reordering or ranking.** Comment order stays as-is (chronological
  insertion); this WEP only partitions visible vs. collapsed.
- **No data-shape change**: no `updatedAt`, no new fields, no migration. Edits
  don't exist as an operation today and this WEP doesn't add them.
- **No notifications**, no live ticking (the boundary is evaluated when the view
  renders, not by a timer mid-session).
- Other comment surfaces — the journal, `AnnotationPanel`'s standard filter
  mode, the library's family-notes panel — are out of scope; timeline reading
  view only. (The domain predicate is written to be reusable if they follow.)
- No per-device persistence of the expanded state (expanding is session-local).

## Proposal

### The rule

For a rendered comment list (the comments sharing one anchor in the reading
view), with `lastActivity(c) = max(c.createdAt, createdAt of c's non-deleted
replies)` and `anchor = max(lastActivity)` over the list:

```
active(c)  ⇔  lastActivity(c) ≥ now − 28×24h          (absolute window)
            ∨ lastActivity(c) ≥ anchor − 7×24h        (activity-relative window)
```

Both windows are rolling durations against the stored unix-ms timestamps —
never calendar weeks/days, so the active set doesn't depend on the viewer's
timezone or flip at midnight. The relative window is inclusive of its own
anchor, which is what guarantees never-empty.

This composes two established primitives (research notes at the end): a recency
window (standard in time-aware retrieval) and a **session-gap window** — the
same shape as Google Analytics' inactivity-based sessions and Flink/Beam
session windows, and a one-window special case of Kleinberg-style burst
detection. The relative clause exists because human commenting activity is
bursty with heavy-tailed gaps (Barabási 2005): any fixed window is
simultaneously too short for quiet documents and too long for busy ones — the
documented failure of absolute-only staleness (GitHub's stale-bot backlash).

### Named scenario — the comeback Waltz

Dani and partner drill *Comp Waltz 2026* through May; before the June
competition their coach leaves 14 notes across the routine, 9 of them a
two-week burst on the Whisk's count 3 alone. Then summer break — the routine is
untouched for 8 weeks. In September the partner adds one note on the Whisk:
*"arm line collapsed again — video from Tue."*

*Today:* the Whisk margin cell shows the latest snippet; tapping it opens a
thread of all 10 comments with equal weight. May's pre-comp corrections — long
settled on the floor — are visually indistinguishable from this week's note,
and the reader scrolls history to find what currently matters.

*Proposed:* the thread opens on the September note; above it a single divider
row reads **"9 more comments"**. Tapping the divider expands the May burst in
place, oldest-first as today. The margin cell's snippet and avatar stack derive
from the active comment only, so the margin shows the September author, not a
stack of stale avatars.

The second half is the low-traffic case that motivates the relative clause:
the same couple's *Tango* routine was last commented **6 weeks ago** — three
comments within four days of each other. Under a pure 4-week cutoff the thread
would render empty, as if nobody ever gave feedback. Under this rule all three
are within 7 days of the newest, so all three are active and no expander shows.
The last conversation is always readable.

### Risks & mitigations

- *Cliff effect:* a comment visible today collapses when it crosses the 28-day
  boundary, with no intermediate state. Mitigation: the expander is always
  visible with an honest count — collapse never reads as loss (the failure mode
  in GitHub's hidden-conversations complaints is *silent* or miscounted hiding).
  A visual pre-fade (dimmed styling approaching the boundary) is a design-bundle
  option, not required for v1.
- *Boundary flapping:* one new comment moves the relative anchor forward and can
  collapse an old burst in a single step; soft-deleting the newest comment moves
  it back. Accepted for v1 — the transition is the feature working as intended,
  and everything stays one tap away. A hysteresis margin (stay active until
  7+3 days behind the anchor) is recorded as a refinement if flapping annoys in
  practice, not built speculatively.
- *Clock skew:* `createdAt` is client-stamped (existing model, same trust as
  `relativeTime` display today). A future-dated comment is trivially active —
  harmless; a badly past-dated one collapses early but remains expandable.

## Design Details

*(Sketch — to be completed for `implementable`. The UI surface requires a
`docs/design/` prototype per process §6 — the collapsed thread divider and the
stale-margin-cell treatment added to the Builder bundle are a promotion
prerequisite for this WEP.)*

- **Data shape: unchanged.** The rule needs only `Annotation.createdAt`,
  `Reply.createdAt`, and `deletedAt` tombstones, all of which exist (PLAN §2.6).
  No sync, permission, DO, or D1 impact — this is read-side presentation.
- **Domain helper** (`packages/domain`, pure TS): something like
  `partitionByActivity(annotations, now): { active, stale }` plus the two
  exported constants (`ACTIVE_WINDOW_MS = 28×24h`, `ACTIVITY_SESSION_MS =
  7×24h`). Pure function of its inputs — trivially unit/property-testable, and
  reusable by other surfaces later. Tombstoned replies don't count as activity;
  tombstoned annotations are already dropped by the store read.
- **Where it applies** (`apps/web`): `RoutineReadingView`'s per-anchor comment
  lists — the thread panel list collapses stale comments behind one divider row
  ("N more comments", Gmail's *N older messages* pattern; stale comments are
  the older ones, so the divider sits above the active tail); the notes margin
  cell (`NotesMarginCell`) derives its snippet and avatar stack from active
  comments only. A cell whose comments are *all* stale cannot occur for a
  non-empty list (never-empty guarantee), so the margin needs no empty-state
  treatment beyond today's.
- **Evaluation time:** at render, `now` captured per view mount and passed down
  (no per-frame `Date.now()` churn); recomputation piggybacks on the existing
  memoization (`useStableAnnotationsByFigure` / `store/reconcile.ts` identity
  stability must be preserved — the partition memoizes over the stable arrays).
  A view left open across a boundary re-evaluates on next data change or
  remount; that is accepted (Non-Goals: no live ticking).
- **Lens split respected:** the read lens renders annotations, the editing lens
  doesn't (PLAN §4.4) — fade-out therefore touches the read lens only.
- **i18n:** new en/de strings for the expander label (existing
  `i18n/messages/journal.ts` pattern).
- **Type honesty:** the partition takes and returns the existing `Annotation`
  type; no casts, no new assertions.

## Test Plan

TDD write-first, per layer:

- **Domain unit + property** (`packages/domain`, new spec beside
  `doc-routine.test.ts`): window edges (exactly 28d, exactly 7d behind the
  anchor — both inclusive); reply reactivation (old comment + fresh reply →
  active); tombstoned replies ignored; properties: (1) non-empty input yields a
  non-empty active set, (2) the newest comment is always active, (3) active ∪
  stale is a partition preserving input order, (4) everything within 28d of
  `now` is active regardless of the anchor. Factories: `makeAnnotation` already
  accepts explicit timestamps.
- **Component** (`apps/web/src/components/annotations.test.tsx` +
  `reading-view.test.tsx`): thread renders active tail + divider with correct
  count; tapping expands in place and keeps order; margin cell snippet/avatars
  derive from active comments only; all-recent and all-within-session lists
  render with no divider; axe pass on collapsed and expanded states.
- **Worker/DO:** none (no boundary change); coverage thresholds unaffected.
- **E2E:** the ship-gate journey below, `@smoke`-tagged for the core path.
  Seeding backdated comments needs the E2E fixture path to inject `createdAt`
  (the store's `createAnnotation` stamps `Date.now()`), so the seed goes through
  the test-support document builders, not the UI.

## Ship Gate

`apps/web/e2e/comment-activity-fadeout.spec.ts` — green on the implementing PR:

1. Seed a routine with a 9-comment burst on one anchor backdated beyond 28 days
   and one fresh comment on the same anchor. Open the reading view: the margin
   cell shows the fresh comment's snippet; the thread shows the fresh comment
   plus a "9 more comments" divider; tapping it reveals all ten in order.
2. Seed a second routine whose only comments are a 3-comment cluster (all
   within 7 days of each other) older than 28 days. Open its thread: all three
   render, no divider — the never-goes-dark guarantee.

Marking `implemented` additionally updates PLAN §4.3/§4.6 (the margin/thread
behavior and the new time-based visibility rule) and `docs/TEST-MAP.md` in the
same change.

## Drawbacks

- First wall-clock-dependent rendering in the app: every covering test must
  inject `now`, and a snapshot of the view is only reproducible with a pinned
  clock.
- A binary boundary means comments disappear from default view in one step
  (mitigated by the counted expander; no gradual visual decay in v1).
- The relative anchor makes the active set non-monotone: *adding* a comment can
  *shrink* what's visible (an old burst collapses). Correct per the rule, but it
  will surprise at least one user once.
- Client-stamped timestamps mean skewed clocks mis-bucket comments (pre-existing
  trust model, now with visible consequences).
- Hidden-by-default invites "where did the feedback go?" reports — the counted
  expander and the never-empty guarantee are the load-bearing mitigations, and
  both must survive future design changes.

## Alternatives

- **Absolute window only** (pure 4-week cutoff — the stale-bot model) —
  rejected: fails the comeback Waltz's Tango half (a quiet routine renders
  empty, as if never coached). Absolute-only inactivity staleness is the
  industry pattern with the worst documented user backlash (GitHub stale-bot).
- **Continuous decay score with a threshold** (Elasticsearch-style `exp`/`gauss`
  over last-activity, HN-gravity ranking) — more tunable, degrades smoothly,
  and can blend future signals (reactions, author role). Rejected for v1 on
  explainability: "last 4 weeks plus the last conversation" survives a user
  asking *why is this one hidden*; a score threshold doesn't. The hybrid rule is
  expressible as a degenerate two-parameter decay, so this path stays open.
- **Show-newest-N regardless of age** (Gmail's "N older messages", GitHub's
  timeline truncation) — never empty and trivially stable, but N is arbitrary:
  it splits the comeback Waltz's 9-comment burst mid-conversation and shows
  dead comments on abandoned routines as if current. Kept as the fallback
  *floor* idea if the hybrid ever proves confusing, not as the rule.
- **Explicit resolve/archive state** (Google Docs, Figma, GitHub review
  threads) — the strongest signal in industry practice, but it is a data-shape
  + permission change (who may resolve — author? any editor?), demands manual
  gardening, and PLAN §10 already fences adjacent per-user state out of v1.
  Time-based fading needs no user action and no new state. Recorded as the
  natural v2 companion: if resolution ever ships, resolved collapses always and
  unresolved would arguably never auto-collapse — the two rules compose.
- **Per-user read/unread tracking** — explicitly a PLAN §10 non-goal; requires
  per-user state on a shared doc (or per-device approximations) and reopens a
  settled scope decision for no scenario benefit over the time rule.
- **Burst clustering** (Kleinberg 2002 / session-merge with a 7-day gap):
  group the full history into labeled episodes ("9 comments · May 12–24"),
  latest episode expanded. The most faithful model of how coaching actually
  happens — the relative clause *is* its one-window special case — but strictly
  more UX and implementation for the same default view. Natural successor if
  the single expander proves too coarse.
- **Stored staleness flag / background job** — rejected: staleness is a pure
  function of existing timestamps and `now`; storing it invents mutable derived
  state that needs a writing actor, clock-skew-sensitive writes, and
  invalidation. Render-time evaluation is simpler and trivially testable.

## Research notes

The rule and its pitfalls were checked against the literature and industry
practice (2026-07-14):

- **Session-gap windows** (the relative clause's pedigree): Google Analytics
  sessions end after an inactivity gap measured from the last event
  (<https://support.google.com/analytics/answer/12798876>); Flink/Beam session
  windows stay open and extend while events arrive within the gap
  (<https://nightlies.apache.org/flink/flink-docs-stable/docs/dev/datastream-v2/builtin-funcs/windows/>).
- **Burst structure of human activity**: Kleinberg, *Bursty and Hierarchical
  Structure in Streams*, KDD 2002
  (<https://www.cs.cornell.edu/home/kleinber/bhs.pdf>); Barabási, *The origin of
  bursts and heavy tails in human dynamics*, Nature 435 (2005)
  (<https://www.nature.com/articles/nature03459>) — the citable argument that a
  fixed window alone cannot fit both quiet and busy documents.
- **Time-aware ranking / decay** (the alternative family): Li & Croft,
  *Time-Based Language Models*, CIKM 2003
  (<https://ciir.cs.umass.edu/pubfiles/ir-297.pdf>); Elasticsearch date decay
  functions
  (<https://www.elastic.co/docs/reference/query-languages/query-dsl/query-dsl-function-score-query>);
  Hacker News gravity and classic Reddit "hot" as deployed examples.
- **Collapsing UX precedents**: Gmail's "N older messages" stack; GitHub's
  hidden-conversations truncation and the backlash against its heuristic
  (<https://github.com/orgs/community/discussions/130618>) — the cautionary
  case for silent or unexpandable hiding; Google Docs/Figma hide on *explicit
  resolution*, never on age.
- **Absolute-inactivity backlash**: GitHub Actions stale bot
  (<https://github.com/actions/stale>) and its criticism — the direct evidence
  against the absolute-only alternative.
