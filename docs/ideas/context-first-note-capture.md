# Context-first note capture — pick the dance/choreo before you speak or type

*(Created 2026-07-20 · areas: web, worker, contract, design. Design sketch; the
`docs/design/` prototype for the scoped note flow is owed before implementation.)*

## Summary

Today a Journal note is **content-first**: you open the entry editor, type (or speak) a note,
and only afterwards reach for the link picker to attach it. Voice capture inherits the worst of
this — it resolves the transcript against **every** figure in **all** your choreos at once, and
against **nothing** when the account is empty, so a fresh dancer who speaks a note immediately
gets *"couldn't make the connection"* with no way to help the model.

This idea makes note creation **scope-first**: when you start a note you pick the **dance**
(and optionally a specific choreo) it's about; *then* you add the note by text or voice; *then*
you connect the figure. The chosen scope does two jobs at once — it narrows the link picker to
that dance's choreos, and it becomes the **grounding context the voice AI resolves against**,
so the model is choosing among a handful of relevant figures instead of everything (or nothing).

Nothing about the anchor model changes — this is a **reordering of the capture flow** plus
passing the already-selected scope into the existing interpret route. Confirm still produces the
very same link the manual picker would.

## Mental-model delta

- **[`docs/concepts/annotations.md`](../concepts/annotations.md) § The Journal** — the entry
  editor gains a **scope step at the front**: choose a dance (and optionally one of your choreos
  in it) before capturing. The link picker's `choreo → target → …` flow becomes
  `dance → choreo → target → …` (or the picker opens pre-scoped to the choice), so the choreo
  list is already filtered. Content-first note-taking (type, then link) still works for a plain
  unlinked note — the scope step is *skippable* into an "all my dancing" default; skipping it
  just means the old, broad behavior.
- **§ Voice capture** — the voice affordance lives *inside* the chosen scope: the sheet passes
  the selected dance/choreo to `POST /api/voice-notes/interpret`, which grounds only against
  **that** scope's figures. An empty scope (no choreos in that dance yet) surfaces an honest
  *"add a figure to a 〈dance〉 choreo first"* hint instead of a silent unresolved. The three
  proposable anchor shapes are unchanged.
- Mechanics land in **[`docs/system/architecture.md`](../system/architecture.md)**: the
  interpret route already accepts an optional `routineRef`; this adds an optional `dance` scope
  to the request + the context assembler (`assembleVoiceContext`), and the web store threads the
  editor's selected scope through. No new anchor type, no new table, no permission change.

## Motivation

### Goals

- A dancer can reliably land a spoken note on the right figure because the model is choosing
  among the figures of **one dance they named**, not all choreos at once.
- A fresh/empty account gets an honest, actionable prompt ("no 〈dance〉 choreos yet") instead of
  *"couldn't make the connection."*
- One coherent flow: pick what you're working on → capture → connect.

### Non-goals

- **No** change to the anchor model, the write path, or what Confirm produces.
- **Not** forcing a scope — a plain unlinked practice note still saves with no dance chosen.
- Not a new note class, not offline-capable voice (unchanged), not multi-dance notes.

## Proposal

### Named scenario — the Slowfox Feather (the one that failed)

Dani finishes a Slow Foxtrot lesson and opens a new Journal note. *Today:* the editor is a blank
text box; Dani taps the mic and says *"In Slowfox, in Feather Steps, settle the sway."* The
interpret route grounds against **all** of Dani's choreos (here: none yet, or a jumble across
dances) → the model finds no confident match → the sheet says *"couldn't make the connection,"*
and Dani has no lever to fix it.

*Proposed:* the new note opens on a **scope step** — Dani taps **Slow Foxtrot** (and, if they
like, the specific *Comp Slowfox* choreo). Now the mic is in context. Dani holds and says the
same sentence. Interpret grounds only against the **Feather Steps in Dani's Foxtrot choreos** →
proposes the **Feather family** anchor with `noteText` "settle the sway" (the addressing
stripped). Dani confirms; the note lands on every Feather. Had Dani *no* Foxtrot choreo, the
sheet would say *"add a figure to a Foxtrot choreo first"* — a fixable state, not a dead end.

