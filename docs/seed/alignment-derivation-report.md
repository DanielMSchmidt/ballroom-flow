# Alignment-derivation report — the non-round-trippable figures

**Generated 2026-07-10** by the alignment-derivation migration (PLAN §3.8), from
`docs/seed/figure-charts.json` at pre-migration HEAD `662663a`, using the shipped
implementation (`packages/domain/src/alignment.ts`) as the checker. Regenerating this
report = re-running the classification in `alignment.test.ts` against the frozen oracle
(`packages/domain/src/__fixtures__/alignment-oracle.ts`).

## The rule this report is the exception list for

A figure's exit alignment is **derived**: `exit = entry ⊕ Σ leader turns` on the mod-8
room wheel, presented as `backing` when the leader's last charted step travels `back`,
else `facing` (`deriveExitAlignment`). The migration **dropped the stored `exitAlignment`
from the 111 figures where derivation reproduces the book's printed exit token exactly**
(the book value stays regression-pinned in the frozen oracle fixture). Every figure
below did NOT round-trip, **keeps its stored `exitAlignment` untouched in the seed**, and
is flagged by that very fact (stored exit present = non-derivable) until the owner
decides per case. `alignment.test.ts` enforces the flag stays honest in both directions.

## Why figures legitimately don't round-trip (the accepted tradeoff)

The step model carries ONE scalar turn per step. ISTD/WDSF technique splits what that
scalar merges:

- **Foot turn vs body turn (CBM):** the books chart "body turn only"/"body completes
  turn" as prose, not as an amount on the step — the seed's conventions put those cells
  in `note`s, so the summed per-step amounts legitimately disagree with the printed exit
  (usually by ±1/8).
- **Turns charted on a neighbouring figure's row:** WDSF prints "x between Prec. Step
  and 1" on the *preceding figure's* row (e.g. Foxtrot Back Feather's note records
  exactly this) — that eighth is outside this figure's steps.
- **`pointing` / promenade / heel-turn endings:** the printed exit token encodes a
  foot-vs-body relationship (`pointing DW`, a PP exit charted `facing` off a crossing
  step, a heel-turn finish charted `backing` off a closing step) that no turn sum can
  reproduce.

None of this data was altered or dropped — do not "fix" these rows without re-verifying
against the printed chart.

## A. Orientation mismatches — 83 figures

The derived body orientation itself disagrees with the printed exit (residual = what
the charted turns are short/over by, mod 8 — `+1/8` means the book's exit sits one
eighth further to the right than the turn sum reaches).

