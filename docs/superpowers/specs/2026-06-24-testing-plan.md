# Ballroom Flow — Detailed Testing Plan

**Status:** Draft for review — v1
**Date:** 2026-06-24
**Owner priority:** Quality and a solid, detailed testing plan are an explicit, non-negotiable requirement.
**Sources of truth:**
- `research/design-spec.md` — the exhaustive wireframe enumeration (the **prototype feature checklist**; every item here must appear below with explicit coverage).
- `docs/superpowers/specs/2026-06-24-ballroom-flow-design.md` (**v2 spec**, the current target) — lean online-only stack: React + Vite PWA → Hono on Workers → D1 + Drizzle → Clerk; **two step charts per figure**; **meter-based timing**; **per-user op-log undo**; shared co-editing (LWW); Lanes view; sample routine; export/import.
- `research/platform.md` §6 — the toolchain.

This document **expands §9 of the design spec into a standalone, far more detailed plan**, reconciled with the v2 decisions. In particular: there are **NO offline/CRDT two-client merge tests** in v1 (the entire sync-correctness surface was deleted). Concurrency is **server-authoritative last-write-wins (LWW)**, tested for a *defined deterministic outcome*, plus **per-user op-log undo**.

---

## 0. How to read this document

- §1 — Testing philosophy, the pyramid for this stack, and the concrete tooling/runner setup.
- §2 — **Prototype Feature Coverage Matrix** (the core deliverable): one row per prototype feature/screen/interaction, cross-checked against `design-spec.md`, including cross-cutting features the spec added that the prototype only stubbed.
- §3 — Per-layer detailed test catalogs (Unit, Worker/D1, Component, E2E, Contract).
- §4 — High-risk areas and how they are de-risked (incl. property-based testing).
- §5 — Accessibility, performance, cross-browser/PWA testing.
- §6 — CI pipeline, flakiness control, coverage gates, EXPLAIN-QUERY-PLAN guard.
- §7 — Test data, fixtures, factories.
- §8 — Traceability: explicit confirmation of full coverage + the list of features deliberately not tested in v1, with reasons.

---

## 1. Testing philosophy, pyramid & tooling

### 1.1 Philosophy

1. **Push correctness down the pyramid.** The hardest correctness logic (op-log invert/undo, meter-based timing, two-chart seeding/independence, sortKey ordering, deep-copy, enum/Zod validation) is **pure `domain/` TypeScript with no I/O**. It is tested exhaustively and cheaply at the unit layer, including property-based tests. We do not re-prove this logic at slower layers; slower layers prove *wiring*, *permissions*, and *user-visible behavior*.
2. **Test the real runtime, not a mock, where a mock would lie.** Worker/D1 behavior (route auth, op-log append, LWW ordering, index usage, invite tokens) runs **inside `workerd` against a real D1 binding** via `@cloudflare/vitest-pool-workers` + `applyD1Migrations()`. No hand-rolled D1 mock — a mock cannot catch a missing index or a real SQLite constraint.
3. **Contract is types first, runtime-validated second.** Hono RPC `typeof app` gives compile-time client/server type safety with zero codegen; shared Zod schemas validate payloads at runtime on both ends. CI fails on schema drift.
4. **E2E proves journeys and the few genuinely cross-process invariants** (concurrent LWW across two contexts, cross-user undo, coach-blocked-and-forged-request-rejected, invite redemption, export/import round-trip, PWA app-shell). E2E is the *smallest* layer by count and the most guarded against flakiness.
5. **Every prototype feature is traced.** §2 is the contract that nothing the prototype demonstrated is silently dropped. Features moved to v1.1/out-of-scope are listed in §8 so the omission is *visible*.
6. **Color is never the only signal under test.** Accessibility assertions live inside the component and E2E layers, not bolted on.

### 1.2 The pyramid for this stack

```
                 ┌───────────────────────────────────────┐
       E2E       │ Playwright — full journeys, 2-context  │   ~12–20 specs
   (workerd +    │ LWW, cross-user undo, perms, invite,   │   slowest, most guarded
    real SPA)    │ export/import round-trip, PWA shell    │
                 ├───────────────────────────────────────┤
   Component     │ Vitest browser mode + Testing Library  │   ~1 file per screen/sheet
   (browser)     │ every screen/sheet, tag editor, a11y   │
                 ├───────────────────────────────────────┤
   Worker / D1   │ @cloudflare/vitest-pool-workers        │   every route, perms,
   integration   │ real D1, applyD1Migrations, EXPLAIN    │   op-log, LWW, invites, undo
                 ├───────────────────────────────────────┤
                 │ Vitest unit — pure domain/             │   the bulk of correctness:
      Unit       │ timing, two-chart, op-log invert,      │   op-log, timing, sortKey,
   (no runtime)  │ sortKey, deep-copy, enums + fast-check │   deep-copy, enums; property
                 └───────────────────────────────────────┘
   Contract: Hono RPC types (compile-time) + shared Zod (runtime, both ends) — cross-cuts all layers
```

What each layer **owns**:

| Layer | Owns (authoritative for) | Does NOT own |
|---|---|---|
| **Unit** | All pure-domain correctness: op-log apply/invert + undo interleaving, meter timing & per-role bar derivation, two-chart seeding/independence, sortKey, side auto-naming, deep-copy, Zod/enum validation | Anything touching D1, HTTP, auth, React rendering |
| **Worker/D1** | Route behavior against real D1, **permission enforcement**, op-log *appended on every mutation*, undo endpoint incl. stale refusal, LWW outcome, invite issue/redeem/expiry, EXPLAIN-QUERY-PLAN index assertions | Pixel-level UI, pure-domain math (already unit-tested) |
| **Component** | Each screen/sheet renders & reacts correctly to a seeded store; tag-editor chip behavior; role toggle/side-by-side; Lanes; empty states; coach affordance hiding; toasts; a11y (axe, keyboard, 44px) | Real network, cross-user concurrency, real auth |
| **E2E** | Cross-process journeys & invariants: full authoring loop, concurrent LWW (2 contexts), cross-user undo, coach-blocked + forged-request-rejected, invite redemption, export→import, PWA install/app-shell, tab nav across all screens | Exhaustive permutations (those live below) |
| **Contract** | Client↔Worker type safety (compile) + runtime payload validation (Zod) + schema-drift CI gate | Behavior (delegated to the layers above) |

### 1.3 Tooling & runner setup

**Test runners**
- **Vitest** — single test runner across unit, Worker/D1, and component, via Vitest **workspace/projects** so one `vitest` invocation runs all three with the right environment per project:
  - `domain` project — Node environment, pure TS, fastest, includes **fast-check** for property tests.
  - `worker` project — **`@cloudflare/vitest-pool-workers`** (`defineWorkersProject`), runs inside `workerd` with real bindings (D1, and a test KV/R2 stub if needed). `wrangler.toml`/`wrangler.jsonc` bindings are referenced so tests use the same schema as prod.
  - `component` project — **Vitest browser mode** (Playwright provider, headless Chromium) + **@testing-library/react** + `@testing-library/jest-dom` + **`vitest-axe`** for accessibility assertions.
