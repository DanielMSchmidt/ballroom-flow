# (Short imperative title)

*(Created YYYY-MM-DD · areas: domain / worker / web / contract / design / content / ops.
Copy this file to `docs/ideas/<short-slug>.md` and delete the parenthetical guidance. Keep
it as short as honesty allows — see [`README.md`](README.md) for the contract.)*

## Summary

*(One screen, readable by someone who knows the product but hasn't followed the debate.
What changes, for whom, and what becomes true that isn't true today.)*

## Mental-model delta

*(The load-bearing section. Which concepts change, named against `docs/concepts/` — e.g.
"annotations gain a fourth anchor type (`annotations.md` § Anchors)". Which `docs/system/`
docs the mechanics land in. When this idea ships, this section is the checklist of docs to
rewrite before deleting this file.)*

## Motivation

### Goals

### Non-goals

*(The YAGNI fence — what this idea deliberately does not do.)*

## Proposal

*(The change, told through at least one NAMED CONCRETE SCENARIO — walk it through current
behavior, then proposed behavior. Include risks and mitigations.)*

## Design details

*(Data shape, document boundaries, sync, permissions, D1 impact, migrations/back-compat.
Sketch until picked up; complete before implementing. Respect the locked invariants:
soft-delete only, client ULIDs, permissions at the DO boundary, D1 as pure index, components
only via `apps/web/src/store/`. UI: prototype in `docs/design/` first and link it here.)*

## Test plan & ship gate

*(Which layers per `docs/system/testing.md`, written/unskipped first. Then the graduation
criterion, singular: the Playwright journey `apps/web/e2e/<name>.spec.ts` that must be green.
An idea with no runtime surface names its equivalent observable outcome.)*

## Drawbacks

*(The honest cost: complexity carried, invariants made harder to hold, perf, bundle size.)*

## Alternatives

*(Every alternative seriously considered and why it lost — name the scenario each fails.
Load-bearing: this is what stops the debate being re-run.)*