| Figure | Entry (stored) | Σ leader turns | Derived exit | Printed exit | Residual |
|---|---|---|---|---|---|
| `foxtrot:back-feather` | backing DC | +2/8 | backing DW | backing LOD | -1/8 |
| `foxtrot:bounce-fallaway-with-weave-ending` | facing DC | -3/8 | facing ALOD | facing DW | -3/8 |
| `foxtrot:hover-cross` | facing DW | +4/8 | facing DC_against | facing DC | +2/8 |
| `foxtrot:outside-swivel` | pointing LOD | +1/8 | backing DC_against | pointing LOD | -1/8 |
| `foxtrot:quick-open-reverse-turn` | facing DC | -7/8 | facing LOD | facing DW | +1/8 |
| `foxtrot:reverse-pivot` | backing DC | -4/8 | backing DW_against | facing DW | +2/8 |
| `foxtrot:top-spin` | backing ALOD | -4/8 | facing ALOD | facing DC | +3/8 |
| `foxtrot:weave-from-p-p` | pointing DC | -7/8 | facing LOD | facing DW | +1/8 |
| `quickstep:impetus` | backing LOD | +5/8 | facing DW | backing DC | +2/8 |
| `quickstep:rumba-cross` | facing LOD | +8/8 | facing LOD | backing LOD | +4/8 |
| `quickstep:tipple-chasse-to-r-at-the-corner` | backing LOD | +3/8 | facing DC | facing DW | +2/8 |
| `quickstep:weave-from-pp` | pointing DC | -5/8 | facing wall | facing DW | -1/8 |
| `quickstep:wing` | facing DW | -1/8 | facing LOD | facing DC | -1/8 |
| `tango:back-corte` | backing centre | 0/8 | facing wall | facing DW | -1/8 |
| `tango:fallaway-four-step` | facing LOD | -2/8 | facing centre | facing DC | +1/8 |
| `tango:fallaway-in-promenade` | pointing DW | +2/8 | facing DW_against | facing wall | -1/8 |
| `tango:mini-five-step` | facing DW | -2/8 | facing DC | facing DW | +2/8 |
| `tango:natural-turn-from-pp` | pointing DW | +6/8 | facing DC | facing DW | +2/8 |
| `tango:outside-swivel-method-1-after-open-finish-and` | pointing wall | 0/8 | facing wall | facing DW | -1/8 |
| `tango:outside-swivel-method-2-turning-to-l` | pointing LOD | -2/8 | facing centre | facing DC | +1/8 |
| `tango:progressive-side-step` | facing DW | -2/8 | facing DC | facing LOD | +1/8 |
| `tango:progressive-side-step-reverse-turn` | facing DC | -5/8 | facing wall | facing DW | -1/8 |
| `viennese_waltz:lf-backward-change-step-natural-to-reverse` | backing LOD | +2/8 | facing centre | backing DW | -1/8 |
| `viennese_waltz:natural-turn` | facing LOD | +8/8 | facing LOD | facing DC | -1/8 |
| `viennese_waltz:reverse-turn` | facing LOD | -8/8 | facing LOD | facing DW | +1/8 |
| `viennese_waltz:rf-backward-change-step-reverse-to-natural` | backing LOD | -2/8 | facing wall | backing DC | +1/8 |
| `viennese_waltz:rf-forward-change-step-natural-to-reverse` | facing LOD | +2/8 | facing wall | facing DW | -1/8 |
| `waltz:impetus` | backing LOD | +5/8 | facing DW | backing DC | +2/8 |
| `waltz:natural-turning-lock` | backing LOD | +3/8 | facing DC | pointing LOD | +1/8 |
| `waltz:outside-spin` | backing DW | +10/8 | facing DC | facing DW | +2/8 |
| `waltz:quick-open-reverse` | facing DC | -4/8 | backing DC | backing LOD | +1/8 |
| `waltz:overturned-running-spin-turn` | facing DW | +13/8 | facing centre | facing DC | +1/8 |
| `viennese_waltz:chasse-change-step` | facing LOD | +4/8 | facing ALOD | backing DW | +1/8 |
| `viennese_waltz:continuous-spin` | facing LOD | +8/8 | backing ALOD | facing DC | -1/8 |
| `viennese_waltz:reverse-pivots` | facing LOD | -8/8 | backing ALOD | facing DW | +1/8 |
| `viennese_waltz:hesitation-change` | facing LOD | +7/8 | facing DC | facing LOD | +1/8 |
| `viennese_waltz:drag-hesitation` | facing LOD | -4/8 | facing ALOD | backing DW | +1/8 |
| `viennese_waltz:natural-spin-turn` | facing LOD | +12/8 | backing LOD | backing DC | -1/8 |
| `viennese_waltz:telemark` | facing LOD | -8/8 | facing LOD | pointing DW | +1/8 |
| `viennese_waltz:natural-spin-turn-reverse-pivot` | facing LOD | +10/8 | backing centre | facing DW | -1/8 |
| `viennese_waltz:checked-natural-turn` | facing LOD | 0/8 | backing ALOD | facing DW | +1/8 |
| `viennese_waltz:natural-back-check` | facing LOD | +2/8 | backing centre | facing DW | -1/8 |
| `viennese_waltz:checked-reverse-turn` | facing LOD | -2/8 | backing wall | facing DC | +1/8 |
| `viennese_waltz:reverse-back-check` | facing LOD | -4/8 | backing LOD | facing DC | +3/8 |
| `viennese_waltz:contra-check` | facing DC | 0/8 | facing DC | facing DW | +2/8 |
| `viennese_waltz:left-whisk` | backing LOD | -4/8 | facing LOD | facing DW | +1/8 |
| `viennese_waltz:running-weave` | facing LOD | +4/8 | backing LOD | backing DC | -1/8 |
| `viennese_waltz:natural-fleckerl` | facing DW | +16/8 | facing DW | facing LOD | -1/8 |
| `viennese_waltz:reverse-fleckerl` | facing DC | -16/8 | facing DC | facing LOD | +1/8 |
| `viennese_waltz:check-from-reverse-to-natural-fleckerl` | facing DC | +3/8 | backing centre | facing DW_against | +1/8 |
| `viennese_waltz:overturned-natural-spin-turn` | facing LOD | +13/8 | backing DW | facing DC | +2/8 |
| `viennese_waltz:throwaway-oversway` | facing LOD | -8/8 | facing LOD | facing DW | +1/8 |
| `viennese_waltz:throwaway-oversway-taken-after-1-3-of-reverse-turn` | backing LOD | -4/8 | facing LOD | facing DW | +1/8 |
| `viennese_waltz:hover-reverse-turn` | facing LOD | -8/8 | facing LOD | facing DW | +1/8 |
| `viennese_waltz:running-feather` | facing LOD | +8/8 | backing ALOD | facing DC | -1/8 |
| `viennese_waltz:running-feather-opening-to-promenade-position` | facing LOD | +8/8 | backing ALOD | facing DC | -1/8 |
| `viennese_waltz:double-reverse-spin-overspin` | facing LOD | -16/8 | backing ALOD | facing DW | +1/8 |
| `viennese_waltz:reverse-impetus-into-right-lunge` | backing LOD | -5/8 | facing DC | facing LOD | +1/8 |
| `viennese_waltz:rudolph-fallaway` | facing LOD | -1/8 | backing DW_against | facing LOD | +1/8 |
| `viennese_waltz:ronde-twist-turn` | facing DC | +15/8 | facing centre | facing LOD | +2/8 |
| `viennese_waltz:double-leg-ronde` | facing DC | +16/8 | facing DC | facing DW | +2/8 |
| `viennese_waltz:swivel-to-promenade-pivot` | facing LOD | +4/8 | facing ALOD | backing DW | +1/8 |
| `viennese_waltz:swivel-to-promenade-link` | facing LOD | +6/8 | facing centre | facing DC | +1/8 |
| `tango:chase-alternative-endings-chase-chasse-common-steps-1-8` | pointing DW | +5/8 | facing centre | facing LOD | +2/8 |
| `foxtrot:outside-spin` | backing DW | +10/8 | facing DC | facing DW | +2/8 |
| `foxtrot:natural-twist-turn-with-impetus-to-p-p` | facing DW | +6/8 | facing DC | pointing centre | -1/8 |
| `quickstep:outside-spin` | backing DW | +10/8 | facing DC | facing DW | +2/8 |
| `quickstep:natural-turning-lock` | backing LOD | +3/8 | facing DC | pointing LOD | +1/8 |
| `waltz:throwaway-oversway` | backing DC | -3/8 | facing LOD | pointing DW | +1/8 |
| `foxtrot:throwaway-oversway` | backing DC | -3/8 | facing LOD | pointing DW | +1/8 |
| `quickstep:throwaway-oversway` | backing DC | -3/8 | facing LOD | pointing DW | +1/8 |
| `tango:throwaway-oversway` | backing DC | -3/8 | facing LOD | pointing DW | +1/8 |
| `waltz:oversway` | backing DC | -3/8 | facing LOD | facing DW | +1/8 |
| `foxtrot:oversway` | backing DC | -3/8 | facing LOD | facing DW | +1/8 |
| `quickstep:oversway` | backing DC | -3/8 | facing LOD | facing DW | +1/8 |
| `waltz:hinge` | backing DC | -3/8 | facing LOD | pointing DW | +1/8 |
| `foxtrot:hinge` | backing DC | -3/8 | facing LOD | pointing DW | +1/8 |
| `quickstep:hinge` | backing DC | -3/8 | facing LOD | pointing DW | +1/8 |
| `tango:hinge` | backing DC | -3/8 | facing LOD | pointing DW | +1/8 |
| `waltz:same-foot-lunge` | facing DW | +6/8 | facing DC | facing LOD | +1/8 |
| `foxtrot:same-foot-lunge` | facing DW | +6/8 | facing DC | facing LOD | +1/8 |
| `quickstep:same-foot-lunge` | facing DW | +6/8 | facing DC | facing LOD | +1/8 |
| `tango:same-foot-lunge` | facing DW | +6/8 | facing DC | facing LOD | +1/8 |