- **Playwright** — separate `playwright.config.ts` for E2E. **Projects:** `chromium-desktop`, `mobile-chrome` (Pixel 5 device), `mobile-safari` (iPhone 13, WebKit) — covering the spec's iOS Safari / Chrome Android targets. Reuses the same Wrangler dev server (Worker + Static Assets + D1) so E2E hits the real stack.

**Cloudflare worker test config**
- `@cloudflare/vitest-pool-workers` configured with `miniflare.d1Databases` and a per-suite **isolated D1** (each test file/`describe` gets a fresh DB or runs inside a transaction that is rolled back) so tests don't share state.
- **`applyD1Migrations()`** runs the real Drizzle-generated migrations in `beforeAll`/`beforeEach` so the test DB schema is identical to prod. The same migration set is the single source of truth — no parallel "test schema".
- **`EXPLAIN QUERY PLAN`** helper: a test utility that runs `EXPLAIN QUERY PLAN <sql>` against the real test D1 and asserts the output contains `USING INDEX`/`USING COVERING INDEX` and **does not** contain `SCAN` (full table scan) for the guarded queries (routine-list, routine-load, membership lookups, op-log tail).

**Clerk auth in tests (edge auth stubbing)**
- The Worker verifies Clerk JWTs **networklessly** against a public key. For tests we inject the **test JWKS/PEM via a binding/env var**, and a `makeTestJWT(userId, claims)` factory signs tokens with the matching test private key. This means the Worker's real verification path runs against tokens we mint — no Clerk network calls, but the *actual* verify + `sub`→D1-user mapping middleware is exercised.
- Worker/D1 layer: tokens minted in-process, attached as `Authorization: Bearer`.
- E2E layer: use **Clerk's testing mode / test tokens** (or the same mint-and-inject approach via a test-only sign-in route) so Playwright gets **deterministic, network-free auth** — no real Clerk UI in the hot path, no flakiness from a third-party login screen. Auth is seeded per Playwright fixture (see §7).

**Fixtures, factories, seed data** — see §7. The read-only **sample routine** (a real product artifact) is reused as the canonical test fixture across all layers.

**Quality tooling alongside tests:** TypeScript `strict`; ESLint + Prettier (or Biome); Drizzle typed D1; Sentry (or Tail Workers) wired in staging+prod. Coverage via Vitest V8 coverage with per-area gates (§6).

---

## 2. Prototype Feature Coverage Matrix (core deliverable)

One row per prototype feature/screen/interaction from `design-spec.md`, plus the cross-cutting features the spec added that the prototype only stubbed. Cross-checked so **nothing the prototype demonstrated is missing**.

**Layer key:** U = Unit · W = Worker/D1 integration · C = Component · E = E2E · K = Contract (Zod/RPC).
**Risk:** H = high (dedicated de-risking, §4) · M = medium · L = low.

### 2.1 Choreo / Routine List (`scList`)

| Feature / interaction | Behaviors to verify | Layer(s) | Key assertions | Risk |
|---|---|---|---|---|
| List routines user is a member of | Only routines where user has Membership appear; dance-color icon; `title`; `dance · barLabel · created`; chevron | W, C | Membership-scoped query returns exactly the user's routines; non-member's routine absent; `barLabel` = "N bars"/"no figures yet" | M |
| `barLabel` derivation | "N bars" when figures exist, "no figures yet" when 0; bars are **meter-derived** (not the old count-of-1 rule) | U, C | Derived from per-role timing (§2.4); zero-figure routine shows "no figures yet" | H |
| Tap card → open routine | Opens Assemble; loads full tree via one RPC | W, E | Route returns sides→figures→both charts→threads in one fetch; navigates to Assemble | M |
| "+" → New Choreo sheet | Opens overlay | C, E | Sheet visible; backdrop dismiss | L |
| **Empty state (added)** | Wireframe had none; v1 shows sample routine + "start from template" | C, E | Zero-member-routine user sees sample + template CTA | M |
| **Search by title/dance (added)** | Indexed D1 filter | W, C | Filter narrows list; query uses index (EXPLAIN) | M |

### 2.2 Assemble (`scAssemble`)

| Feature / interaction | Behaviors to verify | Layer(s) | Key assertions | Risk |
|---|---|---|---|---|
| Sides → figures overview | Collapsible side headers; derived bar labels; figure cards (name, custom badge, count summary) | C | Each side renders its figures; custom badge only for `source=custom`; count summary correct | M |
| Side divider / uppercased name | Side name shown uppercased per side | C | Rendered text matches `name.toUpperCase()` | L |
| Collapse/expand side | `collapsed` state toggles per side | C | Chevron toggles; figures hidden when collapsed | L |
| Figure card → Figure Timeline | Tap opens timeline; mode derived from edit access | C, E | Navigates; coach opens in view-only | M |
| **Role toggle (leader/follower) — added** | Sets which chart's summary chips show; defaults to viewer's role | C | Toggling swaps summary chips to the other chart; default = viewer role | H |
| Mini dimension header Ri/Bo/Fw/Sw/Tn → Info sheet | Each abbrev opens Info sheet for that dimension | C | Tap `Ri` opens rise info; all five mapped | L |
| Inline comments preview (reading) | Up to 2 latest comments, colored dot, text truncated to 44 chars, "+N more", "+ add comment" | C | Truncation at 44 chars; "+N more" count correct; both links open thread; "none" → just "+ add comment" | M |
| "Add figure" → Add-figure sheet | Opens sheet scoped to that side | C, E | Sheet opens with side context | L |
| "Add side" inline picker | "WHAT KIND OF SIDE?" → Long/Short/Corner; auto-named by ordinal | U, C | Auto-naming "1st/2nd Long Side", "Corner"/"Corner 2" under add/delete | M |
| **Reorder figures within a side (added)** | sortKey-based reorder | U, W, C | sortKey insert-between yields stable distinct order; op-log appended | M |
| **Delete figure (added)** | Editor can delete; confirm dialog | W, C, E | Editor deletes (op-log appended); coach cannot; confirm required | M |
| Reading-vs-editing collapsed to role gate | No separate mode toggle; editor edits, coach view+comment only | C, W | Coach sees no edit affordances; editor sees them | H |
| Share button → Share | Opens Share screen | E | Navigates | L |

### 2.3 Figure Timeline (`scFigure`)

