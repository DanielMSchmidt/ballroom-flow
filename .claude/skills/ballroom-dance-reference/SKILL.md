---
name: ballroom-dance-reference
description: Load when work touches figures, attributes, timing, alignment, footwork, syllabus/seed data, or any file in packages/domain (vocabulary.ts, dances.ts, timing.ts, figure-steps.ts, wdsf-timing.ts, docs/seed/*) and you don't know ballroom dancing. The domain theory pack — maps ballroom concepts (S/Q timing, CBM vs CBMP, rise & fall, heel turns, LOD alignment) to this codebase's exact enums and modules.
---

# Ballroom dance reference — the domain theory behind the code

Weave Steps notates **International Standard ballroom choreography**. Every enum in
`packages/domain/src/vocabulary.ts` is a real dance-technique term with an official
definition. This skill teaches enough ballroom to read, extend, and review that code
without inventing domain data. Assume zero dance knowledge.

**When NOT to use this**
- Building/regenerating the seed catalog or `*.generated.ts` files → **ballroom-flow-figure-data-pipeline** (this skill only tells you what the data *means*).
- CRDT/Automerge mechanics, variants/fork resolution internals → **ballroom-flow-crdt-reference**.
- Module boundaries, store seam, DO/D1 → **ballroom-flow-architecture-contract**.
- Process (TDD, PLAN.md updates, branching) → **ballroom-flow-change-control**.

**Cardinal domain rule (D30/#117/#118 lineage): never invent domain data.** Figures
without a verifiable per-step source were *removed* from the catalog, not guessed
(`docs/seed/figure-charts.json` meta; `scripts/gen-figure-charts.mjs` header). If you
need a figure's footwork and it isn't in `figure-steps.ts`, the answer is "unverified —
leave the scaffold", not a plausible-sounding chart.

---

## 1. The structural hierarchy

```
Dance (Waltz…) → Routine (a whole choreography, quoted in BARS of music)
                 → Amalgamation (a run of figures that flows as a unit — informal here)
                   → Figure (named, standardised pattern: "Reverse Turn", "Whisk")
                     → Step (ONE weight change; a Slow step = 2 beats, so step ≠ beat)
                       → per-step technique attributes (the chart cells)
```

- A **figure** is the reusable unit: in this app a `FigureDoc` with a float-count
  attribute timeline (`packages/domain/src/doc-types.ts`). A **routine** references
  figures via placements.
- A **step** is one weight change. It is *not* one musical beat — a **Slow (S)**
  occupies 2 beats, a **Quick (Q)** 1. The app does not store "steps" as entities;
  a step is implied by the attributes sharing a `count`.
- **Amalgamation** and **precede/follow rules** (which figures may legally join) are
  ballroom theory the app does *not* enforce in v1 — no compatibility validation exists.

### Leader and follower dance DIFFERENT patterns

The two partners in one figure dance *different* charts: when the leader steps forward
the follower steps back, sway and turn mirror, and footwork differs (heel turns are
typically the follower's). Every syllabus figure therefore has **two parallel step
charts**. Consequences baked into the code:

- `Attribute.role ∈ "leader" | "follower" | null` (`doc-types.ts:15,22-30`); `null`
  means "the couple together" (rise and position are couple-shared; direction,
  footwork, sway, turn, bodyActions are `roleAware` in the registry).
- Role is a **view dimension, not a user attribute** (PLAN §1.5): no stored default
  role; which role's steps you see is a per-device toggle.
- **Foot (L/R) is NEVER stored** (PLAN §2.5): feet alternate automatically with each
  weight change, so recording "LF"/"RF" would be redundant and could drift. The step's
  headline is `direction` (forward/back/side/…), not which foot.

---

## 2. Syllabus systems — whose truth is it?

Ballroom terminology is **system-relative**: the same figure can differ in name, step
count, timing, and level across authorities. The players (research/domain.md §0):

| System | What it is | Role in THIS repo |
|---|---|---|
| **ISTD** (Imperial Society of Teachers of Dancing) | The canonical London authority for International Standard; technique published as per-step **charts** (format devised by Alex Moore, 1948; *Ballroom Dancing* is the canonical text) | **System of record / figure identity.** `docs/seed/istd-standard-figures.json` (Sept 2024 syllabus outline; carries `istdLevel` bronze/silver/gold + `istdGrade`) |
| **WDSF** (World DanceSport Federation) | Competitive federation; publishes its own figure catalogue (Figurenkatalog) with per-figure timing strings | **Timing + start/finish source.** `docs/seed/wdsf-standard-figures.json` (`wdsf.timing` like "123 123", "SQQ"); parsed by `wdsf-timing.ts` |
| **IDTA** | Parallel UK body, near-identical ISTD terminology | Not used |
| **American Smooth/Rhythm** | Separate North-American tradition (same dance names, different figures) | Out of scope |

Operating rule: **ISTD provides identity; WDSF provides timing/start/finish/notes**
(header of `packages/domain/src/library-data.ts`; the WDSF seed's own
`meta.planDiscrepancy` flags this and defers to ISTD as the system of record). Neither
public syllabus contains per-step footwork — that lives in paid technique books, which
is why the charted-figure seed (`figure-charts.json`, 147 figures, WDSF-first,
dancecentral.info primary) exists as a separate, source-attributed research artifact.

---

## 3. The five v1 dances

`packages/domain/src/dances.ts` is the single registry — timing/phrasing/applicability
all derive from it, never from scattered literals. Code columns below match
`DANCES` exactly; tempo and character come from research/domain.md §6 (NOT stored in code).

| DanceId (`DANCE_IDS`) | timeSignature | beatsPerBar | phraseBeats | travelling | Tempo (research, not in code) | Character (research, not in code) |
|---|---|---|---|---|---|---|
| `waltz` | `"3/4"` | 3 | 6 | true | ~84–90 BPM | Smoothest swing dance; rise & fall; "1 2 3" |
| `viennese_waltz` | `"3/4"` | 3 | 6 | true | ~174–180 BPM | Fast continuous rotation; tiny figure set |
| `quickstep` | `"4/4"` | 4 | 8 | true | ~200–208 BPM | S/Q with hops, locks, runs |
| `foxtrot` | `"4/4"` | 4 | 8 | true | ~112–120 BPM | S Q Q; long, gliding (a.k.a. Slow Foxtrot) |
| `tango` | `"2/4"` | 4 | 8 | true | ~120–132 BPM | Staccato; CBMP walks; **no rise & fall, no sway swing** |

Gotchas:
- **Tango is written 2/4 but counted in 4** — `timeSignature: "2/4"` is display/reference
  only; `beatsPerBar: 4` drives all math. Don't "fix" one to match the other.
- `phraseBeats` (6 for the waltzes, 8 otherwise) is the counted phrase a float-count
  wraps in — a *counting* concept, two bars of music, not a bar.
- All five are **travelling** dances (progress counter-clockwise around the floor along
  the Line of Dance). Latin dances are mostly **spot** dances (danced in place) — that's
  why `travelling` exists as a flag and why Latin is deliberately absent in v1 (PLAN §3).

---

## 4. Timing: S/Q notation, float counts, bars

### 4.1 S/Q → beats (`wdsf-timing.ts`)

WDSF states each figure's timing as syllables. `parseWdsfTiming` walks left→right with
a beat cursor starting at 1.0, emitting one float count per step:

| Symbol | Duration (beats) — `DURATION`, wdsf-timing.ts:24 |
|---|---|
| `S` (Slow) | 2 |
| `Q` (Quick) | 1 |
| digit (`1`…`9`) | 1 |
| `&` | 0.5 — and it **splits the preceding symbol** ("Q&Q" → counts 1, 1.5, 2) |

So Foxtrot "SQQ" (the Feather rhythm) → counts 1, 3, 4; Waltz "123 123" → 1..6 (spaces
are cosmetic bar separators). Documented approximations: "(… Lady)" groups are the
follower's alternative timing and are stripped; other parens = optional steps, kept; a
leading `&` clamps to the beat-1 floor.

### 4.2 Float counts and fraction labels (`timing.ts`)

An attribute's `count` is a **float relative to figure start, 1-indexed, on the 1/8
grid** (`isOnEighthGrid` — the strict write schema rejects off-grid counts). Fractions
render per the conventional "1 **e** & **a** 2" count (`FRACTION_LABELS`, timing.ts:18-24):

| fraction | label | | fraction | label |
|---|---|---|---|---|
| .125 | `ia` | | .5 | `&` |
| .25 | `e` | | .75 | `a` |
| .375 | `ai` | | .625 / .875 | *no label* (deliberate — fall back to `"N+0.625"`) |

**History:** an earlier draft swapped `e` and `a`; the mappings above are the
*corrected* ones (comment at timing.ts:11, PLAN §2.5). If you see e=.75 anywhere,
that's the old bug — do not reintroduce it. `countLabel(3.25)` → `"3e"`.

### 4.3 Phrases, bars, and continuous numbering

- `countToPhrase(count, dance)` locates a count in the dance's counted phrase
  (wraps at `phraseBeats`): Waltz count 7 → phrase 2, countInPhrase 1. The field was
  renamed from `bar` — it indexes *phrases*, not musical bars.
- `barsForFigure(counts, dance)` = the phrase index of the max count (empty → 1). Used
  as a card-projection fallback.
- **Authored bars** (`FigureDoc.bars`, PLAN §2.5.2) are the primary length:
  `defaultFigureBars` = ⌈distinct *live* whole-beat counts ÷ beatsPerBar⌉, min 1
  (`figure-grid.ts:43`); `resolveFigureBars` prefers explicit `bars` ≥ 1.
  `figureGridSlots(bars, dance)` generates the editor grid from bars, not from existing
  steps: each bar → each beat → the whole beat plus sub-beat slots `SUB_BEATS`
  [0.25, 0.5, 0.75] (e/&/a). Waltz bar 2 beat 1 = count 4; its "&" = 4.5 → "4&".
- **Continuous beat numbering** (`numberRoutineBeats`, timing.ts:144): the *reading*
  view threads one running whole-beat counter through the whole routine, wrapping at
  `phraseBeats`. **Only whole beats advance the counter** — an off-beat renders as its
  bare symbol (`&`/`e`/`a`) and consumes no number. Breaks occupy whole beats and
  advance it. The *edit* view keeps per-figure LOCAL counts; this is display-only.

---

## 5. Technique glossary → codebase mapping

Definitions from research/domain.md; enums verified against `vocabulary.ts` (2026-07-02).

| Ballroom concept | What it means | Where in the code |
|---|---|---|
| **LOD / alignment** | Line of Dance = counter-clockwise travel line around the floor. An alignment = **qualifier × direction**: how the body relates (facing/backing/pointing) to a room reference (LOD, against-LOD, wall, centre, the diagonals) | `Alignment` (doc-types.ts:32): qualifier `facing`\|`backing`\|`pointing`; direction `LOD`\|`ALOD`\|`wall`\|`centre`\|`DW`\|`DC`\|`DW_against`\|`DC_against`. **Per-figure** `entryAlignment`/`exitAlignment` only (PLAN §3: per-figure is sufficient, no floor concept in v1 — real charts are per-step; this is a deliberate simplification) |
| **CBM** (Contrary Body Movement) | A **body action**: turning the opposite side of the body toward the moving foot to initiate rotation | `bodyActions` value `CBM` |
| **CBMP** (Contrary Body Movement *Position*) | A **foot position**, not a body action: the foot placed on/across the line of the supporting foot (Tango walks, Promenade). **CBM ≠ CBMP** — a step may have either, both, or neither | `position` value `CBMP`. Putting CBMP in bodyActions is a domain error |
| **Rise & Fall** | The controlled rise/lower through feet-ankles-body characteristic of the swing dances. **Tango has none** | `rise` kind with `appliesToDances: [waltz, viennese_waltz, quickstep, foxtrot]` (RISE_DANCES, vocabulary.ts:96) — Tango omitted; writes of rise on Tango rejected `dance_not_applicable` (schemas.ts), views hide the lane |
| **Sway** | Body inclination away from the moving foot / into the turn; mirrors between partners | `sway`: `to_L`\|`to_R`\|`none` (roleAware) |
| **Amount of Turn** | Rotation as a fraction of a full turn, recorded **per step**; the per-step amounts **sum to the figure's total** (a single pivot can be `three_quarter` or `full`). 1/8 turns are common | `turn`: `none` + `{eighth,quarter,three_eighth,half,five_eighth,three_quarter,seven_eighth,full}_{L,R}` |
| **Footwork** | Which part of the foot contacts the floor, in contact order. H=Heel, T=Toe, B=Ball, WF=Whole Foot, IE=Inside Edge, NFR="no foot rise" (an ISTD rise annotation → lives in the `rise` enum here, value `NFR`) | `footwork`: `HT`,`TH`,`T`,`H`,`B`,`WF`,`BF`,`IE`,`flat`,`heel turn`,`heel pull` + compound rolls `BH`,`HTH`,`THT`,`T/H/T`,`H/T`,`T/H`,`T/TH`,`TH/T`. Conventions: forward walks = HT, back walks = TH, a step "up" = T, closing/lowering step = TH (figure-steps.ts header) |
| **Heel turn** | Closing foot drawn to the standing foot, turning on the standing heel — characteristically the **follower's** (why footwork is roleAware) | `footwork` values `heel turn`, `heel pull`; follower heel-turn sequence TH, HT, TH |
| **Positions** (hold shapes) | Closed hold; **PP** = Promenade Position (V-shape opening the same way); **OP** = Outside Partner (stepping outside the partner's track) | `position`: `closed`,`promenade`,`counter_promenade`,`outside_partner`,`left_side`,`right_side`,`tandem`,`wing`,`CBMP` (couple-shared, not roleAware) |
| **Foot Position** (ballet) | The five classical relationships of the feet (ISTD's occasional extra chart column) | the `footPosition` kind was REMOVED ⟳2026-07-10 (D33) — zero charted uses; the moving foot's placement lives in `direction` |
| **Direction** (step headline) | What the chart's Description column says the foot does ("LF forward", "RF to side") — minus the foot letter; the step's relative TRANSLATION in the derived-alignment model (PLAN §3.8) | `direction`: `forward`,`back`,`side`,`diagonal_forward`,`diagonal_back`,`close`,`behind`,`in_front`,`diagonal` (legacy unsplit),`in_place`. Closed enum, `required: true` (drives the "Step*" grid column), roleAware. Legacy `diag_forward`/`diag_back` alias-normalize to the split values on read (⟳2026-07-10) |
| **Floorcraft / corners** | Placing travelling figures on long sides, turning figures at corners | Theory only — no floor model in the app (v1) |

### The core registry kinds at a glance (`ATTRIBUTE_REGISTRY`, vocabulary.ts — 8 standard kinds incl. free-text `head`; `footPosition` + `rotation` removed ⟳2026-07-10, `turn` is the canonical rotation and the WDSF Rotation prose stays seed-only provenance)

| kind | cardinality | roleAware | color | notes |
|---|---|---|---|---|
| `direction` | single | yes | `#2f5d8f` | closed enum, `required: true` |
| `footwork` | single | yes | `#a9742c` | `freeText: true` (lenient writes tolerate the syllabus scaffold) but `freeTextInput: false` (editor = closed picklist) |
| `rise` | single | no (couple-shared) | `#1f8a5b` | `appliesToDances` omits Tango; values `commence`,`body_rise`,`foot_rise`,`up`,`continue`,`lowering`,`body_lower`,`NFR` |
| `position` | single | no (couple-shared) | `#8a5cab` | |
| `bodyActions` | **multi** | yes | `#b07cc6` | values `CBM`,`side_leading`,`shaping`,`oversway`,`leg_line`. (PLAN §3 prose groups it with position under `#8a5cab`; the code's rendered color is `#b07cc6` — minor doc drift) |
| `sway` | single | yes | `#c0563f` | |
| `turn` | single | yes | `#5b6b8a` | |

Custom kinds merge in via `mergeRegistry`; **builtin slugs are reserved** (a custom
`rise` can never re-enable rise for Tango).

### The canonical chart columns → this app

The classic ISTD/Alex Moore technique chart (one row per step, per role) maps as:

| ISTD chart column | Here |
|---|---|
| Step number | implicit — the ordered distinct `count`s |
| Description / Action ("LF forward") | `direction` attribute (foot letter dropped — feet alternate) |
| Count / Beat value ("1 2 3", "S Q Q") | `Attribute.count` (float, via `parseWdsfTiming`) |
| Amount of Turn | `turn` attribute — the canonical rotation; tokens = signed eighths, absolute alignment derives from their sum (PLAN §3.8/D33, `packages/domain/src/alignment.ts`) |
| Rise & Fall | `rise` attribute (role `null`) |
| Footwork | `footwork` attribute |
| CBM / CBMP / body position | split: CBM → `bodyActions`; CBMP + holds → `position` (role `null`) |
| Sway | `sway` attribute |
| Alignment | per-figure: `entryAlignment` authored (the start alignment); the exit DERIVED from the turn sum (`deriveExitAlignment`) — `exitAlignment` stored only for the flagged non-derivable figures (docs/seed/alignment-derivation-report.md) |
| Foot Position (occasional) | dropped ⟳2026-07-10 — `direction` carries the placement |

---

## 6. Worked example: the Waltz Reverse Turn

A 6-step, 2-bar figure turning left. The ISTD-style leader chart (research/domain.md §2):

| Step | Count | Action | Turn (ISTD: measured *between* steps) | Rise/Fall | Sway | CBM |
|---|---|---|---|---|---|---|
| 1 | 1 | LF forward | starts to turn L | start to rise end of 1 | — | CBM |
| 2 | 2 | RF to side | 1/4 between 1–2 | continue rise 2–3 | L | |
| 3 | 3 | LF closes to RF | 1/8 between 2–3 | lower end of 3 | L | |
| 4 | 1 | RF back | continue turn L | start to rise end of 4 | — | CBM |
| 5 | 2 | LF to side | 3/8 between 4–5 | continue rise 5–6 | R | |
| 6 | 3 | RF closes to LF | body completes turn | lower end of 6 | R | |

Note the notational shift: ISTD records turn *between* step pairs and rise as prose
("start to rise end of 1"); the app stores a discrete per-step `turn` amount and a
`rise` enum token per count.

How this becomes app data (all verified against the repo):

1. **Identity:** ISTD seed row → `figureType: "reverse-turn"`, `dance: "waltz"`. The
   global catalog doc ref is `global:waltz:reverse-turn` (`globalFigureRef`, library.ts:97).
2. **Timing:** WDSF seed `wdsf.timing: "123 123"` → `parseWdsfTiming` → counts
   `[1,2,3,4,5,6]` (each digit = 1 beat; the space is cosmetic). 6 whole-beat steps ÷
   `beatsPerBar` 3 → `defaultFigureBars` = 2 bars.
3. **Chart:** `docs/seed/figure-charts.json` → `figure-charts.generated.ts`
   `"waltz:reverse-turn"` — 6 `AuthoredStep`s. Step 1 (verbatim from the generated file):
   shared `rise: "commence"`; leader `{direction: "forward", footwork: "HT",
   turn: "quarter_L", bodyActions: ["CBM"]}`; follower `{direction: "back",
   footwork: "TH", turn: "three_eighth_L", bodyActions: ["CBM"]}` — note the roles'
   *different* footwork and turn amounts on the same count, and that "none" sway/turn
   values were dropped by the generator rather than stored.
4. **Attributes:** `buildWdsfAttributes` (wdsf-timing.ts:58) sees authored length (6)
   == parsed counts (6) and emits per-count attributes with deterministic ids. Step 1
   becomes, e.g.:
   - `{id: "fig-reverse-turn-waltz-leader-s1-dir", kind: "direction", count: 1, role: "leader", value: "forward"}`
   - `{id: "fig-reverse-turn-waltz-leader-s1-foot", kind: "footwork", count: 1, role: "leader", value: "HT"}`
   - `{id: "fig-reverse-turn-waltz-leader-s1-turn", kind: "turn", count: 1, role: "leader", value: "quarter_L"}`
   - `{id: "fig-reverse-turn-waltz-leader-s1-ba0", kind: "bodyActions", count: 1, role: "leader", value: "CBM"}`
   - follower mirrors with its own values; shared
     `{id: "fig-reverse-turn-waltz-s1-rise", kind: "rise", count: 1, role: null, value: "commence"}`.
5. **Alignment:** `GENERATED_FIGURE_ALIGNMENTS["waltz:reverse-turn"]` = entry
   `{qualifier: "facing", direction: "DC"}` (Diagonal to Centre — reverse/left-turning
   figures start toward centre), exit `{qualifier: "facing", direction: "DW"}` (Diagonal
   to Wall) — figure-level only.
6. **Turn math sanity check:** leader turn over the figure = ¼ + ⅛ + ⅜ = ¾ L — per-step
   amounts sum to the figure's total rotation. Use this check when reviewing chart data.

A figure *without* a verified chart falls back to the public-syllabus scaffold: one
free-text `footwork` attribute per count carrying the WDSF `start` phrase on the first
step and `finish` on the last, blank between (wdsf-timing.ts:159-167) — that's why
`footwork` is `freeText: true`.

---

## 7. Where the domain data lives

| File | Contents | Edit? |
|---|---|---|
| `packages/domain/src/dances.ts` | The 5-dance registry (`DANCE_IDS`, `DANCES`) | by hand (rare; adding a dance forces a `RISE_DANCES` decision) |
| `packages/domain/src/vocabulary.ts` | `ATTRIBUTE_REGISTRY` (8 builtin kinds), aliases, `mergeRegistry`, `kindAppliesToDance` | by hand — kinds are **data, not code**; UI renders from the merged registry |
| `packages/domain/src/timing.ts`, `figure-grid.ts`, `wdsf-timing.ts` | Count math, grid, S/Q parsing | by hand, TDD |
| `packages/domain/src/figure-steps.ts` | Typed access (`authoredSteps`, `authoredAlignment`) over generated charts | by hand (thin) |
| `packages/domain/src/library-data.ts` | **GENERATED** — 204 merged catalog figures (as of 2026-07-02) from the two syllabus seeds via `scripts/gen-library.mjs`. ISTD identity + WDSF timing, net-new WDSF appended | **never hand-edit — regenerate** |
| `packages/domain/src/figure-charts.generated.ts` | **GENERATED** — per-step both-role technique for the 147 charted figures via `scripts/gen-figure-charts.mjs` (drops no-op sway/turn `"none"`) | **never hand-edit — regenerate** |
| `docs/seed/istd-standard-figures.json` | ISTD Sept-2024 syllabus figure list, 121 figures (identity, `istdLevel`/`istdGrade`; empty attribute timelines — technique books are paid) | source of truth for identity |
| `docs/seed/wdsf-standard-figures.json` | WDSF syllabus (timing/start/finish/notes; `meta.planDiscrepancy` self-flag — ISTD wins identity) | source of truth for timing |
| `docs/seed/figure-charts.json` | The researched per-step charts, per-figure source URL + corroboration, "NO fabrication" policy | source of truth for technique |
| `docs/seed/istd-vs-wdsf-comparison.json` | Overlap analysis (istd 122 / wdsf 184 / slug-match 66) | reference |

Extending or regenerating any of this — new figures, chart corrections, the
generator scripts, verification workflow — is owned by
**ballroom-flow-figure-data-pipeline**; go there before touching seeds.

---

## Provenance and maintenance

Written 2026-07-02 against repo HEAD `70eed7e` on `development`. Verified directly
against: `packages/domain/src/{dances,vocabulary,timing,figure-grid,wdsf-timing,figure-steps,doc-types,library,library-data}.ts`,
`packages/domain/src/figure-charts.generated.ts` (waltz:reverse-turn entry + alignments),
`docs/seed/*.json` metas, `docs/PLAN.md` §1.5/§2.5/§2.5.2/§3, and `research/domain.md`
(the underlying theory research; tempo/character figures come from there, not code).

Re-verify if these drift:

```bash
grep -n 'DANCE_IDS\|timeSignature' packages/domain/src/dances.ts        # dance table
grep -n 'values:' -A 3 packages/domain/src/vocabulary.ts | head -60     # kind enums
grep -n 'FRACTION_LABELS' -A 8 packages/domain/src/timing.ts            # e/&/a labels
grep -n 'DURATION' packages/domain/src/wdsf-timing.ts                   # S=2 Q=1 &=0.5
grep -c 'figureType:' packages/domain/src/library-data.ts               # catalog size (205 = 204 figures + 1 interface field)
grep -n 'waltz:reverse-turn' packages/domain/src/figure-charts.generated.ts  # worked example
```

Known doc drift as of 2026-07-02: `bodyActions` color `#b07cc6` in code vs `#8a5cab`
grouped in PLAN §3. Seed metas match their own files (ISTD 121, WDSF 147), but the
comparison file counts 122/184 from a different (larger, pre-curation) snapshot — trust
each seed's own contents.
