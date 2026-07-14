---
title: AI voice notes — speak a note, land it on the right anchor
wep: 0009
owning-areas: [web, worker, contract, domain, ops]
status: implementable
authors: ["@danielmschmidt"]
approver: owner
created: 2026-07-14
last-updated: 2026-07-14
see-also:
  [
    "WEP-0004 (choreo-first journal links — the anchor shapes this pre-fills)",
    "WEP-0003 (attribute-predicate anchors — the deferred target a predicate utterance needs)",
    "WEP-0002 (account-doc live DO — reworks the figureType-anchor write path this rides)",
    "WEP-0005 (annotation media embeds — the sibling R2/annotation capture increment)",
    "PLAN §4.6 (annotation anchors + picker)",
    "PLAN §11.1 (annotation model)",
  ]
replaces: null
superseded-by: null
---

# WEP-0009: AI voice notes — speak a note, land it on the right anchor

## Summary

Let a dancer **speak** a practice note — "In Slowfox, in Feather Steps, I need to
settle the sway" — and have it land as an ordinary annotation on the **right anchor**,
resolved automatically: a `figureType` note across every Slow Foxtrot routine, or a
`figure`/`point` note on one placement in one choreo, exactly the anchor shapes
**WEP-0004** already ships. The user records; the app transcribes on-device (falling
back to Cloudflare Workers AI Whisper), sends the transcript **plus structured context
about the choreography in scope** to a Cloudflare Workers AI text model, and gets back
a **proposed** anchor + note text. The user sees the proposal rendered in the existing
link picker, confirms or corrects it, and only then is it committed through the
existing annotation write seam.

What becomes true that isn't today: notes can be captured hands-free (phone on the
floor after a round), the tedious choreo → figure → placement → scope taps collapse
into one spoken sentence, and — critically — **this adds no new data shape and no new
trust surface**. The AI only *proposes*; the human confirms; the shipped, tested
`createAnnotation` / `createFamilyNote` path does the write. If intent can't be
resolved, the note degrades gracefully to a plain transcribed comment. The entire
pipeline runs on **Cloudflare APIs only** (Workers AI for both speech-to-text and
intent extraction) — no third-party model provider in v1.

## Motivation

### Goals

- **Hands-free capture.** A spoken sentence produces a correctly-anchored annotation
  without navigating the builder or journal.
- **Grounded resolution, not open-ended NLU.** Because the dance (and usually the exact
  choreo) is known at capture time, the model resolves against the *actual figures in
  scope* — a small, closed multiple-choice, not a guess over the ~200-figure catalog.
- **No new invariants.** Reuse the WEP-0004 `Anchor` union verbatim; the AI output is an
  advisory pre-fill for the existing picker, committed through the existing store seam.
  The DO sync boundary, permission model, and CRDT write paths are untouched.
- **Graceful degradation.** Unresolvable or low-confidence utterances become a plain
  transcribed note — the feature is never worse than a voice memo.
- **Single-vendor, measurably.** Prove whether **Cloudflare Workers AI alone** is
  sufficient, using the confirmation step's accept/edit signal as ground truth.

### Non-Goals

- **No third-party model provider in v1.** No Anthropic/OpenAI/etc. A cross-provider
  escalation path is recorded under Alternatives as a possible future revision, not v1
  scope.
- **No new anchor type.** Predicate-shaped utterances ("soften every left sway") cannot
  be anchored until **WEP-0003** revives; they fall back to this-figure scope or
  transcribe-only. No query layer is added here.
- **No AI writing to the CRDT.** The model never produces a committed change; every
  write passes through the confirmation gate and the existing seam.
- **No audio retention in v1.** Audio is transcribed and discarded; storing the clip
  (R2) is out of scope and would compose with WEP-0005's media model if ever wanted.
- **No new offline behavior.** Voice capture requires connectivity for the fallback STT
  and the extraction call; offline capture is a later increment.

## Proposal

**Named scenario A — the Feather sway (family note).** After a Slow Foxtrot lesson,
Dani props the phone up and says: *"In Slowfox, in Feather Steps, I need to settle the
sway before the Three Step."*

