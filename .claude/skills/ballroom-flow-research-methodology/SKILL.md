---
name: ballroom-flow-research-methodology
description: Load when turning a hunch into an accepted change in ballroom-flow — proposing an architecture or model change, adjudicating a design dispute, root-causing a flake or bug before "fixing" it, or deciding whether an investigation's conclusion is trustworthy enough to lock. Covers the evidence bar, adversarial refutation, named-scenario adjudication, the idea→locked-decision pipeline, and the banned anti-patterns.
---

# Ballroom Flow — research methodology (how ideas become locked decisions)

This repo has a specific, history-tested discipline for how a hunch becomes an accepted
change. It was forged in 8 days / 131 PRs (2026-06-24 → 2026-07-02) that included three
figure-model reversals, a wrong-branch disaster, and a dozen root-caused flakes. Follow it.

**When NOT to use this**

| You actually want | Use instead |
|---|---|
| Concrete proof recipes (convergence proofs, property tests, EXPLAIN gates, repeat-each flake hunting) | `ballroom-flow-proof-and-analysis` |
| The mechanics of landing a change (branch, TDD loop, PR, PLAN.md-in-same-change, review tiers as process) | `ballroom-flow-change-control` |
| Diagnosing a live failure right now | `ballroom-flow-debugging-playbook` |
| The catalog of past incidents and their lessons | `ballroom-flow-failure-archaeology` |
| What the current architecture/model IS | `ballroom-flow-architecture-contract`, `ballroom-flow-crdt-reference` |
| Open research directions and future work | `ballroom-flow-research-frontier` |

---

## 1. The evidence bar

An investigation's conclusion is accepted only when it clears all four rules below.
Each rule has a real case from this repo — read the case, then apply the rule.

### Rule 1 — One mechanism must explain ALL observations, including the negatives

If your explanation covers 4 of 5 symptoms, you have not found the mechanism — you may
have found *a* bug, but you must explicitly classify the residual as a **different class**
and track it separately, never wave it away.

**Case:** the hydration/durability flake split (`97e7fea` then `4ef16ac`; full story:
**ballroom-flow-failure-archaeology**). The hydration fix's commit message does the
load-bearing methodological thing: it explicitly states the residual reload flake is "a
DISTINCT residual flake … a write-DURABILITY gap … NOT hydration; it's tracked + gated
separately as #204" — and that second class was fixed the same day by a different
mechanism. Two flakes, two mechanisms, two fixes — because the first investigation
refused to claim the second.

```text
Checklist before writing "root cause":
[ ] List every observation, including ones your mechanism does NOT explain.
[ ] For each unexplained observation: name it as a separate class with its own tracking id.
[ ] State what your mechanism predicts should NOW be impossible — and verify it is.
```

### Rule 2 — A fix that only works on localhost timing is not a fix

If correctness depends on an ordering that fast local latency happens to provide, the bug
is still there. The same `97e7fea` message records this exactly: the earlier gate "got
away with it on fast localhost timing; on real latency the data-loss bug … could
re-appear." The accepted fix replaced a timing coincidence with an **explicit acknowledged
signal** (the marker frame). Generalization used repo-wide: "open" ≠ "hydrated" ≠
"durable" ≠ "broadcast" — every state transition needs its own explicit signal, never an
assumed ordering. Proving this class of fix (e.g. `--repeat-each` under real latency) is
covered in `ballroom-flow-proof-and-analysis`.

### Rule 3 — The hypothesis must predict the numbers BEFORE you run

State what you expect to measure, then measure. If the measurement matches the
prediction, the mechanism is confirmed; if you measure first and explain after, you are
curve-fitting.

**Case:** the axe a11y flake (commits `b419e0a` then `ad22e16`) — "the dominant CI flake
for a day." Hypothesis: prop-less `<FigureLibrary/>` renders the entire ~240-figure
catalog (~2975 DOM nodes); axe is O(nodes); therefore the sweep should sit just over
vitest's 5s default under parallel CI load but pass warm. Prediction confirmed: ~3s in
isolation, 13–17s under parallel CI load — a deterministic timeout edge, **not** a random
flake. The fix followed from the mechanism (render one dance — 585 nodes, ~0.2s, identical
markup properties so zero coverage lost — plus timeout headroom), not from retrying.

### Rule 4 — Negative results are results; absence of proof is recorded, not papered over

