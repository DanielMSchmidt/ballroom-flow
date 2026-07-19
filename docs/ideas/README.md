# Future ideas

This directory holds **designed-but-not-built ideas** — each one a self-contained document
that can be picked up and dispatched as work at any time, without re-deriving the design.
It replaces the earlier numbered-WEP process (statuses, approver metadata, lifecycle
diagrams): this is a one-person project, so there is nothing to coordinate — **an idea is
either in this folder (not built) or folded into the docs (built)**.

## The contract

- **Presence in this folder means "not implemented".** There are no status fields. If an
  idea is here, the app doesn't do it; the [`docs/concepts/`](../concepts/) and
  [`docs/system/`](../system/) docs describe only what is true.
- **Every idea is explicit about its mental-model delta** — the section that says which
  concepts change, in [`docs/concepts/`](../concepts/) terms, when it ships. This is the
  section that makes flipping the switch cheap: it tells the implementer exactly which docs
  to rewrite.
- **Shipping an idea consumes it.** The PR that implements an idea, in the same change:
  1. folds its mental-model delta into the relevant `docs/concepts/` docs,
  2. folds its mechanics into the relevant `docs/system/` docs,
  3. updates anything else it touched (`TEST-MAP.md`, `OPS.md`, the design bundle, …),
  4. **deletes the idea file.** Git history is the archive.
- **Rejecting an idea also consumes it**: delete the file; if the debate is worth keeping,
  record a one-line "considered and rejected: X, because Y" in the concept/system doc where
  the next person would look for it. Load-bearing rejected alternatives belong *in the
  docs*, next to the rule they protect — not in a graveyard folder.

## When does something need an idea doc?

Write one for anything **substantive**: changes to the data shape, document boundaries,
sync, or permissions; a new feature bigger than one PR; a new dependency or external
service; reversing a documented design rule. The test: *does this change something
`docs/concepts/` or `docs/system/` asserts, or bind us for longer than one PR?*

No idea doc needed for: bug fixes, behavior-preserving refactors, UI work that recreates the
design bundle pixel-for-pixel (the bundle is the proposal), sourced seed-data corrections,
or docs/tooling upkeep. Small enough to design in the PR ⇒ design it in the PR — but the
same-change doc-update rule (CLAUDE.md) still applies.

## Shape

Copy [`TEMPLATE.md`](TEMPLATE.md) to `docs/ideas/<short-slug>.md` (a directory
`<short-slug>/` with a README plus assets is fine when the idea needs supporting files).
Required sections:

1. **Summary** — one screen; what becomes true that isn't today.
2. **Mental-model delta** — the concepts that change, named against `docs/concepts/`
   sections; and the system docs the mechanics will land in.
3. **Motivation** — goals / non-goals (the YAGNI fence).
4. **Proposal** — the change told through at least one **named concrete scenario** (house
   rule: designs are adjudicated against real scenarios, like the *Passing Tumble Turn* —
   not abstractions). Risks and mitigations.
5. **Design details** — data shape, boundaries, sync, permissions, migrations/back-compat.
   A sketch is fine until the idea is picked up; complete it before implementing. Respect
   the locked invariants ([`docs/system/architecture.md`](../system/architecture.md)
   § Global constraints). UI ideas prototype in `docs/design/` first — the bundle stays the
   canonical visual source.
6. **Test plan & ship gate** — which layers, and the **Playwright journey**
   (`apps/web/e2e/<name>.spec.ts`) that must be green before the idea counts as shipped.
7. **Drawbacks** — the honest cost.
8. **Alternatives** — every alternative seriously considered and why it lost; name the
   scenario each fails. This is what stops debates being re-run.

## Keeping ideas honest

An idea that reality has moved under (a premise invalidated, a referenced seam reworked) is
**drift, and drift is a bug**: update or delete it in the same change that moved reality —
exactly the rule that governs `docs/concepts/` and `docs/system/`.