| Feature / interaction | Behaviors to verify | Layer(s) | Key assertions | Risk |
|---|---|---|---|---|
| Step list rows (view) | timing, action, thread badge, five slot chips, expand chevron; unset = empty circle | C | Row renders timing+action+chips; thread badge shows count; empty slot = circle | M |
| Inline expand row (view) | 5 rows (label colored + value or "— not set") | C | Expanded row shows each dimension value or "— not set" | L |
| Footer notes (view/edit/lanes) | Verbatim footer copy per mode | C | Correct footer string per `figMode` | L |
| Edit list view → Step Detail | Tap row opens tag editor | C, E | Navigates to Step Detail for that step+role | M |
| **Lanes view (reinstated v1)** | One dimension across all steps; filled chip or dot; tap → Step Detail; per role | C, E | Column-set: a chosen dimension shown for every step; setting in a lane updates that step; per-role | H |
| **Role view: leader / follower / both side-by-side (added)** | Toggle switches chart; "both" = side-by-side pre-filled entry | C, E | Toggle swaps chart; "both" shows two columns; follower pre-filled = leader at creation | H |
| **Add step (added)** | Add to a role's chart | U, W, C | Step appended to correct role chart; op-log appended; pre-fill seeds other chart on creation | H |
| **Remove step (added)** | Remove from a role's chart | W, C | Removed; op-log appended; undoable | M |
| **Edit timing/action (added)** | Edit `timing.beat/sub/value` and `action` | U, W, C | Valid timing accepted; bars re-derive; op-log appended | H |
| **Edit figure alignment entry/exit (added)** | `entryAlignment`/`exitAlignment` qualifier+direction | U, W, C | Valid pair persists; reads "Facing Diagonal to Wall"; nullable allowed | M |
| Lanes/edit toggles flip back to view | Toggling a mode returns to `view` | C | Mode state transitions correct | L |
| Thread badge per step (role-aware) | Count reflects threads on that step in that role | C, W | Count matches threads anchored to `{figureId, role, stepId}` | M |

### 2.4 Step Detail + Tag Editor (`scStep`) — the hero flow

| Feature / interaction | Behaviors to verify | Layer(s) | Key assertions | Risk |
|---|---|---|---|---|
| Title "Tag · step N (role)" | Shows step number within role chart + role | C | `n` = 1-based index in that role's chart; role shown | M |
| Step card | count/timing, action, figure name, yellow thread button w/ count | C | Renders; thread button → Thread | L |
| Rise section (single-select) | 7 canonical values (`commence`,`body_rise`,`foot_rise`,`up`,`continue`,`lowering`,`NFR`); chip toggles; re-tap clears | U, C | Single-select; re-tap → null; `NFR` selectable | M |
| **Tango suppresses rise** | `hasRiseFall=false` hides rise section/column | U, C, E | Tango figure: no rise section anywhere (Step Detail, Lanes, Assemble chips) | H |
| Body = **position + body-action (added split)** | Position single-select (`closed`,`promenade`,`wing`); body-action multi-select (`CBM`,`CBMP`); "CBP" treated as CBMP typo [Q-D4] | U, C | Position single-select; body-action multi-select & can be empty; both persist independently | H |
| Footwork (single-select) | 5 values (`HT`,`T`,`TH`,`heel_pull`,`H`) | U, C | Single-select; `H` (bare Heel) selectable | M |
| Sway (single-select) | 3 values (`to_L`,`to_R`,`none`) | U, C | Single-select; re-tap clears | L |
| Turn (single-select) | 8 values incl. `eighth_L/R` (⅛), quarters, three-eighths, halves, `none` | U, C | `⅛` selectable; correct degree mapping in display | M |
| Re-tap selected clears slot | `setSlot` toggles to null | U, C | Selecting same value → null | M |
| Edit timing/action here | Inline edit | C, W | Persists; op-log appended | M |
| Short slot labels (chips) | `shorten` mapping (lowering→lwr, body rise→rise, none→—, heel pull→H.pl, …) | U, C | Chip label matches mapping table | L |
| Thread button → Thread | Opens role-aware thread | C, E | Navigates to thread anchored to this step+role | L |

### 2.5 Thread (`scThread`)

| Feature / interaction | Behaviors to verify | Layer(s) | Key assertions | Risk |
|---|---|---|---|---|
| Per-step role-aware thread | Anchor `{type:step, figureId, role, stepId}` | W, C | Thread loads comments for that exact anchor; role-specific | M |
| Title/subtitle | `tTitle` (e.g. "Whisk · step 2"), `tSub` (action · rise · sway · turn) | C | Composed from step data | L |
| People legend | Colored dots for each member (Me/partner/coach) | C | Legend reflects routine members + identity colors | L |
| Comments list | Colored left border by author; "Name (role) · time"; text in note font | C | Author color = `identityColor`; role label correct | M |
| Reply bar → add comment | Append `{authorId, createdAt, text}` | W, C, E | Comment persisted; appears; **coach CAN comment**; op-log/comment append | H |
| **Comment delete (author-only, added)** | Author can delete own comment | W, C | Author deletes; non-author rejected (Worker) | M |
| Back → threadReturnView | Returns to figure or assemble | C | Navigates to recorded return view | L |
| Reachable from Assemble reading comments | "+ add comment"/"+N more" open thread | C, E | Opens correct thread | L |

### 2.6 Share (`scShare`)

| Feature / interaction | Behaviors to verify | Layer(s) | Key assertions | Risk |
|---|---|---|---|---|
| Member list | Members with role (editor/coach); identity initials/colors | C, W | List matches Memberships; roles shown | M |
| Explanatory card (rewritten) | New microcopy: "Both partners can edit… Coaches can view and comment…" (replaces fork copy) | C | Exact rewritten string present; old fork copy absent | L |
| **Invite by link (real, added)** | Editor generates signed expiring token; inviter picks editor/coach | W, E | Token issued; redeem creates Membership with chosen role; **expired token rejected**; **non-editor cannot invite** | H |
| **Redeem invite flow (added)** | Authenticated redeem → Membership | W, E | New member gains access; idempotent/again-redeem handled | H |
| **Remove member (editor-only, added)** | Editor removes a member | W, C | Editor removes; coach/non-member cannot | M |
| "Duplicate" = **save-a-copy (added semantics)** | Deep copy (sides, figures, both charts, tags, alignment); `copiedFromRoutineId`; comments/journal NOT copied [Q-D5]; copier = editor | U, W, E | Copy equals source structurally with new ids; provenance set; threads/journal omitted; copier is editor | H |

### 2.7 Journal List (`scJournal`)

| Feature / interaction | Behaviors to verify | Layer(s) | Key assertions | Risk |
|---|---|---|---|---|
| Entries list | author avatar, "Kind · who", date, text (truncated), tag chips (tone-styled) | C | Renders; tag tone colors (step=blue, sway=red, else neutral) | L |
| Tap entry → Entry Editor | Opens editor in edit mode | C, E | Navigates | L |
| "+ entry" → Entry Editor (new) | Opens editor in new mode | C, E | Navigates | L |
| **Filter chips now functional (added)** | `all`/`lessons`/`practice` client filter; **`by figure` filter (v1)** | C, E | Prototype chips were no-op; now each filters; "by figure" filters to figure-linked entries | M |
| Empty state (added) | Wireframe lacked one | C | Zero-entry list shows empty state | L |

