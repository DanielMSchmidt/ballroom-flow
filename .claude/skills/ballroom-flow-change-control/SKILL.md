---
name: ballroom-flow-change-control
description: Load BEFORE making any change to the weave-steps repo — when classifying a change, choosing a branch, deciding which docs/gates apply, wondering whether something is allowed (new dependency, weakening a test, editing seed data, changing a locked decision), or preparing a commit/PR. Also load when a rule in CLAUDE.md feels inconvenient and you're tempted to route around it.
---

# Weave Steps — Change Control

The rules for changing this repo, each with the incident that made it a rule. This codebase was built in 8 days / 131 PRs (2026-06-24 → 2026-07-02); every rule below was paid for. The internal issue numbers cited in commit messages (#63, #161, #168, …) are a gitignored ledger and do NOT resolve on GitHub — PR numbers do.

**When NOT to use this:** For *how to build/run/test* → `ballroom-flow-build-and-env` and `ballroom-flow-validation-and-qa`. For *what the architecture is* → `ballroom-flow-architecture-contract`. For *why past attempts failed in detail* → `ballroom-flow-failure-archaeology`. For the active migration work itself → `ballroom-flow-v5-migration-campaign`. This skill is only the governance layer: what class of change you're making, what gates it must pass, and what is forbidden.

## Step 0 — before you touch anything

```bash
git branch --show-current      # must NOT be main; feature work branches off development
git status --short             # start clean
```

- **Branch off `development`, never `main`.** `main` is release-only and stale relative to real code. A local pre-push hook and GitHub branch protection both block direct pushes to `main` and `development`.
- Read `docs/PLAN.md` for the area you're changing — it is the single source of truth; any doc/code disagreement is resolved by PLAN.md, and a PLAN-vs-code divergence is *itself a bug* to fix in the same change.

## 1. Change classification

Classify your change first; each class has its own required reading, gates, and definition of done.

| Class | Read first | Gates that apply | "Done" means |
|---|---|---|---|
| **Domain logic** (`packages/domain/` — schemas, overlay/variant resolution, fork, undo, registry, timing) | PLAN §2/§3/§5; `docs/TEST-MAP.md` for covering tests | TDD unskip-first; `pnpm lint && pnpm typecheck && pnpm test`; coverage thresholds armed (domain lines ≥90, `packages/domain/vitest.config.ts`) | Unit/property tests green; PLAN updated if the model moved; if user-visible, the feature's E2E journey is green |
| **Worker / Durable Object / sync / permissions / D1** (`apps/worker/`) | PLAN §5/§6; `docs/spike/SPIKE-FINDINGS.md`; `docs/DEVELOPMENT.md` harness section | Same as above + worker coverage (lines ≥88, `apps/worker/vitest.config.ts`); `expectIndexedQuery` for every new D1 query; **hard review gate** (§5 below) if it touches permission/invariant/security | Worker tests in real workerd green; journey green; boundary behavior asserted at the DO seam |
| **Web UI** (`apps/web/`) | **`docs/design/` bundle first** (prototype the change there), then `docs/DESIGN-SYSTEM.md`; PLAN §4 | Design-bundle parity (pixel-for-pixel); components go through `apps/web/src/store/` only; component + a11y (axe) tests; E2E journey | The Playwright journey for the feature is green on the PR — see delivery model below |
| **Docs** (`docs/`, `README.md`, `CLAUDE.md`) | The doc's own header + PLAN if it cites decisions | `pnpm lint` (markdown untouched by biome, but links/claims must match code) | No new drift: every command/path/number stated is verified against the repo |
| **Seed / figure data** (`docs/seed/*.json`, `packages/domain/src/library-data.ts`, `figure-charts.generated.ts`, `scripts/gen-*.mjs`) | PLAN D30 (§8) + `ballroom-flow-figure-data-pipeline` | **No-fabrication rule** (§3 below); generators are deterministic — run them and check `git diff --stat`; seeder is additive-only, never overwrites an existing doc | Regenerated files committed; every data value has a recorded source; unverifiable entries removed, not guessed |
| **Tooling / CI / config** (`.github/`, `biome.json`, `lefthook.yml`, vitest/playwright configs) | `docs/TOOLING.md` | Don't break the layered CI gate; don't weaken thresholds/timeouts to pass (§3); new deps need owner sign-off (§3) | Full `pnpm test` + `@smoke` E2E still green; CI parity preserved |

**The delivery model (adopted 2026-06-26, recorded in CLAUDE.md §6):** every remaining feature ships as an **end-to-end-testable feature, gated on its Playwright journey** (`apps/web/e2e/*.spec.ts`). `@smoke` runs on every PR; the full 3-project matrix runs nightly. A feature is "done" **only when its journey is green on the PR** — not when its unit tests pass. Why: the M1–M3 stack shipped with **zero verified browser journeys**; unit-green code turned out to have hydration, seeding, and auth bugs that only browser journeys caught (PRs #57/#58, the "Unknown figure" cluster #81/#94). Don't relitigate this.

### Fast "am I allowed to…?" lookup

| You're about to… | Answer | Detail |
|---|---|---|
| Branch off `main` because the task mentions `main` | **No.** Branch off `development` | §2.1 — the #83/#85 revert |
| Write implementation code before a failing test | **No.** Unskip/write the test first | §2.2 |
| Change behavior without touching `docs/PLAN.md` | Only if PLAN already describes the new behavior | §2.3 |
| Build new UI directly in React | **No.** Prototype in `docs/design/` first | §2.4 |
| Hard-delete a row/element, or move by delete+reinsert | **Never.** Tombstone; move via `sortKey` | §2.5 |
| Add a permission check inside CRDT merge/apply code | **No.** Enforce at the DO boundary / REST | §2.6 |
| Bump a timeout / add a retry / skip a flaky test | **No.** Root-cause it first | §3.1 |
| `pnpm add` a new package | Not without owner sign-off | §3.2 |
| Fill in a plausible-looking footwork/timing value | **Never.** Source it or leave it out | §3.3 |
| Work around a PLAN §8 locked decision that blocks you | Surface it to the owner; don't diverge silently | §3.4 |
| `git push --no-verify` | **Never** | §4 |
| Merge a red PR into `development` | **No** — merge = staging deploy | §4 |

## 2. The non-negotiables (each with its incident)

1. **Branch off `development`, never `main`.**
   *Incident:* PR #83 built an entire figure-library layer from `main`'s stale skeleton; it was fully reverted (PR #85, 720103d) and redone from `development` (full account: **ballroom-flow-failure-archaeology**). This happened *despite* the docs saying so, which is why the pre-push hook and this skill now exist. (`main` still carries divergent main-only commits; do not trust it as a base for anything.)

2. **TDD, unskip-first (RED→GREEN→REFACTOR).**
   The backlog ships as **skipped tests**. To implement a story: find its tests in `docs/TEST-MAP.md`, unskip them, watch them fail, make them pass, refactor. Never write implementation before a failing test. *Corollary incident:* skipped E2E convergence journeys sat with a stale "not built yet" reason long after the machinery existed (d49fb52, PR #61) — when you unskip, also sweep for stale skip reasons in the same area.

3. **Keep `docs/PLAN.md` canonical — update it in the same change.**
   Divergence between PLAN and code is a bug. PLAN records *rejected alternatives inline* (e.g. D10's rejected read-by-default sync, D12's frozen-copy reversal) precisely so the same debate isn't re-run. The figure model oscillated three times (live-overlay v4 → frozen-copy → live-overlay-with-per-beat-ownership v5, PR #132/e27bca6); PLAN §8/§12 is where that history lives. If your change moves a decision, the PLAN edit is part of the diff, not a follow-up.

4. **UI starts in the Claude Design bundle (`docs/design/`).**
   Prototype in the `docs/design/project/*.dc.html` bundle first, then recreate pixel-for-pixel with `apps/web/src/ui` primitives. Shipped-UI-vs-bundle divergence is a bug. The bundle is authoritative but not infallible: when it's *factually wrong about the domain*, push back and fix the design, don't adopt the error (4b9cf8a rejected the designer's "Turn: Continue" per-step amount and the "CBP" slip for CBMP).

5. **Soft-delete only.** Every removal is a `deletedAt` tombstone; never hard-remove. CRDT merge semantics and the undo model both depend on it (see `research/extensibility-undo.md`: cascading deletes were an op-log-undo blocker). Also never delete-and-reinsert to *move* a list element — that's the splice-reorder bug (PR #107, 38dfba7): concurrent edits to the moved item were lost. Moves use the `sortKey` fractional index (`packages/domain/src/order.ts`).

6. **Permissions are enforced at the DO sync boundary (and REST), never by post-hoc CRDT cell rejection.** Per-cell rejection is incoherent with CRDTs (`research/critique-sync.md`). Four boundary incidents define the standard:
   - Gate by **observed effect**, not client-declared labels — eb04a33: a mislabelled commenter frame could otherwise smuggle structural edits.
   - **Re-check roles after connect** — 99fa1b9: role was resolved once at handshake and frozen in the hibernation attachment, so a removed editor kept live write access until reconnect.
   - **Guard REST upserts** — 089dbc0: POST /api/figures let any authenticated caller rewrite a victim's registry title and self-escalate to editor via the membership cascade.
   - Remember **owners have no membership row** (`resolveEffectiveRole` elevates them without one) — 92ace53: author sets built from `listMembers` silently excluded the owner.
   Any change in this area is hard-gated (§5).

7. **IDs are client-generated ULIDs.** Server-assigned IDs are a CRDT blocker (`research/extensibility-crdt.md` — [BLOCKER]-rated): offline/concurrent creation needs collision-free client IDs.

8. **TS strict; no `any`.** `noExplicitAny` is a Biome **error** (`biome.json`). Run `pnpm lint && pnpm typecheck` before committing (lefthook enforces on staged files anyway).

9. **The suite must stay green — skipped tests must not break collection.**
   Never top-level-import a not-yet-built product export: it throws at module load *even when the test is skipped*. Use `import type` (erased) or a dynamic `await import(...)` inside the test body. The canonical pattern is `importDomain()` in `packages/domain/src/__fixtures__/domain-api.ts`. Worker/DO tests additionally require `isolatedStorage: false` + a unique DO id per test (`apps/worker/src/test-support/do-id.ts`) — an M0.5 spike finding (SQLite-backed DOs break isolated-storage teardown; storage persists across tests).

## 3. The unwritten rules (now written)

These were never in CLAUDE.md but are enforced in practice — the history is unambiguous.

1. **Never weaken a test to make it pass. Flakes get root-caused, not retried or loosened.**
   The dominant CI flake of 2026-06-30 (a11y axe timeouts) was root-caused to axe being O(nodes) over a ~2975-node render of all ~240 figures — the fix was rendering one dance's worth of identical markup plus *justified* timeout headroom (b419e0a, ad22e16), not a blind timeout bump or a skip. Other flake classes were each *distinguished and fixed at the cause*: shared-D1 migration collisions (79b927d), and the reload flake that turned out to be TWO bugs — hydration ("live" flipped on socket open before catch-up, PR #57/97e7fea) vs durability (client-side initial seed lost on reload, PR #58/4ef16ac). If a test is red, the code is guilty until proven otherwise. Deleting/skipping a test requires the same justification as deleting the feature it covers (d49fb52 is the cautionary stale-skip tale).

2. **No new dependencies without owner sign-off.**
   The project deliberately runs core Automerge with a hand-rolled sync loop instead of `automerge-repo` (locked decision D6; M0.5 spike concluded the repo layer wasn't needed). Renovate manages upgrades and majors are gated by review (the pnpm-11 major, PR #113, sat open pending decision). Also a pnpm-11 trap: a new dep with a postinstall build script silently won't build unless added to `allowBuilds` in `pnpm-workspace.yaml`. Propose the dependency to the owner with the alternative-considered; don't just add it.

3. **Never invent domain data.**
   The figure-data standard, set in PRs #117/#118: values come from verifiable sources with recorded provenance; **37 unverifiable figures were removed rather than guessed** (241→204); every proposed data change was then **adversarially re-verified** by an independent pass re-fetching every source (160 CONFIRM / 18 REJECT / 23 UNCLEAR-left-as-is). `docs/seed/figure-charts.json` carries per-entry source attribution and the explicit "NO fabrication" meta rule. If you can't source it, leave it empty or remove it — an empty attribute timeline is honest; a plausible-looking fake is data corruption.

4. **A locked decision (PLAN §8, D1–D31) is changed by surfacing it to the owner — never by silently diverging.**
   Decisions *do* get reversed here (Yjs→Automerge; frozen-copy→v5 live overlays; the read-by-default sync rejected inside its own PR #95) — but always explicitly, argued against a **concrete named scenario** (forking; the US-015 convergence journeys; the *Passing Tumble Turn*), and recorded in PLAN with the rejected alternative. If a locked decision feels wrong, write up the scenario that breaks it and raise it; code that quietly contradicts a locked decision will be reverted. PR #90 is the dead-end that comes from building against a decision the codebase had already moved past. *(Since 2026-07-13, WEP-0001: the vehicle for raising it is a **WEP** — `docs/proposals/README.md` §6; PLAN §12 is the closed pre-process ledger.)*

### Classification edge cases

- **A change spanning classes gets the union of gates, strictest tier winning.** Most real features span web-UI + domain + worker (e.g. a figure-editor feature touches `packages/domain` resolution, the DO snapshot path, and the React editor): design-bundle-first for the UI part, unskip-first for every layer, worker hard-gate because a worker file moved.
- **"Just a refactor" is still a class.** A refactor inside `apps/worker` permission code is a hard-gate change even if behavior is "unchanged" — the 2026-07-02 review criticals (§5) all hid in code that looked settled.
- **Generated files are seed-data class, not domain class.** `packages/domain/src/library-data.ts` and `figure-charts.generated.ts` are outputs of `scripts/gen-library.mjs` / `scripts/gen-figure-charts.mjs` over `docs/seed/*.json`. Edit the JSON + regenerate; never hand-edit the generated TS (the next generator run deterministically erases your edit — check with `git diff --stat` after running). Details in `ballroom-flow-figure-data-pipeline`.
- **Precedence when documents disagree:** `docs/PLAN.md` (current version) > code > every other doc. Older superpowers specs (`fe3-variants-cow`, design-parity's model sections) describe superseded figure models — the *workflow* conventions in them still hold; the *domain model* statements yield to PLAN v5. When you find drift, fixing the stale doc is in-scope for your change (divergence = bug).

## 4. Mechanics

**Git hooks (lefthook, installed by `pnpm install`):**
- *pre-commit* (parallel): `biome check --write` on staged JS/TS (autofixes re-staged) + `pnpm -r typecheck` on the whole monorepo.
- *pre-push*: blocks direct pushes to `main`/`development` (GitHub branch protection is the real guard). **Never `--no-verify`** — the superpowers plan template forbids it verbatim.

**PR flow:** branch off `development` → PR back into `development`. Local gate before pushing:

```bash
pnpm lint && pnpm typecheck && pnpm test          # all unit/component/worker suites
pnpm test:e2e:smoke                                # or: pnpm --filter web exec playwright test --grep @smoke --project=chromium-desktop
```

PR CI (`.github/workflows/ci.yml`) runs lint → typecheck → domain coverage → build → worker coverage → web tests → chromium `@smoke` E2E. Commit/push only when asked; keep changes within the workspace you own.

**Deploy trigger:** merging a PR into `development` **auto-deploys to staging**; pushing `development`→`main` (a release) auto-deploys to **production** (`.github/workflows/deploy.yml`, `on: push: branches: [development, main]`, environment selected by ref). The deploy job re-runs lint/typecheck/build/tests/smoke, applies D1 migrations `--remote`, then `wrangler deploy --env <env>`. It skips gracefully if `CLOUDFLARE_API_TOKEN` is unset. There is no manual deploy step to forget — which means **a merge to `development` is a deploy**; don't merge red.

**The never-deploy-dist-e2e rule:** the E2E harness builds an **auth-bypass bundle** (`VITE_E2E=1`) into `dist-e2e/` (gitignored, separate wrangler env `[env.e2e]`) — it must never deploy. Isolate build outputs by *path*, never rely on step ordering; if you touch build outputs, wrangler envs, or the deploy workflow, verify what lands in `apps/web/dist` (incident e71d06d, PR #106 — every "successful" staging deploy once shipped the bypass; full story: **ballroom-flow-failure-archaeology**).

**Commit-message convention (observed across history):** conventional-commit style, `type(scope): imperative summary` — types `feat|fix|docs|test|chore|refactor`; scopes are the area (`domain`, `worker`, `web`, `plan`, `invite`, `figure-editor`, `assemble`, `screenshots`). Bodies explain the *why* and cite the incident/decision. `[skip ci]` only on the video-bot's regeneration commits (the screenshot bot's auto-commit was removed 2026-07-14 — the `screenshots` job in `ci.yml` now renders + diffs without committing). Examples from HEAD: `fix(worker): enforce the permission boundary past the handshake — role refresh on open sockets + annotation authorship` (99fa1b9), `docs(plan): v5.0 — live shared figures + overlay variants (reverses the frozen-copy model)` (e27bca6).

**Branch naming (observed):** `feat/<slug>`, `fix/<slug>`, or agent-session branches `claude/<slug>-<suffix>` — all off `development`. Squash-merge is common; beware the one recorded squash hazard (79b927d): a concurrent direct-push race dropped half a fix during a squash — after merging, confirm your critical hunks actually landed on `development`.

**Feature workflow artifacts — WEPs (since 2026-07-13, WEP-0001; supersedes the docs/superpowers convention for NEW work):** a substantive change starts as a **Weave Enhancement Proposal** — `docs/proposals/NNNN-slug/README.md` (front-matter metadata + Summary → Motivation → Proposal-with-named-scenario → Design Details → Test Plan → **Ship Gate** (the Playwright journey that defines done) → Drawbacks → Alternatives), with the optional checkbox execution plan as `plan.md` in the same directory (the old `docs/superpowers/plans` role, same per-step failing-test format). `docs/proposals/README.md` is the normative process (statuses, when a WEP is required, approval). The existing `docs/superpowers/specs|plans` files remain as the historical record — don't move or rewrite them. Multi-agent execution still uses per-agent git worktrees with commit-before-dispatch.

**Global constraints repeated verbatim in every superpowers plan** (they are the same rules as §2, enforced per-task): TDD RED→GREEN→REFACTOR; no `any`; soft-delete only; D1 is a pure index; client ULIDs; components only via `apps/web/src/store/`; every D1 query indexed (EXPLAIN no-SCAN via `expectIndexedQuery`); run `pnpm -r typecheck && pnpm biome check . && pnpm -r test` as the gate; never `--no-verify`.

## 5. Two-tier review gate (docs/superpowers convention)

From `docs/superpowers/specs/2026-06-29-design-parity-design.md`:

| Tier | Applies to | Gate |
|---|---|---|
| **Hard gate** | Permission/invariant/security-touching PRs — **any worker change**, save-flow, permission tests, DO boundary, auth, quota | Frontend + Tester + Staff verdicts **before merge**. Never merge before every assigned reviewer posts a verdict. |
| **Fast tier** | Pure-UI design-parity PRs | Merge, then a post-merge visual health check. |

When in doubt, hard-gate: all four review-verified criticals of 2026-07-02 (undo soundness 3725ec9, figures-route authz 089dbc0, projection clobber 9edab0a, post-connect role enforcement 99fa1b9) were in exactly this class. Security-adjacent diffs that "look small" are where this repo's worst bugs lived.

## Quick pre-flight checklist

- [ ] On a branch off `development` (not `main`), clean tree
- [ ] Change classified (§1); required docs read; PLAN.md section identified
- [ ] Covering tests found in `docs/TEST-MAP.md`; unskipped and failing first
- [ ] No new dependency / weakened test / invented data / silent divergence from a D-decision (§3)
- [ ] PLAN.md updated in the same diff if any decision or model moved
- [ ] `pnpm lint && pnpm typecheck && pnpm test` green; feature journey green (`@smoke` at minimum)
- [ ] If worker/permission/security-touching: hard review gate (§5)
- [ ] Nothing routes `dist-e2e`/E2E env toward a deployable path

## Provenance and maintenance

Authored 2026-07-02 against repo HEAD 70eed7e on `development`. Verified directly: `lefthook.yml` (pre-commit biome+typecheck, pre-push branch block), `.github/workflows/deploy.yml` (push-to-development/main trigger, env selection), `.gitignore` line 3 (`dist-e2e/`), `apps/web/e2e/serve.sh` (E2E builds to dist-e2e), `biome.json` (`noExplicitAny: "error"`), `packages/domain/src/__fixtures__/domain-api.ts` (`importDomain()`), `apps/worker/src/test-support/do-id.ts`, PLAN.md §8 D30 additive-only seeder + §12, `docs/superpowers/specs/2026-06-29-design-parity-design.md` lines 206–209 (two-tier gate), root `package.json` scripts, and commit messages/hashes via `git log origin/development`. Historical PR numbers (#83/#85, #95, #106, #107, #117/#118, #132) verified against merge commits in history. Coverage thresholds and test counts are as of 2026-07-02.

Re-verify on drift:
- `git log --oneline -5 origin/development` — has HEAD moved past 70eed7e? Re-check PLAN §9 status boxes.
- `grep -n "branches" .github/workflows/deploy.yml` — deploy trigger unchanged?
- `grep -n "dist-e2e" .gitignore apps/web/e2e/serve.sh` — E2E output isolation intact?
- `grep -n "noExplicitAny" biome.json` and `grep -n "protect-branches" lefthook.yml` — gates still armed?
- `grep -n "lines" packages/domain/vitest.config.ts apps/worker/vitest.config.ts` — coverage thresholds current?
