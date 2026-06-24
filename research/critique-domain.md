# Domain-Fidelity Critique — Ballroom Flow Design Spec

Adversarial review of `docs/superpowers/specs/2026-06-24-ballroom-flow-design.md` from the perspective of someone who actually dances/coaches International Standard and reads ISTD charts. Cross-checked against `research/domain.md` and `research/design-spec.md`.

The spec is well-organized and its YAGNI instinct is mostly right. But several of the "leaner than the union" cuts are not YAGNI cuts — they are cuts that make the tool *describe the wrong dance*. A note app can be lean. A choreography-notation app that gets the notation wrong is worse than a blank notebook, because it teaches the couple a falsehood and they will trust it. The findings below separate "lean is fine" from "lean is wrong."

---

## 1. Ranked findings

### [BLOCKER] D-1: One role-agnostic step chart is not a lean version of the truth — for travelling figures it is a *different, wrong* truth, and the spec's "author from leader's perspective" convention silently makes the app useless to exactly one of the two people it's built for.

The spec (Q-D1, §2.1) frames this as "doubles authoring + sync surface for a feature the wireframe never asked for." That framing understates the problem in three concrete ways:

1. **Counts are not 1:1.** The spec's own bar-counting rule depends on `count === "1"` steps. But the heel turn is the canonical counterexample: in a Waltz Natural Turn the man dances 6 steps (1 2 3 | 1 2 3); the lady's steps 4–5 are a **heel turn counted "2 & 3"** — she has a distinct foot-closure-and-turn that does not map one-to-one onto the man's "RF to side / LF closes." So a single `steps[]` cannot represent both roles even by re-labelling; the *cardinality differs*. Any "follower overlay of differences" (option c) is not an overlay — it is a second list with different row counts. The spec's claim that "adding a second chart later is additive" is only true if you also accept that step *count* per figure becomes role-dependent, which ripples into the bar derivation, the thread anchor (`stepId`), and the journal link target. That is not additive; it is a schema change to the primary key of the most-referenced entity.

2. **"Author from the leader's perspective by convention" is a silent product decision that the wireframe never made and that no follower will accept.** The wireframe shows "Daniel (me, leader)". If the app canonically stores the leader's footwork ("LF forward") and the follower opens it, every single foot label is *wrong for her* (she goes back on her right). Two-thirds of the technique columns — footwork, sway direction, and turn entry — are mirrored or different for the follower. A follower using this app would see a chart that is actively misleading on the majority of cells. The coach's correction "your heel turn on 4" has no step 4 to anchor to that means anything to her. This is not "a feature nobody asked for"; it is the basic requirement that the *follower can read her own steps*, and the spec's recommended default fails it.

