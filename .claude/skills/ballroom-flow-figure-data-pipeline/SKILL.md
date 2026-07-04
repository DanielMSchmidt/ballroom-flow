---
name: ballroom-flow-figure-data-pipeline
description: Load when touching Weave Steps figure/seed data — adding or correcting a figure chart, editing docs/seed/*.json, regenerating the bundled figure library (library-data.ts / figure-charts.generated.ts), debugging why a library figure shows a scaffold instead of real footwork, or judging whether technique content is trustworthy.
---

# Weave Steps — the figure data pipeline

The app ships a client-bundled catalog of International Standard ballroom figures.
Every cell of that data (footwork, sway, turn amounts, alignments) was researched
against real published technique sources and adversarially verified. This skill is
the map of how that data flows from seed JSON to the running app, the rules that
keep it trustworthy, and the checklist for adding a figure.

**When NOT to use this:**
- What a "figure", "footwork HT/TH", "CBM vs CBMP", or "alignment" *means* in ballroom → **ballroom-dance-reference** (this skill assumes those terms; they're defined there).
- The live-figure/variant/overlay document model, `resolveFigure(base, variant)`, forking → **ballroom-flow-crdt-reference** and **ballroom-flow-v5-migration-campaign**.
- Running tests, coverage, E2E → **ballroom-flow-validation-and-qa**.
- PR/TDD/PLAN.md process rules → **ballroom-flow-change-control**.
- Why past data decisions were made (full history) → **ballroom-flow-failure-archaeology**; this skill keeps only the data-quality lessons.

---

## 1. The pipeline (two generators, four seed files)

All paths repo-relative. **Generated files are never hand-edited — fix the seed, re-run the script.** Both scripts run `biome format --write` on their output so `pnpm lint` stays green.

```
docs/seed/istd-standard-figures.json      docs/seed/wdsf-standard-figures.json
  (figure IDENTITY — system of record:      (WDSF syllabus: timing string,
   figureType, name, dance, ISTD level;      start/finish phrases, notes;
   121 figures, empty attribute               147 figures)
   timelines — technique books are paid)
                 \                              /
                  v                            v
              scripts/gen-library.mjs   ← run: node scripts/gen-library.mjs
                  |   ISTD rows first (dedup by NFKD-normalized (dance, name) key,
                  |   accent-insensitive); matching WDSF rows contribute
                  |   timing/start/finish/notes; net-new WDSF figures appended.
                  v
   packages/domain/src/library-data.ts   (GENERATED — LIBRARY_FIGURE_DATA,
                                          204 figures as of 2026-07-02)

docs/seed/figure-charts.json             (147 verified per-step BOTH-ROLE charts;
                  |                       every entry records its source URL +
                  v                       corroboration + note)
       scripts/gen-figure-charts.mjs    ← run: node scripts/gen-figure-charts.mjs
                  |   drops no-op sway/turn "none" so timelines stay uncluttered
                  v
   packages/domain/src/figure-charts.generated.ts
       (GENERATED_FIGURE_STEPS + GENERATED_FIGURE_ALIGNMENTS)
                  |
                  v
   packages/domain/src/figure-steps.ts   (typed wrapper: FIGURE_STEPS,
                  |                       authoredSteps(), authoredAlignment())
                  v
   packages/domain/src/wdsf-timing.ts → buildWdsfAttributes()
       AUTHORED PATH: if authoredSteps(dance, figureType) exists AND its length
         equals parseWdsfTiming(timing).length → emit real per-count, per-role
         direction + footwork (+ sway/turn/bodyActions/footPosition/rise/position)
       SCAFFOLD PATH: otherwise → one free-text footwork attribute per count,
         start phrase on step 1, finish phrase on the last, blank between
                  |
                  v
   packages/domain/src/library.ts → LIBRARY_FIGURES  (what the picker/UI reads)
```

Also in `docs/seed/`: `istd-vs-wdsf-comparison.json` — a reference-only diff of the
two syllabi (not consumed by any script; see caveats, §6).

Key facts about the merge (verified in `scripts/gen-library.mjs`):

| Rule | Detail |
|---|---|
| ISTD is the system of record | Identity fields (figureType slug, display name, dance) come from ISTD when a figure is in both syllabi; emitted names keep the ISTD original. |
| WDSF supplies timing | `timing`/`start`/`finish`/`notes` come from the WDSF entry matched by normalized `(dance, name)`. |
| Net-new WDSF figures append | WDSF figures with no ISTD name-match are added with their own identity + timing. |
| ISTD-only figures | Carry identity only (no timing → no attributes → no chart possible until a timing exists). ~57 of the 204 as of 2026-07-02. |
| Dedup key | `dance::NFKD-lowercased-name` — "Chassé" and "Chasse" are the same figure. |
| Stable ids | `buildWdsfAttributes` mints deterministic attribute ids (`fig-<figureType>-<dance>-<role>-s<n>-…`), so regeneration is diff-stable. |

## 2. THE CARDINAL RULE: footwork is never invented

This dataset's value is that every technique cell traces to a published source. The
precedents, all in git history on `development`:

- **Unverifiable figures were REMOVED, not guessed** (1f67e38, PR #117): the full
  library was re-charted from real WDSF technique; 37 timed entries with no
  verifiable per-step source (or mis-catalogued by dance) were deleted from the
  seeds — library shrank 241 → 204. The 57 untimed ISTD identity-only figures
  stayed (nothing to fabricate — they carry no step content at all).
- **Every chart entry records provenance**: `source` (URL), `corroboration` (how
  the source supports the chart), and usually a `note` (what was uncertain and
  what was deliberately omitted). Example: Back Feather's note explains why its
  turn direction was omitted rather than guessed.
- **Second sources are hunted, not assumed** (01284a9): the Tango Fallaway Reverse
  & Slip Pivot page had no footwork column; four candidate second sources were
  chased (dead sites documented), footwork retained from the primary, and the
  provenance recorded in the entry's note instead of fabricating.
- **Designer errors are pushed back, not adopted** (4b9cf8a): the design bundle's
  "CBP" is a slip for CBMP, and its Turn "Continue" value is wrong (turn is the
  amount rotated ON that step; per-step amounts sum to the figure's total — there
  is no carry-over). Both were sent back to the designer; the code did not adopt
  them. Authority on technique content is the published source, not the mockup.
- **The vocabulary bends to reality, not the reverse** (d2d4b75): real 5/8–full
  turns had been silently capped at `half_L/half_R`; the `turn` enum was extended
  (five_eighth/three_quarter/seven_eighth/full) rather than mis-stating the data.
  Turns a source charts as spread BETWEEN steps stay distributed per-step so the
  sum is right — never dumped onto one step.
- **Feet are never shown or stored**: no "LF/RF" anywhere. The step headline is the
  `direction`; feet alternate automatically (1f67e38).

**Your rule when charting:** if you cannot verify a value, omit it and say why in
the entry's `note`. There is no formal "provisional" flag in the schema —
uncertainty is expressed by *omission plus a note*, and doubtful whole figures are
removed, not shipped. An omitted cell is recoverable; a fabricated one poisons
trust in every cell.

## 3. Adversarial verification for batch data changes

Any batch change to the charts goes through the adversarial-verification protocol:
independent verifier, sources re-fetched, CONFIRM/REJECT/UNCLEAR verdicts with a
skeptical default. **The canonical recipe** (proposer/verifier separation, verdict
semantics, and the 58a11f6/PR #118 worked example — 203 proposed cell-changes →
160 CONFIRM / 18 REJECT / 23 UNCLEAR-left-as-is) lives in
**ballroom-flow-proof-and-analysis**, method 2 — follow it, don't re-derive it.

Data-specific notes when applying it to figure charts:

- **UNCLEAR means the cell stays exactly as-is** (neither the old guess nor the new
  one wins); record the ambiguity in the entry's `note`.
- **Run the gates after applying** (§4 step 7): every catalog attribute must still
  pass the strict write schema.
- **What the verifier historically caught — watch for these when charting:**
  CBMP-mistaken-for-CBM; pivot footwork wrongly applied to entry walks; sway removed
  while the source charts it alongside side-leading; a lost `position: closed`.

## 4. Charting a new figure — end-to-end checklist

Prereq: the figure must exist in `library-data.ts` **with a `timing` string** (i.e.
in the WDSF seed, or ISTD-matched to a WDSF entry). An ISTD-only figure needs a
sourced timing added to `docs/seed/wdsf-standard-figures.json` first.

1. **Find sources.** Primary: `https://www.dancecentral.info` (per-figure pages
   with the full chart columns); WDSF technique preferred where systems differ.
   Cross-check a second source when the primary lacks a column (see 01284a9 for
   the documented-dead-ends pattern). No verifiable per-step source → **stop**;
   the figure keeps its scaffold (or gets removed if its content can't be trusted).
2. **Author the entry in `docs/seed/figure-charts.json`.** Shape (verified against
   the seed + `AuthoredStep` in `packages/domain/src/figure-steps.ts`):
   ```json
   {
     "dance": "foxtrot",
     "figureType": "back-feather",
     "source": "https://www.dancecentral.info/...",
     "corroboration": "how the source supports this chart",
     "note": "what was uncertain / deliberately omitted and why",
     "steps": [
       {
         "rise": "commence",            // SHARED (couple): rise vocab; omit if none
         "position": "CBMP",            // SHARED: position vocab; omit if unmapped
         "leader":   { "direction": "back",    "footwork": "TH",
                        "sway": "none", "bodyActions": ["CBM"], "turn": "eighth_R" },
         "follower": { "direction": "forward", "footwork": "HT",
                        "sway": "none", "bodyActions": ["CBM"], "turn": "eighth_R" }
       }
     ],
     "entryAlignment": { "qualifier": "backing", "direction": "DC" },
     "exitAlignment":  { "qualifier": "backing", "direction": "LOD" }
   }
   ```
   Rules: **one steps[] element per parsed timing count** (see §5 — count them
   before you chart); leader and follower are SEPARATE objects (they dance
   different patterns); `rise`/`position` are shared couple-level; all values must
   be vocabulary tokens from `packages/domain/src/vocabulary.ts` (direction/sway/
   turn/bodyActions/rise/position are closed enums; footwork is the free-text ISTD
   token form HT/TH/T/H/"heel pull"); `sway`/`turn` `"none"` is allowed in the seed
   (the generator drops it); alignments are from the **leader's perspective**, and
   a figure's exit should chain onto plausible followers' entries.
3. **Regenerate:**
   ```bash
   node scripts/gen-figure-charts.mjs
   # and only if you touched the ISTD/WDSF seeds:
   node scripts/gen-library.mjs
   ```
4. **The step-count guard** — the test that makes your content actually ship:
   `packages/domain/src/figure-steps.test.ts:10`
   *"every authored figure exists in the library and its step count matches its timing"*.
   If `steps.length !== parseWdsfTiming(timing).length`, `buildWdsfAttributes`
   **silently falls back to the scaffold** — the guard turns that silent downgrade
   into a red test. It also requires the charted figure to exist in
   `LIBRARY_FIGURES` and to have a timing.
5. **Vocabulary gates** (same file): direction values must be in the registry enum;
   footwork non-empty for both roles; optional sway/turn/bodyActions/rise/position
   must be real registry tokens.
6. **Strict-write gates:** `packages/domain/src/library.test.ts:100` ("every
   catalog attribute is a valid strict-write attribute for its dance") and
   `packages/domain/src/wdsf-timing.test.ts` — this is what catches e.g. a `rise`
   charted on a Tango figure (Tango has no rise & fall; `buildWdsfAttributes`
   additionally gates rise via `kindAppliesToDance` so a stray chart value can
   never emit an invalid attribute).
7. **Run it all:**
   ```bash
   pnpm --filter @weavesteps/domain test && pnpm lint && pnpm typecheck
   ```
8. **Process:** this is product data — normal change control applies (TDD where a
   behavior changes, PR into `development`, PLAN.md untouched unless the model
   changed). See **ballroom-flow-change-control**.

## 5. Timing math — `parseWdsfTiming`

`packages/domain/src/wdsf-timing.ts:26`. Converts a WDSF timing string ("SQQ",
"123", "Q&Q") into 1-indexed float beat counts, one per step:

- Cursor starts at 1.0; each symbol places a step at the cursor then advances it:
  **S = 2 beats, Q = 1, any digit = 1, & = 0.5**.
- An `&` **splits the preceding symbol**: a symbol immediately followed by `&`
  advances only 0.5 and the `&` takes the other half — `"Q&Q"` → `[1, 1.5, 2]`,
  `"12&3"` → `[1, 2, 2.5, 3]`.
- Spaces are cosmetic bar separators; the cursor accumulates across bars
  (`"123 123"` → `[1..6]`, `"SQQ QQQQ"` → `[1,3,4,5,6,7,8]`).
- `"(… Lady …)"` groups are the follower's variant — stripped, base timing kept.
  Other parentheses mark optional steps — contents kept, parens dropped.
- A leading `&` (syncopated pickup) clamps to the beat-1 floor.
- Every count snaps to the **1/8 grid** (`Math.round(c*8)/8`) — the same grid the
  write schema (`parseAttributeWrite`) validates.

Fraction display labels (`packages/domain/src/timing.ts`, FRACTION_LABELS):
`.125 → "ia"`, `.25 → "e"`, `.375 → "ai"`, `.5 → "&"`, `.75 → "a"` (only these
five; 3.25 renders "3e"). Historical trap: e/&/a were once swapped and corrected
in plan v4.3 (8f49169) — don't re-derive them from memory.

## 6. Known data caveats (as of 2026-07-02)

| Caveat | Detail | What to do |
|---|---|---|
| ISTD meta count | `istd-standard-figures.json` meta says `figureCount: 121` and the file has 121 entries (consistent at HEAD 70eed7e — some docs still quote 122). | Trust `len(figures)`, not any meta or doc count. |
| Comparison file is stale | `istd-vs-wdsf-comparison.json` summary (istd 122 / wdsf 184 / 66 exact matches) predates the 1f67e38 pruning; the live seeds are 121 / 147. | Treat it as historical reference only; nothing consumes it. |
| `(dance, name-slug)` matching undercounts | The comparison's own `matchCaveat`: ISTD and WDSF name the SAME figure differently (Back Lock vs Backward Lock, Closed Impetus vs Impetus, Reverse Corté vs Hover Corte). "istdOnly"/"wdsfOnly" often means *needs name reconciliation*, not *absent*. The gen-library dedup has the same blind spot — a name-mismatched pair yields TWO catalog rows. | Before adding a "missing" figure, search both seeds for synonyms. |
| WDSF `planDiscrepancy` self-flag | The WDSF seed's meta notes PLAN D30 names ISTD as the seed source while that file is WDSF. **Resolved operationally**: ISTD supplies identity (system of record), WDSF supplies timing/start/finish — exactly what `gen-library.mjs` implements and PLAN Q-LIBSEED now records ("ISTD identity + WDSF timing"). | Not a bug; don't "fix" it by re-keying identity to WDSF. |
| Charted vs scaffold inventory | 147 of 204 library figures have verified charts; the other 57 are ISTD-only identity rows with no timing (scaffold impossible — they show an empty timeline). A timed figure whose chart was removed shows the start/finish scaffold. | To upgrade a figure, follow §4. To see the split: compare keys of `GENERATED_FIGURE_STEPS` against `LIBRARY_FIGURE_DATA` rows with `timing`. |
| Empty `attributes: []` in ISTD/WDSF seeds | Deliberate: per-count technique is NOT in the public syllabi (paid technique books). Content arrives via figure-charts.json only. | Never populate those arrays by hand. |

## 7. v5 — the global-figure seeder is SHIPPED (additive-only, D30)

PLAN.md v5 (D30 ⟳v5; roadmap §9 step 3 ✅ as of 2026-07-02, PR #137): global catalog
figures are **real, admin-owned Automerge docs** (one Durable Object each). The
seeder exists — `seedGlobalFigures` in **`apps/worker/src/seed-global-figures.ts`**
— exposed as the **admin-only** route `POST /api/admin/seed-global-figures`
(`apps/worker/src/index.ts`; a non-admin gets 403) and reused by the E2E test-seed
path (`routes/test-seed.ts`, `seedGlobalFigures: true`). Its D30 contract:

- **One-time import per figure** into a real global figure doc keyed by
  `globalFigureRef(dance, figureType)` = `global:<dance>:<figureType>`; **after
  import the DOC is the source of truth**, refined by admin in-app edits — not
  re-imports.
- **Additive + idempotent:** re-running only ADDS figures that don't exist yet; it
  never overwrites an existing doc (`INSERT OR IGNORE` registry row + no-clobber
  `seedDoc`). A seed-JSON correction after import does NOT reach already-imported
  figures — those are fixed by an admin editing the doc.
- The bundled catalog (`library-data.ts`) remains the browse/picker index (names,
  families, dances); **figure content in routines reads from the docs** (PLAN §9
  content workstream). The store still uses the bundle as the last-resort render
  fallback for a `global:` ref whose doc/snapshot hasn't hydrated
  (`catalogFigureFor` / `resolveBaseContent` in `apps/web/src/store/routine.ts`),
  so a catalog placement is pre-filled by construction.

Everything in §1–§6 stays the live authoring pipeline for the SEEDS + bundle;
what changed is the runtime authority once a figure doc exists. Deployment note:
the seeder is an ops action per environment (see **ballroom-flow-run-and-operate**
§7); regenerating the bundle no longer rewrites content for already-seeded figures.

## Provenance and maintenance

Written 2026-07-02 against repo HEAD `70eed7e`; **§7 refreshed 2026-07-02 — verified at HEAD
`c9622c9`** (PR #137: `seedGlobalFigures` + admin route shipped, PLAN §9 step 3 ✅) on
`development`. Verified directly:
both generator scripts read in full; seed metas and entry counts recounted from the
JSON (`python3 -c "import json; print(len(json.load(open('docs/seed/figure-charts.json'))['figures']))"` → 147; istd 121, wdsf 147); `library-data.ts` → 204 rows;
`wdsf-timing.ts` / `figure-steps.ts` / `library.ts` read in full; guard tests read
(`figure-steps.test.ts`, `library.test.ts`, `wdsf-timing.test.ts`, `library-data.test.ts`);
`apps/worker/src/seed-global-figures.ts` + the admin route read at `c9622c9`;
commits 1f67e38, 58a11f6, 01284a9, 4b9cf8a, d2d4b75 messages read via `git log`;
PLAN.md D30/D31/Q-LIBSEED and the §9 content-workstream wording read.

Re-verify before trusting volatile facts:

```bash
# counts (library rows / charted figures / seed entries)
grep -c 'dance: "' packages/domain/src/library-data.ts          # 204
python3 - <<'EOF'
import json
for f in ["figure-charts","istd-standard-figures","wdsf-standard-figures"]:
    d = json.load(open(f"docs/seed/{f}.json")); print(f, len(d["figures"]))
EOF
# v5 seeder still shipped + additive (D30)?
grep -n "seedGlobalFigures" apps/worker/src/seed-global-figures.ts apps/worker/src/index.ts
grep -n "Global figure docs" docs/PLAN.md
# the step-count guard test still exists
grep -n "step count matches its timing" packages/domain/src/figure-steps.test.ts
# timing durations unchanged
grep -n 'DURATION' packages/domain/src/wdsf-timing.ts
```
