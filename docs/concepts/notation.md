# Notation — attributes, timing & the figure editor

*The mental model of how technique is written down. This is the app's hero domain: everything
here is precise on purpose. For where these rules are implemented, see the "Under the hood"
block at the end.*

## The attribute — the unit of notation

An **attribute** is one piece of technique pinned to one moment of a figure:

```
{ kind, count (float), role (leader | follower | both), value }
```

- **`kind`** — what sort of technique: `direction`, `footwork`, `rise`, `position`,
  `bodyActions`, `sway`, `turn`, or any user-defined kind (§ Kinds below).
- **`count`** — a float relative to the figure's start; fractions encode off-beat timings
  (§ Timing).
- **`role`** — leader, follower, or *both* (the default; stored as "no role").
- **`value`** — typed by the kind; **may be empty** (§ Presence attributes).

### The invariants (the rules that must stay true)

1. An attribute is a **single kind → value** at one moment — not a bag of pairs. A figure
   holds any number of them.
2. **Many attributes may share a count** (and role). The only "one value per count" rule is
   *within a single kind*, governed by that kind's cardinality (single vs multi).
3. Attributes live **on the figure** — never on a placement or a choreo. (Annotations are a
   separate concept, not attributes.)
4. Removal is always a reversible tombstone, never a hard delete; reads drop deleted
   attributes by default.
5. Every kind resolves against **one merged registry** — built-in kinds plus the user's
   custom kinds. Built-in names are reserved: a custom kind colliding with one is ignored.
6. **Enum kinds** constrain values to their declared set (rejected on write, tolerated on
   read); **free-text kinds** treat their value list as suggestions. Reads are
   forward-compatible: unknown persisted values pass through; known legacy spellings
   normalize on read.
7. A kind can be **dance-gated** (`rise` does not exist in Tango): the write path rejects an
   inapplicable value, and the UI hides the kind entirely for that dance.
8. **A step's foot (L/R) is never stored** — steps alternate feet automatically. A step's two
   real dimensions are `direction` (the headline: forward/back/side/…) and `footwork` (the
   foot part: heel/toe contact).
9. Editing attributes requires edit rights; a choreo role cascades to its referenced figures
   ([`collaboration.md`](collaboration.md) § Roles).
10. Variants own beats per the per-beat rule in [`figures.md`](figures.md) § Variants; a
    presence attribute claims ownership exactly like a valued one.

## Kinds — the attribute registry

Attribute kinds are **data, not code**: every editor, lane, chip, and info sheet renders from
the merged registry. Each kind declares its label, color, cardinality (single/multi), value
type (enum/free-text), value list with per-value definitions, dance gate, role-awareness, and
its Both-lens write mode (§ Role lenses).

**Standard kinds** (vocabulary charted from the WDSF Technique Books, 2nd ed. 2013, with
dancecentral.info as secondary source):

| Kind | What it notates | Values (essence) |
|---|---|---|
| `direction` | The step headline — the moving foot's relative placement | Closed enum: `forward`/`back`/`side`/`diagonal_forward`/`diagonal_back`/`close`, own-foot crossings `behind`/`in_front` (lock steps — crossing your OWN foot; partner-outside work is `position`), `in_place`; legacy unsplit `diagonal` survives only for charts not yet re-verified |
| `footwork` | The foot part | Closed picklist over the charted contacts: `HT`/`TH`/`T`/`H`/`B`/`WF`/`BF`/`IE`/`flat`/`heel turn`/`heel pull`, the WDSF technique-book contacts (`H flat`, `HB`, `BT`, `TB`, `THB`, …), and the compound rolls the catalog carries (`HTH`, `THT`, …). Each value has a tight code, a descriptive label, and a one-line definition |
| `rise` | Rise & fall | `commence`/`body_rise`/`foot_rise`/`up`/`continue`/`lowering`/`body_lower`/`NFR`; **absent in Tango** |
| `position` | Couple position (single-valued) | `closed`/`promenade`/`counter_promenade`/`fallaway`/`outside_partner`/`left_side`/`right_side`/`tandem`/`wing`/`left_angle`/`CBMP` — CBMP is a *position*, not a body action |
| `bodyActions` | Body actions (multi-valued) | `CBM`/`side_leading`/`shaping`/`oversway`/`leg_line` |
| `sway` | Sway | `to_L`/`to_R`/`none` |
| `turn` | **The canonical rotation field** — amount turned on that step | `none` + L/R amounts in eighths (`eighth` … `full`); serialized as signed eighths (1 unit = ⅛ turn = 45°, positive = natural); per-step amounts sum to the figure's total |

