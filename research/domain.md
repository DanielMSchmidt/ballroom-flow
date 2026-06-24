# Ballroom Dance Domain Reference

A domain reference for a collaborative ballroom-choreography builder. This document
is about ballroom dance knowledge only; it makes no software-design recommendations,
though it flags where a concept maps cleanly onto a controlled vocabulary (enum) or a
recurring ambiguity the team will want a dancer to resolve.

## 0. Orientation: the teaching/syllabus systems

Ballroom terminology is not free-form. It is governed by a handful of **syllabus and
technique systems**, and almost every term below has an "official" definition in one of
them. The dominant ones:

- **ISTD** — Imperial Society of Teachers of Dancing (London). The most widely cited
  authority for **International Standard** and **International Latin**. Its technique
  books describe figures in **chart form** (one row per step, columns for the technique
  categories). The chart format itself was devised by **Alex Moore** when the technique
  was revised in 1948. ([ISTD shop](https://shop.istd.org/product/item-the-ballroom-technique/),
  [Casa Musica – ISTD Ballroom Technique 10th ed.](https://casa-musica.com/en/literature-books/49083-istd-ballroom-technique-10th-edition-.html))
- **Alex Moore, *Ballroom Dancing*** — the canonical reference text for English/International
  Standard technique; effectively the source from which the ISTD charts derive their
  layout and language. ([Perlego listing](https://www.perlego.com/book/814925/ballroom-dancing-pdf))
- **IDTA** — International Dance Teachers' Association. A parallel UK body; terminology is
  nearly identical to ISTD with minor wording differences.
- **Imperial / "the Revised Technique"** — historically the ISTD's own technique; the names
  are sometimes used interchangeably in older sources.
- **WDSF** — World DanceSport Federation. Publishes its own **figure catalogue** (Figurenkatalog)
  used for competitive grading worldwide; figure *names* mostly match ISTD but the WDSF
  catalogue organises and levels them differently. ([WDSF Figurenkatalog](https://www.tanzsport.de/de/sportwelt/standard-und-latein/wdsf-figurenkatalog))
- **American Smooth / American Rhythm** (Arthur Murray, Fred Astaire, DVIDA) — a separate
  North-American tradition. Same dance *names* (Waltz, Foxtrot…) but different figures,
  open-position breaks, and a "spot vs travelling" treatment that differs from International
  style. Where it diverges materially, it is noted.

**Key takeaway for the data model:** terminology is *system-relative*. The same figure can
have slightly different official step counts, alignments, or even names across ISTD / IDTA /
WDSF / American. A figure or technique value should be attributable to a source system.

---

## 1. Glossary

### Top-level structural terms

- **Dance** — a named ballroom dance with its own music, character, and figure repertoire
  (e.g. Waltz, Tango, Foxtrot, Quickstep, Viennese Waltz; Cha Cha, Rumba, Samba, Paso Doble,
  Jive). Determines time signature, tempo, and whether floorcraft (line of dance) applies.
- **Choreography / Choreo / Routine** — a deliberately ordered sequence of figures for a
  *single* dance, fitted to a piece (or length) of music. Often quoted in **bars** ("a
  64-bar Waltz routine"). A routine is the unit a couple memorises and performs.
- **Amalgamation** — a combination of two or more figures joined so they flow as a unit. An
  amalgamation is the building block *between* a single figure and a full routine: figures →
  amalgamations → routine. ([LBDC glossary](https://lbdc.ca/glossary-of-ballroom-dance-terms/))
- **Figure** — a named, standardised movement pattern (e.g. Natural Turn, Reverse Turn, Whisk,
  Chassé, Feather Step, Closed Change). Defined in the syllabus with a fixed step count,
  timing, footwork, alignments, and a defined set of figures it may precede/follow. The set
  of figures available is a **figure library / syllabus**; choreographers also invent
  **custom (non-syllabus) figures**.
- **Step** — a single weight change (one "beat" of footwork) within a figure. A figure
  decomposes into an ordered list of steps; each step carries the technique attributes in
  §2. A step is **not** always one musical beat — a slow step can occupy two beats.
- **Syllabus** — the le-velled, official list of figures used for teaching, exams, and
  competition (e.g. Bronze / Silver / Gold; or Pre-Bronze, Bronze, etc.). ([ISTD Standard
  syllabus PDF](http://ballroomatuva.org/wp-content/uploads/2015/06/ISTD-Standard-Syllabus.pdf))

### Roles

- **Leader** (traditionally "the man" / "gentleman" in older texts; modern usage prefers
  **leader/follower** which are role-, not gender-bound) — initiates and navigates the
  figures; primarily responsible for **floorcraft**.
- **Follower** ("the lady" in older texts) — responds to the lead. Crucially, the follower
  dances a *different* step pattern from the leader in the same figure: when the leader steps
  forward the follower steps back, sway and turn often mirror, footwork differs (e.g. heel
  turns are typically the follower's). **Every figure therefore has two parallel step charts,
  one per role.** (See open question Q1.)

### Floor geometry & floorcraft

- **Line of Dance (LOD)** — the imaginary line of travel around the floor, running
  **counter-clockwise**. Travelling (Standard) dances progress along it.
  ([SI Ballroom – Line of Dance](https://www.siballroom.org/line_of_dance.html))
- **Against Line of Dance (ALOD / backing LOD)** — the opposite direction.
- **Wall** — the outer edge of the room, on the dancer's *right* when facing LOD.
- **Centre** — toward the middle of the room; the alignment opposite Wall.
- **Long Side** — one of the two long edges of the rectangular floor; the LOD runs straight
  along it. The bulk of *travelling* figures happen here, moving down the room.
- **Short Side** — one of the two short edges; a shorter straight run before the next corner.
- **Corner** — the junction of a long and short side. Because LOD changes direction ~90° at a
  corner, corners are where **turning/redirecting figures** are placed; sides are where
  progressive figures travel. The floor is effectively a rectangular circuit of
  Long–Corner–Short–Corner–Long–Corner–Short–Corner. ([Arthur Murray – Floorcraft](https://blog.arthurmurraylive.com/what-is-floorcraft-in-ballroom-dancing),
  [Delta.Dance – lost art of floor craft](https://delta.dance/2024/01/lost-art-floor-craft/))
- **Floorcraft** — the skill of placing and adapting figures so the couple travels safely
  around the floor, follows LOD, negotiates corners, and avoids other couples. Choreography
  is built *around* the side/corner structure precisely so corners get turning figures and
  sides get travel. ([Arthur Murray – Floorcraft](https://blog.arthurmurraylive.com/what-is-floorcraft-in-ballroom-dancing))

### Alignment & direction (these become a controlled vocabulary)

**Alignment** = the direction a step/figure is oriented relative to the room. It has two
parts: a **qualifier** (how the body relates to the direction) + a **direction** (the room
reference). ([Dance Central – glossary](https://www.dancecentral.info/ballroom/resources/glossary),
[Dance Central – alignment diagram](https://www.dancecentral.info/ballroom/resources/alignment-diagram))

Qualifiers:
- **Facing** — front of the body points to the direction (used on forward steps).
- **Backing** — back of the body points to the direction (used on backward steps).
- **Pointing to** — the *foot* points to the direction but the *body* does not (yet) — used
  when foot and body differ, e.g. in promenade or mid-turn.
- **Moving toward** — the step travels in a direction independent of where the body faces.

Directions (the eight room references):
- **Line of Dance (LOD)**
- **Against Line of Dance (ALOD)**
- **Wall**
- **Centre**
- **Diagonal to Wall (DW / DTW)** — diagonal, to the *right* of LOD.
- **Diagonal to Centre (DC / DTC)** — diagonal, to the *left* of LOD.
- **Diagonal to Wall against LOD** and **Diagonal to Centre against LOD** — the two
  "backwards" diagonals, used on short sides and after corners.

A typical alignment value reads "**Facing Diagonal to Wall**" or "**Backing LOD**." This
two-token structure (qualifier × direction) is a natural enum pair. ([Dance Central – alignment diagram](https://www.dancecentral.info/ballroom/resources/alignment-diagram),
[Ballroom Dance ATL – Room Alignments](http://ballroomdanceatl.com/room-alignments/))

### Body / technique terms

- **CBM (Contrary Body Movement)** — turning the opposite side of the body toward the moving
  foot (forward or back) to *initiate* rotation. It is a *body action*. ([Dance Central – glossary](https://www.dancecentral.info/ballroom/resources/glossary))
- **CBMP (Contrary Body Movement Position)** — a *foot position*, not a body action: the foot
  is placed on or across the line of the supporting foot (front or behind), e.g. in Promenade
  Position or Tango walks. CBM and CBMP are distinct and a step may have either, both, or
  neither. ([Dance Central – glossary](https://www.dancecentral.info/ballroom/resources/glossary))
- **Rise & Fall** — the controlled rise (elevation through feet, ankles, legs, body) and lower
  characteristic of swing dances (Waltz, Foxtrot, Quickstep). Recorded per step, e.g. "Rise
  at end of 1; up on 2 and 3; lower at end of 3." Tango has **no rise & fall**.
  ([WebSearch – ISTD technique chart example](https://www.scribd.com/doc/36129771/The-Ballroom-Technique-Alex-Moore))
- **Sway** — inclination of the body away from the moving foot / toward the inside of a turn,
  used to balance momentum. Recorded as **Left / Right / None (—)**.
  ([Dance Central – glossary](https://www.dancecentral.info/ballroom/resources/glossary))
- **Footwork** — which part of the foot contacts the floor and in what order. Standard
  abbreviations: **H** = Heel, **T** = Toe, **B** = Ball, **F** = Flat / Whole Foot
  (**WF**), and compounds like **HT** (heel then toe), **TH** (toe then heel),
  **BH** (ball then heel). Also **IE/OE** (inside/outside edge). ([Dance Central – glossary](https://www.dancecentral.info/ballroom/resources/glossary))
- **Amount of Turn** — how much rotation happens, expressed as a fraction of a full turn
  *measured between two steps* (between the feet), e.g. **1/8 (45°), 1/4 (90°), 3/8 (135°),
  1/2 (180°)**, plus phrasing like "**body turns less**" (the body rotates less than the
  feet), "**commence to turn**," "**complete the turn**," and "**no turn**." Turn is
  directional: **to L** or **to R**. ([Dance Central – Turns](https://www.dancecentral.info/ballroom/international-style/international-standard-technique/turns))
- **Heel Turn** — a turn made by drawing the closing foot to the standing foot and turning on
  the heel of the standing foot; characteristic of the follower in many Standard figures.
- **Count / Timing / Beat Value** — the rhythmic value of a step. Two notations coexist:
  - **Numeric beats**: "1 2 3" (Waltz), "1 2 3 4."
  - **Slow/Quick**: **S** (Slow ≈ 2 beats in 4/4), **Q** (Quick ≈ 1 beat), giving patterns
    like **S Q Q** (Foxtrot Feather) or **S S Q Q S** (Quickstep). Cha Cha uses split beats
    "2 3 4 & 1." The same figure's timing can be written either way depending on dance.

### Position & frame terms (commonly attached to figures/steps)

- **Closed (Hold) Position** — standard ballroom frame, partners offset slightly to their
  left.
- **Promenade Position (PP)** — a "V" shape, both opening toward the same side to travel along
  the open end (e.g. into a Whisk → Chassé).
- **Outside Partner (OP) / Partner Outside (PO)** — stepping outside the partner's track
  (right or left side), e.g. Feather Step.
- **Contact / shadow / fallaway / fan / open** positions — used especially in Latin.

---

## 2. The standard technique categories (the chart columns)

The app's set — **Count, Action, Rise & Fall, Body, Footwork, Sway, Turn** — is essentially
the **canonical ISTD / Alex Moore technique-chart column set**, with one synthesis: "Body" in
the app conflates the chart's CBM/CBMP/body-position content. The classic ISTD chart row, one
per step, has columns approximately:

1. **Step number**
2. **Description / Action** — what the foot does in words ("LF forward", "RF to side",
   "LF closes to RF"). This is the app's **Action**.
3. **Count / Beat value / Timing** — "1 2 3" or "S Q Q". App's **Count**.
4. **Amount of Turn** — fraction + direction, measured *between this and the previous/next
   step*. App's **Turn**.
5. **Rise & Fall** — per-step rise/lower description. App's **Rise & Fall**.
6. **Footwork** — H/T/B/HT etc. App's **Footwork**.
7. **CBM / CBMP / body position** — body actions. App's **Body**.
8. **Sway** — L / R / none. App's **Sway**.
9. **Alignment** — facing/backing/pointing × direction (the app should consider whether this
   is per-step or per-figure; see Q4).
10. **Lead / Foot position** — sometimes a separate column.

A real worked example confirms the column structure — the **Waltz Reverse Turn (leader)**:

| Step | Count | Footwork | Alignment | Turn | Rise/Fall | Sway | CBM |
|------|-------|----------|-----------|------|-----------|------|-----|
| 1 | 1 | LF forward | Facing DC | Starts to turn L | Start to rise end of 1 | None | CBM |
| 2 | 2 | RF to side | Backing DW | 1/4 between 1–2 | Continue rise 2–3 | L | — |
| 3 | 3 | LF closes to RF | Backing LOD | 1/8 between 2–3 | Lower end of 3 | L | — |
| 4 | 1 | RF back | Backing LOD | Continue turn L | Start to rise end of 4 | None | CBM |
| 5 | 2 | LF to side | Pointing DW | 3/8 between 4–5 | Continue rise 5–6 | R | — |
| 6 | 3 | RF closes to LF | Facing DW | Body completes turn | Lower end of 6 | R | — |

([Dance Central – Waltz Reverse Turn](https://www.dancecentral.info/ballroom/international-style/waltz/waltz-reverse-turn))

So **yes, the app's seven categories are the canonical set** (Body absorbing CBM/CBMP), with
**Alignment** the main additional column that real charts carry. **Lead** and explicit
**Foot Position** are occasional extra columns.

### Suggested controlled vocabularies (enums)

These are the concrete value sets the team can lift directly:

- **Count / Timing**
  - Slow/Quick: `S`, `Q`, `&` (half-beat), `a` (quarter-beat, e.g. Quickstep/Jive).
  - Numeric: `1`, `2`, `3`, `4`, plus `&`, `a` for splits.
  - A step usually carries a beat-value (how many beats it occupies): `1`, `2`, `½`, `¾`.
- **Footwork** (ordered contacts): `H`, `T`, `B`, `F`/`WF`, `HT`, `TH`, `BH`, `B HF`,
  `IE`, `OE`, `Toe Heel`, `Heel Toe`, `Flat`, `Pressure` (Tango), `Whole Foot`. Plus
  "**No foot rise**" annotations.
- **Sway**: `Left (L)`, `Right (R)`, `None (—)`. (Occasionally "broken sway".)
- **Rise & Fall**: free-text phrasing today, but decomposable into
  `commence to rise` / `up` / `continue to rise` / `up on toes` / `lower` / `no foot rise` /
  `NFR (no foot rise)`, each tied to "at end of N" or "on N–M". Tango = always `none`.
- **Amount of Turn**: magnitude ∈ `none`, `1/8`, `1/4`, `3/8`, `1/2`, `5/8`, `3/4`, `7/8`,
  `1` (and "between feet" vs "body turns less"); direction ∈ `L`, `R`. Often qualified by
  `commenced` / `completed` / `between steps N–M`.
- **Body (CBM/CBMP/position)**: `CBM`, `CBMP`, `CBM & CBMP`, `none`, plus positional flags
  `PP (Promenade)`, `OP/PO (Outside Partner)`, `Fallaway`, `Shadow`, etc.
- **Alignment**: qualifier ∈ `Facing`, `Backing`, `Pointing to`, `Moving toward`; direction ∈
  `LOD`, `ALOD`, `Wall`, `Centre`, `DW`, `DC`, `DW against LOD`, `DC against LOD`.
- **Action verbs** (the Description column, semi-controlled): `forward`, `back`, `to side`,
  `closes to`, `crosses`, `point`, `brush`, `swivel`, `pivot`, `lock`, `ronde`, `replace`.
  ([Dance Central – Turns](https://www.dancecentral.info/ballroom/international-style/international-standard-technique/turns),
  [ISTD technique chart excerpt](https://www.scribd.com/doc/36129771/The-Ballroom-Technique-Alex-Moore))

---

## 3. How dancers/choreographers actually record routines

- **Technique charts** (above): the formal, exam-grade record — one row per step, full
  column set, per role. This is what an ISTD/IDTA examiner expects and what coaches use to
  correct detail.
- **Amalgamation lists / "skeleton" routines**: in practice most working routines are
  recorded far more loosely — an *ordered list of figure names with bar counts and
  alignments at the joins*, e.g. "Natural Turn (DW, 1 bar) → Closed Impetus → Progressive
  Chassé to Right → ...". The fine technique is assumed known from the syllabus and only
  *deviations* are written down. ([Ballroom Dance Experience – using routines/choreography](https://www.ballroomdanceexperience.com/blog/using-routines-and-choreography-dance-floor))
- **Precedes / follows rules**: each syllabus figure has a defined set of figures it can
  *follow* (its valid entries) and *precede* (valid exits). These are constrained by (a)
  which foot is free at the end, (b) the ending alignment, and (c) the ending position
  (closed vs PP vs outside partner). A routine is valid only if every join respects the
  preceding figure's exit and the following figure's required entry. The ISTD technique books
  list "**Preceding figure**" and "**Following figure**" for each entry. (Sources discuss the
  concept; the exact tables live in the ISTD technique books and WDSF catalogue.
  [ISTD Standard syllabus](http://ballroomatuva.org/wp-content/uploads/2015/06/ISTD-Standard-Syllabus.pdf),
  [WDSF Figurenkatalog](https://www.tanzsport.de/de/sportwelt/standard-und-latein/wdsf-figurenkatalog))
- **Alignment & direction at joins**: the data dancers most care about between figures is
  *what foot is free, what alignment you end on, and what position you're in* — because that
  determines what can come next and whether you're set up for the corner.
- **Bars & timing**: routines are quoted in **bars of music**; each figure consumes a known
  number of bars (a Waltz Natural Turn = 1 bar = 3 beats; many figures are 1 or 2 bars). A
  full competition routine must fit the heat length (often ~1.5–2 minutes).
- **What they care about capturing**: figure order; bar count per figure and running total;
  alignment/foot at each join; which figures are "feature" vs "linking"; corners vs sides
  placement; deviations from syllabus technique; lead/follow split where it differs from the
  norm; and *coaching notes* (see §5).

---

## 4. Structure of a routine

**Figures → amalgamations → routine, mapped onto the floor and the music.**

- **Figures combine into amalgamations** subject to precede/follow compatibility (free foot,
  end alignment, end position). A well-formed amalgamation flows without an awkward adjusting
  step.
- **Mapping onto the floor (Standard/travelling dances):** the routine is laid over the
  rectangular circuit. **Long sides** carry progressive, travelling figures (Feather, Three
  Step, progressive chassés, natural/reverse turns travelling down LOD). **Corners** carry
  the turning/redirecting figures (impetus turns, spin turns, outside swivels) that rotate
  the couple ~90° to pick up the new LOD onto the **short side**, then again at the next
  corner. Alignment notation at each figure tells you whether you're set up correctly for the
  corner. ([Arthur Murray – Floorcraft](https://blog.arthurmurraylive.com/what-is-floorcraft-in-ballroom-dancing),
  [Dance Central – Quickstep choreography](https://www.dancecentral.info/ballroom/international-style/quickstep/quickstep-choreography))
- **Mapping onto the music:** each dance has a **time signature** and is counted in **bars**.
  Figures are written to start on bar/beat boundaries; "bar label" in the app corresponds to
  the running bar index where a figure begins. A 3/4 Waltz figure occupying one bar = 3
  beats; a 4/4 Foxtrot Feather Step = S Q Q over one bar.
- **Section structure:** longer routines are often grouped into phrases that align with the
  music (e.g. 8-bar phrases), and choreographers think in "down the side → around the
  corner" units.

---

## 5. Collaboration practices (validates threads/journal/tagging)

How a couple + coach actually annotate and discuss a routine:

- **Granularity of notes.** Feedback attaches at several levels, and the same routine accrues
  notes at *all* of them simultaneously:
  - **Whole routine / section**: "the whole second long side is rushing the music."
  - **A figure**: "make the Closed Impetus bigger / more turn here."
  - **A single step**: "step 3, more lower"; "your step 5 is short."
  - **A specific technique attribute on a step**: "more sway L on 2"; "heel turn, not a toe
    pivot, on step 4"; "no foot rise on step 3" — i.e. a note bound to *one cell* of the
    technique chart.
  - **Per role**: notes are frequently role-specific ("follower's heel turn", "leader's
    frame on the natural turn"), so a note may target leader, follower, or the couple.
- **Iteration / journal.** Routines evolve over many lessons: figures get swapped, a corner
  amalgamation gets rebuilt, timing changes. Couples and coaches value a history of *why* a
  change was made ("changed the corner to a double reverse spin because we kept running out
  of floor"). This validates a journal/versioning concept.
- **Threaded discussion.** A point on one step ("are we doing the chassé or the open turn
  here?") generates back-and-forth between the two partners and the coach — a thread anchored
  to a specific figure/step/attribute. Different coaches (technique vs choreography vs
  competition) may comment on the same routine.
- **Tagging.** Notes get tagged by theme: "musicality", "frame", "footwork", "floorcraft",
  "for nationals", "fix before Friday". Tags cut across the figure/step hierarchy.

This strongly supports the app's threads/journal/tagging model, with the important nuance
that a note's anchor can be *anything from the whole routine down to one technique attribute
of one step of one role* (see Q2/Q3).

---

## 6. Dance-specific specifics

### International Standard (a.k.a. "Modern Ballroom"; American = "Smooth")

All five are **travelling** dances: the side/corner/LOD floorcraft model **fully applies**.
Tempos below are competition figures (BPM = beats/min, MPM = bars/measures per min).
([Ballroom Pages – tempo chart](https://www.ballroompages.com/ballroom-music/tempo-chart/),
[Ballroom-music.net – Standard dances](https://ballroom-music.net/dances),
[FL Dancesport – International Standard](https://fldancesport.com/international-standard-ballroom-dances-waltz-foxtrot-tango-etc/))

| Dance | Time sig | Beats/bar | Tempo (BPM) | ≈ MPM (bars/min) | Rise & Fall | Notes |
|-------|----------|-----------|-------------|------------------|-------------|-------|
| **Waltz** | 3/4 | 3 | ~84–90 | ~28–30 | Yes (swing) | "1 2 3" timing; smoothest swing dance. |
| **Tango** | 2/4 (or 4/4) | 2 (counted) | ~120–132 | ~30–33 | **No rise & fall** | Staccato; SQQ-type; CBMP walks; no sway swing. |
| **Viennese Waltz** | 3/4 | 3 | ~174–180 | ~58–60 | Slight | Fast continuous rotation; very limited figure set. |
| **Slow Foxtrot** | 4/4 | 4 | ~112–120 | ~28–30 | Yes (swing) | S Q Q; long, gliding, continuous. |
| **Quickstep** | 4/4 | 4 | ~200–208 | ~50–52 | Yes (swing) | S/Q with hops, locks, runs. |

### International Latin (American = "Rhythm"; overlapping but different figures)

The floorcraft model applies **differently**. Most Latin dances are **spot dances** — the
couple works largely in place, so the LOD / side / corner model **does not drive the
choreography** the way it does in Standard. The exception is **Paso Doble**, which **does
travel along LOD** (counter-clockwise), so the side/corner model partially applies to it.
This is a real data-model fork: a Dance needs a flag for *travelling vs spot*, and the
side/corner organisation should be optional (relevant for Standard + Paso, largely
irrelevant for Cha/Rumba/Samba/Jive). ([Fred Astaire – Latin styles](https://www.fredastaire.com/blog/ballroom-dances/types-of-latin-dances),
[Ballroom Dance Academy LA – descriptions](https://ballroomdanceacademyla.com/the-dances/descriptions-of-dances/),
[ISTD Latin syllabus](http://www.wright-house.com/dance/istd-international-latin-syllabus-ballroom-dance.html))

| Dance | Time sig | Beats/bar | Tempo (BPM) | Floorcraft | Notes |
|-------|----------|-----------|-------------|------------|-------|
| **Cha Cha** | 4/4 | 4 | ~120–128 | Spot | Split-beat "2 3 4&1"; chassé cha-cha-cha. |
| **Rumba** | 4/4 | 4 | ~100–108 | Spot | "Slow on 1" hold; "2 3 4-1" timing. |
| **Samba** | 2/4 (or 4/4) | 2 | ~96–104 | Mostly spot; some travel | Bounce action "1 a 2"; some figures progress. |
| **Paso Doble** | 2/4 | 2 | ~120–124 | **Travelling (LOD)** | March; the one Latin dance using LOD/corners. |
| **Jive** | 4/4 | 4 | ~168–184 | Spot | Triple-step chassés "1 2 3a4 3a4". |

Note the disagreement between sources on exact tempos (e.g. Tango quoted both ~128 BPM beat
rate and ~30–33 MPM; Waltz 84–90 BPM = 28–30 MPM). Store both BPM and MPM and treat exact
numbers as system-dependent. ([Ballroom Pages tempo chart](https://www.ballroompages.com/ballroom-music/tempo-chart/),
[qbds.ca tempos](http://www.qbds.ca/tempo.htm))

---

## 7. Open domain questions for a dancer to clarify

These are genuine ambiguities a dancer must resolve before the data model is fixed:

1. **Whose attributes are these?** A figure has *two* step charts — leader and follower —
   that differ (different footwork, mirrored sway, follower's heel turns). Does a "step" in
   the model hold one role's data, or both side-by-side? Are leader and follower steps always
   1:1 (same count) or can they differ in number?
2. **Note anchor granularity.** Confirm the lowest level a note can attach to: routine,
   section, figure, step, or a *single technique attribute of a step*. The research suggests
   notes occur at all levels — does the app want a uniform polymorphic anchor?
3. **Per-role notes.** Should a note target leader / follower / both? Coaches routinely give
   role-specific corrections.
4. **Is alignment per-step or per-figure?** Real charts record alignment per step, but
   choreographers often think per-figure ("enter this figure facing DW"). Which is the
   primary record, and is the other derived?
5. **Timing notation.** Is timing stored as Slow/Quick tokens, numeric beats, or both? They
   must reconcile with the dance's time signature and the figure's bar count. How are split
   beats (`&`, `a`) represented?
6. **Amount of turn semantics.** Turn is measured *between* steps (1→2, 2→3) and the body can
   turn less than the feet. Is "turn" a property of a step, or of the *transition between*
   two steps? And does it need both a "feet" and a "body" amount?
7. **Custom / non-syllabus figures.** How much structure must a custom figure carry — full
   step charts, or just a name + bar count? Can a custom figure declare its own
   precede/follow compatibility?
8. **Syllabus system attribution.** Should figures and even technique values be tagged with
   their source system (ISTD vs IDTA vs WDSF vs American), given they differ? Does a routine
   mix systems?
9. **Floorcraft model scope.** Confirm that side/corner/LOD applies to Standard + Paso Doble
   and should be optional/absent for spot Latin — and whether American Smooth (which mixes
   travelling and open spot work) needs a hybrid treatment.
10. **Bars vs beats vs steps.** Clarify the relationship the app should enforce: a figure
    spans N bars = M beats = K steps, and these must be internally consistent with the dance's
    time signature. Is the "bar label" an absolute running index or per-section?

---

## Sources

- [ISTD – The Ballroom Technique (shop)](https://shop.istd.org/product/item-the-ballroom-technique/)
- [Casa Musica – ISTD Ballroom Technique, 10th ed.](https://casa-musica.com/en/literature-books/49083-istd-ballroom-technique-10th-edition-.html)
- [Alex Moore, *Ballroom Dancing* (Perlego listing)](https://www.perlego.com/book/814925/ballroom-dancing-pdf)
- [The Ballroom Technique – Alex Moore (Scribd excerpt, chart columns)](https://www.scribd.com/doc/36129771/The-Ballroom-Technique-Alex-Moore)
- [ISTD Modern Ballroom syllabus outline (Sept 2021)](https://www.istd.org/documents/modern-ballroom-syllabus-outline-september-2021/modern-ballroom-syllabus-september-21.pdf)
- [ISTD International Standard syllabus (wright-house)](http://www.wright-house.com/dance/istd-international-standard-syllabus-ballroom-dance.html)
- [ISTD International Latin syllabus (wright-house)](http://www.wright-house.com/dance/istd-international-latin-syllabus-ballroom-dance.html)
- [ISTD Standard syllabus PDF (ballroomatuva)](http://ballroomatuva.org/wp-content/uploads/2015/06/ISTD-Standard-Syllabus.pdf)
- [WDSF Figurenkatalog](https://www.tanzsport.de/de/sportwelt/standard-und-latein/wdsf-figurenkatalog)
- [Dance Central – Glossary](https://www.dancecentral.info/ballroom/resources/glossary)
- [Dance Central – Alignment diagram](https://www.dancecentral.info/ballroom/resources/alignment-diagram)
- [Dance Central – Turns (amount of turn notation)](https://www.dancecentral.info/ballroom/international-style/international-standard-technique/turns)
- [Dance Central – Waltz Reverse Turn (worked chart)](https://www.dancecentral.info/ballroom/international-style/waltz/waltz-reverse-turn)
- [Dance Central – Quickstep Choreography](https://www.dancecentral.info/ballroom/international-style/quickstep/quickstep-choreography)
- [Ballroom Dance ATL – Room Alignments](http://ballroomdanceatl.com/room-alignments/)
- [SI Ballroom – Line of Dance](https://www.siballroom.org/line_of_dance.html)
- [Arthur Murray Live – What is Floorcraft](https://blog.arthurmurraylive.com/what-is-floorcraft-in-ballroom-dancing)
- [Delta.Dance – The lost art of floor craft](https://delta.dance/2024/01/lost-art-floor-craft/)
- [Ballroom Dance Experience – using routines & choreography](https://www.ballroomdanceexperience.com/blog/using-routines-and-choreography-dance-floor)
- [LBDC – Glossary of Ballroom Dance Terms (amalgamation)](https://lbdc.ca/glossary-of-ballroom-dance-terms/)
- [Ballroom Pages – Tempo Chart](https://www.ballroompages.com/ballroom-music/tempo-chart/)
- [qbds.ca – Ballroom dance music tempos](http://www.qbds.ca/tempo.htm)
- [Ballroom-music.net – Standard dances](https://ballroom-music.net/dances)
- [FL Dancesport – International Standard dances](https://fldancesport.com/international-standard-ballroom-dances-waltz-foxtrot-tango-etc/)
- [Fred Astaire – Types of Latin dances](https://www.fredastaire.com/blog/ballroom-dances/types-of-latin-dances)
- [Ballroom Dance Academy LA – Descriptions of dances](https://ballroomdanceacademyla.com/the-dances/descriptions-of-dances/)
