# Choreographies

*The mental model of a routine — what it is, what it contains, and how it forks. For how
routines are stored and synced, see [`docs/system/architecture.md`](../system/architecture.md).*

A **choreography** (user-facing: *choreo*; internally: *routine*) is an ordered sequence of
**figures**, grouped into named **sections**, annotated over time. It is the thing a couple
dances: "Comp Waltz 2026". A choreo belongs to one **dance** (Waltz, Viennese Waltz, Quickstep,
Foxtrot, Tango — Standard travelling dances only in v1; Latin/spot dances are a future
increment).

The defining property: **a choreo does not contain figures — it references them.** Placing a
figure into a choreo creates a *placement* pointing at a figure that lives on its own (see
[`figures.md`](figures.md)). This referencing model is what makes the shared library, live
propagation, and forking work.

## Sections

- Ordered, **user-named** groups ("Intro", "Long side 1", …) with optional preset quick-fills.
  There is deliberately no long/short/corner enum — the app has no floor concept.
- Sections can be renamed, reordered, and deleted (deletion is always reversible-safe — nothing
  in this app is ever hard-removed; see [`collaboration.md`](collaboration.md) § Deleting).
- **Sections are collapsible, in both lenses:** a section folds behind its header/divider
  (▾/▸) in the builder *and* in the reading programme (the folded divider still shows the
  "N figs" meta). The fold state is **one per-screen set shared by both lenses** — fold a
  section while editing and it arrives folded in the reading view, and vice versa — and is
  ephemeral UI state (not persisted, nothing per-device). Folding is **display-only**: the
  continuous beat numbering is computed from the sections themselves, so a hidden section
  still occupies its span and visible figures keep their real running counts.

## Placements

A placement is one occurrence of a figure inside a section: *"the Feather Step, third item of
Long side 1"*. It carries:

- **A reference to a figure** — the placement is a pointer, never a copy. The same figure can
  be placed many times, in many choreos, by many people.
- **An optional portion window** (`part: from count → to count`): a placement can use *part* of
  a figure — "counts 4–6 of 6". The figure itself stays whole and live; the window only scopes
  what this placement shows and edits. Editing inside the window merges back into the full
  figure; counts outside the window are untouched and keep receiving upstream improvements.
  The window is fixed once placed — to change the range, re-place the figure. Portions are
  picked when placing a catalog figure ("How much of \<name\>?" — count-range chips or the
  whole-figure shortcut); account figures place whole.
- **Ordering**: placements (like sections) are reorderable, and a figure can be inserted
  *between* existing placements (a slim ＋ insert spot before each placement past the first).
  Reordering never destroys anything — see the ordering model in
  [`docs/system/architecture.md`](../system/architecture.md) § Ordering.

## Breaks are ordinary figures

A "Break" (a rest/pause block) is **not a special placement type** — adding one mints a small
choreo-local figure (`name: "Break"`, one bar long, no notation) referenced like any figure.
Consequences all fall out for free: a break is independently sizable (the counts stepper),
even annotatable, and it advances the beat counter and bar totals *because it is a figure*,
with no special-casing anywhere.

*(Why not one shared global "Break" figure? It couldn't be sized per use. Legacy break-shaped
placements from before this rule are migrated server-side; see
[`docs/system/architecture.md`](../system/architecture.md) § Migrations.)*

## Length, bars & the beat counter

- A choreo's length is the sum of its placements' lengths **in beats**: a whole placement
  spans its figure's length (see [`notation.md`](notation.md) § Figure length), a portioned
  placement spans its window, a break spans its beats. A held step still occupies its beats —
  a Foxtrot Feather (steps on 1, 3, 4; the Slow holds beats 1–2) spans 4 beats and the next
  figure starts on 5.
- **Bars are always derived** from beats (3 per bar for Waltz/Viennese, 4 otherwise); nothing
  authors bars directly.