*Today:* they open the journal, tap "add link", pick a choreo, type-ahead the Feather,
choose "entire figure", then scope to "every Feather in my Slow Foxtrot choreos", then
type the note — five deliberate steps (WEP-0004).

*Proposed:* they tap the mic and speak. On-device speech recognition (or the Workers AI
Whisper fallback) yields the transcript. The worker assembles context — dance = foxtrot
(alias "slowfox"), plus Dani's Slow Foxtrot choreos with their figures — and the Workers
AI text model returns
`{ anchor: { type: "figureType", figureType: "feather", danceScope: "foxtrot" },
noteText: "Settle the sway before the Three Step.", confidence: "high" }`. The app shows
the WEP-0004 picker rendering pre-filled to *"Every Feather in my Slow Foxtrot
choreos"*, with the note text below. Dani taps **Confirm**; the note is written through
`createFamilyNote` and surfaces on the Feather in **every** Slow Foxtrot routine,
including next month's.

**Named scenario B — the competition bounce fallaway (instance note).** *"In my
competition slowfox, on the first bounce fallaway, I need to change the direction to go
more diagonal."*

The possessive + specific routine name ("my competition slowfox") plus the ordinal
("first bounce fallaway") resolve against that one choreo's structured figure list:
`{ anchor: { type: "figure", figureRef: "<earliest Bounce Fallaway in Comp Slowfox>" },
noteText: "Change the direction to go more diagonal." }`. The "change the direction"
phrasing is the note's *content*, not a structured edit. Confirmed, it lands on that
placement only — not the Bounce Fallaway in any other routine.

**Named scenario C — the unresolved note (fallback).** *"Remember to breathe and stay
grounded."* No figure, no dance. The model returns `resolved: false`; the app offers to
save it as a plain journal note (no anchor) or discard. Never a wrong anchor.

**Risks & mitigations:**

- *STT mangles ballroom jargon* (Feather, Fallaway, Oversway, Telemark). Mitigation: the
  extraction model matches against the **catalog/choreo figures we send it**, so it
  recovers "feather step" from an imperfect transcript; Whisper is prompted with a
  domain-term bias.
- *A small open model mis-resolves the anchor,* which for a `figureType` note fans out
  across choreos. Mitigation: the **confirmation gate** — nothing commits without the
  user seeing exactly where it will land, in the picker they already understand.
- *Workers AI proves insufficient.* Mitigation: the confirm step yields a per-note
  accept/edit label; ship behind that gate, measure the acceptance rate against a stated
  bar, and revise (escalation path in Alternatives) only if it misses.
- *A predicate utterance can't be honored.* Mitigation: detect predicate shape, fall
  back to this-figure or transcribe-only, and point at WEP-0003.

## Design Details

*(The UI reuses the WEP-0004 picker — prototype any new affordance in
`docs/design/project/Ballroom Builder v3.dc.html` first.)*

**Pipeline (all Cloudflare):**

```
client mic ─▶ on-device SpeechRecognition ──(unsupported/failed)──▶ MediaRecorder blob
    │                                                                     │
    └────── transcript ◀── @cf/openai/whisper-large-v3-turbo ◀───────────┘
                          │
   POST /api/voice-notes/interpret { transcript, choreoScope }
                          │  (worker assembles structured context)
                          ▼
        Workers AI text model (JSON-schema constrained)  ──▶  proposal
                          │
        client renders proposal in WEP-0004 picker ──▶ user confirms/edits
                          │
        existing store seam: createAnnotation | createFamilyNote
```

- **Structured context (the load-bearing part).** The worker serializes the
  choreography in scope the way the reading view already models it: `dance` (id + name +
  aliases), and each in-scope choreo as `{ id, name, dance, figures: [{ figureRef,
  figureType, name, sortKey, counts: [{ count, attributes }] }] }`. Scope is the current
  choreo when captured in-context; otherwise the user's choreos for the resolved dance.
  Sending the *actual figures* (not the full catalog) collapses figure/ordinal/count
  resolution into grounded multiple-choice and shrinks the payload. A pure serializer
  lives in `packages/domain` (reuses the reading-columns / `windowAttributes` data).