### 2.8 Entry Editor (`scEntry`)

| Feature / interaction | Behaviors to verify | Layer(s) | Key assertions | Risk |
|---|---|---|---|---|
| Author row | avatar, name, role-derived label | C | Renders | L |
| Textarea draft | placeholder "What changed today?"; draft persists | C, W | Save persists text | L |
| LINKED TO list | link chips with remove ✕; add → Link Picker | C, W | Add/remove link persists; chip label format correct | M |
| Save → toast "Saved to journal" | Persist entry | W, C, E | Entry stored with links/tags; op-log if applicable | M |
| Media row (voice/photo/video) | All → toast "Attach — coming soon" (v1.1 stub) | C | Each shows "coming soon"; **no upload attempted** | L |

### 2.9 Link Picker (`lpOpen`)

| Feature / interaction | Behaviors to verify | Layer(s) | Key assertions | Risk |
|---|---|---|---|---|
| Type step (trimmed) | Two paths only: **step** (side→figure→role→step) and **figure** (side→figure) | C, E | Attribute path & dance/global scopes ABSENT (dropped); both remaining paths complete | M |
| Step link result | `{type:step, figureId, role, stepId}` routine-scoped | U, C | Link shape valid (Zod); label "↳ Fig · step N (role)" | M |
| Figure link result | `{type:figure, figureId}` | U, C | Link shape valid; label "↳ all Xs" | M |
| Back/close in wizard | `lpCanBack` navigation | C | Back returns to prior step; close dismisses | L |

### 2.10 Profile (`scProfile`)

| Feature / interaction | Behaviors to verify | Layer(s) | Key assertions | Risk |
|---|---|---|---|---|
| Identity display | avatar, name, role | C | Renders | L |
| **Editable name + default role (added)** | Wireframe was read-only | W, C, E | Edit persists | M |
| Note-color picker | 6 swatches; selected ringed + check; **global** across routines | W, C | Pick persists; identity color updates everywhere notes attributed | M |
| Preview card | bg/ink derived from chosen color; "this is how your notes appear" | C | Preview reflects selection | L |
| Explanatory note | "Each member picks their own colour; consistent across every routine" | C | Exact string present | L |
| **Shared-routine count computed (added)** | Replaces hard-coded "shares 2 choreos" | W, C | Count = actual memberships; not literal | L |
| **Sign out (added)** | Clerk sign-out | E | Session cleared; redirected to sign-in | M |

### 2.11 Overlays / sheets

| Feature / interaction | Behaviors to verify | Layer(s) | Key assertions | Risk |
|---|---|---|---|---|
| Add-figure sheet — library view | dance-filtered list; filter input; dot (custom/library); "+" adds; toast "Added X" | C, W, E | Filter narrows; add instantiates figure **with catalog default leader+follower charts**; toast | H |
| Add-figure sheet — empty state | filter matches nothing → "No figures match — create your own below" | C | Empty-state copy renders | L |
| Add-figure sheet — compose custom | name input, placeholder-step note, cancel/add; `source=custom`; **placeholder steps for BOTH roles** | U, W, C | Custom figure created with placeholder steps in both charts; brown dot | M |
| New Choreo sheet | 5 Standard dance chips (one selected); name input; create → Assemble (with `bars:0`, created "today"); **+ start from template** | C, W, E | Create persists routine; opens Assemble; template path seeds from template | M |
| Info sheet (v1-lite) | per-slot name + canonical value list; close ✕ | C | Correct values per dimension (reconciled canonical set); Tango rise info consistent with hidden slot | L |
| Toast — all messages | "Added {Side}", "Added {Figure}", "Saved to journal", "Copied — edit your own version", "Invite link copied", "Attach — coming soon", **"Undone"** | C, E | Each trigger fires the correct verbatim toast; "Undone" shows action name | M |

### 2.12 Tab bar & navigation

| Feature / interaction | Behaviors to verify | Layer(s) | Key assertions | Risk |
|---|---|---|---|---|
| 3-tab bar (Choreo/Journal/Profile) | active accent/bold, inactive gray | C, E | Active state correct; Choreo resets to list | L |
| Tab bar hidden on step/thread/share/entry-editor | visibility rule | C | Hidden on those screens, shown elsewhere | L |
| Full navigation graph | all transitions per `design-spec.md` nav graph | E | Each documented edge reachable | M |

### 2.13 Cross-cutting features the prototype omitted (spec §4.0)

| Feature | Behaviors to verify | Layer(s) | Key assertions | Risk |
|---|---|---|---|---|
| **Auth / onboarding** | Clerk hosted sign-in (Google + passkeys); onboarding sets displayName, role, color | W, E | Networkless JWT verify; `sub`→D1 user; onboarding persists; unauth → sign-in | H |
| **Account / settings** | edit name/role/color; sign out | W, C, E | Persists; sign-out clears session | M |
| **Delete flows** | routine/side/figure/step/journal entry; comment author-only; confirm dialogs | W, C, E | Editor deletes (op-log); coach blocked; confirm required; cascade correctness | H |
| **Reorder** | figures & steps within parent via sortKey | U, W | Stable order; op-log; (side reorder deferred) | M |
| **Step add/edit/remove** | within a figure's chart, edit timing/action | U, W, C | Covered in §2.3/2.4 | H |
| **Undo (per-user, per-action)** | op-log inverse; stale refusal; cross-user interleave; re-undoable | U, W, E | See §4.1 — exhaustive | H |
| **Search** | routine list title/dance | W, C | Indexed; correct results | M |
| **Invite / redeem** | real signed token flow | W, E | See §2.6 | H |
| **Save-a-copy** | deep copy | U, W, E | See §2.6 | H |
| **Sample / template** | read-only sample + start-from-template | W, C, E | Sample is read-only (mutations rejected); template seeds editable copy | M |
| **Export / import** | JSON round-trip | U, W, E | Round-trip reproduces routine incl. both charts, comments, linked journal | H |

---

## 3. Per-layer detailed test catalogs

### 3.1 Unit (Vitest, pure `domain/`)

**Meter-based timing & per-role bar derivation**
- Beats **1–6 map to bars for 3/4 dances** (Waltz, Viennese): beats 1–3 → bar 1, 4–6 → bar 2 of the phrase.
- Beats **1–8 map to bars for 4/4 dances** (Foxtrot, Quickstep, Tango): 1–4 → bar 1, 5–8 → bar 2.
- **Sub-beat markers** `e`/`&`/`a` parse and sort correctly relative to their integer beat (e.g. `1`, `1e`, `1&`, `1a`, `2`).
- **Beat-value** (`value`: S=2 beats, Q=1) handled where present.
- **Per-role derivation handles charts of different lengths:** leader chart with 3 steps and follower chart with 4 steps each derive their own bars from the same phrase meter; one chart's length never affects the other's derivation.
- Edge: empty chart → 0 bars; out-of-range beat (e.g. 7 for a 3/4 dance) rejected by validation.

