# Weave Enhancement Proposals (WEPs)

This directory is the **change process** for Weave Steps, modeled on the
[Kubernetes Enhancement Proposal (KEP)](https://github.com/kubernetes/enhancements) process
and adapted to this repo's scale and house rules. A **WEP** is a numbered, reviewable design
document with an explicit lifecycle: it proposes a substantive change, records the debate
(including rejected alternatives), and graduates through statuses until it is implemented —
or is explicitly deferred, rejected, or replaced.

**Division of labor (the KEP model):**

- **WEPs propose and record *changes*** — what should be different, why, the design, the test
  plan, the ship gate, and what was rejected along the way.
- **[`docs/PLAN.md`](../PLAN.md) describes the *current state*** — the merged, always-true
  spec of the domain model, architecture, and locked decisions. It is updated **in the same
  change** that implements a WEP, never left to drift. A PLAN-vs-code divergence is still a bug.

So: to know *what is true now*, read PLAN.md. To change what is true, or to understand *how it
came to be*, read (or write) a WEP.

---

## 1. When is a WEP required?

| Change | WEP? |
|---|---|
| Data shape, document boundaries, schema/migrations, sync protocol, permission model | **Yes** |
| Adding, changing, or reversing a **locked decision** (PLAN §8, D1–D33) | **Yes** |
| A new feature milestone or any multi-PR feature | **Yes** |
| New dependency, new infrastructure, new external service | **Yes** |
| Process changes (CI gates, review policy, this process itself) | **Yes** |
| Controlled-vocabulary *model* changes (new kind semantics, cardinality rules) | **Yes** |
| Bug fixes, refactors that change no behavior or boundary | No |
| UI work that recreates the `docs/design/` bundle pixel-for-pixel | No (the bundle is the proposal) |
| Vocabulary *value* refinements, seed-data corrections with recorded sources | No (data, not model — PLAN D30 rules apply) |
| Docs fixes, tooling upkeep that doesn't move a gate | No |

When in doubt, ask: *does this change something PLAN.md asserts, or bind us for longer than one
PR?* If yes, write a WEP. Writing one is cheap — a provisional WEP can be a page.

## 2. Lifecycle

```
            ┌──────────────┐     ┌───────────────┐     ┌─────────────┐
  idea ───▶ │ provisional  │ ──▶ │ implementable │ ──▶ │ implemented │
            └──────┬───────┘     └──────┬────────┘     └─────────────┘
                   │                    │
                   ▼                    ▼
        deferred / rejected /      withdrawn
             replaced
```

| Status | Meaning |
|---|---|
| `provisional` | The problem and direction are accepted as worth pursuing; design may be incomplete. |
| `implementable` | Design approved by the owner; Design Details + Test Plan + Ship Gate are complete. Implementation may start. |
| `implemented` | Shipped: the ship-gate journey is green and **PLAN.md was updated in the same change**. |
| `deferred` | Explicitly parked (e.g. v1.1 scope). Records why and what would revive it. |
| `rejected` | Considered and declined — kept so the debate is never re-run from scratch. |
| `withdrawn` | The author pulled it. |
| `replaced` | Superseded by a later WEP (`superseded-by` names it). |

**Status changes are PRs** that edit the WEP's front-matter (and body, as the design firms up).
The review conversation lives on those PRs. This mirrors how decisions were already made here —
argued in a PR against a **named concrete scenario** (the *Passing Tumble Turn* standard) and
recorded with the rejected alternative — the WEP just gives that record a stable home and number.

## 3. Directory layout & numbering

```
docs/proposals/
  README.md                      ← this process
  0000-template/README.md        ← copy me
  0001-enhancement-proposal-process/README.md
  0002-account-doc-live-do/README.md
  NNNN-short-slug/
    README.md                    ← the proposal (front-matter + body)
    plan.md                      ← optional: the checkbox execution plan (the old
                                    docs/superpowers/plans role), added at `implementable`
    *.png, *.md                  ← optional supporting assets
```

- **Numbering:** next free four-digit number, claimed by the PR that adds the directory.
  Numbers are never reused.
- **One directory per WEP**, named `NNNN-short-slug`. The proposal itself is always
  `README.md` inside it.
- **Owning area** (the SIG analogue — who must review): `domain`, `worker`, `web`,
  `contract`, `design`, `content`, `ops`, or `process`. A WEP spanning areas lists all of
  them; the strictest review tier wins.

## 4. Metadata (front-matter)

Every WEP's `README.md` starts with YAML front-matter:

```yaml
---
title: Short imperative title
wep: NNNN
owning-areas: [worker, domain]
status: provisional        # provisional|implementable|implemented|deferred|rejected|withdrawn|replaced
authors: ["@danielmschmidt"]
approver: owner            # the project owner approves every status promotion
created: 2026-07-13
last-updated: 2026-07-13
see-also: []               # PLAN sections, research docs, related WEPs
replaces: null             # WEP number this supersedes, if any
superseded-by: null        # filled when status becomes `replaced`
---
```

## 5. Required sections

The template ([`0000-template/README.md`](0000-template/README.md)) carries the full skeleton.
The section set is the KEP structure with this repo's gates folded in:

1. **Summary** — one screen, readable by someone who knows the product but not the debate.
2. **Motivation** — Goals / Non-Goals.
3. **Proposal** — the change, told through at least one **named concrete scenario**
   (house rule: designs here are adjudicated against real scenarios, not abstractions —
   see `.claude/skills/ballroom-flow-research-methodology`).
4. **Design Details** — data shape, document boundaries, sync, permissions, migrations
   and back-compat. Required for `implementable`, optional sketch at `provisional`.
5. **Test Plan** — which layers (per `docs/TEST-MAP.md` conventions), which tests are
   written/unskipped first (TDD is not optional), coverage impact.
6. **Ship Gate** — the KEP "graduation criteria", which here has one canonical form:
   the **Playwright journey** (`apps/web/e2e/*.spec.ts`) that must be green on the
   implementing PR before the WEP can be marked `implemented`. Name the spec file.
7. **Drawbacks** — the honest cost.
8. **Alternatives** — every alternative seriously considered, and why it lost. This is
   load-bearing: rejected alternatives recorded here are what stop the same debate being
   re-run (the role PLAN §8/§12 used to play).

## 6. Review & approval

- The **project owner approves** every status promotion (this is a single-owner project;
  the owner plays the KEP "approver" role, area reviewers play "reviewers").
- The existing **two-tier review gate** applies to the *implementing* PRs unchanged: any
  worker/permission/security-touching change is hard-gated
  (`.claude/skills/ballroom-flow-change-control` §5); pure design-parity UI stays fast-tier.
- A WEP that changes or reverses a **locked decision** must say so explicitly
  (`see-also: PLAN §8 D<n>`) and must argue against the scenario that motivated the original
  decision — silently diverging from a D-decision remains forbidden.
- UI-affecting WEPs don't replace the design bundle: **prototype in `docs/design/` first**;
  the WEP links the prototype as its design detail for the UI surface.

## 7. Relationship to what came before

- **PLAN §8 (Locked Technical Decisions, D1–D33) and §12 (Open Questions)** are the
  **pre-process decision ledger** — every decision made before 2026-07-13 lives there,
  unchanged, and D-numbers stay citable. Going forward: a new or changed locked decision
  is made **by a WEP**, and PLAN §8 gains/updates its row citing that WEP in the same
  change. New open questions are raised as **provisional WEPs**, not new §12 entries.
- **`docs/superpowers/specs` + `docs/superpowers/plans`** are **superseded for new work**
  by WEP directories (the spec role → the WEP `README.md`; the plan role → the WEP's
  optional `plan.md`, same checkbox format and global constraints). Existing files remain
  as the historical record — do not move or rewrite them.
- **Reference docs stay reference docs.** `DEVELOPMENT.md`, `TOOLING.md`,
  `DESIGN-SYSTEM.md`, `TEST-MAP.md`, `OPS.md`, `PROVISIONING.md` describe current state
  and are not proposals; a WEP that changes what they describe updates them at
  `implemented`, same as PLAN.md.

## 8. Index & keeping it current

**The canonical WEP index lives in [`CLAUDE.md` §1](../../CLAUDE.md)** — one table of every
WEP with areas, status, and a one-line summary, placed where every contributor (human or
agent) reads first, so relevant WEPs are picked up *before* execution. There is deliberately
no second table here — one list, one place to drift.

Same-change maintenance duties (never a follow-up PR):

- **Adding a WEP** → add its row to the CLAUDE.md index in the PR that creates the directory.
- **Any status change** → update the WEP's front-matter (`status`, `last-updated`) **and**
  its CLAUDE.md row together.
- **Reality moved** — an implementing PR (or any change) alters what a WEP asserts: its
  design details, scope, ship gate, or a premise a `provisional` WEP rests on → **update the
  WEP body + `last-updated` in that same change**. This is the same sync rule that protects
  PLAN.md: a WEP that disagrees with the code, with PLAN.md, or with its index summary is
  a bug.
