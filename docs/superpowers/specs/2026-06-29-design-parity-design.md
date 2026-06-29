# Design-Parity Program — Make the app look & behave like the canonical design

**Status:** proposed (awaiting review)
**Date:** 2026-06-29
**Owner:** staff-eng (orchestrating subagents)
**Canonical inputs:** `docs/design/project/Ballroom Wireframes v4.dc.html` (primary, 30 labelled frames) + `Ballroom Builder.dc.html` (interactive prototype) + `docs/PLAN.md` v4.4 (domain/behavior source of truth).

---

## 1. Goal & success criteria

Make the Ballroom Flow PWA **look and behave like the canonical design** (wireframes + prototype), extend the
backend only where parity requires it, and ensure **every user workflow is tested and every user-error / edge
case is accounted for**.

**Done means:**
1. Every design frame has a matching app screen that is visually faithful at phone width (header layout,
   structure, density, chips, empty/error states, copy) — verified by screenshot against the rendered frame.
2. Every interaction the design annotates (`.cap` notes) works in the app.
3. The two net-new surfaces — **Journal tab** and **Save-to-personal-library** — are built to the wireframes,
   backed by existing domain logic.
4. Every user workflow (§5) has a green Playwright journey; every user-error / edge case (§6) has an explicit
   test (unit, worker, or E2E) asserting the app handles it gracefully.
5. `pnpm build / test / lint / typecheck` clean; `@smoke` E2E green; `docs/PLAN.md` ↔ code ↔ design have **no
   known divergence** (drift in USER-STORIES/TEST-MAP/`ScopeBadge` reconciled to PLAN v4.4).

**Non-negotiables (project conventions):** TDD (RED→GREEN), soft-delete only, permissions at the DO/REST
boundary, components touch data only through `apps/web/src/store/`, render UI from `apps/web/src/ui` primitives
+ tokens (no hard-coded hex), per-agent git worktrees, explicit-refspec push, no `--no-verify`, keep `PLAN.md`
canonical in the same change.

---

## 2. Scope decisions (confirmed with user 2026-06-29)

- **Parity scope:** mobile-first pixel parity to the wireframes; **keep** the existing sensible desktop
  adaptation (bottom nav → left side-rail at `lg+`). Nothing in the design contradicts the desktop adaptation.
- **Net-new UI (both in scope):** full **Journal tab** (list + Lesson/Practice entry editor + multi-step link
  picker) and **"↟ Save to my library" + personal library** (lineage + "used in N routines"), per PLAN §5.2.
- **Verification:** run the real app (E2E harness, seeded auth/data, no Clerk) and **visually verify each
  screen** against its rendered design frame. Harness is already bootstrapped (§4).

---

## 3. Current state (grounded)

The app is **already built and high-polish** — not a skeleton. It shares the design's visual system
(studio-paper palette, Inconsolata + Caveat, studio-blue accent, token-driven `--bf-*`), has live CRDT
collaboration, copy-on-write figures, sharing/quota/invites, undo, custom kinds, search, and broad unit +
real-worker E2E tests. So this is a **parity / polish / coverage** effort, not greenfield.

**The real gaps (design ↔ app), confirmed by screenshot diff:**

- **App shell:** persistent "Ballroom Flow / Signed in" header on inner screens; design uses no app-name header
  inner — tabs are the nav, each screen has its own compact header. Tabs are `useState` (not URL-routed).
- **Assemble READING (frame 1.6):** biggest gap. App shows a busy text-button header (Undo/Redo/Make a copy/
  List view/Share), **always-on abbreviated columns** (Ri/Bo/Fw/Sw/Tn) with tall white step-cards, plain
  direction text, no inline comments, no Leader/Follower toggle. Design wants: compact `‹ · reading · ✎ · ↗`
  header, Leader/Follower segmented toggle, **only the columns each figure uses** (full type-coloured headers),
  merged **`fwd·HT` Step chips** (direction+footwork in one blue chip), dimmed off-beat (`&`/`a`) rows, figure
  **count pills** (`1 2 3`), and **inline latest-comments** + "+ add comment" under steps.
- **Assemble EDITING (1.7/1.8/1.9):** verify section header style (green collapse header `▾/▸`, "N bars/figs"),
  figure cards (scope dot, count pill, `⠿` drag handle), dashed "＋ add figure"/"＋ add section", inline
  add-section panel, and empty state copy.