**Two-chart pre-fill seeding + independence**
- Creating a step seeds the **follower equal to the leader** (action, timing, all slots) at creation time.
- **Independence:** after seeding, editing the leader step does NOT mutate the follower step, and vice-versa (pre-fill is one-time seeding, not a live binding).
- Adding a follower-only step (no leader counterpart) is allowed; charts need not be 1:1.
- Property test (fast-check): for random leader charts, seeded follower deep-equals leader at creation; a random sequence of edits to one chart leaves the other byte-identical to its post-seed snapshot except where directly edited.

**Op-log apply/invert + per-user undo (highest-risk — see §4.1)**
- **Every op kind has a correct inverse:** `step.setSlot`, `step.add`, `step.remove`, `step.editTiming`, `step.editAction`, `figure.add` (compound: seeds both charts), `figure.remove`, `figure.reorder`, `side.add`, `side.remove`, `side.reorder` (if any), `alignment.set`, `comment.add`, `comment.delete`, `journal.*`, `membership.*`.
- **apply(inverse(apply(op, s))) === s** (invertibility) for every kind — property-based with fast-check over random states + ops.
- **Undo is itself logged as a new forward op** and is therefore **re-undoable** (undo of undo = redo-equivalent).
- **Superseded-op refusal:** if a later op changed the same field, undoing the earlier (now stale) op is refused with the defined error; the targeted entity must still exist.
- **Per-user undo interleaving:** with ops from users A and B interleaved, A's "undo my last" targets A's latest not-yet-undone op, B's targets B's — neither touches the other's; verified across many interleavings.
- **Compound op undo (Q-S2 default):** `figure.add` that seeds both leader+follower charts undoes as **one** op; coalesced same-field rapid edits (~1s window) undo as one; single-item reorder = one op.

**sortKey ordering**
- Insert-between two keys yields a key strictly between; insert at both ends; **repeated same-gap inserts stay distinct** (no collision / precision exhaustion within reasonable depth); ordering stable after many inserts.

**Side auto-naming**
- Ordinals: "1st/2nd/… Long Side", "… Short Side", "Corner"/"Corner 2"; correct under **add and delete** (deleting the 1st Long Side renumbers or holds per defined rule — assert the chosen rule).

**Deep-copy (save-a-copy)**
- Copies sides, figures, **both charts**, tags, alignment; **regenerates all ids**; sets `copiedFromRoutineId`; **omits** comments/threads and journal [Q-D5 default]; structural deep-equality modulo ids.

**Enum / Zod validation**
- Confirmed additions valid: **`NFR`** (rise), **`H`** (foot), **`⅛`** (turn).
- **Tango → rise slot absent** (schema/derivation: `hasRiseFall=false` ⇒ rise rejected/omitted for Tango).
- **Body position (single) vs body-action (multi)** separation enforced; "CBP" normalized/treated as CBMP [Q-D4].
- Invalid enum value rejected with typed error; alignment qualifier+direction pair validated; timing beat range validated per dance meter.

### 3.2 Worker / D1 integration (`@cloudflare/vitest-pool-workers`, real bindings)

Run with `applyD1Migrations()` against a real isolated D1 per suite. Every test authenticates with a minted test JWT.

**Routes against real D1 — and op-log appended on EVERY mutation**
- Create routine; add side/figure/step (both charts); set slot; edit timing/action; reorder; delete — each persists the row(s) **and appends exactly one `EditOp`** (assert `seq` monotonic per routine, `forward`+`inverse` present). A mutation that does not append an op is a failure.
- Routine-load route returns the full tree (sides→figures→both charts→threads/comments) in one fetch; routine-list returns only the caller's memberships.

**Permission enforcement (high-risk)**
- **Coach rejected on structure/steps** (add/edit/delete figure/step/side, set slot) → 403.
- **Coach accepted on comment** (post comment) → 200.
- **Coach tag-edit** gated by Q-D6 (default: rejected) — test asserts the chosen default.
- **Non-member rejected entirely** (any read or write) → 403/404.
- **Editor succeeds** on all structural mutations.
- **Member removal / routine deletion require editor** — coach/non-member rejected.

**Undo endpoint**
- Undo applies the inverse, marks the op `undone`, appends the undo as a new op.
- **Stale/superseded undo** returns the defined refusal ("can't undo — changed since") — not a silent no-op, not a 500.
- Undo of a non-existent/foreign op rejected.

**LWW (defined deterministic outcome)**
- Two sequential writes to the **same field** → **second wins** (deterministic), `updatedAt` bumped.
- Writes to **different fields/steps** → **both persist**.

**Invites**
- Editor issues signed expiring token; **redeem** (authenticated) → correct `Membership` with the inviter's chosen role; **expired token rejected**; **non-editor cannot issue**; double-redeem handled idempotently.

**Sample / template**
- Mutations against a `templateOf` (read-only sample) routine are **rejected**; "start from template" creates an editable copy.

**Export / import**
- Export route returns JSON containing structure + both charts + comments + linked journal; import route reconstructs an equivalent routine (round-trip asserted here and E2E).

**EXPLAIN QUERY PLAN index assertions**
- Routine-list (by membership), routine-load joins, membership lookup, op-log tail (latest op per user) — each asserted to use an index (`USING INDEX`/`COVERING INDEX`) and **no full `SCAN`**. This is the D1 rows-scanned cost guard.

### 3.3 Component (Vitest browser mode + Testing Library)

Each test seeds an in-memory store / mocks the typed RPC client with fixture data, then asserts rendered UI + interactions. `vitest-axe` assertion per screen.

**Tag editor**
- Chips reflect current slot values; toggling a chip updates the slot; **re-tapping the selected chip clears it**.
- **Single-select** (rise, position, foot, sway, turn): selecting one deselects the previous.
- **Multi-select** (body-action CBM/CBMP): multiple can be on; clearing all is valid.
- **Tango hides the rise section** entirely.

**Two-chart UI**
- **Role toggle** switches between leader and follower charts.
- **Side-by-side ("both") entry** pre-fills the follower equal to the leader.
- **Chart independence:** editing one side's chip leaves the other side's chip unchanged in the UI.

**Lanes view**
- Renders one dimension (column-set) across all steps; setting a value in a lane updates that step's chip; per-role.

**Per screen/sheet** (one file each): List, Assemble (reading/editing affordances), Figure Timeline (view/edit/lanes), Step Detail, Thread, Share, Journal List (+ functional filter chips incl. "by figure"), Entry Editor (+ media "coming soon"), Profile (+ color picker/preview), Add-figure sheet (library + empty state + compose), Info sheet, New Choreo sheet, Link Picker (step + figure paths only).

