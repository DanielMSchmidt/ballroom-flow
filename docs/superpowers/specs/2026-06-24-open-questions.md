# Ballroom Flow — Consolidated Open Questions & Decisions Needed

Synthesis of the spec (`2026-06-24-ballroom-flow-design.md`) and five adversarial
critiques (`research/critique-{domain,sync,product,testing,scope}.md`). Questions are
deduplicated and ranked. **★ = blocking** (decide before building the relevant subsystem).
Tags: `[dancer]` needs ballroom expertise; `[product]` your call as owner; `[tech]` architecture.

---

> **UPDATE (extensibility pass, 2026-06-24):** an extensibility review across three axes
> (new attributes, CRDT-future, undo) led to **spec v3**. Folded in (all cheap-now/expensive-later):
> client-generated ULID ids, soft-delete tombstones, a footprint-based unified undoability rule,
> a widened op-log (HLC clock + footprint + op registry), a `SLOT_REGISTRY` single source of truth
> for technique vocabularies (retires `hasRiseFall`), `schemaVersion` on export+routine, and a
> `store/` repository seam. See `research/extensibility-{attributes,crdt,undo}.md` and the spec's
> "Changelog — v3". A standalone detailed testing plan with full prototype-feature coverage is at
> `2026-06-24-testing-plan.md`.

## ✅ DECISIONS LOCKED (2026-06-24)

- **Q-K1 → Shared editing.** Both partners co-edit ONE routine; coach comments. **Plus: an Undo
  capability is required.** → removes owner-only/fork/two-zone auth. (Resolves Q-C1, Q-C2, Q-S1.)
- **Q-K2 → Online-only for v1.** Offline-first deferred to v2 (offline *read* is the additive
  next step). → removes the CRDT, Durable Objects, sync-reconcile, WebSockets. (Resolves §3
  entirely, plus Q-S2–Q-S6, Q-O1.)
- **Q-K3 → Minimize / ship fast.** Lean stack: **React + Vite PWA → Hono on Workers → D1
  (Drizzle) → Clerk auth**, server-authoritative, last-write-wins. R2/media = v1.1.
- **Q-D0 → Dancer + coach available** to answer §1 (domain) questions.

