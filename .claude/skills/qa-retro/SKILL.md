---
name: qa-retro
description: After a bug is fixed, analyze how the qa-explorer agent could have caught it earlier and fold that lesson into the QA probe library. Invoke with a reference to the fixed bug (/qa-retro <PR/commit/issue ref or a description>). Updates .claude/qa/probes.md (and, for methodology gaps, the agent definition itself).
---

# /qa-retro — turn a fixed bug into QA coverage

A bug that reached the user is a bug the QA explorer missed. This skill runs the
retrospective that closes that loop: understand the escape, decide honestly whether the
current QA setup would have caught it, and encode the *class* of bug — not the instance —
into `.claude/qa/probes.md` so the next `/qa-run` hunts its siblings.

This is about the QA agent only. The fix itself should already carry its own regression
test per repo policy (`ballroom-flow-validation-and-qa`) — if it doesn't, flag that to the
user, but don't conflate the two: the Playwright test pins *this* bug; the probe hunts the
*next one like it*.

## 1. Understand the escape

From the reference the user gave (PR, commit, issue, or description), reconstruct:

- **Symptom** — what a user actually experienced.
- **Root cause** — read the fix diff; read the linked issue; if the area has history, check
  `ballroom-flow-failure-archaeology` for prior incidents in the same class.
- **Which documented promise it broke** — find the exact `docs/concepts/` /
  `docs/system/` sentence. (If no doc promises the behavior, that's a finding too: the
  mental-model docs have a gap — tell the user.)

## 2. The honest counterfactual

Trace the current QA setup against this bug, step by step — no wishful thinking:

1. Would the **feature checklist** derived from `docs/concepts/` have driven the explorer
   into the right surface at all?
2. Would the **protocol** (`qa-explorer.md` §4: happy path ×2 viewports, adversarial,
   cross-account, model audit, offline/durability) have produced the triggering conditions
   (the specific role, concurrency, timing, viewport, data shape)?
3. Would an existing **probe** (`.claude/qa/probes.md`) have fired?

Verdict, one of:

- **CAUGHT** — the setup covers it; the bug predates the QA system or the run wasn't
  executed. No probe change; note it in the summary.
- **PROBE GAP** — the surface would be visited but the triggering condition would never be
  produced. → §3a.
- **METHOD GAP** — a whole dimension is missing from the explorer's protocol (a class of
  input, environment, or user behavior it never varies). → §3b.

## 3. Encode the lesson

### 3a. Probe gap → append to `.claude/qa/probes.md`

Write the probe **generalized to the class**: ask "what family of bugs is this one instance
of?" and probe the family. ("Owner missing from author list" → "every people-listing surface
must include the owner", not "check the journal author dropdown".) Follow the file's format:
`### P-NN — <name>`, what to do → what must hold, provenance line citing the fixed
PR/commit/issue and today's date. Before appending, check whether an existing probe already
subsumes it — if so, sharpen that probe instead of adding a near-duplicate.

### 3b. Method gap → edit `.claude/agents/qa-explorer.md`

If the explorer's protocol itself is blind to a dimension (e.g. it never varied locale, never
tested with a slow network, never resized mid-session), add that dimension where it belongs
in the agent definition (§4 usually), keeping the edit minimal. Show the user the diff —
the agent's charter is theirs.

### 3c. Siblings

List the sibling scenarios the new probe implies (other surfaces/roles/timings in the same
class). If any look likely to be broken *right now*, recommend a focused
`/qa-run <that area>` — but launching it is the user's call.

## 4. Report

Summarize for the user: the escape (symptom → root cause → broken promise), the verdict
with the honest reasoning, exactly what changed (probe added/sharpened, or agent edit —
show it), and the sibling list. Offer to commit the probe/agent changes on a
`chore/qa-retro-<slug>` branch. Do not commit unasked; never to `main`.