3. **The cheap-capture argument (notes carry role) does not survive contact with the heel turn.** The spec says role-specific corrections live on the comment, not the step. But you cannot comment "fix the heel turn on step 4" if step 4 (leader's "LF to side") is not a heel turn for *anyone* and the follower's actual heel-turn step has no representation to point at. The note has no anchor. The model has erased the thing the note is about.

**Why this is a BLOCKER, not a MAJOR:** the spec calls Q-D1 "the single most consequential domain decision," yet ships a *default implementation* (one chart, leader's perspective) inside the v1 schema before the dancer answers. If the dancer says "two charts," the primary entity, the bar derivation, the thread anchor, and the journal link all change. You cannot build v1 on the recommended default and treat the answer as additive. The honest options are: (a) build the two-chart model now (Step gains a `role` discriminator and figures hold up to two ordered lists, count per role), accepting the merge surface; or (b) explicitly scope v1 as a **single-role leader's-reference tool** and *say so in the UI and onboarding* ("this records the leader's part"), so a follower isn't handed a wrong chart under the impression it's hers. What is not acceptable is the current middle position: a role-agnostic chart that is implicitly the leader's, presented to both partners as "the routine."

**Recommendation:** Reverse Q-D1's default to **(a) two parallel charts, role-keyed, independent step counts, with the leader chart authored first and the follower chart optional-but-first-class.** If cost forces a cut, take option (b) and *brand it as leader's-reference*, never "role-agnostic."

---

### [BLOCKER] D-4 / §3.8: Deferring Alignment makes the notation unusable for the exact thing the app is for — travelling choreography and floorcraft.

The spec defers Alignment ("the single most-requested additional technique column... but the wireframe's users never asked for it"). But re-read `domain.md` §3 and §4: the *whole reason* a Standard routine is organized into sides and corners is alignment. The data dancers "most care about capturing" between figures is, verbatim, "what foot is free, what alignment you end on, and what position you're in — because that determines what can come next and whether you're set up for the corner." (§3, §4.) The app's headline feature is the Side/Corner/LOD model. Without alignment you have the *skeleton* of the floorcraft model (the boxes labelled "Long/Short/Corner") but none of the data that makes the skeleton mean anything. You can say "Natural Turn on the 1st Long Side" but not "facing DW" — so you cannot tell whether the figure is set up correctly for the corner, which is the one thing the side/corner structure exists to express.

Worse, the spec keeps the side/corner model (an alignment *consequence*) while cutting alignment (the *cause*). That is backwards. A coach's most common travelling-dance note — "you're under-rotating, you finished backing LOD instead of backing DC, so you over-ran the corner" — is un-recordable. The Reverse Turn worked example in `domain.md` §2 has an Alignment value on every one of its 6 rows; remove that column and the chart no longer distinguishes a correct turn from a wrong one.

**This is arguably a worse cut than D-1**, because at least one chart records *something* true; an alignment-free travelling chart records the part dancers treat as assumed-from-syllabus and omits the part they actually write down. `domain.md` §3 is explicit: skeleton routines record "figure names with bar counts **and alignments at the joins**" — alignment at joins is the minimum a working routine carries, below which you have a figure name list, not choreography.

**Recommendation:** Promote Alignment to v1, at minimum **per-figure entry/exit alignment** (which matches how choreographers think, per Q-D4's own parenthetical), even if per-step is deferred. The two-token `{qualifier, direction}` value is cheap. If a six-slot per-step column is too much UI for v1, put a single "enters facing __ / exits __" pair on the Figure, not the Step. Cutting it entirely should be reversed.

---

### [MAJOR] D-3 / §3.2: The CBP/CBM/CBMP confusion is reproduced, not resolved — and the spec invents a contradiction that wasn't even in the wireframe.

`domain.md` is unambiguous: **CBM** is a body action (turning the opposite side of the body toward the moving foot to initiate rotation); **CBMP** is a foot position (foot placed across the line of the supporting foot). They are independent — a step can have either, both, or neither. The wireframe's "CBP" with the gloss "Counter Body Movement — body turns away from the moving foot" is wrong twice over: (1) "CBP" is not standard notation (it's a typo/conflation of CBM and CBMP); (2) the *definition* given ("turns **away** from the moving foot") is the opposite of CBM, which turns the opposite side **toward** the moving foot.

The spec correctly flags this for [confirm] — good — but then makes two errors of its own:

- §3.2 defines the `cbmp` value's display gloss as "foot across the line of the supporting foot" — **correct** — but then keeps a *separate* `cbp` value alongside it. If the answer is CBM, then the right model is **CBM and CBMP as two independent booleans/values that can co-occur** (per `domain.md` §2: `CBM`, `CBMP`, `CBM & CBMP`, `none`), not a single-select where you pick one of {CBMP, CBP}. The spec's Body slot is single-select (§2.1: "each a nullable single-select enum"). **A single-select Body slot structurally cannot represent "CBM & CBMP," which is a real and common combination** (e.g. a Feather Step step). This is a modelling error independent of the naming question.

- The Body slot also conflates *positions* (Closed, Promenade, Wing, Outside Partner) with *actions* (CBM, CBMP) into one single-select. A step can be **in Promenade Position AND have CBMP** (Tango promenade walks; the whisk's exit). One single-select field cannot hold both. `domain.md` §2 lists Body as carrying both "CBM/CBMP" *and* positional flags "PP, OP/PO, Fallaway, Shadow" — these are orthogonal axes, not one enum.

**Recommendation:** Split Body into at least two slots: **Position** (single-select: Closed / Promenade / Outside Partner / Fallaway / Wing) and **Body action** (multi-select or two booleans: CBM, CBMP). Resolve the naming with a dancer but model them as independent regardless. Drop "CBP" entirely; it is not a real term.

---

### [MAJOR] D-2 / §2.1: "Turn is a property of the step" misrepresents the chart, and the spec's own worked example proves it.

The spec recommends turn-as-step-property "matching the wireframe... simpler... adequate." But look at the Reverse Turn chart in `domain.md` §2: turn values are literally written as **"1/4 between 1–2"**, **"1/8 between 2–3"**, **"3/8 between 4–5"** — *between* two steps. The magnitude of turn is the rotation accumulated across a step interval, and a real chart reads it as a transition quantity. Storing it on a single step forces a choice the dancer shouldn't have to make: is "1/4 between 1–2" the turn *on* step 1 or *on* step 2? Different dancers will key it differently, and a coach's note ("more turn into 2") becomes ambiguous about which cell it targets.

This is a MINOR-bordering-MAJOR because the working couple can live with a convention ("turn occurs *leading into* this step," which the spec states). But it does undercut two of the spec's other claims: the bar-count rule and the "turn between feet vs body turns less." The latter — "body turns less than feet" — is dismissed as out-of-scope, but it is *not* an exotic detail; it appears in the very first row set of the worked Reverse Turn ("Body completes turn" on step 6) and is fundamental to how sway is generated. Cutting it is defensible for a couple's working notes; calling it exotic is a domain misread.

**Recommendation:** Acceptable to keep turn-as-step-property for v1 **if** the UI labels it "turn into this step" unambiguously and the [confirm] explicitly asks the dancer whether the leading-into convention matches their mental model. Do not represent it as the natural/obvious model — it is a simplification of a between-steps reality.

---

### [MAJOR] §3.1 Rise & Fall: the canonical set drops the most important Tango/Foxtrot value and mislabels the Waltz mechanism.

Two issues:

- **"No Foot Rise" (NFR) is missing and it is not optional.** `domain.md` §2 calls it out specifically ("Plus 'No foot rise' annotations" in footwork; `no foot rise` / `NFR` in rise). NFR is the standard annotation on the heel-turn step and on the third step of many figures (e.g. the Natural Turn's step 3 for the follower) — it is precisely the value a coach references ("no foot rise on step 3," verbatim in `domain.md` §5). The spec's 6-value set (`commence`, `body_rise`, `foot_rise`, `up`, `continue`, `lowering`) has no way to say "no rise here." This is a real gap, not a wording nit.

- **The spec drops `body lower` as "rare"** — it's uncommon as a *selectable chip* but it is exactly the mechanism that distinguishes a controlled lower from a drop, and it pairs with `body rise`. Deferring it is fine; calling it rare suggests the reviewer didn't recognize it as the partner to `body_rise`.

- Tango: the spec says "rise is always effectively `none`" and a flag "may later hide this slot." But Tango ships in v1 (§3.6). So in v1 the Rise slot is present and offers 6 rise values for a dance that has none — the app will invite the user to tag rise on a Tango walk, which is a domain error the app actively encourages. The `hasRiseFall: false` flag exists in the dance metadata (§3.6) but the spec only says it "may later hide this slot." It must hide it in v1, or v1 teaches wrong Tango.

**Recommendation:** Add `NFR`/`none` to the rise set; wire `hasRiseFall: false` to actually suppress the rise slot for Tango in v1 (the data is already there).

---

### [MAJOR] §3.3 Footwork: 4 values cannot chart a single complete figure; "heel pull" is the only follower-specific value kept while the rest of the follower's footwork is unrepresentable.

The wireframe's 4 (HT, T, TH, heel_pull) omit **H (heel)** and **B/whole-foot** — but a Waltz Natural Turn *opens* with the leader's "RF forward, **heel**" and many steps are "**T** then **H**" vs plain "**T**." Without bare `H` you cannot chart step 1 of almost any forward-moving figure correctly; HT (heel-then-toe) is a different thing from H (heel). The spec keeps `heel_pull` (a follower heel-turn footwork) but not the bare `H`/`T`/`B` the rest of the chart needs — an odd selection that suggests the 4 were taken from the wireframe without checking they can chart one real figure end to end. They cannot.

**Recommendation:** v1 footwork minimum should be `H, T, HT, TH, WF` plus `heel_pull` (and ideally `NFR`). Adding values is genuinely additive here (it's a flat enum), so this is a low-cost fix that materially raises fidelity. Reverse the "ship the wireframe's 4" decision.

---

### [MAJOR] §3.5 Turn magnitudes: ⅛ is not a fine/exotic magnitude — it is the single most common turn value on the chart.

The spec defers ⅛, ⅝, ¾ as "finer magnitudes." But ⅛ (45°) is everywhere — the worked Reverse Turn uses **"1/8 between 2–3"** as a core value, and most "rotate to set up the corner" adjustments are ⅛. Deferring ⅛ removes the ability to chart the closing step of most turning figures accurately; the couple will be forced to round ⅛ up to ¼ and the chart will over-state rotation, which is the exact error that over-runs corners. ⅝/¾/⅞ are genuinely rarer and fine to defer; **⅛ must be in v1.**

**Recommendation:** Add `eighth_L`/`eighth_R` to v1. Reverse the deferral of ⅛ specifically.

---

### [MAJOR] §4.0 / §11 Q-D8 / Q-D10: count/timing is modelled as a free string token with no relationship to the dance's meter — the bar-count derivation is therefore wrong for the dances v1 ships.

The Step's `count` is "a string token: '1', '&', '2', 'S', 'Q'." Bars are derived as "count of steps whose `count === '1'`." This breaks on the dances in v1:

- **Foxtrot and Quickstep are charted in S/Q, not numbers.** A Foxtrot Feather Step is `S Q Q` over one bar — there is **no step with `count === "1"`**, so the bar-count rule yields **zero bars** for a correctly-charted Foxtrot figure. The derivation only works if every figure is charted numerically, but S/Q is the standard notation for two of the five v1 dances. So either the rule silently breaks for Foxtrot/Quickstep, or the app forces numeric counting on dances dancers count as S/Q.

- **Tango is counted in S/Q too** (`domain.md` §6: "SQQ-type"). Same problem.

- A **Slow occupies 2 beats**; the spec's model has no beat-value, so it can't reconcile "S Q Q = 4 beats = 1 bar of 4/4." `domain.md` §2 explicitly notes a step carries a beat-value (1, 2, ½, ¾) distinct from its count label. The spec collapses these.

The spec acknowledges this only weakly in Q-D8 ("store S/Q, numeric, or both"). But this isn't an open question to defer — the **bar derivation in §2.1 is already specified and is wrong** for 3 of 5 v1 dances. You cannot ship the `count === "1"` rule and also ship Foxtrot.

**Recommendation:** Either (a) give each Step a `beatValue` (number of beats) and derive bars from `dance.beatsPerBar` against the running beat sum — the correct model; or (b) restrict the bar-count display to dances counted numerically and show no bar count for S/Q dances in v1. Do not ship the `count === "1"` rule unqualified. This needs to move from §11 into the v1 design.

---

### [MINOR] §3.6 Viennese Waltz figure set vs the side/corner model.

Viennese Waltz has a *very* limited figure set (Natural Turn, Reverse Turn, Forward/Backward Change, Fleckerl, Contra Check) and travels in near-continuous rotation around the floor — it barely has "sides" in the sense the other dances do; it's a continuous reverse/natural rotation with changes. Forcing it into Long/Short/Corner sides is more of a stretch than for Waltz/Foxtrot/Quickstep. Not a blocker (it does travel CCW), but the spec treats all five Standard dances as identically side/corner-shaped when VW is the odd one. The dance metadata could carry this nuance later.

---

### [MINOR] §2.1 Side: "Corner" semantics undefined (Q-D9 too weak).

Q-D9 asks "what distinguishes a Corner functionally." `domain.md` §1/§4 answers it: a corner is where LOD changes ~90°, so corners carry turning/redirecting figures and sides carry progressive ones. The app doesn't need to *enforce* this, but the spec leaves it as an open question when the domain doc already answers it. The real product question is narrower and the spec misses it: **does the app validate or warn that a figure placed on a corner actually turns ~90°** (i.e. exits on a perpendicular alignment)? That requires alignment (see D-4), which is cut — so the corner is currently a label with no data behind it.

---

### [MINOR] §10 / Latin: cutting Latin from v1 is correct, but the spec's reason is incomplete.

Cutting Latin is the right call. But the spec frames it purely as scope ("ship Standard only"). The deeper reason — that spot Latin's entire organizing model is *not* sides/corners (it's spot work, figures-in-place, with `travelling: false`) — means Latin isn't "more dances to add later," it's a **second floor model** the side/corner UI doesn't fit. The spec's `travelling` flag gestures at this but the UI is built entirely around sides. Adding Cha Cha later isn't "add a dance enum value"; it's "design the no-sides flat-figure-list mode" the spec mentions in one clause in §2.1 and never designs. Fine to defer, but the spec under-states that Latin is an architecture fork, not a content addition. (Paso Doble is the one travelling Latin dance and would fit the existing model — worth noting it's the natural first Latin addition, not Cha Cha.)

---

## 2. Decisions I would reverse

1. **Q-D1 default (one role-agnostic chart):** reverse to two role-keyed charts with independent step counts, OR explicitly re-brand v1 as a leader's-reference tool in the UI. The current "role-agnostic but secretly the leader's" position is the worst of both. [BLOCKER]

2. **§3.8 / Q-D4 (defer Alignment entirely):** reverse — add at least per-figure entry/exit alignment to v1. It is the data the side/corner model exists to carry. [BLOCKER]

3. **§2.1 Body as one single-select slot:** reverse — split into Position (single-select) and Body-action (CBM/CBMP, independently settable). A single-select cannot represent "Promenade + CBMP" or "CBM & CBMP," both of which are common. [MAJOR]

4. **§2.1 bar-count rule (`count === "1"`):** reverse/qualify — derive bars from beat-values against the meter, or suppress bar counts for S/Q dances. As written it returns 0 bars for any correctly-charted Foxtrot/Quickstep/Tango figure. [MAJOR]

5. **§3.5 defer ⅛ turn:** reverse — ⅛ is the most common turn magnitude, not a fine one. [MAJOR]

6. **§3.3 footwork = wireframe's 4:** reverse — add at least H, T, WF; the 4 cannot chart step 1 of a forward figure. [MAJOR]

7. **§3.1 Tango rise slot:** reverse the "may later hide" — wire `hasRiseFall: false` to suppress the rise slot in v1, since Tango ships in v1. Add `NFR`/`none` to the rise set. [MAJOR]

---

## 3. New / sharper questions for the dancer (that §11 misses or states too weakly)

**Q-NEW-1 [sharper than Q-D1] — Who is the primary author and reader, and is the chart the leader's, the follower's, or both?**
Why it matters: determines whether a follower can read her own steps at all, and whether step *counts* are role-dependent (they are, because of heel turns). Options: (a) two full role charts, counts independent [highest fidelity, highest cost]; (b) leader chart only, app explicitly branded "leader's reference," follower reads it knowing it's mirrored [cheap, honest]; (c) one chart authored by the leader with a follower "differences" annotation layer [middle, but breaks on differing step counts — probably not viable]. The spec's "role-agnostic" wording hides that there is no role-neutral footwork.

**Q-NEW-2 [missing] — Can the Body slot hold a position AND a body-action simultaneously (e.g. Promenade + CBMP, or CBM & CBMP)?**
Why it matters: the spec's single-select Body slot cannot, and both combinations are common (Tango promenade walks; Feather Step). This is a structural modelling question, not just the CBP naming question in Q-D3. Options: split into two slots [recommended]; keep single-select and accept lost fidelity; multi-select Body.

**Q-NEW-3 [missing] — Is alignment recorded at all in v1, and if so per-figure (entry/exit) or per-step?**
Why it matters: the side/corner model is decorative without it. Q-D4 frames it as "add a 6th column?" but the real v1 question is the cheaper "do figures carry entry/exit alignment?" Options: per-figure entry+exit pair [cheap, high value]; per-step [full fidelity]; none [the spec's current position — leaves corners meaningless].

**Q-NEW-4 [sharper than Q-D8] — How is timing stored for S/Q dances, and how are bars derived?**
Why it matters: 3 of 5 v1 dances (Foxtrot, Quickstep, Tango) are counted S/Q, and the spec's bar rule returns 0 bars for them. Options: store a `beatValue` per step and derive bars from the meter [correct]; allow both S/Q label and numeric beat; restrict bar display to numeric dances. The dancer must confirm whether they count Foxtrot in S/Q or in numbers.

**Q-NEW-5 [missing] — Does "no foot rise"/NFR need to be a selectable rise value in v1?**
Why it matters: it's the standard annotation on heel-turn and certain closing steps and a frequent coaching note; the spec's rise set omits it entirely. Likely yes.

**Q-NEW-6 [missing] — Is ⅛ turn needed in v1?**
Why it matters: it's the most common turn magnitude; deferring it forces rounding to ¼, which over-states rotation. Almost certainly yes.

**Q-NEW-7 [sharper than Q-D9] — Should the app warn when a corner figure's exit alignment isn't perpendicular to its entry (i.e. doesn't actually turn the corner)?**
Why it matters: this is the one place floorcraft logic could earn its keep, and it's the real question behind the vague Q-D9. Depends entirely on whether alignment is recorded (Q-NEW-3). Options: no validation, just labels [v1]; warn on alignment mismatch [needs alignment data].

**Q-NEW-8 [missing] — Should the rise slot (and eventually sway) be suppressed for Tango in v1?**
Why it matters: the metadata flag exists but the spec only says "may later hide." Showing a 6-value rise picker on a Tango step actively teaches a falsehood. Options: suppress now using the existing flag [recommended]; show with a "Tango has no rise" note; ignore [wrong].
