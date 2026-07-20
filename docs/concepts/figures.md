# Figures, variants & the library

*The mental model of figures — the reusable unit of choreography. For how figure documents are
stored, resolved, and seeded, see [`docs/system/architecture.md`](../system/architecture.md).*

A **figure** is a named unit of choreography — a Feather Step, a Natural Turn, your own
invented link — described as a timeline of attributes over counts ([`notation.md`](notation.md)).
Figures exist independently of choreos; choreos *reference* them
([`choreography.md`](choreography.md) § Placements).

## The core rule: figures are live wherever referenced

**Editing a figure edits the figure — everywhere.** A figure placed in three choreos shows the
edit in all three, immediately, including choreos your co-editors own. This is the app's
deliberate, foundational semantic: **propagation over isolation**. It's *your* figure, refined
over time, danced everywhere it appears. The safety story is visibility plus escape hatches,
not confirmation friction:

- the figure editor always shows **"used in N choreos"**, so propagation is never a surprise;
- a choreo **fork** gives you an independent copy when you want isolation
  ([`choreography.md`](choreography.md) § Forking);
- the global catalog is protected by **variants** (below), so nobody can edit the shared
  canon in place.

*(**Why live figures?** The model went the other way once — "frozen copies", where editing a
figure from outside its choreo silently snapshotted it, guaranteeing "an edit in one choreo
never changes another". The owner reversed that after working it against a real scenario, the
**Passing Tumble Turn** — see § Variants below: frozen copies meant a variant could never
receive catalog improvements, and every shared-figure workflow degenerated into divergent
copies. The reversal is final; don't re-propose freezing.)*

## Figure families — `figureType`

A **figureType** names a *family* of similar figures that exist in multiple dances with
different steps: a *Feather* exists in Foxtrot, Waltz, and Quickstep — three different
figures, one family identity. Each (family × dance) is its own figure; they share the
`figureType` so:

- the library can group and browse by family across dances;
- an annotation can target the whole family — "on every Feather, keep the head left" — in one
  dance or across all dances ([`annotations.md`](annotations.md) § Family notes).

A variant or custom figure inherits its family + dance from what it was based on; a
from-scratch custom gets a private family of its own (nothing else shares it, so family-wide
notes don't apply to it).

## Scopes: the catalog, your figures, and the choreo-local default

**The global catalog** is application-wide: the canonical Standard syllabus (~265 figures
across the 5 dances, charted from the WDSF Technique Books / ISTD identity), readable and
placeable by every signed-in user, editable **only by admins**. Catalog content is seeded from
verified source data and the seed remains authoritative for seeded values — corrections reach
every environment ([`docs/system/architecture.md`](../system/architecture.md) § Seeding). The
charted figures arrive with full both-role step content; uncharted ones carry an honest
scaffold (timing plus start/finish phrases) — **footwork is never invented** (the
no-fabrication rule).

**Everything else is account-scoped** — owned by its creator, live wherever referenced:

- **Choreo-local (the default):** a figure created or diverged inside a choreo. Glue steps,
  links, and one-off tricks stay out of every library. It's editable by everyone who can edit
  a choreo that places it (the role cascade — [`collaboration.md`](collaboration.md) § Roles).
- **Library membership is a bookmark, not a copy.** "Add to my library" records a reference in
  *your* account, making the figure appear on your library screen and placeable into your other
  choreos. The same figure can sit in several people's libraries — your partner bookmarks the
  very figure you made in a shared choreo, and you both keep editing the one shared figure.
  Un-bookmarking removes the entry, never the figure; placements are untouched.

## Variants — editing the catalog without breaking it

Editing a **global** figure as a non-admin never touches the catalog. Instead it spawns a
**variant**: your own figure, linked live to its base, that **owns only the beats you
changed**. The placement re-points to the variant automatically (toast: *"made this figure
yours"*).

**Per-beat ownership** is the precise rule:

- The variant **owns beat *b*** the moment it carries any content on *b* (either role, any
  kind — including a deleted value; a beat once touched stays owned).
- An **owned beat reads wholly from the variant** — both roles, all kinds, sub-beat timings
  included. Base values never leak into an owned beat: a re-choreographed beat never shows
  steps you don't dance.
- An **unowned beat reads live from the base** — catalog improvements keep appearing there
  automatically.
- **Copy-down on first touch:** editing an unowned beat first materializes the base's current
  content for that beat into the variant (nothing visually disappears), then applies your
  edit. Deleting a base-provided value = copy-down + delete. Reverting a beat back to exactly
  the base's content releases ownership.
- Variant edits never mutate the base; base edits never rewrite owned beats.
- A variant without its own explicit length inherits its base's length live; setting the
  length stepper pins it.

**The canonical scenario (the *Passing Tumble Turn*):** a Slowfox choreo places the catalog
Tumble Turn twice — once plain, once danced as a Passing Tumble Turn (footwork/shape/turn
changed for the last ~3 beats). When the catalog Tumble Turn later gains values of a new
attribute kind, the plain placement shows them on every beat (live reference), and the Passing
variant shows them **only on its untouched beats** — its re-choreographed beats stay exactly
as authored. Every design change to variants must keep this scenario working.

**One base, many variants:** each re-timed placement of the same catalog figure may get its
own independent variant — there is deliberately no "at most one derivative per base" rule.

**Account figures never spawn variants.** Editing an account figure — yours or a co-editor's,
choreo-local or library — is always in place. Variant-spawn is exclusively the
global-edit path.

## The custom badge — divergence, not mechanism

A placed figure is badged **Custom** only when its *resolved content* (or its name/identity)
has actually diverged from its origin: a variant owning ≥1 changed beat, a rename, or a
from-scratch custom. An unedited catalog reference — or a legacy copy still identical to its
base — reads **Library**. Divergence compares attributes *by meaning* (kind, count, role,
value) over the resolved timeline, ignoring internal identity. The same predicate gates the
placement card's "add to my library" affordance (only a diverged/custom figure offers it —
bookmarking a pristine catalog figure is the Library screen's job).

*(Precision, 2026-07-19: this badge comparison is a **raw** value equality — it does not run
the registry read-aliases. The distinct "matched by meaning" of attribute-predicate anchors
([`annotations.md`](annotations.md) § Anchors) normalizes both sides through `normalizeValue`
before comparing. Two different comparisons, deliberately: the badge asks "did the bytes
change from the base?", the predicate asks "does this value mean the anchor's value?".)*

## The library screen

Two halves:

- **Catalog browse:** canonical figures grouped by family, dance filter chips (including an
  "All" cross-dance view), a "↟ save" bookmark affordance per card. From a family you can open
  the **cross-dance note** surface ([`annotations.md`](annotations.md)).
- **Your library:** your bookmarks — amber cards with lineage ("based on \<base\>" for a
  variant, else "your own figure"), a Library/Custom scope badge, "used in N routines", an
  edit affordance, dance filter, and a guided empty state per dance.

## Naming & renaming

The figure editor's add-to-library bar carries a naming input: saving with a changed name
**renames the live figure itself** (visible in every referencing choreo), then bookmarks it.
A diverged figure with an origin carries the identity-reassurance chip *"adjusted for this
choreo — still \<name\>"*; a from-scratch custom shows no such chip (nothing was adjusted).

## Elevation (user figure → catalog)

A user may propose one of their library figures for the global catalog; an **admin** approves
(the figure is re-scoped to global, ownership transfers to the app, existing placements keep
working — same reference) or rejects. Until an approval-queue UI exists this is an operator
action ([`OPS.md`](../../OPS.md)).

---

**Under the hood:** figure documents, `resolveFigure` per-beat resolution, variant spawn, the
fork copy, and the catalog seed pipeline live in
[`docs/system/architecture.md`](../system/architecture.md); the figure-data/charting workflow
in the `ballroom-flow-figure-data-pipeline` skill. **Design source:**
`docs/design/project/Ballroom Builder v3.dc.html`.
