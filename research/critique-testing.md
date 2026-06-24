# Adversarial Critique — Testing, Quality & Operations

**Reviewer lens:** testing rigor, testability of the architecture, and operations. Owner has explicitly ranked **quality + a detailed testing plan above feature count**, so this critique holds §9 to a high bar and treats hand-waving as a defect.

**Verdict up front:** The testing *pyramid shape* is right and the stack choices are testable in principle. But §9 is a **list of scenarios, not a test plan** — it names what to test without specifying how correctness is decided, how the multi-client harness is built, or how the highest-risk property (CRDT convergence) is proven rather than smoke-tested. Operations is the weakest section of the entire spec: observability, CRDT schema migration, backup/restore, abuse, and environments are essentially absent. For a local-first app, **schema migration of the persisted CRDT is a known project-killer and the spec does not mention it once.**

---

## 1. Ranked Gaps

### BLOCKERS

**[BLOCKER] B1 — No CRDT schema/version migration story (the local-first killer).**
The CRDT lives in two durable places that are *out of the deploy's control*: the client's IndexedDB and each routine's DO-SQLite. When the Step model gains a field (the spec itself promises additive growth: second step chart Q-D1, Alignment slot Q-D4, role discriminator, finer enums), you will have:
- Old clients (PWA cached, possibly offline for weeks; service workers update lazily) writing the *old* shape.
- New clients writing the *new* shape.
- Both merging into the same MergeableStore.
There is no document/schema version cell, no migration-on-load routine, no "minimum supported client" gate, no forward/backward-compat contract for the merge. TinyBase will happily merge structurally-incompatible rows and you get silent corruption. This is *the* hard problem for local-first and §6/§9 are silent. **This must be designed and tested before any schema is frozen**, because every deferred feature in §10 is a future migration.

**[BLOCKER] B2 — "Test the CRDT merges" is asserted, never operationalized; no convergence/property testing.**
§9.4 has exactly one merge scenario ("both edits survive") and §9.2 says "rebroadcast to a second simulated peer." That proves *doesn't-clobber* on one hand-picked interleaving. It does **not** prove the CRDT's defining property: **convergence** (all replicas reach identical state regardless of operation order/timing) and **commutativity/idempotency** of ops. The owner's stated priority makes this the single most important test and it is absent. There is no:
- Property-based test (fast-check) generating random op sequences across N replicas, applying them in shuffled/duplicated/delayed orders, asserting final-state equality.
- Deterministic multi-replica simulation harness (in-memory MergeableStores, controllable clock, scriptable partition/merge) that runs *without* workerd or Playwright — fast enough to run thousands of interleavings in CI.
Without this, "the CRDT works" is faith, not a tested property. The spec leans entirely on TinyBase's own correctness (§7 Option A risk note even admits "synchronizer maturity for our exact merge edge cases" is an unknown) yet provides no test that would catch a TinyBase merge bug or a misuse of it (e.g. a wrongly-modeled cell).

**[BLOCKER] B3 — Fractional-index reorder correctness is under-tested for its actual failure mode.**
§9.1 tests sortKey generation in isolation and §9.4 has one "concurrent reorder converges" E2E. The real risks are untested: (a) **interleaving exhaustion / precision collapse** — repeated inserts at the same gap (LexoRank/base62 keys grow unbounded or float keys run out of precision) — §9.1 says "stay distinct and ordered" but not "remain distinct after 10k inserts-between" or "rebalance correctly"; (b) the **concurrent same-gap insert tie-break** must be deterministic across replicas (needs a stable secondary key, usually the row id) — there is no test that two replicas inserting at the identical sortKey gap converge to the *same* order rather than merely "no duplicates"; (c) reorder + delete of the neighbor offline on another replica. This is exactly where fractional indexing silently breaks and it deserves property tests, not one happy-path E2E.

### MAJOR