### Risks & mitigations

- *A scope step adds friction to a quick note.* — Mitigation: the step is one tap, remembers the
  last dance, and is skippable into "all my dancing" (today's behavior) for an unlinked note.
- *A dancer picks the wrong dance and nothing matches.* — The unresolved state names the scope
  ("no Feather-like figure in your Foxtrot choreos") and offers *"search all my choreos"* to
  widen — degrade to the old broad grounding, never a hard fail.

## Design details

*(Sketch — complete against the seams before building.)*

- **Web (the flow):** the entry editor (`apps/web/src/components/JournalEntryEditor.tsx`) gains a
  leading scope selector (dance chips → optional choreo). The selected scope is held in editor
  state and (a) pre-filters the `JournalLinkPicker` choreo list, (b) is passed to the
  `VoiceNoteSheet` as its grounding scope. Components reach data only via `apps/web/src/store/`.
- **Contract + worker:** the interpret request (`packages/contract`) gains an optional
  `dance` alongside the existing `routineRef`; `assembleVoiceContext`
  (`apps/worker/src/index.ts`) filters the caller's annotate-capable routines to that dance
  before serializing (still per-figure authorized, still read-only). Empty scope → an empty
  context → the sheet's honest "add a figure first" branch (a small proposal-shape addition:
  distinguish "unresolved" from "no context to resolve against").
- **Design source:** prototype the scope step + the scoped voice sheet in
  `docs/design/project/Ballroom Builder v3.dc.html` **before** building. *Owed.*
- **Invariants respected:** read-only interpret route stays read-only; per-figure authorization
  unchanged; no new storage; soft-delete/ULID/permission model untouched.

## Test plan & ship gate

- **Contract:** the interpret request accepts + validates the optional `dance`.
- **Worker:** `assembleVoiceContext` scoped to a dance returns only that dance's figures; empty
  scope → empty context; per-figure auth still excludes viewer-only routines.
- **Web (component):** the editor's scope step pre-filters the picker; the voice sheet passes the
  scope; the empty-scope "add a figure first" state renders.
- **Ship gate — `apps/web/e2e/context-first-note.spec.ts`:** open a new note → pick a dance →
  hold-to-talk (fixture transcript) → the proposal lands on a figure **from that dance**, and a
  dance with no choreos shows the actionable empty state (not "couldn't connect"). Shipping folds
  the delta into `annotations.md` (§ The Journal, § Voice capture) + `architecture.md`, updates
  the design bundle, and **deletes this file**.

## Drawbacks

- A step before capture — real friction for the "just jot a line" case, mitigated by
  skippable/remembered scope.
- The interpret context now depends on a UI selection: a wrong pick yields a worse match than
  today's everything-grounding for that one note (the "widen to all my choreos" escape hatch
  covers it).
- More surface in the entry editor (already the busiest sheet).

## Alternatives

- **Keep content-first; just fix voice grounding server-side (rank/narrow by the transcript's
  named dance).** Less UI churn, but the model must infer the dance from the words — brittle, and
  it doesn't help the empty-account dead end (no actionable prompt). Fails the fresh-dancer
  scenario.
- **Auto-scope to the single most-recent choreo.** Zero taps, but wrong whenever the note is
  about a different dance, and invisible (the dancer can't tell what it grounded against). Fails
  "the dancer named Slowfox but it used their Waltz."
- **A dedicated per-dance Journal (tabs by dance).** Heavier IA change for the same benefit;
  the scope step gets the context without splitting the Journal.
- **Do nothing (rely on the picker after the fact).** The status quo — leaves voice ungrounded
  on empty/broad accounts, which is the reported failure.