**Implication for Undo:** online-only makes this cheap — a per-routine server-side command/edit
log (or a bounded client-side undo stack) with last-write-wins. Decide grain (per-field? per
action?) during planning. New small question: **Q-U1 — is Undo per-user (undo *my* last change)
or global (undo the routine's last change, regardless of who)?** With shared editing, per-user is
usually the less-surprising default.

**Sections now mostly moot:** §3 (Sync & data correctness) — drop. §4 ops items tied to CRDT/DO
(Q-O1 CRDT-merge testing) — drop; keep the generic ops items (Q-O2–O7). §5 Q-P5 (iOS Background
Sync) — moot for v1 (no offline write, media is v1.1).

**Remaining before build:** §1 domain blockers (take to your dancer+coach) and the §5 product
calls. Everything in §0/§3 below is retained for the record but superseded by the locks above.

---

## 0. The keystone decision (everything cascades from this)

Four critics independently converged here. The wireframe microcopy *"to change steps,
anyone can duplicate the choreo and edit their own copy"* was elevated into a load-bearing
**owner-only-edit + fork-to-change** model. That single choice forced: the CRDT, the
per-choreo Durable Object, the "two-zone write-authority" mechanism, and the fork/divergence
problem — and the sync critic showed the two-zone mechanism is **technically incoherent** with
the chosen CRDT (TinyBase MergeableStore is last-write-wins per cell with no verified per-cell
author to gate on). Meanwhile the product critic showed fork-to-edit produces divergent copies
with no merge-back for a couple who co-own one routine, and makes the coach (the tag expert) a
second-class commenter.

- **★ Q-K1 `[product]` — How do the people edit a routine?**
  - (a) **Both partners co-edit one shared routine; coach comments** *(recommended by product critic)* — simplest mental model, matches "a couple builds a routine together," and actually *removes* the two-zone auth complexity.
  - (b) Owner edits structure; **partner can edit technique tags**; coach comments.
  - (c) Strict owner-only edit; everyone else forks to change *(current spec)*.
  - *Cascades into:* need for CRDT, fork/merge, two-zone auth, tags-zone (Q-C1), divergence handling.

- **★ Q-K2 `[product/tech]` — Is full offline *write* a real v1 need, or is offline *read* enough?**
  - (a) **Offline read of already-synced routines** (studio has no signal → you *view/tag-review*), edits sync when online *(scope critic argues this covers the real need)*.
  - (b) Full offline authoring (create/edit/tag with zero connectivity) — the expensive requirement that justifies the CRDT/reconcile layer.
  - (c) Online-only is acceptable for v1.
  - *Cascades into:* whether we need a CRDT + sync-reconcile + WebSockets at all.

- **★ Q-K3 `[product/tech]` — Complexity appetite as the (likely solo) maintainer.**
  - (a) **Minimize moving parts / ship fast**: lean v1 = D1 server-authoritative store + Hono RPC + offline *read* cache; defer CRDT/Durable Objects to v2 if usage proves it *(scope critic's "leaner v1")*.
  - (b) Build the full local-first CRDT now as a deliberate learning investment, accepting the maintenance burden.
  - (c) Decide after I lay out the two architectures side-by-side with cost/risk.

> If Q-K1=(a) co-edit, Q-K2=(a) read-only-offline, Q-K3=(a) lean: **the CRDT, Durable Objects,
> two-zone auth, fork/merge, and ~half the testing surface all disappear** — leaving a much
> smaller, more maintainable v1 that keeps 100% of the product. This is the scope critic's
> central recommendation and the highest-leverage set of answers you can give.

---

## 1. Domain / notation fidelity `[dancer]` — needs ballroom expertise

> **ANSWERED 2026-06-24 by the owner (a dancer):**
> ✅ **Q-D1 → TWO charts** (leader + follower; counts not 1:1; role-default views; entry shows both,
> follower pre-filled = leader). ✅ **Q-D2 → Alignment per-figure** (entry/exit). ✅ **Q-D3 → bars/phrase
> counting** CONFIRMED: 1–6 (3/4: Waltz, Viennese) / 1–8 (4/4: Foxtrot, Quickstep, Tango), sub-beats `e & a`.
> ⏳ **Q-D4 → Body position + action** — pending coach (CBP suspected typo for CBMP). ✅ **Q-D5 → enum
> additions** (Heel, ⅛, NFR, Tango no-rise). ✅ **Q-D6 → turn = step property** (implied, two-chart).
> ✅ **Q-D7 → Standard dances only** for v1. ✅ **Q-D8 → ISTD** conventions. (Hero loop = structured
> per-step tagging.) Product defaults (sample routine, Lanes-as-fast-tag, figure-wide journal links,
> Sentry/export+import/EXPLAIN-check) accepted. Folding into spec v2.

The domain critic found these are **correctness** issues, not lean trade-offs: "a notation tool
that gets the notation wrong is worse than a blank notebook."

- **★ Q-D1 — Is a step chart the leader's, the follower's, or both?** The spec models ONE
  role-agnostic chart. But leader/follower footwork, sway, and turn differ/mirror, and **step
  counts aren't 1:1** (e.g. the follower's heel turn has no matching leader step). A single
  `steps[]` cannot represent both. Options: (a) two role-keyed charts *(domain critic recommends)*;
  (b) brand v1 explicitly as a *leader's-reference* tool (never call it role-agnostic); (c) one
  chart now, accept it's wrong for the follower.
- **★ Q-D2 — Is Alignment recorded in v1 (per-figure entry/exit, or per-step)?** Deferring it
  "guts the headline feature": the entire point of Sides/Corners is alignment; without it a corner
  is a label with no data and the most common floorcraft coaching note is unrecordable.
- **★ Q-D3 — How is timing stored and how are bars derived?** The spec's rule "bars = count of
  steps where count=='1'" returns **zero** for Foxtrot/Quickstep/Tango (counted S/Q, not
  numerically) — and v1 ships those dances. Needs a beat-value-per-step model.