*(Removed from the model, deliberately: a ballet-style `footPosition` kind (zero charted
uses), the WDSF prose columns `rotation`/`head` (the books' text stays in the seed data as
provenance only), and entry/exit **room alignment** — the top-down floor view was dropped, so
alignment carried complexity with no consumer. The per-step `turn` attribute is all that
rotation needs.)*

**Dance metadata:** Waltz/Viennese count 3 beats per bar and phrase over 6; Quickstep/Foxtrot/
Tango count 4 per bar and phrase over 8. All five are travelling dances.

**Custom kinds** are first-class: created and edited in-app (Profile → attribute types, and
the add-kind sheet in the editor), with their own label, description, per-value definitions,
role-awareness flag, enum values (entered as chips, not a comma blob), and a color from a
curated contrast-safe palette (every swatch readability-checked against the timeline surface).
Editing a custom kind keeps its identity stable so existing attributes never orphan. Custom
kinds get the same UI coverage as standard ones (info sheet, lanes, chips, filters).

## Timing — float counts

- A count is a **float**: the whole part is the beat, the fraction is the off-beat —
  **`e` = .25, `&` = .5, `a` = .75** (the conventional "1 e & a 2"), with `i`-subdivisions
  for eighth notes (`ia` = .125, `ai` = .375).
- **The editor shows per-figure local counts; the reading view numbers continuously** across
  the whole routine: one running counter threads every placement in order, wrapping at the
  dance's phrase (a figure starting the second Waltz bar reads "4"). Each placement advances
  the counter by its **length in beats** — never by how many steps it happens to carry — so a
  held Slow still occupies its beats. Within a placement, a step is numbered by its whole-beat
  offset; an off-beat renders as its symbol alone and consumes no number.
- Display labels always wrap at the dance's phrase (a Waltz never labels past 6), while the
  underlying counts stay continuous.
- **Slows & quicks:** for Tango, Foxtrot, and Quickstep a per-device reading lens switches
  numeric counts to `S`/`Q` syllables, derived from duration: two counts = Slow, one = Quick,
  `&` = half. Other dances always show counts.

## Figure length — `counts`

A figure carries an explicit **length in beats** (1–64), set at creation and adjustable via
the editor header's **"− LENGTH: N counts +"** stepper.

- **Default = the step span** — the highest whole beat any live step occupies, **not** the
  number of steps (the two differ whenever a figure holds a Slow: the Foxtrot Feather Step
  `SQQ` steps on 1, 3, 4 — three steps, length four). A fresh custom defaults to one bar of
  its dance.
- **The figure-length invariant (two-way, load-bearing):** a figure's length must cover its
  last step. Writes self-heal (the stepper cannot orphan a notated beat) and reads self-heal
  (a stored length shorter than the step span is lifted on read), so no step is ever hidden.
- **Bars are always derived** (`⌈counts / beatsPerBar⌉`) — a display unit, nothing more.

## Presence attributes — "present, no value yet"

An attribute's value may legitimately be **empty**: "a step happens here, detail later". A
presence attribute is a full citizen — it counts toward the figure's length, claims variant
beat-ownership, and renders as *present* (a dashed ring in the edit grid; a kind-colored dot
in the reading view) — never as a value chip, never as an empty slot. Closed-enum validation
exempts the empty value.