**[MAJOR] M1 — Two-zone write-authority enforcement is tested too thinly for a security-critical boundary.**
§5.3 makes the *entire permission model* depend on the DO rejecting structural ops from non-owners (since the CRDT itself has no concept of authority — it'll merge anything fed to it). §9.2/§9.4 test one happy reject + one forged op. A boundary this load-bearing needs adversarial coverage: forged op *embedded inside an otherwise-valid batch*; a partner who was *removed* mid-session (DO must drop the connection and reject queued offline ops on reconnect — §5/§6 promise this, no test asserts it); a former owner of a fork trying to write to the origin; tag edits specifically (Q-C1 says tags are owner-only structure — is that enforced at the op level or just hidden in UI?). Also: **what happens to a non-owner's rejected offline structural edits?** §6 says "rejected on reconnect" — does the client silently drop them, surface them, or get stuck retrying? No test, no UX defined; this is a data-loss-shaped hole.

**[MAJOR] M2 — Offline reconcile is tested as a single linear scenario, not as the partition matrix it is.**
"Offline reconcile" has many independent axes the spec collapses into one E2E: (a) who edited (owner structure / partner comment / both); (b) duration (brief vs. weeks-old client with a stale schema → see B1); (c) op types (insert / delete / reorder / tag / comment / journal); (d) **delete-vs-edit races** (A deletes a figure offline, B comments on a step inside it offline — what is the converged state? orphaned comment? resurrected figure? this is undefined in §6 and untested); (e) the DO itself being cold/hibernated/PITR-restored mid-reconcile. A reconcile matrix (even a documented subset) belongs in the plan; one Playwright test does not cover it.

**[MAJOR] M3 — Operations is largely undesigned.** The spec is a *design* spec and ops is a design concern. Missing entirely:
- **Observability:** no error monitoring on Workers/DO. workerd exceptions and DO crashes are invisible without **Tail Workers** (or `wrangler tail` + a sink) and/or **Sentry** (`@sentry/cloudflare`). For an offline-sync app, the failures you most need to see (a merge that throws, a sync that wedges, a rejected-op storm) happen server-side in the DO and will be *silent*. No structured logging, no sync-success/conflict metrics, no alerting.
- **Backup/restore of per-routine DOs:** §1 NFR mentions DO "point-in-time recovery" exists, but there is no *operational procedure* — how do you restore one couple's corrupted routine? Is PITR per-DO self-serve or a support action? Export (§8) is per-routine JSON, manual, and explicitly excludes import ("import is deferred"), so **there is no tested restore path at all** — export with no import is a backup you can't restore.
- **Cost alerting / the D1 rows-scanned trap:** platform.md flags the documented $134 "rows scanned" bill. The spec says "index everything" but defines **no budget alarms, no Cloudflare billing notifications, no test/CI check that list/search queries hit an index** (e.g. assert query plans in the vitest-pool-workers layer). "Index everything" is a hope, not a guardrail.
- **Staging vs prod & secrets:** no environments (`wrangler` env per stage), no secrets-management plan (Clerk keys, R2 creds, invite-signing secret — where do they live, how rotated?), no migration-deploy ordering (D1 migrations vs Worker deploy vs DO schema).
- **Rate limiting / abuse:** invite tokens (§5.5) and presigned-URL issuance (§5/§7) are unauthenticated-adjacent surfaces. No rate limiting, no invite-token replay/scope tests, no R2 presign abuse cap. A signed invite link is a capability URL — what stops enumeration or sharing-bomb?

**[MAJOR] M4 — Domain logic separability (ports/adapters) is claimed but not enforced, and the DO is not shown to be testable in isolation.**
§7.1 puts pure logic in `domain/` ("No I/O — unit-testable") which is good. But the **DO mixes three concerns** (TinyBase synchronizer + WebSocket lifecycle + authorization gate) with no stated seam between auth-decision logic and Cloudflare bindings. The auth gate — the most security-critical, most-needing-unit-tests piece — should be a **pure function** (`authorizeOp(member, op) -> allow|deny`) that the DO calls, so it's testable without spinning workerd. The spec doesn't carve that out; as written the only way to test authority is the slow vitest-pool-workers layer, which invites under-testing (see M1). Same for sync-conflict resolution helpers. **Flag:** without an explicit ports/adapters seam, the highest-value tests land in the slowest layer.

**[MAJOR] M5 — CI realities for this exact stack are not addressed; flakiness is predictable.**
§9.6 says "CI runs all five layers" — that is the aspiration, not the plan. Known pain this stack will hit, unmentioned:
- **workerd in CI** is generally fine, but DO + WebSocket Hibernation tests have timing/eviction behavior that differs from local; needs explicit waits, not sleeps.
- **Playwright + service worker + IndexedDB + offline emulation** is the canonical flaky combination: SW registration races page load; `context.setOffline(true)` doesn't stop an already-open WebSocket the way you'd expect; IndexedDB persistence across reloads needs care; **two contexts + sync timing** means tests must assert on *convergence with polling/retry*, never fixed delays. The spec names these tests but gives no determinism strategy (fake timers? test-only "sync now" hook? deterministic clock injection into the CRDT?). Without one, the two-client tests will be the flakiest, most-skipped, least-trusted tests — defeating their purpose.
- No mention of **test isolation** (each test its own DO id / fresh D1 via `applyD1Migrations` per test vs per suite) or **parallelism** constraints.

### MINOR

**[MINOR] m1 — PWA / cross-browser / iOS-Safari testing is asserted as a target but has no test.**
§8 lists iOS Safari + Chrome Android + installable PWA as support targets. iOS Safari is the highest-risk runtime for *exactly this app*: **service-worker + IndexedDB eviction under storage pressure** (Safari's 7-day eviction of unused PWA data; quota behavior), Background Sync API **is not supported on iOS Safari** (which breaks the §6 media deferred-upload design on iOS — a real functional gap, not just a test gap), and `MediaRecorder` codec differences. None of this is in the test plan or even acknowledged as a risk. At minimum: a documented manual device matrix, and a fallback for Background Sync on iOS (foreground retry queue).

**[MINOR] m2 — Accessibility is a stated NFR (WCAG AA) with zero automated coverage.**
§8 commits to WCAG AA (color-not-sole-signal, 44px targets, SR-navigable, reduced-motion). §9 has no axe-core/`@axe-core/playwright` checks, no keyboard-nav test, no contrast assertion on the heavily color-coded technique chips / identity colors (the very place color-as-signal risk concentrates). A committed NFR with no test is a wish.

**[MINOR] m3 — JWT/auth edge verification has only happy-path-ish coverage.**
§9.2 tests invite issue/redeem + expiry. It does not test the JWT verification edge cases that networkless verification makes critical: expired session JWT, wrong-issuer/audience, tampered signature, **JWKS rotation** (Clerk rotates keys — is the cached key refreshed? this is a known outage cause), clock-skew tolerance, and the DO using a *stale* identity for a long-lived hibernated WebSocket (the JWT may expire mid-connection — is it re-validated? §6 mentions re-validating authorization on sync but not re-validating the *token's* freshness). These are security tests, not nice-to-haves.

**[MINOR] m4 — "Export honors data ownership" but export itself is untested and lossy-by-design.**
§8 export = JSON of structure + comments + linked journal. No round-trip test, no schema for the export, and since import is deferred it can't be validated by re-import. Combined with M3's restore gap, the data-ownership promise is unverifiable.

**[MINOR] m5 — Media deferred-upload (v1.1) test is a stub for a genuinely hard flow.**
§9.4 has one Background-Sync E2E. The hard parts are untested/undesigned: presigned-URL **expiry between offline-capture and eventual upload** (the URL is requested at flush time per §6 — good — but the entry's CRDT metadata references an R2 key that doesn't exist yet, so other clients can sync a *dangling* media reference; what do they render?), upload failure/retry/backoff, partial multipart upload resume, and orphaned R2 objects (entry deleted before its blob uploads → R2 leak with no GC). Fine to defer the feature, but the test plan should name these before v1.1.

---

## 2. Concrete Additions to the Testing Plan

**Add a new layer 0: Deterministic CRDT simulation harness (pure, fast, no workerd).**
- In-memory MergeableStore replicas with an injectable logical clock and a scriptable network (`partition`, `deliver`, `delayDuplicate`, `merge`).
- **Property tests (fast-check):** for random op streams over 2–4 replicas applied in shuffled / duplicated / partitioned-then-merged orders, assert (a) **convergence** — all replicas byte-identical after full delivery; (b) **idempotency** — re-delivering an op is a no-op; (c) **commutativity** — order of independent ops doesn't change final state; (d) invariants hold (no orphaned step under a deleted figure; sortKeys remain a strict total order; bar-count derivation matches converged structure).
- Targeted adversarial cases: same-gap concurrent insert tie-break determinism; insert-vs-delete-of-neighbor; reorder-vs-reorder; 10k repeated inserts-between (precision/length bound + rebalance).

**Add CRDT schema-migration tests (ties to B1).**
- Introduce a `schemaVersion` value-cell. Test: old-shape store + new-client load → migration runs, data preserved, converges with a new-shape replica. Test merge of old-shape and new-shape rows produces the migrated shape, not corruption. Test "client below minimum version" is refused a sync with a clear error rather than silently corrupting.

**Promote the auth gate to a pure function and unit-test it exhaustively (ties to M4/M1).**
- `authorizeOp(membership, op): Decision` table-tested over {role × op-type × zone} including removed-member, fork-origin cross-writes, tag ops, batched mixed ops. Then one thin vitest-pool-workers test confirms the DO *calls* it and drops connections on removal.

**Replace single reconcile E2E with a reconcile matrix** (documented subset run in the fast simulation harness for the data-correctness axes, with 2–3 representative Playwright E2Es for the real SW/IndexedDB/two-context path). Explicitly include delete-vs-comment and delete-vs-edit races with a *defined expected outcome* (which forces §6 to specify the semantics).

**Determinism strategy for E2E (ties to M5):** add a test-only `window.__syncNow()` / quiescence signal the app exposes so Playwright asserts on "sync settled" deterministically instead of timed waits; inject a controllable clock; document the SW-ready wait helper. State the isolation rule (fresh D1 via `applyD1Migrations` per file; unique DO id per test).

**Query-plan guard in CI (ties to M3 cost trap):** in the vitest-pool-workers layer, run `EXPLAIN QUERY PLAN` on every list/search/ACL query and **fail the test if it does a SCAN of a table without using an index.** This turns "index everything" into an enforced invariant.

**Auth edge tests:** expired/wrong-aud/tampered JWT; JWKS rotation refresh; token expiry mid-hibernated-WebSocket → re-auth or graceful disconnect.

**A11y + PWA:** `@axe-core/playwright` on each screen; keyboard-only nav pass; contrast assertion on technique-chip and identity-color palettes; a documented iOS-Safari manual device pass covering install, offline boot, IndexedDB persistence after eviction window, and the Background-Sync fallback.

**Observability as a tested artifact:** assert errors thrown in the DO/Worker reach the Tail Worker/Sentry sink (a smoke test that a deliberately-thrown error is captured), and that a structured "sync conflict / rejected op" event is emitted.

---

## 3. New / Sharper Open Questions (the spec's §11 misses these)

**Q-OPS1 — CRDT schema-evolution & minimum-client policy.** *(maps to B1; §11 has nothing on this)* When the Step/Figure schema grows (it will — half of §10 is deferred fields), how do old offline clients and old DO state migrate? Why it matters: silent merge corruption is the top cause of local-first app failure. Options: (a) versioned cell + on-load migration + "min supported client refuses sync" gate [recommended]; (b) only-ever-additive-optional fields, never rename/remove (cheap but constrains the model forever); (c) lazy per-row migration on first write. **Decide before freezing the schema.**

**Q-OPS2 — Observability vendor & budget.** Do you want **Sentry** (`@sentry/cloudflare`, free dev tier) for Workers/DO error tracking, or are Cloudflare **Tail Workers** + Logpush to R2 enough? Why it matters: sync failures are server-side and silent without this; "$0 ops" should not mean "no visibility." Options: Tail Worker → R2 (cheap, DIY dashboards) vs. Sentry (richer, another vendor/free-tier dependency) vs. both. Also: do you want a synthetic uptime/sync canary?

**Q-OPS3 — Backup/restore & import.** Export-without-import (§8) is a backup you can't restore. What's your tolerance for "a corrupted routine can only be fixed by Cloudflare DO PITR, by you, manually"? Do you want **JSON import** in v1 to make export a real restore path, and is per-DO PITR self-serve for a user or an owner-only support action? Why it matters: it's the difference between recoverable and unrecoverable data loss for a couple's months of work.

**Q-OPS4 — Flaky-test & CI tolerance.** What is your tolerance for two-client/offline E2E flakiness, and do you accept building a test-only sync-quiescence hook + deterministic clock into the app to make them reliable? Why it matters: without instrumentation these tests flake, get `.skip`-ed, and the highest-risk area ends up untested — the opposite of the stated priority. Options: invest in determinism hooks [recommended]; or move correctness coverage down to the pure simulation harness and keep only a few E2Es as smoke.

**Q-OPS5 — iOS Safari Background-Sync fallback.** Background Sync API is unsupported on iOS Safari, breaking the §6 media-upload design on iPhone. What's the fallback — foreground retry queue on next app open? Accept "media upload only completes while the app is open" on iOS? Why it matters: iOS is half your mobile users and the spec's media architecture silently assumes a non-iOS capability.

**Q-OPS6 — Abuse/rate-limit posture on invites & presigns.** Invite links are capability URLs and presign issuance is a cost lever. What rate limits / quotas do you want (per-user invite cap, presign-per-minute, invite-token single-use vs. multi-use, revocation)? Why it matters: a shared/leaked invite or a presign loop is the cheapest way to blow the $0 budget or leak access. Options: per-user quotas in D1 + single-use tokens [recommended] vs. accept-the-risk at hobby scale.

**Q-OPS7 — Rejected-offline-edit UX.** When a non-owner's offline structural edit (or an old/forked-origin write) is rejected on reconnect, what should the user see and what happens to their work? Why it matters: §6 promises rejection but undefined UX here is a silent-data-loss complaint waiting to happen. Options: surface "these edits couldn't be applied — fork to keep them?" vs. silently discard (bad) vs. prevent at UI so it never reaches sync (still need a defense-in-depth test).