When a source can't support a value, the value is dropped, not guessed: 37 unverifiable
figures were **removed** from the catalog rather than fabricated (`1f67e38`, PR #117 —
"removed rather than guessed"); turn edits beyond the representable enum were "dropped
rather than mis-stated" (`58a11f6`). The M0.5 spike explicitly recorded what it did NOT
exercise (WS/hibernation — deferred to M2) in `docs/spike/SPIKE-FINDINGS.md`.

---

## 2. Adversarial refutation is an assigned role, not a vibe

"Be skeptical" is not a process. This repo assigns refutation to a **separate party with
a skeptical default**, and gates merges on their verdict.

**Case — the catalog verification pass (`58a11f6`, PR #118):** charting agents proposed
203 per-cell technique changes; an *independent adversarial verifier* re-fetched every
source and judged each change with a skeptical default (160 CONFIRM / 18 REJECT / 23
UNCLEAR-left-as-is). The methodological point: **the proposer never self-certifies** —
refutation was an assigned role with merge-gating verdicts. The step-by-step recipe and
the representative catches live in `ballroom-flow-proof-and-analysis`, method 2.

**Case — review gates for invariant-touching changes** (design-parity spec,
`docs/superpowers/specs/2026-06-29-design-parity-design.md`): a **two-tier** gate —
permission/invariant/security-touching PRs are **hard-gated** (Frontend + Tester + Staff
verdicts before merge; "Never merge before every assigned reviewer posts a verdict");
pure-UI parity PRs are fast-tier with a post-merge visual health check. The tier is
chosen by what the change *touches*, not by how confident the author feels.

**Case — the five adversarial critiques** (`research/critique-{domain,product,scope,sync,
testing}.md`): commissioned specifically to attack the plan. Several were adopted
wholesale (critique-sync's "per-cell CRDT rejection is incoherent — gate at the
connection" is now the permission architecture; critique-testing's EXPLAIN CI guard
shipped). One was **overridden**: critique-scope argued to drop the CRDT/DO layer for a
D1-only v1, and the owner overrode it because fork/document-graph is the deliberate
investment (PLAN §1). **Being overridden is a valid outcome** — the critique still
sharpened the decision and lives in the repo as the recorded counter-argument.

```text
When you propose a change to an invariant (permissions, undo, sync, CRDT schema, catalog data):
[ ] Name the refuting party (a reviewer, a verifier agent, a second-source check) BEFORE building.
[ ] The refuter's default is REJECT; each claim needs affirmative evidence to flip to CONFIRM.
[ ] UNCLEAR = leave the existing state as-is; never resolve ambiguity in your proposal's favor.
[ ] Record the refuter's verdict counts / rejected items in the PR, not just the accepted ones.
```

---

## 3. Named-scenario adjudication: disputes are settled by a concrete scenario, not debate

When two models both "sound right," write one **named, concrete end-to-end scenario**,
derive what each model observably does in it, and let the derivation decide. Then —
**this is a requirement of the method, not a nicety** — record the *rejected* alternative
inline in `docs/PLAN.md` next to the decision, so the next person who re-derives the
losing idea finds the refutation waiting.

**Case — Passing Tumble Turn → the v5 reversal** (PR #132, `e27bca6`): the frozen-copy
vs live-figure dispute was settled by the owner's canonical scenario, now written
verbatim into PLAN §5.2: a Slowfox choreo places the catalog Tumble Turn twice — once
plain, once re-choreographed as a *Passing* Tumble Turn for the last ~3 beats. Derive:
when the catalog figure later gains a new attribute kind, the plain placement must show
it on every beat, and the Passing variant on its **untouched beats only**. Frozen copies
cannot produce that observation; live-overlay-with-per-beat-ownership can. Decision:
D12 ⟳v5; the scenario itself is pinned by domain tests (`packages/domain/src/fork.ts`
per PLAN §9 step 2).

**Case — US-015 journeys → the D10 rejection** (PR #95, same-day commits `9416875` →
`01365dc`): the first cut made *everyone* read via polled REST snapshot, upgrading to WS
on first edit. The already-written US-015 convergence journeys were the scenario: a
passive co-editor on a ~20s poll cannot see a collaborator's edit live — 5 @smoke
journeys broke. Rejected **within the same PR**; the final model is the role-aware hybrid
(viewers zero sockets; editors one eager routine WS; figure WS on editor open). PLAN §8
D10 records the rejected alternative inline: "(An earlier 'read-by-default for everyone,
upgrade on first edit' variant was rejected: a passive co-editor on a polled snapshot
can't receive another editor's edits live — it broke the US-015 convergence journeys.)"

**Case — Yjs → Automerge** (`12dd3db` recommended Yjs; `370de7c` v4 reversed to
Automerge): the CRDT research's library recommendation was overturned not on tech merit
but by a product scenario — full-power cross-routine forking, the v1 centerpiece. A
recommendation is an input; the scenario decides.

```text
Adjudication recipe:
1. Name the scenario (a real figure, a real user pair, a real journey — "Passing Tumble Turn", "US-015").
2. For each competing model, DERIVE the observable behavior in that scenario. No adjectives — observations.
3. The model whose derived observations match the requirement wins. If both match, the scenario was
   too weak — sharpen it until it discriminates.
4. Write the decision into docs/PLAN.md (§8 row and/or the owning section) WITH the rejected
   alternative and why it fails the scenario, in the same change (CLAUDE.md rule).
5. If tests can pin the scenario, pin it (the Passing Tumble Turn is a domain test, not just prose).
```

---

## 4. The idea lifecycle: pipeline with artifacts

Every accepted idea in this repo left this paper trail. If you're introducing an idea,
produce the artifacts in order; if you're auditing one, walk the trail backwards.

| Stage | Artifact | Repo location / example |
|---|---|---|
| 1. Deep-dive or critique | `research/*.md` | `research/extensibility-crdt.md` (load-bearing), the 5 `critique-*.md` |
| 2. Owner review on a PR | PR discussion driving plan versions | PR #9 ("docs/consolidated-plan", merged `6954651`): v2 `94187e4` "redesign from PR review" → v3 `de89e00` → v4 `370de7c` → v4.3 `8f49169` |
| 3. Locked decision | `docs/PLAN.md` §8 (D1–D31), with resolved Q-ids in §12 (Q-COW-TRIGGER, Q-OVERLAY-GRAIN, Q-FORK-UX, …) | D10's inline rejection; D12 ⟳v5 |
| 4. Feature spec | `docs/superpowers/specs/YYYY-MM-DD-<slug>-design.md` — frontmatter (Date/Status/Branch/Stories/ship gate) + a dated "## Locked decisions" section | `2026-06-27-fe3-variants-cow-design.md` |
| 5. Plan | `docs/superpowers/plans/YYYY-MM-DD-<slug>.md` — TDD checkbox tasks, agentic-worker banner, global constraints | `2026-06-29-design-parity.md` |
| 6. Code + tests | TDD RED→GREEN→REFACTOR (see `ballroom-flow-change-control`) | — |
| 7. Coverage row | `docs/TEST-MAP.md` story-key → test files | US-001…US-054 matrix |
| 8. (Sometimes) documented reversal | PLAN edited **in place** with lineage kept | figure model: live-overlay v4 → frozen-copy v4.4 (`9f0357d`) → live-overlay-with-per-beat-ownership v5.0 (`e27bca6`); PLAN §12 keeps the superseded 2026-06 answers under a "supersedes" header |

**Retirement is documented, never silent.** When an idea dies, its grave is marked where
the next person will look:

- `docs/TEST-MAP.md` carries inline retirement entries — US-006 "~~Overlay resolution~~
  *(retired + removed 2026-06-30)*" with a full note of what was deleted and which
  migration strips strays; US-047/US-048 "_retired — JSON export/import superseded by
  forking_".
- `USER-STORIES.md` was removed by owner call (`17eee40`, 2026-07-02) with the removal
  note written into TEST-MAP's header and CLAUDE.md — the `US-…` ids survive as stable keys.
- The M0.5 spike code was deleted (`b09d5e5`, "findings retained") — findings live on in
  `docs/spike/SPIKE-FINDINGS.md`, and the commit hash is recorded there so the code stays
  recoverable.

**Reversals keep lineage.** All three figure-model changes were made by editing PLAN in
place with markers (Δ = v4 change, ⟳v5 = v5 change) and superseded-entry notes — never by
deleting history or forking the doc. A reader of PLAN v5.0 can reconstruct v4 and v4.4
and *why each fell*.

---

## 5. Where good ideas historically came from

Know the productive sources; invest in them deliberately.

| Source | Mechanism | Evidence |
|---|---|---|
| **Adversarial critiques** | 5 commissioned attacks on the plan; adopted where they held, overridden where the product scenario beat them — both outcomes valuable | `research/critique-*.md`; critique-sync → connection-gated permissions; critique-scope overridden (fork investment) |
| **The timeboxed throwaway spike** | M0.5: prove the riskiest assumption (Automerge-in-DO) on real workerd before committing; code deleted, findings + sharp edges kept | `docs/spike/SPIKE-FINDINGS.md`; deletion `b09d5e5`; the isolatedStorage and incremental-persistence findings still govern every DO test |
| **Owner scenario-walking** | The owner works the model against a concrete dance scenario until it breaks or holds | Passing Tumble Turn → v5 (PLAN §5.2); PR #9 review → v2 flat roles/float-count timeline |
| **Failing journeys** | An already-written E2E journey refutes a design before it ships | US-015 → D10 rejection (`01365dc`); `--repeat-each` exposing the durability gap (`4ef16ac`) |
| **Root-caused flakes** | Every flake investigation produced a durable engineering rule | axe O(nodes) → render-minimal-equivalent-markup; hydration marker → explicit-signal rule; shared-D1 collisions → per-suite migrations |

Note the common thread: none of these is "brainstorming." Each source works by
**confronting a model with something concrete** — an attacker, real infrastructure, a
named scenario, a failing assertion.

---

## 6. Anti-patterns observed and banned

| Anti-pattern | Incident | Rule |
|---|---|---|
| **Building on the wrong base** | PR #83 built on stale `main` instead of `development` and was fully reverted (`720103d`); PR #90 built against a retired architecture and died unmerged — right idea, wrong base, both times (full accounts: `ballroom-flow-failure-archaeology`). | Before building, verify the base: `git branch --show-current` must trace to `development` (CLAUDE.md §7), and read the *current* PLAN §6 architecture — the seam you're patching may no longer exist. |
| **Silent divergence from PLAN** | The whole reversal machinery (§4 above) exists so this never happens; CLAUDE.md declares a PLAN/code divergence a bug. | If the code needs to differ from PLAN, change PLAN **in the same change** with the rationale and the rejected alternative. A locked decision that feels wrong goes through PLAN §8/§12 — surface it, don't route around it. |
| **Retry-until-green** | Never once used: the axe flake got an O(nodes) mechanism + prediction (`ad22e16`); the hydration flake got a protocol marker (`97e7fea`); shared-D1 collisions got per-suite migrations; stale skipped convergence journeys were unskipped the moment the machinery existed (`d49fb52`, PR #61) rather than left "flaky". | A flake is a bug with a timing-shaped reproduction. Root-cause it (Rules 1–3 above; recipes in `ballroom-flow-proof-and-analysis`). Weakening or re-running a test to pass is a methodology violation, not a fix. |

Two corollaries from the same history: **fixes can be silently lost in squash/merge races**
(the seed.ts try/catch dropped in PR #51's window, `79b927d`) — after any conflicted
squash, re-verify the fix is still present; and **build artifacts must be isolated by
output path, not step ordering** (`e71d06d`: the E2E auth-bypass bundle shipped to staging
because two builds shared `apps/web/dist`) — when a fix depends on "step A runs before
step B", it fails Rule 2.

---

## Provenance and maintenance

Authored 2026-07-02 against repo HEAD `70eed7e` on `development` (via branch
`claude/skill-library-handoff-bidyjh`). All commit hashes, PR numbers, quoted commit-message
fragments, PLAN.md section contents (§5.2 Passing Tumble Turn, §8 D10/D12/D14, §12 Q-ids),
spec/plan file structure, TEST-MAP retirement entries, and research/ file inventory were
verified directly against the repo and `git log`/`git show` on that date. PR-state claims
(#90, #83/#84 closed-unmerged status) come from the project's verified history corpus of
2026-07-02.

Re-verification one-liners for drift-prone claims:

```bash
git show 97e7fea -s --format='%B' | grep -n "DISTINCT residual"        # Rule 1 case
git show ad22e16 -s --format='%B' | grep -n "13–17s"                   # Rule 3 case
git show 58a11f6 -s --format='%B' | grep -n "160 CONFIRM"              # §2 verifier verdicts
grep -n "Passing Tumble Turn" docs/PLAN.md                              # §3 canonical scenario
grep -n "was rejected" docs/PLAN.md | head -3                           # D10 inline rejection
grep -n "retired" docs/TEST-MAP.md                                      # §4 retirement entries
ls docs/superpowers/specs docs/superpowers/plans research               # §4 pipeline artifacts
git log -1 --format='%h %s' b09d5e5                                     # spike deletion, findings kept
```

If PLAN.md moves past v5.0, re-check §8/§12 anchors (D-numbers and Q-ids are stable keys,
but new ⟳ markers may supersede the v5 entries the same way v5 superseded v4.4).