## B. Qualifier-only mismatches — 28 figures

The orientation derives EXACTLY; only the printed token's qualifier/presentation
(`pointing`, a PP `facing` off a crossing step, `backing` off a closing/heel-turn
step) isn't reproduced by the backing-on-last-back-step presentation rule. These keep
their stored exit so no presentation nuance is lost.

| Figure | Derived exit | Printed exit |
|---|---|---|
| `foxtrot:impetus` | facing DW | backing DC_against |
| `foxtrot:impetus-to-p-p` | facing DC | pointing DC |
| `foxtrot:telemark-to-p-p` | facing DW | pointing DW |
| `quickstep:backward-lock` | facing DC_against | backing DW |
| `quickstep:impetus-to-pp` | facing DC | pointing DC |
| `quickstep:natural-pivot` | backing ALOD | facing LOD |
| `quickstep:natural-turn` | facing ALOD | backing LOD |
| `quickstep:progressive-chasse-to-r` | facing DC_against | backing DW |
| `quickstep:quarter-turn-to-r` | facing DW_against | backing DC |
| `quickstep:reverse-turn` | facing ALOD | backing LOD |
| `quickstep:telemark-to-pp` | facing DW | pointing DW |
| `quickstep:v6` | facing DW | pointing DW |
| `quickstep:zig-zag` | facing DC_against | backing DW |
| `waltz:backward-lock` | facing DC_against | backing DW |
| `waltz:basic-weave` | facing DW | pointing DW |
| `waltz:drag-hesitation` | facing DC_against | backing DW |
| `waltz:hover-corte` | facing DW | backing DC_against |
| `waltz:impetus-to-pp` | facing DC | pointing DC |
| `waltz:outside-change` | facing DW | pointing DW |
| `waltz:progressive-chasse-to-r` | facing DC_against | backing DW |
| `waltz:reverse-turning-lock` | facing DW | pointing DW |
| `waltz:telemark-to-pp` | facing DW | pointing DW |
| `waltz:weave-from-pp` | facing DW | pointing DW |
| `waltz:fallaway-natural-turn` | facing DW | pointing DW |
| `tango:telemark-to-pp` | facing DW | pointing DW |
| `quickstep:outside-change` | facing DW | pointing DW |
| `quickstep:tipple-chasse-to-left` | facing ALOD | backing LOD |
| `quickstep:drag-hesitation` | facing DC_against | backing DW |

