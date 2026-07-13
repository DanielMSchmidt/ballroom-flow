---
title: Adopt the enhancement-proposal process
wep: 0001
owning-areas: [process]
authors: ["@danielmschmidt"]
approver: owner
status: implemented
created: 2026-07-13
last-updated: 2026-07-13
see-also: ["PLAN §8", "PLAN §12", "docs/superpowers/specs (superseded convention)"]
replaces: null
superseded-by: null
---

# WEP-0001: Adopt the enhancement-proposal process

## Summary

Adopt a Kubernetes-Enhancement-Proposal-style change process for Weave Steps: substantive
changes are proposed as numbered **WEP** documents under `docs/proposals/`, each with
metadata, a lifecycle (`provisional → implementable → implemented`, plus terminal states),
required sections (Summary through Alternatives), and a **ship gate** (the Playwright journey
that defines done). `docs/PLAN.md` remains the merged current-state spec, updated in the same
change that implements a WEP. This WEP is self-hosting — it proposes the process it is
written in, and shipped with it.

## Motivation

### Goals

- Give every substantive change a **stable, numbered, reviewable artifact** with an explicit
  status, instead of decision history spread across PLAN §8 rows, §12 Q-entries,
  `docs/superpowers/specs`, and PR threads.
- Preserve what already worked here: decisions argued against **named concrete scenarios**,
  **rejected alternatives recorded** so debates are never re-run, PLAN.md kept canonical for
  current state, and the **E2E-journey ship gate** as the definition of done.
- Make *proposed-but-not-yet-true* work legible: PLAN.md asserts only what is; a WEP carries
  what might be, with a status that says how firm it is.

### Non-Goals

- **Not** retro-converting D1–D33 or the resolved Q-entries into WEP documents — PLAN §8/§12
  remain the citable pre-process ledger, frozen as history.
- **Not** replacing the reference docs (`DEVELOPMENT.md`, `TOOLING.md`, `DESIGN-SYSTEM.md`,
  `TEST-MAP.md`) — they describe current state, as before.
- **Not** changing any engineering gate: TDD unskip-first, the two-tier review gate, the
  design-bundle-first rule, and the coverage ratchet all apply unchanged to implementing PRs.
- **Not** adding tooling/automation (no bot, no CI check on front-matter) — YAGNI at
  single-owner scale; revisit by WEP if the index table starts drifting.

## Proposal

The full process is specified in [`docs/proposals/README.md`](../README.md) (the normative
text — this WEP motivates it and records the alternatives).

**Named scenario — the v5 figure-model reversal, re-run under this process.** The 2026-07-02
live-figures reversal is the strongest test the repo's history offers: it reversed a locked
decision (D12), was argued against the *Passing Tumble Turn*, recorded its rejected
alternative (frozen copies), shipped behind a migration milestone, and rewrote PLAN in the
same change. Under this process it would have been: a `provisional` WEP naming the scenario
and the D12 reversal → owner promotes to `implementable` once `resolveFigure` per-beat
ownership was designed → implementation PRs land against its ship-gate journeys → status
`implemented` in the PR that updated PLAN §5.2/§8. Everything the repo did informally gets a
number, a status, and a place — nothing the repo requires gets lost. A process that could not
express this reversal cleanly would be the wrong process.

## Design Details

No runtime surface. The design is the directory contract in `docs/proposals/README.md`:
numbering, front-matter schema, section set, status semantics, owning areas, and the
relationship rules (PLAN sync at `implemented`; superpowers specs/plans superseded for new
work; §12 closed to new entries in favor of provisional WEPs).

## Test Plan

Docs-class change (per `.claude/skills/ballroom-flow-change-control` §1): no code, no tests.
The verifiable claims are the paths and gate references in the process doc, checked against
the repo in review.

## Ship Gate

Process WEPs have no Playwright journey. The observable outcome: this directory exists with
the process doc, template, and seed WEPs (0002, 0003); CLAUDE.md and PLAN §8/§12 route
decision-making through it. All shipped in the PR that lands this WEP — hence `implemented`.

## Drawbacks

- **Ceremony at single-owner scale.** Most KEP machinery exists to coordinate many parties;
  here the owner approves their own proposals. Mitigated by keeping the required set small
  (a provisional WEP is a page) and the "when required" table honest — bug fixes and
  design-parity UI need no WEP.
- **A second place to keep current** (the index table, statuses, PLAN cross-references).
  The same-change sync rule that already protects PLAN.md extends to cover it.

## Alternatives

- **Status quo** (PLAN §8/§12 + superpowers specs). Worked for the 8-day build, but proposals
  had no lifecycle (a spec was either "a file" or "shipped"), §12 mixed open and resolved
  items across five dated subsections, and pre-decision debate lived only in PR threads.
  Rejected: the owner asked for an explicit proposal process, and the v5-reversal scenario
  shows the informal version already needed everything a WEP records.
- **Full retro-conversion of D1–D33 into WEPs.** Maximal uniformity, but it would rewrite
  history documents that other docs, commits, and skills cite by number and section — high
  churn, zero new information, and a violation of the repo's own "don't rewrite the
  historical record" instinct (superpowers files are kept verbatim for the same reason).
  Rejected in favor of the ledger rule (§7 of the process doc).
- **Rust-RFC style single files** (`proposals/NNNN-slug.md`, no directory). Fewer files, but
  no home for the execution `plan.md` or supporting assets, which the superpowers convention
  proved this repo wants next to the spec. Rejected; directories cost nothing.
- **GitHub Issues/Discussions as the proposal medium.** Off-repo state contradicts how this
  project works (agent-driven, everything greppable in the tree; the gitignored issue ledger
  already causes dangling `#n` references). Rejected.