- **★ Q-D4 — Can the Body attribute hold a position *and* a body-action at once** (e.g. "PP +
  CBMP")? Single-select can't. And "CBP" in the wireframe isn't a real term and its gloss is
  backwards vs CBM. Likely split Body → Position (single) + Body-action (CBM/CBMP).
- **Q-D5 — Confirm/extend the technique enums.** Footwork missing bare **Heel** (step 1 of nearly
  every forward figure); Turn defers **⅛** (the most common magnitude); Rise missing **NFR / "no
  foot rise"** (standard heel-turn annotation); Tango shows a rise picker despite having no rise.
- **Q-D6 — Is "turn" a property of a step or of the transition between steps?** (Body can turn
  less than feet.) Spec chose step-property to match the wireframe; confirm acceptable.
- **Q-D7 — Latin/spot dances in v1?** Spec already cuts them to v1.1 (sound). Confirm v1 =
  Standard/Smooth travelling dances only.
- **Q-D8 — Whose terminology system?** ISTD / IDTA / WDSF / American differ on counts &
  alignments. Do we attribute figures/values to a system, or pick one (e.g. ISTD) for v1?

> **Q-D0 `[meta]` — Are you a ballroom dancer, or do you have a dancer + coach who can answer
> §1?** These can't be resolved by defaults; they need someone who charts dances.

---

## 2. Collaboration, permissions & onboarding `[product]`

- **Q-C1 — Are technique tags "structure" (owner-only) or shared annotations?** *(prerequisite —
  determines the data split)* The coach is the tag expert; the product critic strongly argues tags
  belong in the shared/editable zone. Folded into Q-K1 if you pick co-edit.
- **Q-C2 — If fork stays the edit path, what is the reconcile/promote story?** As specified
  (fork, no merge-back) the normal workflow *guarantees* divergent copies with no source of truth.
  Minimum viable: "make this fork canonical, archive origin." (Moot if Q-K1=(a).)
- **Q-C3 — Invitee onboarding sequence.** Who assigns the invitee's role, and can it be changed
  later (no role-edit UI in v1)? When does the new member pick their identity colour (before/after
  seeing the routine)? What does an **expired/revoked/already-redeemed** invite link show?
- **Q-C4 — Identity colour for a coach shared across many couples.** Colour is global per user,
  but a coach's one colour will collide in some couples' palettes with no per-routine override.
  Make colour decorative + initials the real identity signal? Or per-membership colour (drops the
  global-colour microcopy)?
- **Q-C5 — Max collaborators per routine?** Confirmed ~2–3 (couple + coach)? If it could grow to a
  class/studio, the sync design changes.

---

## 3. Sync & data correctness `[tech]` — only if Q-K2/K3 keep the CRDT

If the lean path is chosen, most of this section evaporates. If the CRDT/DO path is kept:

- **★ Q-S1 — The two-zone "reject non-owner structural ops" model is incoherent with TinyBase
  MergeableStore** (LWW-per-cell state, no verified author, "rejection" is just another racing
  write). Fix is two *physical* stores (owner-writable structure + read-only partner snapshot +
  shared annotation store), not post-hoc rejection. Confirm the redesign.
- **★ Q-S2 — What does a user see when their offline edits are rejected/overwritten?** As
  specified, a stale client's offline work is silently overwritten on reconnect (no diff, no undo).
  Trust-destroying for a notes app. Needs a defined UX.
- **★ Q-S3 — CRDT schema/vocabulary migration.** Persisted offline state (IndexedDB + DO-SQLite)
  outlives deploys. Adding the 2nd chart / Alignment / new enums later = old clients writing old
  shapes that merge into new stores → silent corruption. Needs a schema-version cell + min-client
  gate + migration-on-merge. (All three critics flagged this as *the* local-first killer.)
- **Q-S4 — Ordered-list reorder under concurrency.** Fractional-index sort keys need: stable
  tie-break for same-gap concurrent inserts, rebalancing policy, **atomic move-figure-across-side**
  (currently unmodeled under LWW), and add-wins-vs-remove-wins delete policy.
- **Q-S5 — DO↔D1 index consistency.** Title/bar-count live in the DO but are mirrored in the D1
  routine index; no transaction spans both and offline renames never reach the Worker — the index
  will drift. Who writes it, and what's the staleness/repair contract?
- **Q-S6 — TinyBase MergeableStore maturity** for these exact patterns, vs falling back to Yjs
  arrays (a real list-CRDT) per platform.md Option B.

---

## 4. Architecture, ops & quality `[tech]`

- **★ Q-O1 — CRDT merge correctness testing.** "Both edits survive" proves one interleaving, not
  convergence/commutativity/idempotency. Needs a pure in-memory multi-replica simulation harness +
  property-based tests (fast-check) over thousands of shuffled/partitioned op orders. Commit to
  this if any CRDT is used.
- **Q-O2 — Observability vendor:** Sentry vs Cloudflare Tail Workers (sync failures are currently
  silent server-side).
- **Q-O3 — Backup/restore + data export.** Export-without-import = an unrestorable backup. Add JSON
  import in v1? Also dancers print charts — is a human-readable/printable chart export higher value
  than JSON?
- **Q-O4 — Account deletion / GDPR erasure** across Durable Objects + D1 + R2, where a user's data
  is scattered across DOs owned by others (in tension with point-in-time recovery / CRDT history).
- **Q-O5 — D1 "rows scanned" cost guard** (documented $134 surprise-bill trap): index everything,
  add an `EXPLAIN QUERY PLAN` CI check.
- **Q-O6 — Staging vs prod environments, secrets management/rotation, rate limiting** on invite
  tokens + R2 presigns.
- **Q-O7 — CI determinism** for Playwright + service workers + IndexedDB + two-context offline
  (predictably flaky without a strategy).

---

## 5. Product / adoption `[product]`

- **Q-P1 — Cold-start.** New users land in an empty editor facing a Ri/Bo/Fw/Sw/Tn vocabulary they
  may not know; the "aha" (a fully-tagged routine) is never shown. Ship a read-only **sample
  routine** (the seed data already exists) + "start from template"? *(recommended; nearly free)*
- **Q-P2 — Mobile data-entry burden.** A routine is 100+ steps × (count + action + up to 5 tag
  taps), entered on a phone. Needs one concrete fast path: copy-tags-from-previous-step, batch
  apply, or reinstating the cut **Lanes view** as the fast cross-step tagging surface.
- **Q-P3 — What is the real *capture* path during/after a lesson?** If structured tagging is too
  slow in-lesson, the v1 hero is a quick text note (voice in v1.1) linked to a figure, and tagging
  is a calm-weekend activity. Validate which is the core loop before polishing the tag editor.
- **Q-P4 — Journal links.** Step-only linking (the v1 cut) may gut the journal — the high-value
  insights are figure-wide ("my frame collapses on every Natural Turn"). Pull figure-wide linking
  into v1, and drop the speculative 9-cell polymorphic Link model down to the 1–2 cells that ship?
- **Q-P5 — iOS Safari has no Background Sync API**, which breaks the planned deferred-media-upload
  design on iPhone (media is v1.1, but flag the fallback now: in-app retry queue while the tab is
  open).

---

## 6. Auth & platform `[tech]` — mostly settled, confirm

- **Q-A1 — Auth vendor:** Clerk (50k MRU free, networkless edge JWT verify, Google + passkeys)
  recommended. Acceptable, or do you want the Better-Auth-in-our-Worker escape hatch designed in?
- **Q-A2 — Native wrapper later?** Confirm PWA-first is acceptable (vs a future React Native path,
  which would change the local-store choice).
- **Q-A3 — Media scope/limits** (v1.1): per-attachment cap, video allowed or voice+photo only,
  retention.

---

## Recommended answering order

1. **§0 keystones (Q-K1, Q-K2, Q-K3)** — these can delete entire subsystems and §3 with them.
2. **Q-D0** — do you have a dancer to answer §1? If not, we resolve domain via research + your
   confirmation, or scope v1 down to what's safely chartable.
3. **§1 domain blockers** (Q-D1–Q-D4) — model-blocking.
4. Everything else can be settled during planning once the above are fixed.