- **Figure detail / timeline (1.11) + attribute editor (1.12) + info (1.13) + add-kind (1.15) + custom-type
  (1.16):** verify grid (sticky count column, only-set vs all-columns by mode, `*` required Step, add-timing
  chooser `& a 1 2 3 4`), role rails, toast wording.
- **Library (2.1–2.4):** app Library is read-only browse + a "Mine" list. Design (canonical) wants global
  catalogue grouped by figure-type family with dance filter chips + **"↟ Save to my library"**, and a
  **personal library** with lineage ("based on X" / "your own"), "used in N routines", edit. **Net-new save
  flow + reconcile the stale "variants" tab.**
- **Journal (3.1–3.7):** **stub ("Coming soon").** Net-new: list (author-coloured Lesson/Practice cards with
  link chips + filters), entry editor (type toggle, text, link chips, media "coming soon"), multi-step link
  picker (type → figure/attribute[disabled v1.1] → scope).
- **Profile (4.1) / Share (4.2):** verify swatch picker, "Leader/Follower is a timeline toggle" microcopy;
  Share role pills/labels, fork CTA, invite, info card.
- **Thread (1.14):** profile-coloured comments + reply composer; must also surface inline in reading view.
- **Visual reconciliation:** empty-state copy must match design strings exactly; `ScopeBadge` is two-state by
  **content divergence** (Library/Custom) per PLAN, not three-state global/variant/custom; toast wording
  "copied into this choreo" / "Forked — independent copy" / "Undone".

---

## 4. Verification harness (bootstrapped — do not rebuild)

Already in place on this branch (gitignored under `.parity-audit/`, plus throwaway specs):

- **Design frames → PNG:** `apps/web/_parity_capture.mjs design` renders all 30 labelled wireframe frames to
  `.parity-audit/design/NN_<label>.png` (Playwright, deviceScaleFactor 2).
- **App screens → PNG:** `apps/web/e2e/parity-capture.spec.ts` (`@parity`, not `@smoke`) seeds a user + Waltz
  routine via the gated `/api/test/seed`, injects the E2E session, and screenshots key screens to
  `.parity-audit/app/`. Runs against the real worker in ~5s (`npx playwright test parity-capture
  --project=mobile-chrome`). The E2E server (`bash apps/web/e2e/serve.sh`) builds the SPA + runs the worker
  (SPA+API+WS, test CLERK_JWT_KEY) at `:4173`.
- **Diff:** read design-frame PNG + app PNG side by side; produce a concrete per-screen punch-list.

Each implementation workstream **extends** the capture spec to shoot its screen/states and diffs against the
frame before claiming done. Chrome MCP is available for interactive spot-checks. **All `_parity_capture.mjs`,
`parity-capture.spec.ts`, and `.parity-audit/` artifacts are throwaway and must be removed (or kept behind
`@parity`, never `@smoke`) before final merge.**

---

## 5. User workflows (must each have a green journey)

From PLAN §1.4/§4/§5 (existing journeys noted):

1. Sign in & onboard (name + identity colour) — *profile.spec partial*
2. Create routine (quota-checked) / start-from-sample / start-from-template — *authoring/template.spec*
3. Build structure: add/rename/reorder/soft-delete sections + placements — *authoring.spec*
4. Add a figure: catalogue preset / name-match pre-fill / unmatched → empty custom — *authoring/library.spec*
5. Notate a figure (hero): tap count → place/edit/remove attributes any kind; re-tap clears; Lanes — *authoring*
6. Flip role view (leader/follower/both), persisted — *partial*
7. Edit alignment (entry/exit + per-placement) — *fork-and-figures*
8. Copy-on-write (auto frozen choreo copy on outside-choreo edit; in-place for choreo-owned) — *fork-and-figures*
9. Edit a reused personal-library figure → flows into all your routines — **new (library save flow)**
10. Save a choreo figure to personal library — **new**
11. Fork a routine (frozen, quota-counted, lineage) — *fork-and-figures*
12. Browse library (global grouped + personal w/ lineage + "used in N") — *library.spec (extend)*
13. Annotate (point / figure / family, dance-scoped) + reply threads + filters — *annotations.spec*
14. **Journal**: log lesson/practice, link to step/figure/attribute, scope, filter — **new (journal.spec)**
15. Undo / redo (per-user; other client survives) — *undo.spec*
16. Share & collaborate (roles, invite link, remove, live convergence) — *permission-quota-invite/convergence*
17. Custom attribute kinds (create/edit; merges into registry) — *authoring (custom-kind)*
18. Search routines + figures — *search.spec*
19. Manage profile/plan (name, colour, plan/count, sign out) — *profile.spec*
20. Install PWA / offline shell (deferred to M9 — see §8) — *pwa-a11y.spec (skipped)*