## The figure editor (the hero surface)

A **full-screen** editor opened from a placement. Its **grid is generated from the figure's
length, not from existing steps**: every possible timing (each beat plus its `e`/`&`/`a`
slots, grouped by derived bar) × every applicable attribute column. A cell has three states:
a **color chip** (set value), a **dashed ring** (presence attribute), or a faint **＋**
(empty slot).

- **Tap quick-add:** tapping an empty cell of an optional-value kind instantly writes a
  presence attribute ("Added · tap the dot to add detail"); tapping a ring, a valued chip, or
  a required-value kind opens the attribute editor.
- **The attribute editor** is a focused single-attribute overlay: exactly one (timing, kind),
  rendering only that column's kind(s) from the registry (the merged Step column edits
  direction + footwork). Edits commit eagerly (**Done** confirms, it doesn't save); re-tap
  clears; **Remove** clears that one attribute for the active role scope (a single role's
  remove first splits a shared value, preserving the partner's side).
- **Everything auto-saves** — there is no figure-level Save. The safety net is the header's
  **Undo/Redo**, which targets *this figure* (undo follows the surface being edited —
  [`collaboration.md`](collaboration.md) § Undo).
- **Portion-windowed editing:** opened from a portioned placement, the grid shows only the
  window's counts and the header shows "4–6 of 6" instead of the length stepper; edits merge
  back into the whole live figure ([`choreography.md`](choreography.md) § Placements).
- **Lanes** (one kind across all counts) and the add-kind affordance live below the grid.
- **Read vs edit lens:** the detail opens per its surface — the builder opens the editor, the
  reading programme opens the read-only view (static grid, notes surfaces shown, editing
  affordances absent) — and an editor flips between them only explicitly, via the header
  pencil. In the editing lens the surface is notation-only (no annotation threads) but shows
  the per-count text recap; the read lens is the reverse.
- Tapping a **column header** (either lens) opens the registry-derived **info sheet**: prose
  description + value glossary per kind; the merged Step column describes both of its kinds;
  a custom kind with no authored prose synthesizes at least its value list.

## Role lenses — reading and writing for leader, follower, or both

Leader/follower is a **view dimension, not a user attribute**: no stored default role; which
side you see is a per-device preference.

- **Reading** is a two-way lens: Leader | Follower.
- **Editing adds Both, and the lens is the write scope** ("STEPS FOR · Leader | Follower |
  Both"):
  - Under a **single role**, every write is stored role-tagged and is invisible under the
    other role's lens. Editing a shared (both-roles) value under a single-role lens first
    **splits** it — the other role keeps exactly what it saw.
  - Under **Both**, one edit notates both dancers by each kind's declared derivation:
    `direction` and `sway` store the leader's value verbatim plus the **mirrored** follower's
    (forward ↔ back, diagonal_forward ↔ diagonal_back, behind ↔ in_front, to_L ↔ to_R;
    symmetric values collapse to one shared attribute); `footwork` is **leader-only** — a
    follower's footwork is never derivable (real charts disagree; a plausible-looking wrong
    value is data corruption), so it stays empty until authored under the Follower lens;
    every other kind (custom included) **copies** as one shared attribute.
  - Both mode **never clobbers hand-authored divergence**: a (kind, count) whose stored
    values aren't consistent with the derivation rule renders locked under Both (🔒 +
    explanatory toast) — switch to a single role to edit it. A pair Both itself wrote counts
    as consistent, so Both can always re-edit its own output.

---

**Under the hood:** the registry and vocabulary data, timing math, figure-length resolution,
grid generation, and the Both-write derivation helpers are pure domain modules — see
[`docs/system/architecture.md`](../system/architecture.md) § The domain package. Ballroom
concepts themselves (what CBM is, why heel turns aren't derivable) are in the
`ballroom-dance-reference` skill. **Design source:** `docs/design/project/Ballroom Builder
v3.dc.html`.