**Cross-cutting component assertions**
- **Empty states** render (zero routines → sample/template; zero journal entries; empty side; thread with no comments → "+ add comment").
- **Coach sees no edit affordances** (no add/delete/edit-slot buttons; comment input present).
- **Toasts** including **"Undone"** (with action name) render on their triggers.

### 3.4 E2E (Playwright)

Deterministic auth seeded per fixture (§7); seeded D1 via a test-only seed route or pre-seeded DB. No arbitrary sleeps — wait on app state / network idle / explicit data-testid presence.

- **Full core authoring journey:** sign in → open sample/template or create routine → add side → add figure (instantiates both charts) → tag steps in **both** charts (Step Detail + Lanes) → values appear correctly after reload.
- **Concurrent LWW (two contexts = two editors):** both edit the **same field** online → after refresh both contexts show the **defined last-write-wins** value; edits to **different steps** both survive. (Replaces the old offline-merge test.)
- **Undo correctness E2E incl. cross-user:** user makes several edits, undoes their last → prior state; partner's interleaved edit is unaffected; undoing a field the partner has since changed → **refusal message** shown.
- **Permission E2E:** a coach context has **no structural edit UI**; a **forged structural request** (crafted fetch with coach token) is **rejected by the Worker** (assert 403, state unchanged).
- **Invite-link redemption flow:** editor generates link → second user redeems → gains access with chosen role; expired link rejected.
- **Export → import round-trip:** export routine to JSON → import into a fresh routine → structurally identical (both charts, comments, linked journal).
- **PWA install / app-shell offline state:** service worker registers; app shell loads offline; data operations show the clear "you're offline" state (no crash). (Per spec: shell offline only, not offline data.)
- **Tab navigation across all screens:** every documented nav-graph edge reachable; tab-bar visibility rule honored.

### 3.5 Contract (Hono RPC + Zod)

- **Compile-time typed client:** `typeof app` consumed by `hc` client; a deliberate type-drift fixture (changed route shape) must fail `tsc` — verified in CI via a type-test (`tsd`/`expectTypeOf`).
- **Runtime schema validation both ends:** shared Zod schemas validate requests on the Worker and responses on the client; a **malformed payload is rejected with a typed error** (not a 500).
- **Schema-drift CI gate:** client and worker import the *same* schema module; a check fails CI if a route's request/response schema diverges from the shared contract (e.g. a snapshot/`tsc` build of both packages against the shared `contract/`).

---

## 4. High-risk areas & de-risking

The v2 architecture **deleted** the old highest-risk surface (CRDT sync/merge, fork lineage, two-zone writes). The new top risks:

### 4.1 Undo / op-log correctness (HIGHEST)
- **Property-based testing (fast-check):** generate random routine states and random op sequences; assert **invertibility** (`apply(inverse(apply(op,s))) === s`) for every op kind, and **convergence/idempotence** of undo (undo→redo→undo lands consistently). This catches inverse bugs no example test would.
- **Interleaving model:** enumerate/randomize A/B op interleavings; assert per-user "undo my last" always targets the correct user's latest non-undone op.
- **Stale refusal** is a *defined* behavior (Worker test + E2E), not best-effort.
- Re-undoability (undo is logged) tested at unit and E2E.

### 4.2 Two-chart data integrity (HIGH)
- Unit: seeding equality at creation + independence after edits (property-based); charts of unequal length derive bars independently.
- Worker: adding a figure persists **both** default charts; deep-copy copies both.
- Component/E2E: role toggle + side-by-side pre-fill + edit-one-leaves-other.

### 4.3 Worker-side permission enforcement (HIGH)
- The Worker — not the UI — is the security boundary. Every structural route has an explicit **coach-rejected / non-member-rejected / editor-accepted** Worker test. E2E proves a **forged** request from a coach token is rejected even when the UI is bypassed. Hiding UI affordances (component layer) is defense-in-depth, never the enforcement point.

### 4.4 D1 cost / rows-scanned (HIGH operationally)
- **`EXPLAIN QUERY PLAN` Worker tests** assert every guarded query uses an index and performs no full scan. Mirrored as a **CI gate** (§6) so a query regression fails the build, not the bill.

---

## 5. Accessibility, performance, cross-browser/PWA

### 5.1 Accessibility (WCAG AA)
- **axe** assertions (`vitest-axe` in component, `@axe-core/playwright` in E2E) on every screen/sheet — zero serious/critical violations.
- **Keyboard navigation:** all interactive controls reachable and operable by keyboard (tab order, Enter/Space activate chips, Escape closes sheets); Step Detail tag editor fully keyboard-operable.
- **Color is not the only signal:** technique slots carry text labels (short labels), identity colors carry initials/names; assert label/initial present wherever color conveys meaning (covers the five-dimension colors and per-user identity colors).
- **Touch targets ≥ 44px:** component assertion on chips, tab bar, swatches, add/remove buttons.
- **Reduced motion:** `prefers-reduced-motion` respected — animations suppressed; assert no motion when the media query is set (E2E with emulated reduced-motion).

### 5.2 Performance
- **App-shell interactive budget:** Playwright/Lighthouse-CI check — app shell interactive < ~2s on emulated mid-range mobile/3G (precached shell).
- **Query-plan checks** (shared with §4.4) bound server-side cost.
- Routine-load is a single RPC; assert one round-trip for the tree (network-request count assertion in E2E).

### 5.3 Cross-browser / PWA
- Playwright projects: **mobile-safari (iPhone/WebKit)** and **mobile-chrome (Pixel)** run the core journeys — covering iOS Safari and Chrome Android explicitly.
- **PWA install / app-shell:** manifest valid; service worker registers; installable; **app shell loads offline**; data ops show "you're offline" (no data offline in v1).

---

## 6. CI pipeline

### 6.1 Ordering & PR vs main
- **On every PR (fast gate, must pass to merge):**
  1. Typecheck (`tsc`, incl. contract type-tests) + lint (ESLint/Prettier or Biome).
  2. **Unit** (`domain` project) — incl. fast-check property tests.
  3. **Contract** — Zod runtime validation tests + schema-drift gate.
  4. **Worker/D1 integration** (`vitest-pool-workers`) — incl. **EXPLAIN QUERY PLAN guard**.
  5. **Component** (browser mode) + axe.
  6. **E2E (smoke subset)** — core authoring journey + one permission + one undo test on `chromium-desktop`.
- **On merge to main / nightly:**
  - **Full E2E matrix** across `chromium-desktop`, `mobile-chrome`, `mobile-safari` (concurrent LWW, cross-user undo, invite, export/import, PWA shell, full nav).
  - **Lighthouse-CI** performance budget.
  - Deploy to **staging**; smoke E2E against staging; then **prod** on approval.

