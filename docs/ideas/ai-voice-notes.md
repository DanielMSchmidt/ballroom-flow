# AI voice notes — speak a note, land it on the right anchor

*(Created 2026-07-14 as WEP-0009, migrated 2026-07-15 · areas: web, worker, contract,
domain, ops. Design-complete and dispatch-ready; owner-approved for implementation.
Re-verified 2026-07-15: the store seams this rides (`createAnnotation`/`createFamilyNote`,
`mergeLiveFamilyNotes`) exist as described, and the Workers AI model ids check out against
the current catalog (`@cf/meta/llama-3.3-70b-instruct-fp8-fast` — 24k context, function
calling, $0.29/$2.25 per M tokens; `@cf/meta/llama-3.1-8b-instruct-fast`). The capture →
proposal → confirm surfaces are prototyped in
`docs/design/project/Ballroom Builder v3.dc.html` (voice sheet off the Journal entry
editor). Execution plan: [`ai-voice-notes.plan.md`](ai-voice-notes.plan.md).)*

## Summary

Let a dancer **speak** a practice note — "In Slowfox, in Feather Steps, I need to settle the
sway" — and have it land as an ordinary annotation on the **right anchor**, resolved
automatically: a family note across every Slow Foxtrot routine, or a figure/point note on
one placement, exactly the anchor shapes the choreo-first link picker already ships. The
user records; the app transcribes on-device (falling back to Cloudflare Workers AI Whisper),
sends the transcript **plus structured context about the choreography in scope** to a
Cloudflare Workers AI text model, and gets back a **proposed** anchor + note text. The user
sees the proposal rendered in the existing link picker, confirms or corrects it, and only
then is it committed through the existing annotation write seam.

What becomes true: hands-free capture (phone on the floor after a round), the choreo →
figure → placement → scope taps collapse into one spoken sentence — and **no new data shape,
no new trust surface**. The AI only *proposes*; the human confirms; the shipped write path
commits. Unresolvable utterances degrade to a plain transcribed note. The entire pipeline is
**Cloudflare-only** (Workers AI for both STT and extraction).

## Mental-model delta

- [`docs/concepts/annotations.md`](../concepts/annotations.md) § The Journal gains a voice
  capture path: mic → transcript → **proposed** anchor rendered in the existing picker →
  confirm/correct → the ordinary write. Anchor semantics are unchanged — this is an on-ramp
  onto the existing model, not a new note class. Unresolved → transcribe-only plain
  note; predicate-shaped utterances ("soften every left sway") can't anchor until
  [`attribute-predicate-anchors.md`](attribute-predicate-anchors.md) revives — they fall
  back gracefully.
- Mechanics land in [`docs/system/architecture.md`](../system/architecture.md): a new
  read-only worker route (`POST /api/voice-notes/interpret`), the Workers AI binding via AI
  Gateway, the choreo-context serializer in the domain package, and the mockable AI seam
  (the zero-secret test matrix keeps holding). `docs/TOOLING.md` records the model choice.

## Motivation

### Goals

- **Hands-free capture** without navigating the builder or journal.
- **Grounded resolution, not open-ended NLU:** the dance/choreo is known at capture time, so
  the model resolves against the *actual figures in scope* — closed multiple-choice, not a
  guess over the ~200-figure catalog.
- **No new invariants:** the anchor union is reused verbatim; the AI output is an advisory
  pre-fill; the DO boundary, permission model, and CRDT write paths are untouched.
- **Graceful degradation:** never worse than a voice memo.
- **Single-vendor, measurably:** prove whether Workers AI alone suffices, using the confirm
  step's accept/edit signal as ground truth.

### Non-goals

No third-party model provider (even the escalation lever stays in-Cloudflare); no new anchor
type; no AI writes to the CRDT (everything passes the confirmation gate); no audio retention
(transcribe and discard; storing clips would compose with
[`annotation-media-embeds.md`](annotation-media-embeds.md)); no offline capture.

## Proposal

**Named scenario A — the Feather sway (family note).** After a Slow Foxtrot lesson, Dani
props the phone up: *"In Slowfox, in Feather Steps, I need to settle the sway before the
Three Step."* On-device STT (or Whisper fallback) yields the transcript. The worker
assembles context — dance = foxtrot (alias "slowfox") + Dani's Slow Foxtrot choreos with
their figures — and the model returns
`{ anchor: { type: "figureType", figureType: "feather", danceScope: "foxtrot" },
noteText: "Settle the sway before the Three Step.", confidence: "high" }`. The picker
renders pre-filled to *"Every Feather in my Slow Foxtrot choreos"*; Dani taps **Confirm**;
the note surfaces on the Feather in every Slow Foxtrot routine, including next month's.

