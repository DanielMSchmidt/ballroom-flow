---
title: Wire the account doc to a live Durable Object
wep: 0002
owning-areas: [worker, domain, web]
authors: ["@danielmschmidt"]
approver: owner
status: provisional
created: 2026-07-13
last-updated: 2026-07-13
see-also: ["PLAN §2.7", "PLAN §9 (2026-07-03 close-out)", "packages/domain/src/doc-account.ts"]
replaces: null
superseded-by: null
---

# WEP-0002: Wire the account doc to a live Durable Object

*(Seeded from the one recorded v1 engineering gap — PLAN §9's 2026-07-03 close-out deliberately
deferred this as "its own milestone, not a rider on unrelated work". This WEP is that
milestone's proposal artifact; promoting it to `implementable` requires the full Design
Details below.)*

## Summary

The per-user **account doc** — the intended CRDT home for `figureType` family notes and
library bookmarks (`libraryFigureRefs`) — exists today only as built-and-tested domain helpers
(`packages/domain/src/doc-account.ts`); the actually-persisted state lives in the D1
projections (`FigureTypeNoteIndex` rows, `library_entry`). This WEP wires the account doc to a
real per-user SQLite-backed Durable Object like every other document: DO-hosted Automerge doc,
auth boundary, alarm projection into the existing D1 tables (inverting today's
write-direction), and the web store reading through a `DocConnection`.

## Motivation

### Goals

- Canonical state for family notes + library bookmarks lives in an Automerge doc, per the
  architecture's global constraint ("canonical state lives in the Automerge documents; D1 is
  a pure index/registry") — currently violated for exactly this document type, by recorded
  deferral.
- Account-doc content gains what every other doc already has: offline editing (§11.2
  machinery), per-user undo, and history.

### Non-Goals

- No new user-facing features — this is an architecture-completion milestone; surfaces keep
  their behavior.
- No change to note *visibility* semantics (Q-FIGNOTE-VIS option 2 stands).

## Proposal

**Named scenario — the coach's family note, offline.** A coach annotates "on every Feather,
keep the head left" (an all-dances `figureType` note) from a practice room with no signal.
Today that write is a REST call and fails — family notes are the one annotation class with no
offline path, because they have no doc behind them. With the account doc live, the note is a
CRDT edit to an already-hydrated doc: persisted locally, replayed on reconnect, undoable —
identical to every routine-scoped note. The D1 `FigureTypeNoteIndex` row becomes an
alarm-written projection (as `JournalEntry` already is for routine docs) instead of the
source of truth.

**Sketch (to be firmed for `implementable`):** one DO per user's account doc, registered in
`DocumentRegistry` as `type='account'` (the type already exists); boundary rule is
owner-only write (no membership cascade — an account doc has exactly one editor); the
existing add/remove-library and family-note REST routes become doc edits behind the store
seam; alarm projects to `library_entry` + `FigureTypeNoteIndex`; a one-time migration imports
existing D1 rows into each account doc on first load.

**Risk:** this is a hard-gate change end to end (new DO class instance semantics, a new auth
boundary, a projection inversion, a data migration) — exactly the class where this repo's
worst bugs lived. It ships alone, not as a rider.

## Design Details

*To be completed for `implementable`.* Must cover: DO id derivation (one stable id per user),
the auth boundary (owner-only; admin?), projection idempotence, the import migration (additive,
tombstone-safe, run under a fixed migration actor), interaction with the §11.2 offline gate
(bookmarks are currently live-gated REST — do they become offline-capable CRDT edits?), and
back-compat for clients mid-rollout.

## Test Plan

*To be completed for `implementable`.* Expected layers: domain (account-doc helpers already
tested — extend for migration), worker/DO (boundary: non-owner rejected; persistence;
projection parity with today's rows; EXPLAIN on any new query), web component (store seam),
E2E (the ship-gate journey below).

## Ship Gate

A Playwright journey (proposed: `apps/web/e2e/account-doc.spec.ts`) covering: a family note
authored offline survives reload and replays on reconnect; the bookmark set round-trips
through the account doc; a co-member still sees the family note on a shared routine's
matching figure (visibility unchanged). Green on the implementing PR, plus PLAN §2.7/§9
updated in the same change.

## Drawbacks

One more DO class-usage pattern and a data migration for a feature set that, today, works.
The projection inversion touches security-adjacent read paths (the co-membership gate on
family notes) that are currently settled.

## Alternatives

- **Leave it as is** (D1 rows as truth, helpers dormant). Zero risk now, but the architecture
  constraint stays violated, family notes stay the one non-offline annotation, and the
  dormant helpers rot. This is the standing default until this WEP is promoted — the WEP
  exists so that staying here remains a *decision*, not drift.
- **Drop the account doc concept; bless D1 as truth for account state.** Honest, smaller —
  but it forks the architecture ("canonical state in Automerge docs, except account state"),
  forecloses offline/undo for that state, and reverses the recorded intent in
  `doc-account.ts`'s STORAGE NOTE. Would need its own WEP reversing the constraint.