- **Transcription (STT).** Server fallback is `@cf/openai/whisper-large-v3-turbo`
  (base64 audio in, `$0.00051`/audio-minute — a ~15s clip ≈ $0.0001). Its
  **`initial_prompt`** parameter is seeded with a domain-vocabulary hint (a compact list
  of the in-scope figure names) to bias transcription toward ballroom jargon; `language:
  "en"`. The on-device Web Speech API is tried first where supported.
- **Extraction contract.** New RPC `POST /api/voice-notes/interpret` (Zod schemas in
  `packages/contract`) returning a proposal validated against a JSON schema that mirrors
  the WEP-0004 `Anchor` union plus `noteText`, `confidence`, `resolved`, and
  `alternatives[]` (candidate anchors when ambiguous). The model is called with Workers
  AI **JSON mode** (`response_format: { type: "json_schema", json_schema }`); output is a
  handful of tokens so JSON mode's no-streaming limit is irrelevant. Workers AI gives
  **no hard schema guarantee** — a "JSON Mode couldn't be met" error or an off-shape
  payload is possible — so the worker **re-validates with the same Zod schema** and, on
  failure, returns `resolved: false` (→ transcribe-only). Never trust the model's shape.
- **Model choice (researched, a data decision to keep current in `docs/TOOLING.md`).**
  Default extraction model **`@cf/meta/llama-3.3-70b-instruct-fp8-fast`** (70B, fp8-fast,
  JSON-mode capable) — strong instruction-following for a *grounded* extraction against a
  small figure set. **`@cf/meta/llama-3.1-8b-instruct-fast`** is the cost/latency floor to
  A/B in the field. If field use shows the default insufficient, escalation can stay
  **Cloudflare-only** (e.g. `@cf/moonshotai/kimi-k2.7` or a larger Llama for the
  low-confidence/ambiguous slice) — no third-party provider required.
- **No commit in the pipeline.** `/interpret` is read-only — it returns a proposal, it
  does not write. The commit is the existing client → store seam →
  `createAnnotation` (`figure`/`point`) or `createFamilyNote` (`figureType`), unchanged.
  This keeps the AI entirely outside the DO sync boundary, the permission model, and the
  CRDT (locked invariants intact: soft-delete, client ULIDs, permissions at the DO
  boundary, D1 as pure index, components only via `apps/web/src/store/`).
- **Mockable seam (required for the zero-secret matrix).** Both external calls (Whisper,
  text model) sit behind a worker interface with a deterministic fixture implementation.
  E2E and CI run against fixtures — no real Workers AI calls, no secrets, no flakiness.
- **Binding + gateway.** Both calls go through the Workers AI binding, routed via **AI
  Gateway** for logging, rate-limiting, cost, and the accept-rate telemetry. No secrets
  beyond the Cloudflare account binding (`wrangler`, per `ops`).
- **Sufficiency = field validation (not a pre-set numeric bar).** Ship it behind the
  confirmation gate and **validate in the field** (owner testing in real practice). The
  confirm step emits an accept/edit event per note as the honest signal; AI Gateway
  aggregates it. The only hard safety property is structural: **0 wrong-anchor commits
  can occur past the confirm step**, because nothing commits without the user seeing the
  resolved anchor. Whether Workers AI alone is "good enough" is a judgment from field
  use, and the in-Cloudflare escalation lever above is the response if it isn't.
- **Sequencing note.** The `figureType`/`createFamilyNote` path currently writes the D1
  `figure_type_note_index` rows that **WEP-0002** is moving onto a live DO; the
  `figure`/`point` (routine-doc) path is stable. v1 can lead with the stable path or
  coordinate the family-note path with WEP-0002.

## Test Plan

TDD, write/unskip-first, per layer:

- **Domain unit** (`packages/domain`): the choreo-context serializer produces the
  expected structured shape from a fixture routine (figures ordered by `sortKey`, counts
  + attributes present); dance-alias resolution ("slowfox" → foxtrot).
- **Contract** (`packages/contract`): the `/interpret` request/response Zod schemas
  accept valid proposals for all three anchor shapes and reject a malformed model output
  (the re-validation guard).