**Named scenario B — the competition bounce fallaway (instance note).** *"In my competition
slowfox, on the first bounce fallaway, I need to change the direction to go more diagonal."*
The possessive + routine name + ordinal resolve against that one choreo's structured figure
list → a `figure` anchor on the earliest Bounce Fallaway in "Comp Slowfox". ("Change the
direction" is the note's *content*, not a structured edit.)

**Named scenario C — the unresolved note.** *"Remember to breathe and stay grounded."* No
figure, no dance → `resolved: false`; the app offers a plain journal note or discard. Never
a wrong anchor.

**Risks & mitigations:** STT mangles ballroom jargon → the extraction model matches against
the figures we send it, and Whisper's `initial_prompt` is seeded with the in-scope figure
names. A small model mis-resolves → the **confirmation gate**: nothing commits without the
user seeing exactly where it lands. Workers AI proves insufficient → measure the accept rate
in the field and escalate within Cloudflare (a larger model for the ambiguous slice).

## Design details

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
        client renders proposal in the link picker ──▶ user confirms/edits
                          │
        existing store seam: createAnnotation | createFamilyNote
```

- **Structured context (the load-bearing part):** the worker serializes the in-scope
  choreography the way the reading view models it — dance (id + name + aliases) and each
  choreo as `{ id, name, dance, figures: [{ figureRef, figureType, name, sortKey,
  counts: [{ count, attributes }] }] }`. Scope = the current choreo when captured
  in-context, else the user's choreos for the resolved dance. Sending the *actual figures*
  collapses figure/ordinal/count resolution into grounded multiple-choice. A pure serializer
  lives in `packages/domain`.
- **STT:** server fallback `@cf/openai/whisper-large-v3-turbo` (~$0.0001 per 15 s clip),
  `initial_prompt` seeded with in-scope figure names, `language: "en"`; on-device Web Speech
  API tried first where supported.
- **Extraction contract:** `POST /api/voice-notes/interpret` (Zod in `packages/contract`)
  returns a proposal mirroring the anchor union plus `noteText`, `confidence`, `resolved`,
  `alternatives[]`. Called with Workers AI JSON mode; Workers AI gives **no hard schema
  guarantee**, so the worker **re-validates with the same Zod schema** and returns
  `resolved: false` on any mismatch — never trust the model's shape.
- **Model choice (a data decision, kept current in `docs/TOOLING.md`):** default
  `@cf/meta/llama-3.3-70b-instruct-fp8-fast`; `@cf/meta/llama-3.1-8b-instruct-fast` as the
  cost/latency floor to A/B; in-Cloudflare escalation (e.g. `@cf/moonshotai/kimi-k2.7`) for
  the low-confidence slice if field use demands.
- **No commit in the pipeline:** `/interpret` is read-only. The commit is the existing
  client → store seam → `createAnnotation` / `createFamilyNote`. The AI stays entirely
  outside the DO boundary, permissions, and the CRDT.
- **Mockable seam (required):** both AI calls sit behind a worker interface with a
  deterministic fixture implementation — E2E and CI run against fixtures, no secrets, no
  flakiness.
- **Binding + gateway:** Workers AI binding routed via **AI Gateway** for logging,
  rate-limiting, cost, and accept-rate telemetry.
- **Sufficiency = field validation:** no pre-set numeric bar; the confirm step emits
  accept/edit per note; the one hard safety property is structural — **zero wrong-anchor
  commits can occur past the confirm step**.

## Test plan & ship gate

Domain: the context serializer (figures ordered, counts + attributes present); dance-alias
resolution. Contract: proposal schemas accept all three anchor shapes, reject malformed
model output. Worker: `/interpret` assembles context, calls the **stubbed** seam, returns a
schema-valid proposal; predicate/unresolved inputs → `resolved: false`. Component + axe: the
confirmation card renders each anchor shape via the picker, allows correction, and produces
the same payload the manual picker would.

**Ship gate — `apps/web/e2e/voice-notes.spec.ts`** (fixture AI, `@smoke` core path):
(1) scenario A: two Slow Foxtrot routines sharing a Feather; injected transcript → proposal
resolves to `figureType`/foxtrot → confirm → note surfaces in the *other* routine;
(2) scenario B: "Comp Slowfox" with two Bounce Fallaways → proposal picks the earliest
(`figure` anchor) → note appears on that instance only; (3) scenario C → `resolved: false`
+ transcribe-only fallback. Shipping also folds the delta into the concept/system docs +
TOOLING.md and deletes this file.

## Drawbacks

- A new external service class (Workers AI) and a new worker route — new failure modes,
  latency (two calls), a model choice to maintain.
- Cross-browser STT variance (notably iOS Safari) makes the Whisper fallback load-bearing.
- A model-quality dependency behind a human gate: if acceptance is low, the feature is slow
  rather than wrong.

## Alternatives

- **Third-party frontier model for extraction** — rejected by owner: single-vendor on
  Cloudflare, validated in the field; the confirmation gate makes a smaller model low-risk;
  escalation stays in-Cloudflare.
- **Send the full catalog instead of the in-scope choreos** — more tokens, weaker grounding;
  fails scenario B's ordinal resolution.
- **AI writes the annotation directly (no confirmation)** — a mis-resolved family note fans
  out across every choreo; putting the AI on the write side of the boundary violates the
  locked invariants for no benefit.
- **On-device STT only** — Web Speech coverage is too uneven for a mobile-first PWA.
- **Server-side Whisper only** — uploads every clip and adds latency/cost where the browser
  transcribes free; kept as the fallback.
- **Agentic orchestration** — this is one grounded extraction call, not an agent loop.
- **Persist the audio** — no scenario needs the clip; composes with the media-embeds idea if
  ever wanted.