### 6.2 Flakiness control (Playwright)
- **No arbitrary sleeps** — wait on `expect(locator)` auto-retry, `waitForResponse`, or explicit data-testid state.
- **Deterministic auth:** minted/test-mode Clerk tokens injected per fixture — never the live Clerk UI in the hot path.
- **Deterministic seed:** each E2E spec seeds its own routine via a test-only seed route or fresh D1; no shared mutable state between specs; parallel-safe.
- **Two-context timing:** LWW tests assert order by **explicitly sequencing the two writes** (await first response before issuing second), not by racing + sleeping — so the "last write" is deterministic.
- Playwright `retries: 1` on CI with trace-on-first-retry; a test that only passes on retry is flagged, not ignored.

### 6.3 Coverage targets / gates
- **Domain layer: ≥ 95% lines/branches** (it holds the correctness; gate fails the build below threshold).
- **Worker routes: ≥ 90%**, with a hard rule: **every undo, two-chart, and permission edge case has a unit or `vitest-pool-workers` test** (per spec §9.6).
- Component/E2E measured by feature coverage against the §2 matrix (every row has at least one test at its listed layer), not just line %.

### 6.4 EXPLAIN-QUERY-PLAN guard
- A dedicated CI step runs the §3.2 EXPLAIN tests; any guarded query that introduces a full `SCAN` fails the PR. This is the documented D1 cost trap, caught in CI rather than in production billing.

---

## 7. Test data & fixtures

- **Sample routine as the canonical fixture:** the read-only product sample (a "Gold Waltz"-style routine with sides, library + custom figures, both leader+follower charts with pre-set slots, a couple of threads, a couple of journal entries) is defined **once** and reused as a fixture across unit, Worker, component, and E2E. Because it's also a shipping artifact, the fixture and the product stay honest with each other.
- **Factories** (pure functions, used in all layers):
  - `makeRoutine({dance, sides})`, `makeSide({kind})`, `makeFigure({source, leaderSteps, followerSteps})`, `makeStep({role, timing, slots})`, `makeBothCharts(leaderSteps)` (returns leader + pre-filled follower), `makeMembership({role})`, `makeComment`, `makeJournalEntry`, `makeEditOp({kind})`.
  - Factories return Zod-valid data by default; accept overrides to construct invalid/edge cases.
- **Seed data for Worker/D1:** a `seedDb(db, {users, routine})` helper inserts via Drizzle after `applyD1Migrations()`; or the shipping sample-seed migration is applied and reused.
- **Clerk auth fixtures:** `makeTestJWT(userId, claims)` (signs with the test key the Worker verifies against); Playwright `authedContext(role)` fixture that yields a browser context already authenticated as an editor / coach / non-member. Distinct users (Daniel=editor, Lena=editor, Anna=coach) match the seed people so multi-user tests (LWW, cross-user undo, invite, permissions) are realistic.

---

## Update — v3 sync (extensibility changes)

Spec v3 folds in three extensibility reviews (`research/extensibility-{attributes,crdt,undo}.md`). These **add and partially replace** test coverage. Everything in §1–§7 still holds; the deltas below are authoritative where they conflict (notably the undo model, which now uses a **footprint-based undoability rule** that subsumes the older "changed since" supersession check). Layer key as in §2 (U/W/C/E/K).

### V3.1 Undo / op-log — footprint-based undoability (replaces & extends §3.1 op-log + §4.1)

The single undoability rule is now: **an op `O` is undoable iff, for every entity in `O.footprint` (entities touched + `versionBefore`), no later not-yet-undone op (by ANY user) has that entity in its footprint.** This generalizes the old field-level "changed since" check to structural and cross-user cases. Delete is now **soft-delete** (`deletedAt` flip), so a delete's inverse is a trivial field flip over the subtree.

| Area | What to verify | Layer(s) | Key assertions | Risk |
|---|---|---|---|---|
| **Footprint undoability rule (property-based)** | The one rule holds across generated op sequences; **reduces to "changed since"** for the field-edit case (no regression vs the existing §3.1 test) | U | fast-check over random op sequences: an op is undoable iff no later non-undone op shares a footprint entity; the field-edit-only subset yields the same allow/refuse decisions the prior supersession test asserted | H |
| **Supersession/dependency predicate table** | Table-test the rule over {own-later-edit, other-user-dependent-op, child-changed, sibling-reordered, nothing-changed} | U | Correct allow/refuse + correct message: "can't undo — changed since" (self later edit) vs "can't undo — others built on this" (foreign dependent op) | H |
| **Cascade-delete then undo restores the whole subtree (soft-delete)** | Deleting a figure flips `deletedAt` on figure + **both step charts** + anchored threads/comments + journal links; undo flips them all back **with original ids**; soft-deleted rows excluded from normal queries before undo | U, W | Pre-undo: normal queries exclude the soft-deleted subtree (filter `deletedAt IS NULL`); post-undo: every row re-included with original ids; **nothing dangles** (no thread/link points at a missing step); FK graph intact | H |
| **Cross-user dangling refusal** | A adds a figure; B tags a step inside it; A attempts to undo the add → **refused** ("others built on this"); B's tag survives | W, E | A's `figure.add` footprint contains F+its steps; B's later tag puts a step in its footprint → undo refused, not a silent subtree delete; B's edit intact on both contexts after refresh | H |
| **Explicit per-user redo cursor** | Redo is an explicit per-user cursor (not merely "undo the undo"); two interleaved users | U, W, E | After undo, redo re-applies that specific op; a new non-undo edit by the user **clears** their redo cursor; one user's interleaved activity does not corrupt the other's redo cursor; redo is per-user | H |
| **Coalesced inverse correctness (carried from v2, restated under footprint)** | N same-field edits in a ~1s window → inverse restores value before the **first**; coalescing never crosses a foreign op (footprint boundary) | U | Inverse = pre-first value; if B wrote between A's two edits, they are NOT coalesced | M |

These **replace** the v2 undo bullets in §3.1 that referenced only "superseded-op refusal" at the field grain, and **extend** §4.1's property-based testing to the footprint rule (the registry-wide inverse round-trip `apply(inverse(apply(op,s)))===s` for every registered op kind still stands and now auto-covers new op kinds via the op registry).

### V3.2 Data-model / extensibility additions