---

## 6. User-error / edge cases (must each have an explicit graceful-handling test)

Grouped (PLAN + USER-STORIES citations in the inventory). Many already covered; **gaps flagged ⚠**:

- **Permissions:** non-member open → denied (REST preflight 401/403); forged sync (valid JWT, no membership) on
  routine *and* figure docs → rejected; invalid/expired token → fail-closed; viewer edit → blocked; commenter
  structural edit → blocked but annotations allowed; commenter/viewer remove-member/invite → forbidden; viewer
  create-annotation → blocked; non-member sees co-member family note → none.
- **Quota/limit:** 4th owned routine → blocked + upsell sheet/toast; fork at cap → 402; shared-in routines don't
  count.
- **Validation:** unknown value to enum kind → rejected on write, passes through on read; timing outside meter
  → rejected; custom kind colliding with builtin slug → ignored; add-figure name with no catalogue match →
  empty custom (vs match pre-fills).
- **Copy-on-write/fork:** outside-choreo edit → auto frozen copy + re-point + toast, source untouched;
  choreo-owned edit → in place; fork frozen (origin edits don't appear); no cross-doc undo of a COW.
- **Undo:** reverts only your last change; other client's concurrent edit survives; new edit clears redo;
  ⚠ "superseded" soft-hint (US-038 AC-3) **never built** — **build a minimal soft hint** ("others built on
  this change") so the AC is satisfied; CRDT still merges (no hard refusal). Design the smallest surface that
  fits the studio-paper system; record it in PLAN as the v1 realization of AC-3.
- **Offline/connectivity:** offline → explicit "you're offline" state, no silent stale edits; no offline
  editing in v1; denied vs offline distinguished by REST preflight, not WS close.
- **Conflict/convergence:** concurrent edits merge (no LWW); duplicate change idempotent; ⚠ section
  reorder + soft-delete two-client merge (US-026 AC-3) **untested**.
- **Delete safety:** soft tombstone only; confirm dialogs (alertdialog) on destructive deletes; reply delete
  author-only.
- **Invite lifecycle:** expired/already-redeemed token → rejected; editor→commenter downgrade at editable cap.
- **New-surface errors:** Journal — empty states (no entries / no match), link-picker attribute disabled
  (v1.1), media "coming soon"; Library — personal-library empty per-dance, "save" idempotence, edit-ripples.

---

## 7. Workstreams (parallelizable; each = its own worktree + agent, TDD, self-verified by screenshot)

Dependency order in **bold**; the rest fan out.

- **WS-0 Foundation (lead, first):** lock the `ui` primitive + token deltas the screens need (e.g. compact
  screen-header component, segmented Leader/Follower toggle, attribute-column grid row, count-pill, inline
  comment line, section collapse header, scope dot). Land shared primitives so screen agents don't collide on
  `ui/`. Reconcile `ScopeBadge` to two-state. **Blocks WS-C/D/E/F.**
- **WS-A Shell & nav parity:** per-screen compact headers; remove persistent app-name header inner; verify tab
  bar icons/active styling; (optional) URL-route the tabs behind the existing router seam.
- **WS-B Choreo list + sheets:** list cards (dance dot, meta, `⋯`), forked amber card + "forked from", empty
  state copy, many-scroll, Open/Fork sheet (1.4), New-choreo sheet (1.5) dance chips + name + bars-math.
- **WS-C Assemble READING (largest):** rebuild to 1.6 — compact header, L/F toggle, per-figure only-set
  type-coloured columns, merged `fwd·HT` Step chips, dimmed off-beat rows, count pills, inline comments.
- **WS-D Assemble EDITING:** sections/figure-cards/add-flows to 1.7/1.8/1.9 (green collapse headers, drag
  handle affordance, dashed add rows, inline add-section, empty copy).
- **WS-E Figure timeline + editors:** 1.11 grid, 1.12 attribute editor (role rails, direction+footwork,
  remove, toast), 1.13 info sheet, 1.15 add-kind picker, 1.16 custom-type builder, 1.17 Profile attribute-types.
- **WS-F Thread / inline comments:** 1.14 thread (profile-coloured, reply composer) + the reading-view inline
  comment surface; wire to existing annotation store.
- **WS-G Library + Save-to-library (net-new + reconcile):** global grouped catalogue + dance chips (2.1/2.2);
  "↟ Save to my library"; personal library w/ lineage + "used in N routines" + edit (2.3/2.4); edit-ripples to
  referencing routines. Extend store/worker as needed (save-to-library promotion).
- **WS-H Journal (net-new):** list + filters (3.1/3.2), entry editor (3.3), link picker type→figure→scope
  (3.4–3.7, attribute disabled v1.1, media "coming soon"). Backed by the existing annotation/journal domain;
  surface journal entries (lesson/practice anchored notes) in a journal-tab UI.
- **WS-I Profile + Share:** 4.1 swatches + microcopy; 4.2 roles/labels, fork CTA, invite, info card.
- **WS-J Visual reconciliation:** exact empty-state/toast/microcopy strings, off-beat dimming, chip radii,
  studio-paper backdrops; sweep for hard-coded values; confirm Tango omits Rise everywhere.
- **WS-K Workflow + error-case test coverage:** fill §6 ⚠ gaps; add journeys for Journal + Save-to-library;
  add the superseded-hint (or defer it in PLAN); two-client reorder/soft-delete merge; Share microcopy.
- **WS-L Doc reconciliation:** update `USER-STORIES.md` + `TEST-MAP.md` wording from retired overlay/variant
  "flow-up" model to PLAN v4.4 frozen-copy; align `ScopeBadge`/toast copy; record any backend extensions and
  the superseded-hint decision in `PLAN.md` **in the same PRs**.

---

## 8. Execution model

- **Worktrees & branches:** each WS in its own git worktree off `development`, explicit-refspec push, run
  gates explicitly (`pnpm typecheck`, `pnpm -r test`, relevant `@smoke`), no `--no-verify`. Lead (me) commits
  any shared edits **before** dispatching the next agent (avoid the uncommitted-edits race).
- **TDD:** unskip/extend the story's tests, RED→GREEN→REFACTOR. New surfaces (Journal, Save-to-library) get
  failing component + journey tests first.
- **Review gates (two-tier):** permission/invariant/security-touching PRs (WS-G save flow, WS-K permission
  tests, any worker change) are **hard-gated** — Frontend + Tester + Staff verdicts before merge; pure-UI
  parity PRs fast-tier with a post-merge visual health check. Never merge before every assigned reviewer posts
  a verdict.
- **Self-verification:** every screen agent extends the capture spec, screenshots its screen/states, diffs
  against the rendered frame, and attaches the comparison to its PR. "Pixel-faithful at phone width" is the
  bar; desktop must remain usable (side-rail) but is not frame-matched.
- **Sequencing:** WS-0 first (shared primitives). Then WS-A/B/G/H/I in parallel (independent screens), WS-C/D/
  E/F after WS-0. WS-J/K/L continuous, finalized last. Integrate to `development` incrementally; keep `@smoke`
  green throughout.
- **Out of scope (defer, keep honest stubs):** PWA install/offline-shell + a11y E2E + app icons (M9, US-050/
  051/052); billing/Pro upgrade (US-053 server `/api/profile` + checkout); full ISTD seed completeness
  (US-054); Ops/observability (US-049); predicate/attribute-link annotations + journal media (v1.1). Each stays
  a clearly-labelled "coming soon"/disabled affordance matching the design's own deferrals.

---

## 9. Risks & mitigations

- **Reading-view rebuild is large & central** → do it behind the existing read-model seam; keep editing view
  working; screenshot-gate each figure layout (multi-column, off-beat, no-attrs, comments).
- **Library "save" needs backend** → confirm the promotion path (choreo figure → account personal-library
  figure) against PLAN §5.2; smallest worker/store extension; hard-gate the PR.
- **Parallel `ui/` collisions** → WS-0 lands shared primitives first; screen agents consume, don't redefine.
- **Doc drift re-introduced** → WS-L owns reconciliation; every backend/behavior change updates PLAN in the
  same PR.
- **Agent git races** → strict per-worktree isolation + commit-before-dispatch.