- The reading view numbers beats **continuously across the whole routine**, wrapping at the
  dance's counted phrase (1–6 for Waltz/Viennese, 1–8 otherwise); the figure editor keeps
  **per-figure local counts**. See [`notation.md`](notation.md) § Timing.

## The choreo list

Your routines, shown as cards: dance-colored icon, title, `dance · N bars · created`; a card
with no figures reads "no figures yet"; a fork shows a "⑂ forked from \<title\>" lineage line.
"+" creates a new choreo (quota-checked — see [`collaboration.md`](collaboration.md) § Plans &
quotas). Per-card actions: **Open / Fork / Delete** (delete is owner-only and always a
reversible tombstone). Search by title/dance. First-run empty state offers a **read-only
sample** and a **start-from-template**.

Card data is a lightweight projection that can lag a few moments behind edits (eventually
consistent by design — see [`docs/system/architecture.md`](../system/architecture.md)
§ Projections).

## Forking — "make it your own"

A **choreo fork** creates a new routine seeded from the origin's current state, owned by the
forker, with lineage recorded ("forked from …"). The semantics are precise and deliberate:

- **Independent of its origin**: later edits to the origin routine — or to the origin owner's
  account figures — never reach the fork. To guarantee that, forking **copies every referenced
  account figure** (the origin's variants and customs) into fresh figures owned by the forker.
- **Still connected to the catalog**: a copied variant is copied *as a variant* — it keeps its
  live link to the global catalog figure, so catalog improvements keep flowing into the fork's
  untouched beats. Plain catalog references stay live references.
- Forking is also the product's **data-ownership story**: a self-contained owned copy of a
  shared choreo is delivered by forking, not by export/import.

*(Why this exact line? The owner worked the model against real scenarios: a fork exists to be
independent of the person you forked from, but nobody wants to stop receiving catalog
corrections. An earlier model where forks were frozen against everything was reversed — see
[`figures.md`](figures.md) § Why live figures.)*

## Assembling (the edit view)

The Assemble view is sections → placement cards. Each card shows the figure name, a **scope
badge** (Library vs Custom — a *content-divergence* check, see [`figures.md`](figures.md)
§ The custom badge), and a compact per-step attribute chip strip filtered to the active
role lens. Tapping the name or the strip opens the full-screen **figure detail** in the
editing lens ([`notation.md`](notation.md) § The figure editor). Add-figure/add-break
affordances sit in each section footer; share and role-lens toggles live in the header. Edit
affordances are gated by membership role ([`collaboration.md`](collaboration.md)).

**Adding a figure** (the add-figure sheet): catalog presets (pre-filled, placed as live
references — optionally as a portion), **your library figures** (placed by reference —
assembly, not creation), and an always-present **"Create my own figure"** row that swaps the
list for a compose view (name + length in counts, defaulting to one bar of the choreo's
dance). Confirming the compose view **always creates your own figure** — even a name that
collides with a catalog figure (typing "Natural Turn" there means *my* Natural Turn; the
catalog is reached by tapping its preset). A newly composed figure opens its editor
immediately; a catalog pick stays on the builder.

## Reading (the programme view)

The reading view is the choreo as a **programme**: every figure's notation laid out in up to
4 picked attribute columns (per-device column picker), a notes margin on the right
([`annotations.md`](annotations.md) § Where notes appear), continuous beat numbering, a
Leader/Follower lens, and — for Tango/Foxtrot/Quickstep — a counts ⇄ slows-and-quicks timing
lens. Reading never slides silently into editing: the figure detail opens read-only from
here, and editors flip it explicitly with a pencil toggle.

---

**Under the hood:** routine documents, placement/section shapes, ordering keys, and the card
projection live in [`docs/system/architecture.md`](../system/architecture.md); live
collaboration and offline behavior in [`docs/system/sync-and-offline.md`](../system/sync-and-offline.md).
**Design source:** `docs/design/project/Ballroom Builder v3.dc.html` (see
[`docs/design/README.md`](../design/README.md)).
