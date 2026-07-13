---
title: (short imperative title)
wep: 0000
owning-areas: []          # domain | worker | web | contract | design | content | ops | process
status: provisional       # provisional|implementable|implemented|deferred|rejected|withdrawn|replaced
authors: []
approver: owner
created: YYYY-MM-DD
last-updated: YYYY-MM-DD
see-also: []              # PLAN sections (e.g. "PLAN §5.2"), research docs, related WEPs
replaces: null
superseded-by: null
---

# WEP-0000: (title)

<!--
Copy this directory to docs/proposals/NNNN-short-slug/ (next free number), fill in the
front-matter, and delete the comments. A `provisional` WEP needs Summary, Motivation, and
Proposal with a named scenario — the rest can be sketches. Promotion to `implementable`
requires every section complete. Keep it as short as honesty allows.
-->

## Summary

<!-- One screen. Readable by someone who knows the product but hasn't followed the debate.
What changes, for whom, and what becomes true that isn't true today. -->

## Motivation

### Goals

<!-- Bullet list. What this WEP guarantees when implemented. -->

### Non-Goals

<!-- What this WEP deliberately does not do — the YAGNI fence. -->

## Proposal

<!-- The change, told through at least one NAMED CONCRETE SCENARIO (house rule — designs are
adjudicated against real scenarios like the Passing Tumble Turn, not abstractions). Walk the
scenario through the current behavior, then through the proposed behavior. Include risks and
mitigations. -->

## Design Details

<!-- Required for `implementable`. Data shape, document boundaries, sync, permissions,
D1 index impact, migrations and back-compat (schemaVersion? migration actor? legacy reads?).
Respect the locked invariants: soft-delete only, client ULIDs, permissions at the DO boundary,
D1 as pure index, components only via apps/web/src/store/. If the WEP touches UI, link the
docs/design/ prototype — the bundle stays the canonical visual source. -->

## Test Plan

<!-- Which layers (domain unit/property, worker/DO, component+axe, E2E) per docs/TEST-MAP.md
conventions; which tests are written or unskipped FIRST (TDD is not optional); coverage
impact against the armed thresholds. -->

## Ship Gate

<!-- The graduation criterion, singular and canonical: name the Playwright journey
(apps/web/e2e/<name>.spec.ts) that must be green on the implementing PR before this WEP can be
marked `implemented`. A WEP with no runtime surface (process/content) names its equivalent
observable outcome instead. Marking `implemented` also requires PLAN.md (and any affected
reference doc) updated in the same change. -->

## Drawbacks

<!-- The honest cost: complexity carried, invariants made harder to hold, perf, bundle size. -->

## Alternatives

<!-- Every alternative seriously considered and why it lost. Load-bearing — this is what stops
the debate being re-run. Name the scenario each alternative fails. -->