- **Worker/DO** (`apps/worker`): `/interpret` assembles context from the scoped
  choreo(s), calls the **stubbed** STT + extraction seam, and returns a schema-valid
  proposal; predicate/unresolved inputs return `resolved: false`. No DO/permission/index
  change, so no boundary tests and coverage thresholds are unaffected.
- **Component + axe** (`apps/web`): the confirmation card renders a proposed
  `figureType` / `figure` / `point` anchor via the WEP-0004 picker, allows scope/count
  correction, and produces the same payload the manual picker would; axe pass.
- **E2E**: the ship-gate journey below, `@smoke` for the core path, against fixture AI.

## Ship Gate

**`apps/web/e2e/voice-notes.spec.ts`** must be green on the implementing PR (fixture STT
+ extraction — no live AI):

1. Seed two Slow Foxtrot routines sharing a Feather. Trigger capture; inject the
   scenario-A transcript; assert the proposal resolves to
   `figureType`/foxtrot, confirm, and the note surfaces on the Feather in the *other*
   Slow Foxtrot routine.
2. Seed a "Comp Slowfox" routine with two Bounce Fallaways; inject the scenario-B
   transcript; assert the proposal resolves to the **earliest** Bounce Fallaway
   (`figure` anchor), confirm, and the note appears on that instance and *not* in a
   sibling routine.
3. Inject the scenario-C transcript; assert `resolved: false` and the transcribe-only
   fallback (plain note, no anchor).

Marking `implemented` additionally updates PLAN §4.6 / §11.1 (the voice capture surface
+ pipeline), `docs/TOOLING.md` (the model choice + AI Gateway), and `docs/TEST-MAP.md`
in the same change. Model sufficiency is validated in the field (owner practice use, via
the confirm-step accept/edit telemetry), not gated on a pre-set numeric threshold.

## Drawbacks

- **A new external service class** (Workers AI STT + text gen) and a new worker route,
  even if kept off the trust boundary — new failure modes, latency (two calls), and a
  model-choice data decision to maintain.
- **Cross-browser STT variance.** The on-device path (Web Speech API) is inconsistent —
  notably iOS Safari — so the Whisper fallback must be robust, adding a code path.
- **A model-quality dependency behind a human gate.** The confirmation step contains the
  risk but adds friction; if acceptance is low, the feature is slow rather than wrong.
- **Sequencing coupling** to WEP-0002 for the family-note write path.

## Alternatives

- **Use a third-party frontier model (Anthropic/OpenAI) for extraction** — rejected by
  owner (2026-07-14): keep it single-vendor on Cloudflare and let field use say whether
  Workers AI suffices; the confirmation gate makes a smaller model low-risk. Even the
  escalation lever stays in-Cloudflare (a larger Llama or `@cf/moonshotai/kimi-k2.7` for
  the ambiguous slice), so a third-party provider isn't the fallback — it's only a
  last-resort future revision if no Cloudflare model clears field validation.
- **Send the full ~200-figure catalog instead of the in-scope choreo** — rejected: more
  tokens, weaker grounding; the dance/choreo context is known at capture time, so
  serializing the actual figures is both smaller and far more accurate (fails scenario B
  ordinal resolution otherwise).
- **Let the AI write the annotation directly (no confirmation)** — rejected: a
  mis-resolved `figureType` note fans out across every choreo; putting the AI on the
  write side of the CRDT/permission boundary violates the locked invariants for no
  benefit. AI proposes, human confirms, existing seam commits.
- **On-device STT only (no server fallback)** — rejected for v1: Web Speech API coverage
  is too uneven for a mobile-first PWA; the Whisper fallback guarantees a transcript
  everywhere. (On-device-first is kept as the *default* to save cost/latency where
  supported.)
- **Server-side Whisper only (skip on-device)** — rejected as the default: uploads every
  clip and adds latency/cost where the browser can transcribe for free; kept as the
  fallback.
- **Managed/agentic orchestration** — rejected: this is a single grounded extraction
  call, not an open-ended agent loop; an agent framework is unwarranted complexity.
- **Persist the audio (R2) with the note** — deferred: no scenario needs the clip in v1;
  if wanted, it composes with WEP-0005's media model rather than inventing storage here.