| Area | What to verify | Layer(s) | Key assertions | Risk |
|---|---|---|---|---|
| **Client-generated ULIDs (text PKs)** | Optimistic-create mints the id client-side; the persisted id **equals** the client id — no id-reconciliation round-trip; ids are text PKs (no autoincrement) | U, W, E | Created entity's client-minted ULID == the id returned/persisted by the Worker; optimistic row and server row are the same row (no swap on reconcile); D1 PK is `text` | H |
| **SLOT_REGISTRY single source of truth** | Info-sheet glossary, Lanes, and the tag editor **all derive from `SLOT_REGISTRY`** (the v2 reconciliation gap is now closed by the registry, not manual sync) | U, C | Each of the three consumers renders exactly the registry's `values`/`label`/`color` for a slot; a registry-only change (add a value) propagates to all three with no per-consumer edit (verified by driving a test registry) | H |
| **`appliesToDances` drives visibility (replaces `hasRiseFall`)** | Tango hides the rise slot because `rise.appliesToDances` omits Tango — via the registry, **not** a `hasRiseFall` bool | U, C | `slotsFor("tango", role)` excludes `rise`; rise section absent in Step Detail + Lanes + Assemble chips for Tango; a non-Tango dance includes rise | H |
| **`appliesToRoles` honored** | A role-only value/slot is offered only for that role | U, C | `slotsFor(dance, "follower")` includes a follower-only value that `slotsFor(dance, "leader")` excludes; tag editor reflects it | M |
| **Forward-compatible read (unknown value passthrough)** | An unknown persisted enum value **passes through** (tagged, e.g. `{unknown: "five_eighth_R"}`) on read rather than hard-failing Zod | U, W | Reading a row with an unknown slot value does not throw; value preserved (round-trips back out on export) instead of being dropped or rejected | M |
| **`schemaVersion` on export/import + migration ladder** | Export envelope carries `schemaVersion`; importing an **older-version** envelope runs the migration ladder | U, W | Export JSON contains `schemaVersion`; importing a current-version envelope round-trips unchanged; importing an older-version envelope is routed through the migration ladder (at least a stub/contract test asserting the ladder is invoked and a known old→new transform applies) | M |

### V3.3 Updated micro-defaults (now decided in spec v3 — re-pinned)

- **Bar derivation:** `bars = ceil(maxBeat / beatsPerBar)` **per role**; partial bars **display as-is**. The §2.1 / §3.1 timing tests assert this exact formula per role (e.g. a Waltz `beatsPerBar=3` chart whose max beat is 4 → `ceil(4/3)=2` bars; an empty chart → 0).
- **Side auto-naming on deletion:** names **renumber from order** after a delete (deleting the 1st Long Side makes the former 2nd Long Side the "1st Long Side"). The §3.1 side-auto-naming unit test asserts the renumber-from-order rule (replacing the earlier "assert the chosen rule" placeholder).

These re-pinnings supersede the corresponding "the plan tests a chosen rule" language in the v2 §3.1 catalog and remove items 5 and 6 from §8.3 (now resolved — see updated §8.3).

---

## 8. Traceability

### 8.1 Full-coverage confirmation
**Every feature, screen, sheet, toast, toggle, interaction, and entity field enumerated in `design-spec.md` is represented in the §2 matrix and the §3 catalogs**, including the cross-cutting capabilities the prototype only stubbed or omitted (auth/onboarding, account/settings, delete flows, reorder, step add/edit/remove, search, real invite/redeem, save-a-copy, export/import, sample/template, undo, functional journal filter chips, computed shared-routine count, role toggle, two-chart side-by-side, Lanes, alignment). The five technique dimensions, all enum value sets (with the confirmed additions `NFR`/`H`/`⅛` and the Tango rise suppression), the short-label mapping, every toast string, the navigation graph, and the tab-bar visibility rule are each covered.

### 8.2 Prototype features deliberately NOT tested in v1 (noted, not silent)
These map to v1.1 / out-of-scope per spec §10; the omission is intentional and visible:

| Prototype feature | Status | Reason (no v1 test) |
|---|---|---|
| **Media attachments** (voice/photo/video) | v1.1 | Only the "coming soon" stub is tested in v1; upload/playback machinery is v1.1 (R2 presigned). |
| **Offline data / sync (CRDT engine, transport, conflict UX)** | out-of-scope (v-next: offline read → write) | v1 is online-only; only PWA app-shell offline + "you're offline" state are tested. No CRDT/two-client merge tests. **Note (v3):** the cheap-now CRDT seams *are* tested in v1 — client-generated ULIDs, `schemaVersion`, soft-delete tombstones (delete-as-op), and the footprint/op-registry shape (see V3.1/V3.2) — so the door is verified open even though the engine itself is deferred. |
| **Fork-to-edit / duplicate-to-edit as edit path** | replaced | "Duplicate" is tested only as **save-a-copy**; the prototype's fork/version/merge model is gone. |
| **Attribute-anchored journal links + dance/global scopes** (Link Picker's 9-cell model) | dropped | Only step + figure links, routine-scoped, are tested. |
| **Cross-routine journal entries / journal search** | deferred | Not built; not tested. |
| **Per-step alignment, finer turn/footwork magnitudes** | deferred | Only confirmed enums + per-figure alignment tested. |
| **Notifications, read/unread, comment editing, threading depth** | out-of-scope | Only comment add + author-only delete tested. |
| **Themes / backdrop settings** | dropped (editor-only props) | No in-app settings; not tested. |
| **Side reorder** | deferred | Figure/step reorder tested; side reorder is not built. |
| **Corner-side floorcraft semantics** | undefined in spec | Corner exists as a side kind (auto-naming tested); its distinct floorcraft semantics are undefined, so only its presence/naming is tested. |

### 8.3 Spec gaps noticed while ensuring full coverage
Flagged for the spec owner (these affect what "correct" means in tests):

1. **Q-S2 (op-log granularity) is still open but is load-bearing for the undo tests.** The plan tests the *recommended defaults* (debounce same-field ~1s = one op; compound `figure.add` = one op; single reorder = one op). If the owner picks different granularity, the undo unit/Worker/E2E tests must be re-pinned. This is the single biggest "definition of correct" dependency.
2. **Q-D4 (body position + body-action vocabulary, pending the coach)** — tests treat "CBP" as a CBMP typo and use `closed/promenade/wing` + `CBM/CBMP`. If the coach expands the set, the change is now **one edit to `SLOT_REGISTRY`** and the registry-driven tests (V3.2) pick it up automatically. **Resolved (v3):** the Info-sheet-vs-Tag-editor reconciliation that was an open gap is now closed by the registry — all three consumers derive from `SLOT_REGISTRY`, asserted by the V3.2 single-source test. Only the *values themselves* remain coach-pending.
3. **Q-D6 (may a coach edit tags?)** — the permission Worker tests assert the **default (coach cannot edit tags)**. A flip changes both the Worker permission test and the coach-affordance component test.
4. **Q-D5 (does save-a-copy carry comments/journal?)** — tested as the default **no**; flipping changes the deep-copy unit test and the save-a-copy E2E assertion.
5. **Live-refresh (Q-S1)** — polling vs SSE tick is unresolved; E2E LWW currently sequences writes deterministically and refetches manually, so it does not depend on the live-refresh mechanism. Worth noting the LWW test intentionally avoids relying on near-real-time.

*Resolved in spec v3 (previously items 5 and 6):* **bar derivation** is now `bars = ceil(maxBeat/beatsPerBar)` per role with partial bars displayed as-is, and **side auto-naming on deletion** renumbers from order — both re-pinned in the V3.3 micro-defaults and asserted directly by the §3.1 unit tests; they are no longer open gaps. The enum-reconciliation gap is likewise resolved (see item 2) by `SLOT_REGISTRY`.

---

*End of testing plan (v1 + v3 sync).*