## C. Figures with incomplete alignments — 10

No derivation possible/needed; untouched by the migration.

| Figure | Has |
|---|---|
| `foxtrot:fallaway-reverse-and-slip-pivot` | entry only |
| `quickstep:reverse-pivot` | exit only |
| `tango:fallaway-reverse-and-slip-pivot` | entry only |
| `tango:open-promenade` | entry only |
| `waltz:closed-change-on-lf` | none |
| `waltz:closed-change-on-rf` | none |
| `waltz:fallaway-reverse-and-slip-pivot` | entry only |
| `waltz:reverse-pivot` | exit only |
| `waltz:contra-check` | exit only |
| `tango:outside-spin` | exit only |

## D. Unsplit `diagonal` direction cells — 51 figures

Related to the direction-vocabulary move to the ISTD set (`diagonal_forward` /
`diagonal_back`, added 2026-07-10): these role-steps are charted with the legacy
unsplit `diagonal` and can only be split by re-consulting the printed chart —
never mechanically. Count in parentheses = affected role-steps in that figure.

- `foxtrot:back-whisk (1)`
- `foxtrot:change-of-direction (1)`
- `foxtrot:curved-feather (1)`
- `foxtrot:feather-ending (1)`
- `foxtrot:hover-telemark (2)`
- `foxtrot:hover-telemark-to-p-p (1)`
- `foxtrot:impetus (1)`
- `foxtrot:impetus-to-p-p (1)`
- `foxtrot:natural-hover-telemark (2)`
- `foxtrot:natural-telemark (2)`
- `foxtrot:natural-twist-turn (2)`
- `foxtrot:natural-weave (1)`
- `foxtrot:natural-zig-zag-from-p-p (1)`
- `foxtrot:top-spin (1)`
- `quickstep:back-whisk (1)`
- `quickstep:backward-lock (3)`
- `quickstep:fisht-tail (2)`
- `quickstep:forward-lock (3)`
- `quickstep:hover-corte (1)`
- `quickstep:impetus (1)`
- `quickstep:impetus-to-pp (1)`
- `quickstep:natural-spin-turn (1)`
- `quickstep:quarter-turn-to-r (1)`
- `quickstep:reverse-pivot (1)`
- `quickstep:running-cross-chasse (2)`
- `quickstep:v6 (1)`
- `quickstep:zig-zag (1)`
- `tango:reverse-pivot (1)`
- `viennese_waltz:lf-backward-change-step-natural-to-reverse (2)`
- `viennese_waltz:lf-forward-change-step-reverse-to-natural (2)`
- `viennese_waltz:rf-backward-change-step-reverse-to-natural (2)`
- `viennese_waltz:rf-forward-change-step-natural-to-reverse (2)`
- `waltz:back-whisk (1)`
- `waltz:backward-lock (3)`
- `waltz:closed-change-on-lf (2)`
- `waltz:closed-change-on-rf (2)`
- `waltz:hover-corte (1)`
- `waltz:impetus (1)`
- `waltz:impetus-to-pp (1)`
- `waltz:natural-spin-turn (1)`
- `waltz:natural-turning-lock (1)`
- `waltz:reverse-pivot (1)`
- `waltz:running-cross-chasse (2)`
- `waltz:running-spin-turn (1)`
- `waltz:running-weave-from-pp (1)`
- `viennese_waltz:running-weave (1)`
- `tango:back-whisk (1)`
- `foxtrot:hover-feather (2)`
- `foxtrot:natural-twist-turn-with-impetus-and-feather-finish (1)`
- `quickstep:basic-movement-quarter-turn-and-progressive-chasse (1)`
- `quickstep:natural-turning-lock (1)`
